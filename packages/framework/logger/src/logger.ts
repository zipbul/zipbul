import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';

import type {
  LogArgument,
  LogContextTarget,
  LogLevel,
  LogMessage,
  LogMetadataRecord,
  LogMetadataValue,
  Loggable,
  LoggerOptions,
  Transport,
} from './interfaces';

import { RequestContext } from "@zipbul/request-context";
import { ConsoleTransport } from './transports/console';

declare global {
  var WORKER_ID: number | undefined;
}

const LOG_LEVELS: readonly string[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const FORMAT_SPECIFIER = /%[sdifjoO]/;

const resolveEnvLogLevel = (): LogLevel | undefined => {
  const envLevel = Bun.env.LOG_LEVEL;

  if (typeof envLevel === 'string' && LOG_LEVELS.includes(envLevel)) {
    return envLevel as LogLevel;
  }

  return undefined;
};

export class Logger {
  private static globalOptions: LoggerOptions = {
    level: resolveEnvLogLevel() ?? 'info',
    ...(Bun.env.NODE_ENV === 'production' ? { format: 'json' as const } : {}),
  };
  private static transports: Transport[] = [new ConsoleTransport(Logger.globalOptions)];
  private static scopeStore = new AsyncLocalStorage<Logger>();

  private readonly context?: string;

  private readonly metadata: LogMetadataRecord;

  /** Per-instance timers started via `time(label)`, settled by `timeEnd(label)`. */
  private readonly timers = new Map<string, number>();

  constructor(context?: string | LogContextTarget | object, metadata?: LogMetadataRecord) {
    this.metadata = metadata ?? {};

    if (typeof context === 'function') {
      this.context = context.name;
    } else if (typeof context === 'object' && context !== null) {
      const constructorName = context.constructor?.name;

      if (typeof constructorName === 'string' && constructorName.length > 0) {
        this.context = constructorName;
      }
    } else if (typeof context === 'string') {
      this.context = context;
    }
  }

  /**
   * Executes `fn` within an ALS scope that makes `logger` available
   * to any code that calls `Logger.inherit()` during the callback.
   *
   * @public
   */
  static runScoped<T>(logger: Logger, fn: () => T): T {
    return Logger.scopeStore.run(logger, fn);
  }

  /**
   * Returns the Logger instance from the current ALS scope. Throws if no
   * scope is active — use `new Logger('scope')` for standalone usage.
   *
   * @public
   */
  static inherit(): Logger {
    const parent = Logger.scopeStore.getStore();

    if (!parent) {
      throw new Error('Logger.inherit() called outside Logger.runScoped()');
    }

    return parent;
  }

  static configure(options: LoggerOptions) {
    this.globalOptions = { ...this.globalOptions, ...options };

    if (options.transports) {
      this.transports = options.transports;
    } else {
      this.transports = [new ConsoleTransport(this.globalOptions)];
    }
  }

  child(metadata: LogMetadataRecord): Logger {
    const cloned = new Logger(this.context, { ...this.metadata, ...metadata });
    return cloned;
  }

  trace(msg: string, ...args: ReadonlyArray<LogArgument>) {
    this.log('trace', msg, ...args);
  }

  debug(msg: string, ...args: ReadonlyArray<LogArgument>) {
    this.log('debug', msg, ...args);
  }

  info(msg: string, ...args: ReadonlyArray<LogArgument>) {
    this.log('info', msg, ...args);
  }

  warn(msg: string, ...args: ReadonlyArray<LogArgument>) {
    this.log('warn', msg, ...args);
  }

  error(msg: string, ...args: ReadonlyArray<LogArgument>) {
    this.log('error', msg, ...args);
  }

  fatal(msg: string, ...args: ReadonlyArray<LogArgument>) {
    this.log('fatal', msg, ...args);
  }

  /**
   * Starts a timer keyed by `label`. Use {@link Logger.timeEnd} to log the
   * elapsed milliseconds. Timers are per-instance, so a child or sibling
   * Logger does not see them.
   *
   * Re-calling `time()` with the same label resets the start time (matches
   * `console.time` semantics).
   */
  time(label: string): void {
    this.timers.set(label, performance.now());
  }

  /**
   * Logs `<label>: <ms>ms` at info level and clears the timer. Logs a
   * warning and returns silently if the label was never started.
   */
  timeEnd(label: string): void {
    const started = this.timers.get(label);
    if (started === undefined) {
      this.warn('timer "%s" never started', label);
      return;
    }
    this.timers.delete(label);
    const ms = performance.now() - started;
    // 3 decimal places matches `console.timeEnd`'s precision.
    this.info('%s: %dms', label, Math.round(ms * 1000) / 1000);
  }

  private log(level: LogLevel, msg: string, ...args: ReadonlyArray<LogArgument>) {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    // Separate primitives (interpolated into msg via util.format) from
    // structured arguments (Error / Loggable / plain object → metadata).
    const primitives: unknown[] = [];
    const structured: unknown[] = [];

    for (const arg of args) {
      if (arg === null || arg === undefined) {
        primitives.push(arg);
        continue;
      }
      if (arg instanceof Error) {
        structured.push(arg);
        continue;
      }
      if (this.isLoggable(arg as LogMetadataValue)) {
        structured.push(arg);
        continue;
      }
      if (typeof arg === 'object') {
        structured.push(arg);
        continue;
      }
      // string | number | boolean
      primitives.push(arg);
    }

    const finalMsg = primitives.length > 0 && FORMAT_SPECIFIER.test(msg)
      ? format(msg, ...primitives)
      : msg;

    const logMessage: LogMessage = {
      level,
      msg: finalMsg,
      time: Date.now(),
    };

    if (this.context !== undefined) {
      logMessage.context = this.context;
    }

    // 1. ALS context (lowest priority)
    const alsContext = RequestContext.get();

    if (alsContext) {
      Object.assign(logMessage, alsContext);
    }

    // 2. Instance metadata from child() (overrides ALS)
    Object.assign(logMessage, this.metadata);

    const workerId = globalThis.WORKER_ID;

    if (workerId !== undefined) {
      logMessage.workerId = workerId;
    }

    // 3. Per-call structured args (highest priority)
    for (const arg of structured) {
      if (arg instanceof Error) {
        logMessage.err = arg;
      } else if (this.isLoggable(arg as LogMetadataValue)) {
        Object.assign(logMessage, (arg as Loggable).toLog());
      } else if (typeof arg === 'object' && arg !== null) {
        Object.assign(logMessage, arg as Record<string, unknown>);
      }
    }

    this.emit(logMessage);
  }

  private emit(message: LogMessage): void {
    for (const t of Logger.transports) {
      t.log(message);
    }
  }

  private isLevelEnabled(level: LogLevel): boolean {
    const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    const configuredLevel = Logger.globalOptions.level ?? 'info';

    return levels.indexOf(level) >= levels.indexOf(configuredLevel);
  }

  private isLoggable(arg: LogMetadataValue): arg is Loggable {
    return typeof arg === 'object' && arg !== null && 'toLog' in arg && typeof arg.toLog === 'function';
  }
}
