/**
 * Reason why query-parser options validation failed, or why parsing failed in
 * strict mode. String-valued so `QueryParserError.reason` (a public field)
 * serializes stably and is not silently renumbered when a member is inserted.
 */
export enum QueryParserErrorReason {
  // Option-validation reasons, ordered to match the schema's field order in
  // options.ts (depth, maxParams, nesting, arrayLimit, duplicates, strict,
  // urlEncoded) so "first failure wins" reporting reads consistently.
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
  /** urlEncoded must be a boolean. */
  InvalidUrlEncoded = 'invalid-url-encoded',
  /** Query string contains malformed syntax (unbalanced/nested brackets). */
  MalformedQueryString = 'malformed-query-string',
  /** Key is used as both a scalar and a nested structure. */
  ConflictingStructure = 'conflicting-structure',
}
