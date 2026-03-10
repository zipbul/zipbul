import type { BaseLogMessage, Loggable } from './interfaces';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type Color =
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'
  | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightBlue' | 'brightMagenta' | 'brightCyan';

export type LogMetadataPrimitive = string | number | boolean | null | undefined;

export type LogMetadataLeaf = LogMetadataPrimitive | Error | Loggable;

export interface LogMetadataRecord {
  [key: string]: LogMetadataValue;
}

export type LogMetadataValue = LogMetadataLeaf | ReadonlyArray<LogMetadataLeaf> | LogMetadataRecord;

export type LogMessage = BaseLogMessage & LogMetadataRecord;

export type LogArgument = LogMetadataValue;
