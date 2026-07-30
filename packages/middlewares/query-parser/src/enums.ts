/**
 * Reason why query-parser options validation failed, or why parsing failed in
 * strict mode. String-valued so `QueryParserError.reason` (a public field)
 * serializes stably and is not silently renumbered when a member is inserted.
 */
export enum QueryParserErrorReason {
  // Option-validation reasons, ordered to match the schema's field order in
  // options.ts (depth, maxParams, nesting, arrayLimit, duplicates, strict) so
  // "first failure wins" reporting reads consistently.
  /** depth must be a non-negative integer. */
  InvalidDepth = 'invalid-depth',
  /** maxParams must be a positive integer. */
  InvalidMaxParams = 'invalid-max-params',
  /** nesting must be a boolean. */
  InvalidNesting = 'invalid-nesting',
  /** arrayLimit must be a non-negative integer. */
  InvalidArrayLimit = 'invalid-array-limit',
  /** duplicates must be 'first', 'last', or 'array'. */
  InvalidDuplicates = 'invalid-duplicates',
  /** strict must be a boolean. */
  InvalidStrict = 'invalid-strict',
  /** Query string contains malformed syntax (unbalanced/nested brackets). */
  MalformedQueryString = 'malformed-query-string',
  /** Key is used as both a scalar and a nested structure. */
  ConflictingStructure = 'conflicting-structure',
  /** `depth` or `maxParams` was exceeded (strict mode only). */
  LimitExceeded = 'limit-exceeded',
}

/**
 * Strategy for handling duplicate keys (HTTP Parameter Pollution). String-valued
 * so the member value doubles as the wire/option literal — a consumer may write
 * either {@link DuplicateStrategy.First} or the bare `'first'` literal (the public
 * `duplicates` option type is the union of this enum and its string literals).
 */
export enum DuplicateStrategy {
  /** Keep the first value — the most HPP-conservative choice. */
  First = 'first',
  /** Keep the last value. */
  Last = 'last',
  /** Collect every value into an array — the default (keep-all, lossless). */
  Array = 'array',
}
