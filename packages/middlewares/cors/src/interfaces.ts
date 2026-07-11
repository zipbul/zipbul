import type { HttpStatus } from '@zipbul/http-adapter';

import type { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';

/**
 * Normal request or `preflightContinue` preflight.
 * Merge `headers` into your response.
 */
export interface CorsContinueResult {
  action: CorsAction.Continue;
  headers: Headers;
}

/**
 * Preflight response.
 * Use `headers` and `statusCode` to build a response.
 */
export interface CorsPreflightResult {
  action: CorsAction.RespondPreflight;
  headers: Headers;
  statusCode: HttpStatus;
}

/**
 * CORS validation failed.
 * Inspect `reason` to build an error response.
 *
 * `headers` carries the cache-correctness headers that must ride along even on a
 * rejected/non-CORS response — chiefly `Vary: Origin` when the resource's allow-origin
 * answer depends on the request origin (STANDARDS §7.1), plus any `Access-Control-*`
 * headers already negotiated before a later preflight check failed. Merge them into
 * the outgoing response; the request itself is not blocked by CORS.
 */
export interface CorsRejectResult {
  action: CorsAction.Reject;
  reason: CorsRejectionReason;
  headers: Headers;
}

/**
 * Error data payload carried by {@link CorsError} and the internal Result
 * pattern. Kept in the public surface (not stripped) so the emitted
 * {@link CorsError} constructor signature resolves — mirrors cookie's
 * `CookieErrorData`.
 */
export interface CorsErrorData {
  reason: CorsErrorReason;
  message: string;
  cause?: unknown;
}

/**
 * Thrown by {@link Cors.create} on invalid options, or by {@link Cors.handle}
 * when the origin function throws or returns `'*'` together with
 * `credentials:true` (forbidden by Fetch Standard §3.3.5).
 *
 * Inspect {@link reason} to programmatically distinguish error kinds.
 * When the origin function throws, the original thrown value is preserved
 * in {@link cause} for diagnostic purposes.
 */
export class CorsError extends Error {
  public readonly reason: CorsErrorReason;

  constructor(data: CorsErrorData) {
    super(data.message, 'cause' in data ? { cause: data.cause } : undefined);
    this.name = 'CorsError';
    this.reason = data.reason;
  }
}

