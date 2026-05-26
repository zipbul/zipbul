import type { ResultAsync } from '@zipbul/result';

import { isHttpToken } from '@zipbul/baker/rules';
import { isErr, safe } from '@zipbul/result';
import { HttpHeader } from '@zipbul/http-adapter';
import type { HttpStatus } from '@zipbul/http-adapter';

import type { CorsErrorData, CorsOptions, CorsRejectResult } from './interfaces';
import type { CorsResult, OriginResult, ResolvedCorsOptions } from './types';

import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import { CorsError } from './interfaces';
import { resolveCorsOptions, validateCorsOptions } from './options';

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
   * @throws {CorsError} when options fail validation (invalid origin, methods, maxAge, etc.)
   * @returns A ready-to-use Cors instance.
   */
  public static create(options?: CorsOptions): Cors {
    const resolved = resolveCorsOptions(options);
    const validation = validateCorsOptions(resolved);

    if (isErr(validation)) {
      throw new CorsError(validation.data);
    }

    return new Cors(resolved);
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

    const allowMethodsValue = this.serializeAllowedMethods(this.options.methods, requestMethod);

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
        const echoed = this.filterValidHeaderTokens(requestHeadersRaw);
        if (echoed !== undefined) {
          headers.set(HttpHeader.AccessControlAllowHeaders, echoed);
        }
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
      originOption.lastIndex = 0;
      return originOption.test(origin) ? origin : undefined;
    }

    if (Array.isArray(originOption)) {
      const matched = originOption.some(entry => {
        if (entry instanceof RegExp) {
          entry.lastIndex = 0;
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

    if (typeof result === 'string' && result.length > 0) {
      if (result === '*' && this.options.credentials) {
        throw new CorsError({
          reason: CorsErrorReason.CredentialsWithWildcardOrigin,
          message: 'origin function returned "*" while credentials:true is enabled; this combination is forbidden by Fetch Standard §3.3.5. Return the request origin to echo it back, or set credentials:false.',
        });
      }
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
  private serializeAllowedMethods(allowedMethods: ReadonlyArray<string>, requestMethod: string): string {
    if (!this.includesWildcard(allowedMethods)) {
      return allowedMethods.join(',');
    }

    if (this.options.credentials) {
      return requestMethod;
    }

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

    if (!this.includesWildcard(allowedHeaders)) {
      return allowedHeaders.join(',');
    }

    if (this.options.credentials) {
      if (requestHeadersRaw !== null && requestHeadersRaw.length > 0) {
        return this.filterValidHeaderTokens(requestHeadersRaw);
      }

      return undefined;
    }

    return '*';
  }

  /**
   * Filters a comma-separated header-name list down to entries that satisfy
   * the RFC 9110 §5.6.2 `token` grammar, then re-joins the survivors with
   * commas. Returns `undefined` when no entry survives so the caller can
   * omit the `Access-Control-Allow-Headers` header entirely.
   *
   * @internal
   */
  private filterValidHeaderTokens(raw: string): string | undefined {
    const valid = this.parseCommaSeparatedValues(raw).filter(name => isHttpToken(name) === true);
    if (valid.length === 0) {
      return undefined;
    }
    return valid.join(',');
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
