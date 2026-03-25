/**
 * HTTP adapter pipeline phases.
 *
 * Each phase represents a middleware execution point in the HTTP request lifecycle.
 * The pipeline execution order is:
 * `OnReceive → [resolveRoute] → [parseBody] → PostParse → Guards → PreHandle → [executeHandler]`
 *
 * @public
 */
export enum HttpPhase {
  /** Runs immediately when a request is received, before routing or parsing. CORS, logging, method override, URL rewriting. */
  OnReceive = 'OnReceive',
  /** Runs after body/query parsing is complete. Query parsing, cookie parsing, body transformation. */
  PostParse = 'PostParse',
  /** Runs just before the handler is invoked, after guards pass. */
  PreHandle = 'PreHandle',
  /** Runs after the response has been sent (Phase 3 finalize). Errors are swallowed. Logging, metrics. */
  OnComplete = 'OnComplete',
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
  Location = 'location',
  Forwarded = 'forwarded',
  XForwardedFor = 'x-forwarded-for',
  XRealIp = 'x-real-ip',
}

export enum ContentType {
  Text = 'text/plain',
  Json = 'application/json',
}

export type { HttpMethod } from './types';
