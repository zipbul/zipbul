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
   * Standard §3.3.5 (CORS protocol and credentials). Fires from both:
   *  - option validation (`origin: '*'` + `credentials: true`)
   *  - runtime origin-function return (`origin: () => '*'` + `credentials: true`)
   *
   * When an origin function returns `'*'` with `credentials: false`, the more
   * specific {@link InvalidOriginReturn} fires instead (RFC 6454 §6.2 — not a
   * serialized origin).
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
   * **BREAKING (baker 3.3.0 migration)**: `RegExp` matchers carrying the
   * `g` (global) or `y` (sticky) flag are now rejected at boot — they
   * mutate `lastIndex` between `test()` calls, so the previous workaround
   * silently rewrote the caller's instance on every request. Drop the
   * flag from your matcher; the stateless variants (`i`, `m`, `s`, `u`,
   * `d`) all pass.
   */
  InvalidOrigin = 'invalid-origin',
  /** methods is an empty array or contains empty/blank string entries (RFC 9110 §5.6.2 token). */
  InvalidMethods = 'invalid-methods',
  /** allowedHeaders contains an entry that is not a valid HTTP token — empty/blank or non-tchar chars (RFC 9110 §5.6.2: 1*tchar). */
  InvalidAllowedHeaders = 'invalid-allowed-headers',
  /** exposedHeaders contains an entry that is not a valid HTTP token — empty/blank or non-tchar chars (RFC 9110 §5.6.2: 1*tchar). */
  InvalidExposedHeaders = 'invalid-exposed-headers',
  /**
   * Origin function returned a string that is not a serialized origin per
   * RFC 6454 §6.2. Covers CR/LF/NUL/BOM/zero-width injection, trailing slash,
   * uppercase scheme/host, default port, path/query/fragment, userinfo, raw
   * IDN (must be punycode), parse failures, empty string, and the wildcard
   * literal `'*'` (when `credentials: false` — with `credentials: true` the
   * more specific {@link CredentialsWithWildcardOrigin} fires first).
   *
   * **Origin function return-value contract** (3 forms):
   *  - `return true`        — echo the request `Origin` header (recommended;
   *                           prefer this over manual `return originHeader`)
   *  - `return false`       — reject (yields `CorsRejectionReason.OriginNotAllowed`)
   *  - `return '<origin>'`  — override with a serialized RFC 6454 §6.2 origin
   *                           (`'null'` is the only allowed reserved literal;
   *                           wildcard `'*'` is rejected — return `true` instead)
   *
   * **Asymmetry with option validation**: the `origin` *option* accepts `'*'`
   * (via baker's `isCorsOrigin`) because static wildcard is a meaningful
   * configuration; the *return value* of an origin function rejects `'*'`
   * (via baker's `isOrigin`) because dynamic wildcard is an anti-pattern —
   * use `return true` to echo the request origin instead.
   *
   * **BREAKING (baker 3.1.0 migration)**: empty-string return (`return ''`)
   * was previously a silent reject; it now throws this error. If you used
   * empty string as a deny signal, return `false` instead.
   */
  InvalidOriginReturn = 'invalid-origin-return',
}
