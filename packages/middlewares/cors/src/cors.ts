import type { ResultAsync } from '@zipbul/result';

import { isBakerIssueSet } from '@zipbul/baker';
import { isErr, safe } from '@zipbul/result';
import { HttpHeader, HttpMethod } from '@zipbul/http-adapter';

import type { CorsErrorData, CorsRejectResult } from './interfaces';
import type { CorsResult, OriginResult, ResolvedCorsOptions } from './types';

import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import { CorsError } from './interfaces';
import { corsBaker } from './baker';
import { CORS_DEFAULTS, CorsOptions } from './options';

/**
 * Lazy seal — `Cors.create` seals {@link corsBaker} once on first call.
 *
 * baker requires `seal()` after every `@corsBaker.Recipe` class is imported.
 * Only {@link CorsOptions} registers with this baker, so a single seal on first
 * `Cors.create` suffices; we defer (rather than sealing at module load) so the
 * seal runs after the class import has settled. The boolean guard makes repeat
 * `Cors.create` calls skip the redundant seal.
 */
let isSealed = false;
function ensureSealed(): void {
  if (isSealed) {
    return;
  }
  corsBaker.seal();
  isSealed = true;
}

/**
 * Framework-agnostic CORS handler.
 * Evaluates CORS policy and returns a discriminated union result
 * instead of generating responses directly.
 */
export class Cors {
  /**
   * @internal Whether the resource's Access-Control-Allow-Origin answer depends on the
   * request `Origin`. A static `'*'` yields the same header for every request and
   * `false` never yields one, so neither varies; every other form (fixed string, true,
   * array, RegExp, function) does, and §7.1 then requires `Vary: Origin` on ALL
   * responses — including rejects and no-Origin responses that carry no ACAO.
   */
  private readonly variesByOrigin: boolean;

  private constructor(
    /** @internal */
    private readonly options: ResolvedCorsOptions,
  ) {
    this.variesByOrigin = options.origin !== '*' && options.origin !== false;
  }

  /**
   * Creates a Cors instance after resolving and validating options.
   *
   * Validation delegates to the {@link CorsOptions} baker schema; cross-field
   * checks (`credentials:true` + wildcard origin/methods) run as a
   * post-validate step. The resolved options object is held privately on the
   * instance and is not mutated by the middleware; callers should not mutate
   * inputs they passed in after this call returns.
   *
   * @throws {CorsError} when options fail validation (invalid origin, methods, maxAge, etc.)
   * @returns A ready-to-use Cors instance.
   */
  public static create(options?: CorsOptions): Cors {
    ensureSealed();
    const merged: ResolvedCorsOptions = { ...CORS_DEFAULTS, ...options };

    // Defensive copy of the array options: the shallow spread above aliases the
    // caller's arrays, so without this a post-registration `opts.methods.push(...)`
    // would silently mutate the resolved policy.
    merged.methods = [...merged.methods];
    if (Array.isArray(merged.origin)) {
      merged.origin = [...merged.origin];
    }
    if (merged.allowedHeaders !== null) {
      merged.allowedHeaders = [...merged.allowedHeaders];
    }
    if (merged.exposedHeaders !== null) {
      merged.exposedHeaders = [...merged.exposedHeaders];
    }

    const result = corsBaker.validateSync(CorsOptions, merged);
    if (isBakerIssueSet(result)) {
      const [issue] = result.errors;
      if (issue === undefined) {
        throw new Error('internal: baker reported an invalid options set with no errors');
      }
      const ctx = issue.context as { reason?: CorsErrorReason } | undefined;
      if (ctx?.reason === undefined) {
        throw new Error(`internal: baker @Field for "${issue.path}" missing context.reason`);
      }
      throw new CorsError({
        reason: ctx.reason,
        message: `${issue.path}: ${issue.code}`,
      });
    }

    // Collapse a wildcard array origin (`['*']` / `['*', ...]`) to the bare
    // wildcard scalar so it allows every origin via matchOrigin's `=== '*'`
    // branch. This MUST run *before* the credentials cross-field guard below:
    // that guard compares `merged.origin === '*'`, so a still-array origin would
    // bypass the credentials:true rejection. (Unlike the methods normalization
    // further down, which sits after its guard because that guard tests
    // `includes('*')` on the array directly.)
    if (Array.isArray(merged.origin) && merged.origin.includes('*')) {
      merged.origin = '*';
    }

    // Cross-field semantics (schema = single-field value, cors = cross-field).
    if (merged.credentials === true) {
      if (merged.origin === '*') {
        throw new CorsError({
          reason: CorsErrorReason.CredentialsWithWildcardOrigin,
          message: 'credentials:true with origin:"*" forbidden (Fetch Standard §3.3.5)',
        });
      }
      if (Array.isArray(merged.methods) && merged.methods.includes('*')) {
        throw new CorsError({
          reason: CorsErrorReason.CredentialsWithWildcardMethods,
          message: 'credentials:true with methods:["*"] forbidden (Fetch Standard §3.2.6)',
        });
      }
    }

    // Normalize the wildcard methods array (`['*', ...]` → `['*']`). This is
    // wire-emit accuracy, not mutation isolation — the rest of the merged
    // options are handed to the instance as-is.
    if (merged.methods.includes('*')) {
      merged.methods = ['*'];
    }

    return new Cors(merged);
  }

