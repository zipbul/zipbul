import type { LogLevel, LogMessage, LogMetadataRecord, LogMetadataValue } from './types';

export type { LogArgument, LogLevel, LogMessage, LogMetadataRecord, LogMetadataValue } from './types';

export interface BaseLogMessage {
  level: LogLevel;
  msg: string;
  time: number;
  context?: string;
  fn?: string;
  reqId?: string;
  workerId?: number;
  err?: Error | Loggable;
}

export interface Loggable {
  toLog(): LogMetadataRecord;
}

export interface LogContextConstructor {
  readonly name?: string;
}

/**
 * Any object-like value the {@link Logger} can derive a context name from.
 *
 * The `Logger` constructor accepts either a `string` or a taggable object;
 * the idiomatic form is `new Logger(this)` inside a class. Every ECMAScript
 * object has a `.constructor` with a `.name`, but TypeScript structural
 * typing does not surface that implicit property on `this`. This shape
 * accepts any non-null object — runtime reads `.name` / `.constructor.name`.
 */
export type LogContextTarget = {
  readonly name?: string;
  readonly constructor?: LogContextConstructor;
};

export interface LoggerOptions {
  level?: LogLevel;
  /**
   * Output format.
   *
   * - `'plain'` (default in non-production): single-line agent-friendly
   *   output, `<level>: [<context>[/<fn>]] <msg> [<key>=<val> ...]`.
   * - `'json'` (default in production): NDJSON for log aggregation.
   */
  format?: 'plain' | 'json';
  transports?: Transport[];
}

export interface Transport {
  log(message: LogMessage): void;
}

export interface LogContext {
  [key: string]: LogMetadataValue;
}
