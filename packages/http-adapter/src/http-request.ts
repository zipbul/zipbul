import type { ContentTypeInfo, HttpMethod, HttpRequestData, RequestBodyValue, RequestParamMap } from './types';

export class HttpRequest {
  // ── readonly — 생성자에서 확정 ──
  public readonly requestId: string;
  public readonly originalMethod: HttpMethod;
  public readonly originalUrl: string;
  public readonly headers: Headers;
  public readonly protocol: string | null;
  public readonly host: string | null;
  public readonly hostname: string | null;
  public readonly port: number;
  public readonly queryString: string | null;
  public readonly contentType: ContentTypeInfo | null;
  public readonly contentLength: number | null;
  public readonly ip: string | null;
  public readonly ips: readonly string[];
  public readonly isTrustedProxy: boolean;
  public readonly signal: AbortSignal;

  // ── mutable — 파이프라인에서 재할당 ──
  public method: HttpMethod;
  public url: string;
  public path: string;
  public body: RequestBodyValue;
  public params: RequestParamMap;
  public rawBody: Uint8Array | null;
  /** Parsed query parameters. Set by BeforeValidation middleware (e.g. parseQuery). */
  public query: unknown;

  constructor(data: HttpRequestData) {
    // readonly
    this.requestId = data.requestId;
    this.originalMethod = data.originalMethod;
    this.originalUrl = data.originalUrl;
    this.headers = data.headers;
    this.protocol = data.protocol;
    this.host = data.host;
    this.hostname = data.hostname;
    this.port = data.port;
    this.queryString = data.queryString;
    this.contentType = data.contentType;
    this.contentLength = data.contentLength;
    this.ip = data.ip;
    this.ips = data.ips;
    this.isTrustedProxy = data.isTrustedProxy;
    this.signal = data.signal;

    // mutable
    this.method = data.method;
    this.url = data.url;
    this.path = data.path;
    this.body = undefined;
    this.params = {};
    this.rawBody = null;
    this.query = undefined;
  }
}
