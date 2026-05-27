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
 */
export interface CorsRejectResult {
  action: CorsAction.Reject;
  reason: CorsRejectionReason;
}

/**
 * Error data payload used internally with the Result pattern.
 * @internal
 */
export interface CorsErrorData {
  reason: CorsErrorReason;
  message: string;
  cause?: unknown;
}

/**
 * Thrown by {@link Cors.create} on invalid options, or by {@link Cors.handle}
 * when the origin function throws.
 *
 * Inspect {@link reason} to programmatically distinguish error kinds.
 * When the origin function throws, the original thrown value is preserved
 * in {@link cause} for diagnostic purposes.
 */
export class CorsError extends Error {
  public readonly reason!: CorsErrorReason;

  constructor(data: CorsErrorData) {
    super(data.message, data.cause !== undefined ? { cause: data.cause } : undefined);
    this.name = 'CorsError';
    Object.defineProperty(this, 'reason', {
      value: data.reason,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    Object.defineProperty(this, 'message', {
      value: data.message,
      writable: false,
      configurable: false,
      enumerable: false,
    });
    if (data.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: data.cause,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    }
  }
}

