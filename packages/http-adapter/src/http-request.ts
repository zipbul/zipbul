import type { Class } from '@zipbul/common';
import type { ContentTypeInfo, HttpMethod, HttpRequestData, RequestBodyValue, RequestParamMap } from './types';
import { parseContentTypeInfo } from './content-type';
import { validateRequestId } from './request-id';
import { defaultPortByProtocol, extractHostname, extractPort } from './url-parts';

export class HttpRequest {
  // ── readonly — 생성자에서 확정 ──
  public readonly originalMethod: HttpMethod;
  public readonly originalUrl: string;
  public readonly headers: Headers;
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

  private _queryString: string | null | undefined = undefined;
  private _contentType: ContentTypeInfo | null | undefined = undefined;
  private readonly _origin: HttpRequestData['origin'];
  private _requestId: string | undefined;
  private readonly _requestIdHeaderName: string | undefined;
  private readonly _requestIdGenerator: (() => string) | undefined;
  private _protocol: string | null | undefined;
  private _host: string | null | undefined = undefined;
  private _hostname: string | null | undefined = undefined;
  private _port: number | undefined = undefined;

  constructor(data: HttpRequestData) {
    // readonly
    this._requestId = data.requestId;
    this._requestIdHeaderName = data.requestIdHeaderName;
    this._requestIdGenerator = data.requestIdGenerator;
    this.originalMethod = data.originalMethod;
    this.originalUrl = data.originalUrl;
    this.headers = data.headers;
    this.contentLength = data.contentLength;
    this.ip = data.ip;
    this.ips = data.ips;
    this.isTrustedProxy = data.isTrustedProxy;
    this.signal = data.signal;
    this._origin = data.origin;

    // mutable
    this.method = data.method;
    this.url = data.url;
    this.path = data.path;
    this.body = undefined;
    this.params = {};
    this.rawBody = null;
    this.query = undefined;
  }

  get requestId(): string {
    if (this._requestId !== undefined) {
      return this._requestId;
    }

    const headerName = this._requestIdHeaderName;

    if (headerName !== undefined) {
      const headerValue = this.headers.get(headerName);

      if (headerValue !== null && validateRequestId(headerValue)) {
        this._requestId = headerValue;
        return headerValue;
      }
    }

    this._requestId = this._requestIdGenerator?.() ?? crypto.randomUUID();

    return this._requestId;
  }

  get protocol(): string | null {
    if (this._protocol !== undefined) {
      return this._protocol;
    }

    const proxyProtocol = this._origin.proxyProtocol;
    const urlProtocol = this._origin.urlProtocol;

    this._protocol = (proxyProtocol === 'http' || proxyProtocol === 'https')
      ? proxyProtocol
      : urlProtocol;

    return this._protocol;
  }

  get host(): string | null {
    if (this._host !== undefined) {
      return this._host;
    }

    const proxyHost = this._origin.proxyHost;
    const urlHost = this._origin.urlHost;

    this._host = proxyHost ?? (urlHost !== null ? urlHost.toLowerCase() : null);

    return this._host;
  }

  get hostname(): string | null {
    if (this._hostname !== undefined) {
      return this._hostname;
    }

    const host = this.host;

    this._hostname = host !== null ? extractHostname(host).toLowerCase() : null;

    return this._hostname;
  }

  get port(): number {
    if (this._port !== undefined) {
      return this._port;
    }

    const host = this.host;
    const forwardedPort = host !== null ? extractPort(host) : null;
    const parsedForwardedPort = forwardedPort !== null ? parseInt(forwardedPort, 10) : NaN;

    this._port = !Number.isNaN(parsedForwardedPort)
      ? parsedForwardedPort
      : (this._origin.proxyPort ?? defaultPortByProtocol(this.protocol));

    return this._port;
  }

  get queryString(): string | null {
    if (this._queryString !== undefined) {
      return this._queryString;
    }

    const questionIndex = this.url.indexOf('?');

    this._queryString = questionIndex === -1 ? null : this.url.slice(questionIndex);

    return this._queryString;
  }

  get contentType(): ContentTypeInfo | null {
    if (this._contentType !== undefined) {
      return this._contentType;
    }

    this._contentType = parseContentTypeInfo(this.headers.get('content-type'));

    return this._contentType;
  }

  /**
   * Returns the validated request body as an instance of the given DTO class.
   * Validation is wired by the AOT compiler — by the time this is called,
   * the body has been parsed and validated against `dto`.
   *
   * @param _dto - DTO class constructor (type witness for `T` inference; AOT extracts it for validation wiring).
   * @returns The validated body instance, typed as `T`.
   * @public
   */
  getBody<T>(_dto: Class<T>): T {
    return this.body as unknown as T;
  }

  /**
   * Returns the route parameters as an instance of the given DTO class.
   * Validation is wired by the AOT compiler.
   *
   * @param _dto - DTO class constructor (type witness for `T` inference).
   * @returns The validated params instance, typed as `T`.
   * @public
   */
  getParams<T>(_dto: Class<T>): T {
    return this.params as unknown as T;
  }
}
