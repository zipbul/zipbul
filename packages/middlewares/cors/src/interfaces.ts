import { HttpMethod } from '@zipbul/http-adapter';
import type { HttpStatus } from '@zipbul/http-adapter';

import type { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import type { OriginOptions } from './types';

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
  public readonly reason: CorsErrorReason;

  constructor(data: CorsErrorData) {
    super(data.message, data.cause !== undefined ? { cause: data.cause } : undefined);
    this.name = 'CorsError';
    this.reason = data.reason;
  }
}

/**
 * Configuration for the {@link Cors} handler.
 * All fields are optional.
 */
export interface CorsOptions {
  /**
   * Allowed origin(s).
   * Accepts `'*'`, `false`, `true`, string, RegExp, array, or async function.
   *
   * Origin values are matched as raw header strings (no URL parsing or
   * normalization). A spec-conformant user agent serializes an opaque origin
   * (e.g., a sandboxed iframe, `data:`, `file:`) as the literal string
   * `"null"` per RFC 6454 §6. To accept such opaque origins, pass `'null'`
   * (the string) as the option.
   *
   * @default `'*'`
   */
  origin?: OriginOptions;

  /**
   * HTTP methods allowed in preflight. Use the {@link HttpMethod} enum.
   *
   * @default `[HttpMethod.Get, HttpMethod.Head, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Post, HttpMethod.Delete]`
   * @example [HttpMethod.Get, HttpMethod.Post, HttpMethod.Delete]
   * @example ['*']  // wildcard — allow all methods
   * @example [HttpMethod.Get, HttpMethod.Propfind]
   */
  methods?: Array<HttpMethod | '*'>;

  /**
   * Request headers allowed in preflight.
   * When omitted, echoes `Access-Control-Request-Headers`.
   */
  allowedHeaders?: string[];

  /**
   * Response headers exposed to browser JavaScript.
   */
  exposedHeaders?: string[];

  /**
   * Whether to send `Access-Control-Allow-Credentials: true`.
   *
   * @default `false`
   */
  credentials?: boolean;

  /**
   * Preflight cache duration in seconds.
   * When omitted, the header is not sent.
   */
  maxAge?: number;

  /**
   * When `true`, preflight returns `Continue` instead of `RespondPreflight`.
   *
   * @default `false`
   */
  preflightContinue?: boolean;

  /**
   * HTTP status for the preflight response.
   *
   * @default `204`
   */
  optionsSuccessStatus?: number;

  /**
   * When `true`, preflight requests carrying
   * `Access-Control-Request-Private-Network: true` receive
   * `Access-Control-Allow-Private-Network: true` in the response.
   *
   * Enables private-network access from public-origin pages per the
   * WICG Private Network Access spec (enforced by Chrome 130+).
   *
   * @default `false`
   */
  allowPrivateNetwork?: boolean;
}
