import type {
  Color,
  LogMessage,
  LogLevel,
  LogMetadataRecord,
  LogMetadataValue,
  Loggable,
  LoggerOptions,
  Transport,
} from '../interfaces';

const DEFAULT_COLORS: Record<LogLevel, Color> = {
  trace: 'gray',
  debug: 'blue',
  info: 'green',
  warn: 'yellow',
  error: 'red',
  fatal: 'magenta',
};
const RESET = '\x1b[0m';
const COLORS: Record<Color, string> = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

export class ConsoleTransport implements Transport {
  constructor(private options: LoggerOptions = {}) {}

  log(message: LogMessage): void {
    const format = this.options.format ?? (Bun.env.NODE_ENV === 'production' ? 'json' : 'pretty');

    if (format === 'json') {
      this.logJson(message);
    } else {
      this.logPretty(message);
    }
  }

  private logJson(message: LogMessage): void {
    const replacer = (_key: string, value: LogMetadataValue) => {
      if (value instanceof Error) {
        const { name, message, stack, ...rest } = value;

        return {
          name,
          message,
          stack,
          ...rest,
        };
      }

      if (this.isLoggable(value)) {
        return value.toLog();
      }

      return value;
    };

    const str = JSON.stringify(message, replacer);

    process.stdout.write(str + '\n');
  }

  private logPretty(message: LogMessage): void {
    const { level, time, msg, context, fn, reqId, workerId, err, ...rest } = message;
    const date = new Date(time);
    const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    const timeColored = `${COLORS.gray}${timeStr}${RESET}`;
    const color = this.options.prettyOptions?.colors?.[level] ?? DEFAULT_COLORS[level];
    const levelCode = COLORS[color] || COLORS.white;
    const levelStr = `${levelCode}${level.toUpperCase().padEnd(5)}${RESET}`;
    let metaStr = '';

    if (workerId !== undefined) {
      metaStr += `[W:${workerId}] `;
    }

    if (typeof reqId === 'string' && reqId.length > 0) {
      metaStr += `[${reqId}] `;
    }

    if (typeof context === 'string' && context.length > 0) {
      metaStr += `[${COLORS.cyan}${context}${RESET}] `;
    }

    if (typeof fn === 'string' && fn.length > 0) {
      metaStr += `[${COLORS.magenta}${fn}${RESET}] `;
    }

    const msgStr = `${levelCode}${msg}${RESET}`;
    const line = `${timeColored} ${levelStr} ${metaStr}${msgStr}`;

    if (level === 'error' || level === 'fatal') {
      console.error(line);
    } else {
      console.log(line);
    }

    if (err) {
      console.error(err);
    }

    if (Object.keys(rest).length > 0) {
      const processedRest: LogMetadataRecord = {};

      for (const [key, val] of Object.entries(rest)) {
        if (this.isLoggable(val)) {
          processedRest[key] = val.toLog();
        } else {
          processedRest[key] = val;
        }
      }

      console.log(Bun.inspect(processedRest, { colors: true, depth: 2 }));
    }
  }

  private isLoggable(value: LogMetadataValue): value is Loggable {
    return typeof value === 'object' && value !== null && 'toLog' in value && typeof value.toLog === 'function';
  }
}
