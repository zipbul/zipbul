import type { Color, LogLevel, LogMessage, LogMetadataRecord } from './types';

export type { Color, LogArgument, LogLevel, LogMessage, LogMetadataRecord, LogMetadataValue } from './types';

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
  name?: string;
}

export interface LogContextTarget {
  name?: string;
  constructor?: LogContextConstructor;
}

export interface LoggerPrettyOptions {
  colors?: Record<LogLevel, Color>;
  columns?: Array<keyof LogMessage>;
}

export interface LoggerOptions {
  level?: LogLevel;

  format?: 'pretty' | 'json';
  prettyOptions?: LoggerPrettyOptions;
  transports?: Transport[];
}

export interface Transport {
  log(message: LogMessage): void;
}

export interface LogContext {
  [key: string]: LogMetadataValue;
}
