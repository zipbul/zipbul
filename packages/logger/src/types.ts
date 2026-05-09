import type { BaseLogMessage, Loggable } from './interfaces';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogMetadataPrimitive = string | number | boolean | null | undefined;

export type LogMetadataLeaf = LogMetadataPrimitive | Error | Loggable;

export interface LogMetadataRecord {
  [key: string]: LogMetadataValue;
}

export type LogMetadataValue = LogMetadataLeaf | ReadonlyArray<LogMetadataLeaf> | LogMetadataRecord;

export type LogMessage = BaseLogMessage & LogMetadataRecord;

/**
 * `LogArgument` covers everything `log.info(msg, ...args)` accepts:
 * - primitive (`string | number | boolean | null | undefined`) — interpolated
 *   into `msg` via util.format placeholders (`%s/%d/%i/%f/%o/%j`).
 * - `Error` — promoted to `err` field on the message.
 * - `Loggable` — `toLog()` result spread into the message.
 * - plain object — spread into the message as metadata.
 * - `unknown` — accepted so callers can forward `catch (e)` values without
 *   pre-narrowing; the runtime classifier sorts them via the same rules
 *   above (objects spread as metadata, anything else stringifies via
 *   `util.format`).
 */
export type LogArgument = unknown;
