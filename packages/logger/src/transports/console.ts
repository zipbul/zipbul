import { inspect } from 'node:util';

import type {
  LogMessage,
  LogLevel,
  LogMetadataValue,
  Loggable,
  LoggerOptions,
  Transport,
} from '../interfaces';

/**
 * Default console transport. Two formats:
 *
 * - `'plain'` (default in non-production): single-line, agent-friendly.
 *   Shape: `<level>: [<context>[/<fn>]] <msg> [<key>=<val> ...]`. ANSI
 *   escapes, timestamps, and icons are deliberately absent — agents read
 *   stdout/stderr text and benefit from a stable greppable format.
 * - `'json'`: NDJSON for log aggregation. One JSON object per line.
 *
 * Stream split: trace/debug/info → stdout, warn/error/fatal → stderr.
 * This matches the CLI's `console.log` vs `console.error` convention so
 * `2>&1` and `2>` shell idioms behave predictably.
 */
export class ConsoleTransport implements Transport {
  constructor(private options: LoggerOptions = {}) {}

  log(message: LogMessage): void {
    const format = this.options.format
      ?? (Bun.env.NODE_ENV === 'production' ? 'json' : 'plain');

    if (format === 'json') {
      this.logJson(message);
    } else {
      this.logPlain(message);
    }
  }

  private logJson(message: LogMessage): void {
    const replacer = (_key: string, value: LogMetadataValue) => {
      if (value instanceof Error) {
        const { name, message, stack, ...rest } = value;
        return { name, message, stack, ...rest };
      }
      if (this.isLoggable(value)) {
        return value.toLog();
      }
      return value;
    };

    const str = JSON.stringify(message, replacer);
    process.stdout.write(str + '\n');
  }

  private logPlain(message: LogMessage): void {
    const { level, msg, context, fn, reqId, workerId, err, time, ...rest } = message;
    void time;

    const prefixParts: string[] = [];

    if (context !== undefined && context.length > 0) {
      prefixParts.push(fn !== undefined && fn.length > 0 ? `${context}/${fn}` : context);
    } else if (fn !== undefined && fn.length > 0) {
      prefixParts.push(fn);
    }

    const prefix = prefixParts.length > 0 ? `[${prefixParts.join(' ')}] ` : '';

    const metaParts: string[] = [];

    if (workerId !== undefined) metaParts.push(`worker=${String(workerId)}`);
    if (typeof reqId === 'string' && reqId.length > 0) metaParts.push(`req=${reqId}`);

    for (const [key, val] of Object.entries(rest)) {
      metaParts.push(this.formatField(key, val));
    }

    const metaSuffix = metaParts.length > 0 ? ` ${metaParts.join(' ')}` : '';
    const line = `${level}: ${prefix}${msg}${metaSuffix}`;
    const sink = isStderrLevel(level) ? process.stderr : process.stdout;
    sink.write(`${line}\n`);

    if (err !== undefined) {
      // Errors carry stack traces — emit the stack on the next line(s) to
      // stderr so the main line stays single-line for greppers.
      const stack = err instanceof Error
        ? err.stack ?? err.message
        : inspect(err, { depth: 4, colors: false });
      process.stderr.write(`${stack}\n`);
    }
  }

  /**
   * Renders one metadata field for the plain-format trailer. Primitives are
   * rendered bare (`key=value`); objects/arrays/Loggables are inspected with
   * colors disabled and depth capped, then `key=` prepended.
   */
  private formatField(key: string, value: LogMetadataValue): string {
    if (value === null) return `${key}=null`;
    if (value === undefined) return `${key}=undefined`;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      // Quote strings containing whitespace / equals so the field stays
      // unambiguously parseable by grep/awk consumers.
      if (typeof value === 'string' && /[\s=]/.test(value)) {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${String(value)}`;
    }
    if (this.isLoggable(value)) {
      return `${key}=${inspect(value.toLog(), { depth: 3, colors: false, compact: true })}`;
    }
    if (value instanceof Error) {
      return `${key}=${value.name}:${value.message}`;
    }
    return `${key}=${inspect(value, { depth: 3, colors: false, compact: true })}`;
  }

  private isLoggable(value: LogMetadataValue): value is Loggable {
    return typeof value === 'object' && value !== null && 'toLog' in value && typeof (value as { toLog?: unknown }).toLog === 'function';
  }
}

function isStderrLevel(level: LogLevel): boolean {
  return level === 'warn' || level === 'error' || level === 'fatal';
}
