import type { QueryParserErrorReason } from './enums';

/**
 * Error data payload carried by the `Result` pattern — the `E` type of the
 * public {@link QueryParser.parseResult} return. Consumers read `.reason`
 * (a {@link QueryParserErrorReason}) and `.message`.
 *
 * @public
 */
export interface QueryParserErrorData {
  reason: QueryParserErrorReason;
  message: string;
}

/**
 * Thrown by {@link QueryParser.create} on invalid options, or by
 * {@link QueryParser.parse} when strict mode detects malformed input.
 *
 * Inspect {@link reason} to programmatically distinguish error kinds.
 */
export class QueryParserError extends Error {
  public readonly reason: QueryParserErrorReason;

  constructor(data: QueryParserErrorData) {
    super(data.message);
    this.name = 'QueryParserError';
    this.reason = data.reason;
  }
}