  /**
   * Evaluates CORS policy for the given request.
   *
   * @throws {CorsError} when the origin function throws at runtime, or when it
   *   returns `'*'` while `credentials:true` is enabled (forbidden by Fetch
   *   Standard §3.3.5; `CorsErrorReason.CredentialsWithWildcardOrigin`).
   * @returns `Continue` — attach headers and proceed,
   *          `RespondPreflight` — return preflight response,
   *          `Reject` — deny with reason.
   */
  public async handle(request: Request): Promise<CorsResult> {
    const origin = request.headers.get(HttpHeader.Origin);

    if (origin === null || origin.length === 0) {
      if (this.options.origin === '*') {
        // §7.2 — a static wildcard is sent on every response for the resource,
        // including a no-Origin (non-CORS/navigation) one, and without `Vary`.
        const headers = new Headers();
        headers.set(HttpHeader.AccessControlAllowOrigin, '*');
        this.applyExposeHeaders(headers);

        return { action: CorsAction.Continue, headers };
      }

      return this.reject(CorsRejectionReason.NoOrigin, this.varyHeaders());
    }

    const allowedOrigin = await this.matchOrigin(origin, request);

    if (isErr(allowedOrigin)) {
      throw new CorsError(allowedOrigin.data);
    }

    if (allowedOrigin === undefined) {
      // §7.1 — the resource's ACAO presence varies by Origin; declare it even on the
      // rejected response so a shared cache cannot replay this ACAO-less body.
      return this.reject(CorsRejectionReason.OriginNotAllowed, this.varyHeaders());
    }

    if (allowedOrigin === '*' && this.options.credentials) {
      throw new CorsError({
        reason: CorsErrorReason.CredentialsWithWildcardOrigin,
        message: 'origin function returned "*" with credentials:true forbidden (Fetch Standard §3.3.5)',
      });
    }

    const headers = new Headers();

    headers.set(HttpHeader.AccessControlAllowOrigin, allowedOrigin);

    // Keyed on the CONFIG (variesByOrigin), not on the granted value: an origin
    // function may return '*' for this request but something else for another, so
    // even an `ACAO: *` grant varies by Origin and must say so (§7.1) — otherwise a
    // cache could replay this wildcard grant to an origin the function denies.
    if (this.variesByOrigin) {
      headers.append(HttpHeader.Vary, HttpHeader.Origin);
    }

    if (this.options.credentials) {
      headers.set(HttpHeader.AccessControlAllowCredentials, 'true');
    }

    // A preflight is an OPTIONS request carrying Access-Control-Request-Method.
    // Anything else — including an OPTIONS request used as a real verb (which a
    // cross-origin `fetch(url, {method:'OPTIONS'})` sends *after* its preflight) —
    // is an actual response, and that is where Access-Control-Expose-Headers
    // belongs (§4.1.2). So gate on preflight-ness, not on the method being OPTIONS.
    const requestMethod = request.method === HttpMethod.Options
      ? request.headers.get(HttpHeader.AccessControlRequestMethod)
      : null;

    if (requestMethod === null || requestMethod.length === 0) {
      this.applyExposeHeaders(headers);

      return { action: CorsAction.Continue, headers };
    }

    if (!this.isMethodAllowed(requestMethod, this.options.methods)) {
      // Rejection withholds the CORS grant (no ACAO/ACAM), but §7.1 still requires
      // Vary: Origin when the resource's answer varies by origin.
      return this.reject(CorsRejectionReason.MethodNotAllowed, this.varyHeaders());
    }

    const allowMethodsValue = this.serializeAllowedMethods(this.options.methods);

    headers.set(HttpHeader.AccessControlAllowMethods, allowMethodsValue);

    headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestMethod);

    const requestHeadersRaw = request.headers.get(HttpHeader.AccessControlRequestHeaders);
    const requestHeaders = this.parseCommaSeparatedValues(requestHeadersRaw);

