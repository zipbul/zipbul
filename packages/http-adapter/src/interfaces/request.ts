import type { HttpMethod } from '../enums';
import type { RequestQueryValue } from '../types';

export interface RequestQueryArray extends Array<RequestQueryValue> {}

export interface RequestQueryRecord extends Record<string, RequestQueryValue> {}

export interface ContentTypeInfo {
  readonly mediaType: string;
  readonly charset: string | null;
  readonly boundary: string | null;
  readonly params: ReadonlyMap<string, string>;
}

/**
 * Proxy/origin resolution result from Forwarded / X-Forwarded-* headers.
 */
export interface HttpRequestOrigin {
  readonly urlProtocol: string | null;
  readonly urlHost: string | null;
  readonly proxyProtocol?: string | null;
  readonly proxyHost?: string | null;
  readonly proxyPort?: number | null;
}

/**
 * Raw network-level data for constructing an HttpRequest.
 */
export interface HttpRequestData {
  readonly requestId?: string;
  readonly requestIdHeaderName?: string;
  readonly requestIdGenerator?: () => string;
  readonly originalMethod: HttpMethod;
  readonly originalUrl: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly path: string;
  readonly headers: Headers;
  readonly origin: HttpRequestOrigin;
  readonly contentLength: number | null;
  readonly ip: string | null;
  readonly ips: readonly string[];
  readonly isTrustedProxy: boolean;
  readonly signal: AbortSignal;
}
