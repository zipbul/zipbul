export interface QueryParserOptions {
  /**
   * Maximum depth of nested objects to parse. Beyond this depth, nesting stops
   * and the value is kept as a leaf at the deepest permitted level — it is never
   * dropped, and no empty placeholder object is left behind. This is a resource
   * limit, not a strict error.
   * @default 5
   */
  depth?: number;

  /**
   * Maximum number of key-value pairs to parse. Pairs beyond this limit are
   * silently dropped; empty `&` separators emit no pair and do not count.
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
   *
   * When enabled, {@link QueryParser.parse} throws (and
   * {@link QueryParser.parseResult} returns an `Err`) on:
   * - Malformed query strings — unbalanced/nested brackets, invalid percent
   *   escapes (`MalformedQueryString`).
   * - Structure conflicts — a key used as both a scalar and a nested structure,
   *   e.g. `a=1&a[b]=2`, or a non-numeric key applied to an array
   *   (`ConflictingStructure`).
   *
   * Resource limits (`depth`, `maxParams`, `arrayLimit`) are NOT strict errors:
   * they truncate silently in both modes.
   *
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
