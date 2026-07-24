import type { DuplicateStrategy, QueryParserErrorReason } from './enums';

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

export interface QueryParserOptions {
  /**
   * Maximum depth of nested objects to parse.
   * @default 5
   */
  depth?: number;

  /**
   * Maximum number of parameters to parse.
   * @default 1000
   */
  maxParams?: number;

  /**
   * Whether to support nested object and array parsing with brackets (e.g. `a[b]=1`, `a[]=b`).
   * @default false
   */
  nesting?: boolean;

  /**
   * Maximum array index allowed.
   * @default 20
   */
  arrayLimit?: number;

  /**
   * Strategy for handling repeated same-key values (HTTP Parameter Pollution).
   * Governs SAME-KIND duplicates only; a scalar↔container shape conflict is
   * resolved independently (strict rejects it under every strategy).
   * - `DuplicateStrategy.Array` (default): keep every value in an array —
   *   lossless, deferring the first/last/reject cardinality choice to the DTO.
   * - `DuplicateStrategy.First`: keep the first value (drops the rest).
   * - `DuplicateStrategy.Last`: keep the last value (drops the rest).
   * @default DuplicateStrategy.Array
   */
  duplicates?: DuplicateStrategy;

  /**
   * Whether to enable strict mode.
   * If enabled:
   * - Throws QueryParserError on malformed query strings (unbalanced brackets, etc.).
   * - Throws on mixed scalar and nested keys (e.g. `a=1&a[b]=2`).
   * - Throws on mixed array and object indices if not handled by conversion.
   * @default false
   */
  strict?: boolean;
}