    if (this.options.allowedHeaders !== null) {
      if (!this.areRequestHeadersAllowed(requestHeaders, this.options.allowedHeaders)) {
        return this.reject(CorsRejectionReason.HeaderNotAllowed, this.varyHeaders());
      }

      const allowHeadersValue = this.serializeAllowedHeaders(this.options.allowedHeaders, requestHeaders);

      if (allowHeadersValue !== undefined) {
        headers.set(HttpHeader.AccessControlAllowHeaders, allowHeadersValue);
        headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestHeaders);
      }
    } else {
      // Reflect mode: the preflight response varies on Access-Control-Request-Headers
      // whether or not this particular request carried one, so declare it
      // unconditionally to keep intermediary caches correct.
      headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestHeaders);

      // Echo the parsed, empty-element-stripped header names — never the raw client
      // string — so the emitted list satisfies RFC 9110 §5.6.1.1 (a sender MUST NOT
      // generate empty list elements). Raw "X-Foo ,, x-bar" would otherwise re-emit
      // the empty element verbatim (STANDARDS §1.5).
      if (requestHeaders.length > 0) {
        headers.set(HttpHeader.AccessControlAllowHeaders, requestHeaders.join(','));
      }
    }

    if (this.options.maxAge !== null) {
      headers.set(HttpHeader.AccessControlMaxAge, this.options.maxAge.toString());
    }

    if (this.options.allowPrivateNetwork && request.headers.get(HttpHeader.AccessControlRequestPrivateNetwork) === 'true') {
      headers.set(HttpHeader.AccessControlAllowPrivateNetwork, 'true');
    }

    if (this.options.preflightContinue) {
      return { action: CorsAction.Continue, headers };
    }

    return { action: CorsAction.RespondPreflight, headers, statusCode: this.options.optionsSuccessStatus };
  }

  /** @internal */
  private reject(reason: CorsRejectionReason, headers: Headers = new Headers()): CorsRejectResult {
    return { action: CorsAction.Reject, reason, headers };
  }

  /** @internal A fresh header set carrying `Vary: Origin` iff the answer varies by origin (§7.1). */
  private varyHeaders(): Headers {
    const headers = new Headers();
    if (this.variesByOrigin) {
      headers.append(HttpHeader.Vary, HttpHeader.Origin);
    }
    return headers;
  }

  /** @internal */
  private async matchOrigin(origin: string, request: Request): ResultAsync<string | undefined, CorsErrorData> {
    const originOption = this.options.origin;

    if (originOption === false) {
      return undefined;
    }

    if (originOption === '*') {
      return '*';
    }

    if (typeof originOption === 'string') {
      return originOption === origin ? originOption : undefined;
    }

    if (originOption === true) {
      return origin;
    }

    if (originOption instanceof RegExp) {
      return originOption.test(origin) ? origin : undefined;
    }

    if (Array.isArray(originOption)) {
      const matched = originOption.some(entry => {
        if (entry instanceof RegExp) {
          return entry.test(origin);
        }

        return entry === origin;
      });

      return matched ? origin : undefined;
    }

    const originResult = await safe(
      (async () => originOption(origin, request))(),
      (thrown): CorsErrorData => ({
        reason: CorsErrorReason.OriginFunctionError,
        message: 'Origin function threw an error',
        cause: thrown,
      }),
    );

    if (isErr(originResult)) {
      return originResult;
    }

    return this.resolveOriginResult(origin, originResult);
  }

  /** @internal */
  private resolveOriginResult(origin: string, result: OriginResult): string | undefined {
    if (result === true) {
      return origin;
    }
    if (typeof result === 'string') {
      // A function return is held to the same standard as a config origin string
      // (STANDARDS §1.2/§1.3): `*`, the literal `null`, or a serialized origin.
      // Anything else — trailing slash/path, explicit default port, blank, CR/LF
      // injection (the URL parser strips those, failing the equality) — would fail
      // the UA's byte comparison, so treat it as not-allowed instead of emitting it.
      return this.isSerializedCorsOrigin(result) ? result : undefined;
    }
    return undefined;
  }

  /** @internal `'*'`, `'null'`, or a value that IS its own URL origin serialization. */
  private isSerializedCorsOrigin(value: string): boolean {
    if (value === '*' || value === 'null') {
      return true;
    }
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  }

  /** @internal Emit Access-Control-Expose-Headers for an actual (non-preflight) response. */
  private applyExposeHeaders(headers: Headers): void {
    if (this.options.exposedHeaders === null || this.options.exposedHeaders.length === 0) {
      return;
    }

    const value = this.serializeExposeHeaders(this.options.exposedHeaders);

    if (value !== undefined) {
      headers.set(HttpHeader.AccessControlExposeHeaders, value);
    }
  }

  /** @internal */
  private serializeExposeHeaders(exposedHeaders: string[]): string | undefined {
    // Set-Cookie and Set-Cookie2 are forbidden response-header names (Fetch
    // #forbidden-response-header-name) — never exposable to script via
    // Access-Control-Expose-Headers (the UA blocks them regardless). Drop both so
    // the middleware never emits an inert, misleading entry (STANDARDS §4.1.4).
    // Set-Cookie2 (RFC 2965, obsolete) has no HttpHeader enum member but remains
    // in Fetch's forbidden list, so it is matched by its lowercased literal name.
    const exposable = exposedHeaders.filter(header => {
      const name = header.trim().toLowerCase();
      return name !== HttpHeader.SetCookie && name !== 'set-cookie2';
    });

    if (this.options.credentials && this.includesWildcard(exposable)) {
      const explicit = exposable.filter(header => header.trim() !== '*');

      return explicit.length > 0 ? explicit.join(',') : undefined;
    }

    return exposable.length > 0 ? exposable.join(',') : undefined;
  }

  /** @internal */
  private isMethodAllowed(requestMethod: string, allowedMethods: ReadonlyArray<string>): boolean {
    if (this.includesWildcard(allowedMethods)) {
      return true;
    }

    // CORS-safelisted methods (GET/HEAD/POST) are allowed through even when the
    // configured list omits them — the browser lets them cross regardless, so
    // rejecting their preflight would be inconsistent with the UA (STANDARDS §3.3.1).
    if (this.isCorsSafelistedMethod(requestMethod)) {
      return true;
    }

    return allowedMethods.includes(requestMethod);
  }

  /** @internal A CORS-safelisted method (Fetch #cors-safelisted-method), byte-case-sensitive. */
  private isCorsSafelistedMethod(method: string): boolean {
    return method === HttpMethod.Get || method === HttpMethod.Head || method === HttpMethod.Post;
  }

  /** @internal */
  private serializeAllowedMethods(allowedMethods: ReadonlyArray<string>): string {
    if (!this.includesWildcard(allowedMethods)) {
      return allowedMethods.join(',');
    }
    // Wildcard with credentials:true is rejected by the cross-check in
    // Cors.create (CredentialsWithWildcardMethods), so only credentials:false
    // reaches this branch — emit the literal '*'.
    return '*';
  }

  /** @internal */
  private areRequestHeadersAllowed(requestHeaders: string[], allowedHeaders: string[]): boolean {
    if (requestHeaders.length === 0) {
      return true;
    }

    if (allowedHeaders.length === 0) {
      return false;
    }

    if (this.includesWildcard(allowedHeaders)) {
      const explicitHeaders = allowedHeaders.filter(header => header.trim() !== '*');
      const hasAuthorization = this.includesHeader(requestHeaders, HttpHeader.Authorization);

      if (hasAuthorization && !this.includesHeader(explicitHeaders, HttpHeader.Authorization)) {
        return false;
      }

      return true;
    }

    return requestHeaders.every(header => this.includesHeader(allowedHeaders, header));
  }

  /** @internal */
  private serializeAllowedHeaders(allowedHeaders: string[], requestHeaders: string[]): string | undefined {
    if (allowedHeaders.length === 0) {
      return undefined;
    }

    // '*' is not a valid Access-Control-Allow-Headers token under credentials
    // (browsers reject the literal wildcard), so echo the concrete requested
    // headers instead of the wildcard list. Echo the parsed names (empty list
    // elements already stripped, STANDARDS §1.5), never the raw client string.
    if (this.options.credentials && this.includesWildcard(allowedHeaders)) {
      return requestHeaders.length > 0 ? requestHeaders.join(',') : undefined;
    }

    // Otherwise emit the configured list verbatim. Explicit entries listed
    // alongside '*' (e.g. Authorization — a CORS non-wildcard request-header
    // name that '*' does not cover) are preserved, not collapsed to bare '*'.
    return allowedHeaders.join(',');
  }

  /** @internal */
  private includesWildcard(values: ReadonlyArray<string>): boolean {
    return values.some(value => value === '*');
  }

  /** @internal */
  private includesHeader(allowedHeaders: string[], requestHeader: string): boolean {
    return allowedHeaders.some(header => header.toLowerCase() === requestHeader.toLowerCase());
  }

  /** @internal */
  private parseCommaSeparatedValues(value: string | null): string[] {
    if (value === null) {
      return [];
    }

    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }
}
