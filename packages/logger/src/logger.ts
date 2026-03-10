import { AsyncLocalStorage } from 'node:async_hooks';

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

import { RequestContext } from './async-storage';
import { ConsoleTransport } from './transports/console';

declare global {
  var WORKER_ID: number | undefined;
}

const LOG_LEVELS: readonly string[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

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
    ...(Bun.env.NODE_ENV === 'production' ? { format: 'json' } : {}),
  };
  private static transports: Transport[] = [new ConsoleTransport(Logger.globalOptions)];
  private static scopeStore = new AsyncLocalStorage<Logger>();

  private readonly context?: string;

  private readonly metadata: LogMetadataRecord;

  constructor(context?: string | LogContextTarget, metadata?: LogMetadataRecord) {
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
   * @param logger - The Logger instance to propagate.
   * @param fn - The callback to execute within the scope.
   * @returns The return value of `fn`.
   *
   * @example
   * ```ts
   * const adapterLogger = new Logger('HttpAdapter');
   * await Logger.runScoped(adapterLogger, async () => {
   *   const server = new HttpServer(); // can call Logger.inherit() internally
   * });
   * ```
   *
   * @public
   */
  static runScoped<T>(logger: Logger, fn: () => T): T {
    return Logger.scopeStore.run(logger, fn);
  }

  /**
   * Returns the Logger instance from the current ALS scope.
   *
   * Must be called inside a `Logger.runScoped()` callback.
   * Throws if no scope is active — use `new Logger('scope')` for
   * standalone usage instead.
   *
   * @returns The scoped Logger instance.
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
    return new Logger(this.context, { ...this.metadata, ...metadata });
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

  private log(level: LogLevel, msg: string, ...args: ReadonlyArray<LogArgument>) {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const logMessage: LogMessage = {
      level,
      msg,
      time: Date.now(),
    };

    if (this.context !== undefined) {
      logMessage.context = this.context;
    }

    // 1. ALS context (lowest priority)
    const alsContext = RequestContext.getContext();

    if (alsContext) {
      Object.assign(logMessage, alsContext);
    }

    // 2. Instance metadata from child() (overrides ALS)
    Object.assign(logMessage, this.metadata);

    const workerId = globalThis.WORKER_ID;

    if (workerId !== undefined) {
      logMessage.workerId = workerId;
    }

    // 3. Per-call args (highest priority)
    for (const arg of args) {
      if (arg instanceof Error) {
        logMessage.err = arg;
      } else if (this.isLoggable(arg)) {
        Object.assign(logMessage, arg.toLog());
      } else if (typeof arg === 'object' && arg !== null) {
        Object.assign(logMessage, arg);
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
