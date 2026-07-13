/**
 * Reason why query-parser options validation failed, or why parsing failed in
 * strict mode. String-valued so `QueryParserError.reason` (a public field)
 * serializes stably and is not silently renumbered when a member is inserted.
 */
export enum QueryParserErrorReason {
  /** depth must be a non-negative integer. */
  InvalidDepth = 'invalid-depth',
  /** maxParams must be a positive integer. */
  InvalidMaxParams = 'invalid-max-params',
  /** arrayLimit must be a non-negative integer. */
  InvalidArrayLimit = 'invalid-array-limit',
  /** duplicates must be 'first', 'last', or 'array'. */
  InvalidDuplicates = 'invalid-duplicates',
  /** nesting must be a boolean. */
  InvalidNesting = 'invalid-nesting',
  /** strict must be a boolean. */
  InvalidStrict = 'invalid-strict',
  /** urlEncoded must be a boolean. */
  InvalidUrlEncoded = 'invalid-url-encoded',
  /** allowPrototypes must be a boolean. */
  InvalidAllowPrototypes = 'invalid-allow-prototypes',
  /** Query string contains malformed syntax (unbalanced/nested brackets). */
  MalformedQueryString = 'malformed-query-string',
  /** Key is used as both a scalar and a nested structure. */
  ConflictingStructure = 'conflicting-structure',
}

/**
 * Strategy for handling duplicate keys (HTTP Parameter Pollution). String-valued
 * so the member value doubles as the wire/option literal — a consumer may write
 * either {@link DuplicateStrategy.First} or the bare `'first'` literal (the public
 * `duplicates` option type is the union of this enum and its string literals).
 */
export enum DuplicateStrategy {
  /** Keep the first value — safest against HPP attacks (default). */
  First = 'first',
  /** Keep the last value. */
  Last = 'last',
  /** Collect every value into an array. */
  Array = 'array',
}
