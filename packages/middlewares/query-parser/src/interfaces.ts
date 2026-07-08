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
   * Maximum array index allowed when `nesting` is enabled. An index within the
   * limit allocates a sparse array up to that index, so this doubles as a
   * resource bound: raising it far above the default lets a tiny input allocate
   * a huge array (e.g. `arrayLimit: 1_000_000` + `a[999999]=x`). Keep it small
   * for untrusted input — the default is a safe cap.
   *
   * Note: indices are accepted up to 10 digits, which exceeds the maximum real
   * JS array index (2^32 − 2); an in-limit value above that is retained as a
   * string-keyed own property rather than a true array element (the array's
   * `length` stays 0). No value is lost, but such keys won't be array indices.
   *
   * @default 20
   */
  arrayLimit?: number;

  /**
   * Strategy for handling duplicate keys (HTTP Parameter Pollution).
   * - 'first': Use the first value (Secure).
   * - 'last': Use the last value.
   * - 'array': Convert to array (Use with caution).
   * @default 'first'
   */
  duplicates?: 'first' | 'last' | 'array';

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
   * Whether to decode `+` as space (`application/x-www-form-urlencoded`).
   *
   * When `true`, `+` in both keys and values is treated as a space character,
   * matching the behavior of HTML form submissions. When `false` (default),
   * `+` is treated as a literal character per RFC 3986.
   * @default false
   */
  urlEncoded?: boolean;
}
