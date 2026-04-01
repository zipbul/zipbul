/**
 * HTTP adapter pipeline phases.
 *
 * Each phase represents a middleware execution point in the HTTP request lifecycle.
 *
 * Pipeline execution order:
 * ```
 * OnRequest → [resolveRoute] → BeforeParse → [parseBody] → BeforeValidate → [runValidations + guards]
 *   → BeforeHandle → [handler] → AfterHandle → [serialize] → BeforeResponse → [build + send] → AfterResponse
 * ```
 *
 * Naming convention:
 * - `On*`: lifecycle event (request arrival, response completion)
 * - `Before*`: pre-action hook (before parsing, validation, handler, send)
 * - `After*`: post-action hook (after handler, after response)
 *
 * @public
 */
export enum HttpPhase {
  /** Runs immediately when a request is received, before routing or parsing. CORS, logging, method override, URL rewriting. */
  OnRequest = 'OnRequest',
  /** Runs after route match, before body parsing. Raw body interception, decryption. */
  BeforeParse = 'BeforeParse',
  /** Runs after body parsing. Query parsing, multipart parsing, body transformation — data preparation before validation. */
  BeforeValidate = 'BeforeValidate',
  /** Runs after validation, just before handler invocation. Global + handler-scoped MW. Final preparation. */
  BeforeHandle = 'BeforeHandle',
  /** Runs after handler, before serialization. Result transformation, response envelope. Buffered responses only — native Response (SSE, streaming) has no JS object to transform. */
  AfterHandle = 'AfterHandle',
  /** Runs after serialization, before transmission. Response compression, ETag, signing, security headers. Runs for ALL response types including native Response. */
  BeforeResponse = 'BeforeResponse',
  /** Runs after response has been sent (Phase 3 finalize). Errors are swallowed. Logging, metrics, resource cleanup. */
  AfterResponse = 'AfterResponse',
}

/**
 * Type guard for `HttpPhase` enum values.
 *
 * @param value - The string to check.
 * @returns `true` if the value is a valid `HttpPhase`.
 *
 * @public
 */
export function isHttpPhase(value: string): value is HttpPhase {
  return HTTP_PHASE_VALUES.has(value);
}

const HTTP_PHASE_VALUES: ReadonlySet<string> = new Set(Object.values(HttpPhase));

export enum HeaderField {
  SetCookie = 'set-cookie',
  ContentType = 'content-type',
  ContentLength = 'content-length',
  ContentEncoding = 'content-encoding',
  AcceptEncoding = 'accept-encoding',
  Allow = 'allow',
  Location = 'location',
  Forwarded = 'forwarded',
  XForwardedFor = 'x-forwarded-for',
  XForwardedHost = 'x-forwarded-host',
  XForwardedPort = 'x-forwarded-port',
  XForwardedProto = 'x-forwarded-proto',
  XRealIp = 'x-real-ip',
}

export enum ContentType {
  Text = 'text/plain',
  Json = 'application/json',
}

export type { HttpMethod } from './types';
