import type { ResultAsync } from '@zipbul/result';

import { isBakerIssueSet } from '@zipbul/baker';
import { isErr, safe } from '@zipbul/result';
import { HttpHeader } from '@zipbul/http-adapter';
import type { HttpStatus } from '@zipbul/http-adapter';

import type { CorsErrorData, CorsRejectResult } from './interfaces';
import type { CorsResult, OriginResult, ResolvedCorsOptions } from './types';

import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import { CorsError } from './interfaces';
import { corsBaker } from './baker';
import { CORS_DEFAULTS, CorsOptions, type CorsOptionsInput } from './options';

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
  if (isSealed) return;
  corsBaker.seal();
  isSealed = true;
}

/**
 * Framework-agnostic CORS handler.
 * Evaluates CORS policy and returns a discriminated union result
 * instead of generating responses directly.
 */
export class Cors {
  private constructor(
    /** @internal */
    private readonly options: ResolvedCorsOptions,
  ) {}

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
  public static create(options?: CorsOptionsInput): Cors {
    ensureSealed();
    const merged: ResolvedCorsOptions = { ...CORS_DEFAULTS, ...(options ?? {}) };

    const result = corsBaker.validateSync(CorsOptions, merged);
    if (isBakerIssueSet(result)) {
      const issue = result.errors[0]!;
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
      return this.reject(CorsRejectionReason.NoOrigin);
    }

    const allowedOrigin = await this.matchOrigin(origin, request);

    if (isErr(allowedOrigin)) {
      throw new CorsError(allowedOrigin.data);
    }

    if (allowedOrigin === undefined) {
      return this.reject(CorsRejectionReason.OriginNotAllowed);
    }

    if (allowedOrigin === '*' && this.options.credentials) {
      throw new CorsError({
        reason: CorsErrorReason.CredentialsWithWildcardOrigin,
        message: 'origin function returned "*" with credentials:true forbidden (Fetch Standard §3.3.5)',
      });
    }

    const headers = new Headers();

    headers.set(HttpHeader.AccessControlAllowOrigin, allowedOrigin);

    if (allowedOrigin !== '*') {
      headers.append(HttpHeader.Vary, HttpHeader.Origin);
    }

    if (this.options.credentials) {
      headers.set(HttpHeader.AccessControlAllowCredentials, 'true');
    }

    if (request.method !== 'OPTIONS') {
      if (this.options.exposedHeaders !== null && this.options.exposedHeaders.length > 0) {
        const exposeHeadersValue = this.serializeExposeHeaders(this.options.exposedHeaders);

        if (exposeHeadersValue !== undefined) {
          headers.set(HttpHeader.AccessControlExposeHeaders, exposeHeadersValue);
        }
      }

      return { action: CorsAction.Continue, headers };
    }

    const requestMethod = request.headers.get(HttpHeader.AccessControlRequestMethod);

    if (requestMethod === null || requestMethod.length === 0) {
      return { action: CorsAction.Continue, headers };
    }

    if (!this.isMethodAllowed(requestMethod, this.options.methods)) {
      return this.reject(CorsRejectionReason.MethodNotAllowed);
    }

    const allowMethodsValue = this.serializeAllowedMethods(this.options.methods);

    headers.set(HttpHeader.AccessControlAllowMethods, allowMethodsValue);

    headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestMethod);

    const requestHeadersRaw = request.headers.get(HttpHeader.AccessControlRequestHeaders);
    const requestHeaders = this.parseCommaSeparatedValues(requestHeadersRaw);

    if (this.options.allowedHeaders !== null) {
      if (!this.areRequestHeadersAllowed(requestHeaders, this.options.allowedHeaders)) {
        return this.reject(CorsRejectionReason.HeaderNotAllowed);
      }

      const allowHeadersValue = this.serializeAllowedHeaders(this.options.allowedHeaders, requestHeadersRaw);

      if (allowHeadersValue !== undefined) {
        headers.set(HttpHeader.AccessControlAllowHeaders, allowHeadersValue);
        headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestHeaders);
      }
    } else {
      if (requestHeadersRaw !== null && requestHeadersRaw.length > 0) {
        headers.set(HttpHeader.AccessControlAllowHeaders, requestHeadersRaw);
        headers.append(HttpHeader.Vary, HttpHeader.AccessControlRequestHeaders);
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

    return { action: CorsAction.RespondPreflight, headers, statusCode: this.options.optionsSuccessStatus as HttpStatus };
  }

  /** @internal */
  private reject(reason: CorsRejectionReason): CorsRejectResult {
    return { action: CorsAction.Reject, reason };
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
      return result;
    }
    return undefined;
  }

  /** @internal */
  private serializeExposeHeaders(exposedHeaders: string[]): string | undefined {
    if (this.options.credentials && this.includesWildcard(exposedHeaders)) {
      const explicit = exposedHeaders.filter(header => header.trim() !== '*');

      return explicit.length > 0 ? explicit.join(',') : undefined;
    }

    return exposedHeaders.join(',');
  }

  /** @internal */
  private isMethodAllowed(requestMethod: string, allowedMethods: ReadonlyArray<string>): boolean {
    if (this.includesWildcard(allowedMethods)) {
      return true;
    }

    return allowedMethods.includes(requestMethod);
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
  private serializeAllowedHeaders(allowedHeaders: string[], requestHeadersRaw: string | null): string | undefined {
    if (allowedHeaders.length === 0) {
      return undefined;
    }

    // '*' is not a valid Access-Control-Allow-Headers token under credentials
    // (browsers reject the literal wildcard), so echo the concrete requested
    // headers instead of the wildcard list.
    if (this.options.credentials && this.includesWildcard(allowedHeaders)) {
      return requestHeadersRaw !== null && requestHeadersRaw.length > 0 ? requestHeadersRaw : undefined;
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
