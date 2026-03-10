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

const LEVEL_ICON = '✦';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

/** 24-bit true color helper: `\x1b[38;2;R;G;Bm` (foreground). */
function rgb(red: number, green: number, blue: number): string {
  return `\x1b[38;2;${red};${green};${blue}m`;
}

/**
 * 16-color ANSI palette used only for the public `prettyOptions.colors` API.
 * Internal rendering uses RGB true color for theme-independent output.
 */
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
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
};

/** True color palette — theme-independent, vibrant modern tones. */
const RGB_GRAY = rgb(100, 110, 130);
const RGB_BLUE = rgb(130, 170, 255);
const RGB_GREEN = rgb(126, 201, 110);
const RGB_YELLOW = rgb(240, 198, 116);
const RGB_RED = rgb(255, 107, 131);
const RGB_MAGENTA = rgb(199, 146, 234);
const RGB_CYAN = rgb(137, 221, 255);

const ICON_COLORS: Record<LogLevel, string> = {
  trace: RGB_GRAY,
  debug: RGB_BLUE,
  info: RGB_GREEN,
  warn: RGB_YELLOW,
  error: RGB_RED,
  fatal: RGB_MAGENTA,
};

/**
 * Message text styling per level (24-bit true color).
 *
 * Each level has a unique text color for instant visual scanning.
 * trace: gray (whisper), debug: blue (quiet), info: green (normal),
 * warn: yellow (caution), error: red (problem), fatal: bold red (critical).
 */
const MESSAGE_STYLE: Record<LogLevel, { prefix: string; suffix: string }> = {
  trace: { prefix: RGB_GRAY, suffix: RESET },
  debug: { prefix: RGB_BLUE, suffix: RESET },
  info: { prefix: RGB_GREEN, suffix: RESET },
  warn: { prefix: RGB_YELLOW, suffix: RESET },
  error: { prefix: RGB_RED, suffix: RESET },
  fatal: { prefix: `${BOLD}${RGB_RED}`, suffix: RESET },
};

const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD',
]);

const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/;

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
    const timeColored = `${RGB_GRAY}${timeStr}${RESET}`;
    const customColor = this.options.prettyOptions?.colors?.[level];
    const iconCode = customColor !== undefined ? COLORS[customColor] : ICON_COLORS[level];
    const iconStr = `${iconCode}${LEVEL_ICON}${RESET}`;
    const msgStyle = MESSAGE_STYLE[level];
    let metaStr = '';

    if (workerId !== undefined) {
      metaStr += `${DIM}W:${workerId}${RESET} `;
    }

    if (typeof reqId === 'string' && reqId.length > 0) {
      metaStr += `${DIM}${reqId}${RESET} `;
    }

    if (typeof context === 'string' && context.length > 0) {
      metaStr += `${RGB_CYAN}${context}${RESET} ${RGB_GRAY}›${RESET} `;
    }

    if (typeof fn === 'string' && fn.length > 0) {
      metaStr += `${RGB_CYAN}${fn}${RESET} ${RGB_GRAY}›${RESET} `;
    }

    const highlighted = this.highlightTokens(msg, level);
    const line = `${timeColored} ${iconStr}  ${metaStr}${msgStyle.prefix}${highlighted}${msgStyle.suffix}`;

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

  private highlightTokens(message: string, level: LogLevel): string {
    if (level === 'warn' || level === 'error' || level === 'fatal') {
      return message;
    }

    const match = HTTP_METHOD_PATTERN.exec(message);

    if (!match || match[1] === undefined) {
      return message;
    }

    const method: string = match[1];

    if (!HTTP_METHODS.has(method)) {
      return message;
    }

    const style = MESSAGE_STYLE[level];

    return `${style.suffix}${BOLD}${method}${RESET}${style.prefix}${message.slice(method.length)}`;
  }

  private isLoggable(value: LogMetadataValue): value is Loggable {
    return typeof value === 'object' && value !== null && 'toLog' in value && typeof value.toLog === 'function';
  }
}
