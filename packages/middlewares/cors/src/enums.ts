/**
 * Discriminant for {@link CorsResult}.
 * Determines how to handle the response.
 */
export enum CorsAction {
  /** Attach CORS headers to the response and continue processing. */
  Continue = 'continue',
  /** Return a preflight-only response immediately. */
  RespondPreflight = 'respond-preflight',
  /** Reject the request. See {@link CorsRejectionReason} for details. */
  Reject = 'reject',
}

/**
 * Reason why a CORS request was rejected.
 */
export enum CorsRejectionReason {
  /** `Origin` header is missing or empty. */
  NoOrigin = 'no-origin',
  /** Origin is not in the allowed list. */
  OriginNotAllowed = 'origin-not-allowed',
  /** Preflight request method is not allowed. */
  MethodNotAllowed = 'method-not-allowed',
  /** Preflight request header is not allowed. */
  HeaderNotAllowed = 'header-not-allowed',
}

/**
 * Reason why CORS options validation failed.
 */
export enum CorsErrorReason {
  /**
   * `credentials:true` is incompatible with wildcard origin (`'*'`) per Fetch
   * Standard §3.3.5 (CORS protocol and credentials). Fires at option
   * validation (`origin: '*'` + `credentials: true`).
   */
  CredentialsWithWildcardOrigin = 'credentials-with-wildcard-origin',
  /** credentials:true is incompatible with wildcard methods (`['*']`) per Fetch Standard. */
  CredentialsWithWildcardMethods = 'credentials-with-wildcard-methods',
  /**
   * `maxAge` is not a non-negative integer below 10^21 (RFC 9111 §1.2.2:
   * `delta-seconds = 1*DIGIT`). Negative, non-integer, NaN, Infinity, or
   * values ≥ 10^21 (which `Number.prototype.toString` serializes in
   * exponential notation, e.g. `"1e+21"`, violating the `1*DIGIT` ABNF)
   * all fail this check.
   */
  InvalidMaxAge = 'invalid-max-age',
  /** optionsSuccessStatus must be 200–299 (ok status). */
  InvalidStatusCode = 'invalid-status-code',
  /** Origin function threw at runtime. */
  OriginFunctionError = 'origin-function-error',
  /**
   * `origin` failed schema validation. The baker schema accepts a boolean, a
   * serialized RFC 6454 §6.2 origin (including the reserved literals `'*'`
   * and `'null'`), a stateless `RegExp`, a mixed `Array<string | RegExp>`,
   * or a function — anything else fires this reason.
   *
   * A `RegExp` carrying the `g` (global) or `y` (sticky) flag is rejected at
   * boot: those flags mutate `lastIndex` between `test()` calls, so a shared
   * matcher would return alternating results across requests. Use a stateless
   * matcher — the `i`, `m`, `s`, `u`, `d` flags all pass.
   */
  InvalidOrigin = 'invalid-origin',
  /** methods is an empty array or contains an entry that is not a known {@link HttpMethod} or the wildcard `'*'`. */
  InvalidMethods = 'invalid-methods',
  /** allowedHeaders contains an entry that is not a valid HTTP token — empty/blank or non-tchar chars (RFC 9110 §5.6.2: 1*tchar). */
  InvalidAllowedHeaders = 'invalid-allowed-headers',
  /** exposedHeaders contains an entry that is not a valid HTTP token — empty/blank or non-tchar chars (RFC 9110 §5.6.2: 1*tchar). */
  InvalidExposedHeaders = 'invalid-exposed-headers',
  /** credentials is not a boolean. */
  InvalidCredentials = 'invalid-credentials',
  /** preflightContinue is not a boolean. */
  InvalidPreflightContinue = 'invalid-preflight-continue',
  /** allowPrivateNetwork is not a boolean. */
  InvalidAllowPrivateNetwork = 'invalid-allow-private-network',
}
