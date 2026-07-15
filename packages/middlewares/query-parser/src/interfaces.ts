import type { DuplicateStrategy, QueryParserErrorReason } from './enums';

/**
 * Error data payload used internally with the Result pattern.
 * @internal
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
   * Strategy for handling duplicate keys (HTTP Parameter Pollution).
   * - `DuplicateStrategy.First` / `'first'`: Use the first value (Secure).
   * - `DuplicateStrategy.Last` / `'last'`: Use the last value.
   * - `DuplicateStrategy.Array` / `'array'`: Convert to array (Use with caution).
   * Accepts the {@link DuplicateStrategy} enum or the equivalent string literal.
   * @default DuplicateStrategy.First
   */
  duplicates?: DuplicateStrategy | 'first' | 'last' | 'array';

  /**
   * Whether to enable strict mode.
   * If enabled:
   * - Throws QueryParserError on malformed query strings (unbalanced brackets, etc.).
   * - Throws on mixed scalar and nested keys (e.g. `a=1&a[b]=2`).
   * - Throws on mixed array and object indices if not handled by conversion.
   * @default false
   */
  strict?: boolean;

  /**
   * Whether to allow keys that name Object.prototype members (constructor, toString,
   * hasOwnProperty, …) into the parsed output. `__proto__` is ALWAYS dropped regardless.
   *
   * SECURITY: setting this `true` re-arms a real prototype-pollution primitive
   * (`constructor[prototype][x]=1` becomes a live gadget under a naive recursive merge) and
   * method-shadow crashes (`k[toString]=1` makes `String(out.k)` throw). Leave false unless
   * you fully control downstream consumption. Matches `qs`'s `allowPrototypes` opt-in.
   * @default false
   */
  allowPrototypes?: boolean;
}
