import type { Result } from '@zipbul/result';

import { isHttpToken } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';

import type { CorsErrorData, CorsOptions } from './interfaces';
import type { ResolvedCorsOptions } from './types';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';
import { CorsErrorReason } from './enums';

/**
 * Takes partial {@link CorsOptions} and fills in every missing field with a
 * sensible default, returning a fully populated {@link ResolvedCorsOptions}.
 *
 * You do not need to call this manually — {@link Cors.create} handles it for
 * you automatically.
 *
 * @param options - Optional CORS configuration. Pass nothing to use all defaults.
 * @returns A complete options object ready for validation and request handling.
 */
export function resolveCorsOptions(options?: CorsOptions): ResolvedCorsOptions {
  return {
    origin: options?.origin ?? '*',
    methods: options?.methods?.includes('*') ? ['*'] : [...(options?.methods ?? CORS_DEFAULT_METHODS)],
    allowedHeaders: options?.allowedHeaders ?? null,
    exposedHeaders: options?.exposedHeaders ?? null,
    credentials: options?.credentials ?? false,
    maxAge: options?.maxAge ?? null,
    preflightContinue: options?.preflightContinue ?? false,
    optionsSuccessStatus: options?.optionsSuccessStatus ?? CORS_DEFAULT_OPTIONS_SUCCESS_STATUS,
    allowPrivateNetwork: options?.allowPrivateNetwork ?? false,
  };
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Validates a fully resolved {@link ResolvedCorsOptions} object and returns
 * the first problem it finds, or `undefined` when everything looks good.
 *
 * Covers origins (blank strings, empty arrays), methods,
 * allowed/exposed headers, the `credentials` + wildcard combination,
 * `maxAge`, and `optionsSuccessStatus`.
 *
 * You do not need to call this manually — {@link Cors.create} handles it
 * for you automatically.
 *
 * @param resolved - The fully resolved options object to validate.
 * @returns `undefined` when valid, or `Err<CorsError>` describing the first
 *   rule violation found.
 */
export function validateCorsOptions(resolved: ResolvedCorsOptions): Result<void, CorsErrorData> {
  if (typeof resolved.origin === 'string' && resolved.origin !== '*' && isBlank(resolved.origin)) {
    return err<CorsErrorData>({
      reason: CorsErrorReason.InvalidOrigin,
      message: 'origin must not be an empty or blank string (RFC 6454)',
    });
  }

  if (Array.isArray(resolved.origin)) {
    if (resolved.origin.length === 0) {
      return err<CorsErrorData>({
        reason: CorsErrorReason.InvalidOrigin,
        message: 'origin array must not be empty (RFC 6454)',
      });
    }

    const hasBlankEntry = resolved.origin.some(entry => typeof entry === 'string' && isBlank(entry));

    if (hasBlankEntry) {
      return err<CorsErrorData>({
        reason: CorsErrorReason.InvalidOrigin,
        message: 'origin array must not contain empty or blank string entries (RFC 6454)',
      });
    }
  }

  if (resolved.methods.length === 0) {
    return err<CorsErrorData>({
      reason: CorsErrorReason.InvalidMethods,
      message: 'methods must not be an empty array (RFC 9110 §5.6.2)',
    });
  }

  if (resolved.allowedHeaders !== null) {
    for (const name of resolved.allowedHeaders) {
      if (isHttpToken(name) !== true) {
        return err<CorsErrorData>({
          reason: CorsErrorReason.InvalidAllowedHeaders,
          message: `allowedHeaders entry "${name}" must be a valid HTTP token (RFC 9110 §5.6.2: 1*tchar — no empty/blank/invalid chars)`,
        });
      }
    }
  }

  if (resolved.exposedHeaders !== null) {
    for (const name of resolved.exposedHeaders) {
      if (isHttpToken(name) !== true) {
        return err<CorsErrorData>({
          reason: CorsErrorReason.InvalidExposedHeaders,
          message: `exposedHeaders entry "${name}" must be a valid HTTP token (RFC 9110 §5.6.2: 1*tchar — no empty/blank/invalid chars)`,
        });
      }
    }
  }

  if (resolved.credentials === true && resolved.origin === '*') {
    return err<CorsErrorData>({
      reason: CorsErrorReason.CredentialsWithWildcardOrigin,
      message: 'credentials:true cannot be used with wildcard origin (*) per Fetch Standard',
    });
  }

  if (resolved.credentials === true && resolved.methods.includes('*')) {
    return err<CorsErrorData>({
      reason: CorsErrorReason.CredentialsWithWildcardMethods,
      message: 'credentials:true cannot be combined with wildcard methods (["*"]); per Fetch Standard the "*" token is treated as the literal method name under credentials mode, so the wildcard intent is unreachable. Enumerate the allowed methods explicitly.',
    });
  }

  if (resolved.maxAge !== null && (resolved.maxAge < 0 || !Number.isInteger(resolved.maxAge))) {
    return err<CorsErrorData>({
      reason: CorsErrorReason.InvalidMaxAge,
      message: 'maxAge must be a non-negative integer (delta-seconds per RFC 9111)',
    });
  }

  if (
    !Number.isInteger(resolved.optionsSuccessStatus) ||
    resolved.optionsSuccessStatus < 200 ||
    resolved.optionsSuccessStatus > 299
  ) {
    return err<CorsErrorData>({
      reason: CorsErrorReason.InvalidStatusCode,
      message: 'optionsSuccessStatus must be a 2xx integer status code (200–299)',
    });
  }

  return undefined;
}
