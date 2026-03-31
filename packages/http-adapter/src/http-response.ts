import { CookieMap, type CookieInit } from 'bun';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import type { HttpRequest } from './http-request';
import type { HttpWorkerResponse } from './interfaces';
import type { ResponseBodyValue } from './types';

import { ContentType, HeaderField } from './enums';

export class HttpResponse {
  private readonly req: HttpRequest;
  private _body: ResponseBodyValue | undefined;
  private _cookies: CookieMap;
  private _headers: Headers;
  private _status: StatusCodes | 0 = 0;
  private _statusText: string | undefined;
  private _workerResponse: HttpWorkerResponse;
  private _nativeResponse: Response | undefined;

  constructor(req: HttpRequest, res: Response | Headers) {
    this.req = req;

    if (res instanceof Headers) {
      this._headers = new Headers(res);
      this._cookies = new CookieMap(res.get(HeaderField.SetCookie) ?? {});

      return;
    }

    this._headers = new Headers(res.headers);
    this._cookies = new CookieMap(res.headers.get(HeaderField.SetCookie) ?? {});

    if (res.status) {
      this.setStatus(res.status).end();
    }
  }

  isSent() {
    return this._workerResponse !== undefined;
  }

  getWorkerResponse() {
    return this._workerResponse;
  }

  getStatus() {
    return this._status;
  }

  setStatus(status: StatusCodes, statusText?: string) {
    this._status = status;
    this._statusText = statusText ?? getReasonPhrase(status);

    return this;
  }

  getHeader(name: string) {
    return this._headers.get(name);
  }

  setHeader(name: string, value: string) {
    this._headers.set(name, value);

    return this;
  }

  setHeaders(headers: Record<string, string>) {
    Object.entries(headers).forEach(([name, value]) => {
      this._headers.set(name, value);
    });

    return this;
  }

  appendHeader(name: string, value: string) {
    const existing = this._headers.get(name);

    if (typeof existing === 'string' && existing.length > 0) {
      this._headers.set(name, `${existing}, ${value}`);
    } else {
      this._headers.set(name, value);
    }

    return this;
  }

  removeHeader(name: string) {
    this._headers.delete(name);

    return this;
  }

  getContentType() {
    return this.getHeader(HeaderField.ContentType);
  }

  setContentType(contentType: string) {
    this.setHeader(HeaderField.ContentType, `${contentType}; charset=utf-8`);

    return this;
  }

  getCookies() {
    return this._cookies;
  }

  setCookie(name: string, value: string, options?: CookieInit) {
    this._cookies.set(name, value, options);

    return this;
  }

  getBody(): ResponseBodyValue | undefined {
    return this._body;
  }

  setBody(data: ResponseBodyValue | undefined) {
    this._body = data ?? '';

    return this;
  }

  redirect(url: string) {
    this.setHeader(HeaderField.Location, url);

    return this;
  }

  /**
   * Finalizes the response and marks it as sent.
   * Idempotent — if already sent, returns the cached response.
   *
   * @returns The built worker response.
   * @public
   */
  end(): HttpWorkerResponse {
    if (this.isSent()) {
      return this._workerResponse;
    }

    this.build();

    return this._workerResponse;
  }

  /**
   * Convenience method for middlewares to finalize the response.
   * Delegates to `end()`. Idempotent.
   *
   * @public
   */
  send(): void {
    this.end();
  }

  /**
   * Resets all response headers and cookies.
   * Used by `emergencyTeardown` to clear partially-set headers before writing a 500 response.
   *
   * @returns `this` for chaining.
   * @public
   */
  clearHeaders(): this {
    this._headers = new Headers();
    this._cookies = new CookieMap({});
    return this;
  }

  /**
   * Sets a native `Response` for passthrough.
   * Bypasses the normal `HttpResponse.build()` chain — used for streaming (SSE)
   * and handler-created `Response` objects.
   *
   * Merging rules:
   * 1. native Response headers are the base (handler's explicit choice)
   * 2. `Set-Cookie` from `_cookies` is always appended (RFC 6265: multiple allowed)
   * 3. `_headers` keys not already in native Response are added (middleware defaults)
   *
   * @param response - The native Response to passthrough.
   * @public
   */
  setNativeResponse(response: Response): void {
    const merged = new Headers(response.headers);

    // Append Set-Cookie from middleware/handler cookies
    if (this._cookies.size > 0) {
      for (const header of this._cookies.toSetCookieHeaders()) {
        merged.append(HeaderField.SetCookie, header);
      }
    }

    // Add middleware-set headers that native Response doesn't already have
    for (const [key, value] of this._headers.entries()) {
      if (!merged.has(key)) {
        merged.set(key, value);
      }
    }

    this._nativeResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: merged,
    });
  }

  /**
   * Returns the native Response if set, or `undefined`.
   *
   * @returns The native Response for passthrough.
   * @public
   */
  getNativeResponse(): Response | undefined {
    return this._nativeResponse;
  }

  build(): this {
    if (this.isSent()) {
      return this;
    }

    const location = this.getHeader(HeaderField.Location);

    if (typeof location === 'string' && location.length > 0) {
      if (!this._status) {
        this.setStatus(StatusCodes.MOVED_TEMPORARILY);
      }

      return this.setBody(undefined).buildWorkerResponse();
    }

    if (this.getContentType() === null) {
      this.setContentType(this.inferContentType());
    }

    const contentType = this.getContentType();

    if (this._status === StatusCodes.NO_CONTENT || this._status === StatusCodes.NOT_MODIFIED) {
      return this.setBody(undefined).buildWorkerResponse();
    }

    // body 직렬화 — HEAD에서도 Content-Length 계산에 필요하므로 먼저 수행
    if (contentType?.startsWith(ContentType.Json) === true) {
      try {
        this.setBody(JSON.stringify(this._body));
      } catch {
        this.setContentType(ContentType.Text).setBody('[unserializable body]');
      }
    }

    // RFC 9110 §9.3.2: HEAD 응답은 GET과 동일한 헤더를 포함하되 body만 생략
    if (this.req.method === 'HEAD') {
      if (!this._status) {
        this.setStatus(StatusCodes.OK);
      }

      if (typeof this._body === 'string') {
        this.setHeader(HeaderField.ContentLength, new TextEncoder().encode(this._body).byteLength.toString());
      } else if (this._body instanceof Uint8Array) {
        this.setHeader(HeaderField.ContentLength, this._body.byteLength.toString());
      } else if (this._body instanceof ArrayBuffer) {
        this.setHeader(HeaderField.ContentLength, this._body.byteLength.toString());
      }

      return this.setBody(undefined).buildWorkerResponse();
    }

    if (!this._status && this._body === undefined) {
      return this.setStatus(StatusCodes.NO_CONTENT).setBody(undefined).buildWorkerResponse();
    }

    return this.buildWorkerResponse();
  }

  private buildWorkerResponse(): this {
    const headers = new Headers(this._headers);

    if (this._cookies.size > 0) {
      headers.delete(HeaderField.SetCookie);
      for (const setCookieHeader of this._cookies.toSetCookieHeaders()) {
        headers.append(HeaderField.SetCookie, setCookieHeader);
      }
    }

    const init: ResponseInit = this._status !== 0 ? this.buildStatusInit(headers) : { headers };
    const body: HttpWorkerResponse['body'] = this.normalizeWorkerBody(this._body);

    this._workerResponse = {
      body,
      init,
    };

    return this;
  }

  private inferContentType() {
    if (
      this._body !== null &&
      (typeof this._body === 'object' ||
        Array.isArray(this._body) ||
        typeof this._body === 'number' ||
        typeof this._body === 'boolean')
    ) {
      return ContentType.Json;
    }

    return ContentType.Text;
  }

  private normalizeWorkerBody(body: ResponseBodyValue | undefined): HttpWorkerResponse['body'] {
    if (body === undefined || body === null) {
      return null;
    }

    if (typeof body === 'string') {
      return body;
    }

    if (body instanceof Uint8Array) {
      return body;
    }

    if (body instanceof ArrayBuffer) {
      return body;
    }

    if (typeof body === 'number' || typeof body === 'boolean') {
      return body.toString();
    }

    throw new Error('normalizeWorkerBody received an unserialized object — build() should have serialized it');
  }

  private buildStatusInit(headers: Headers): ResponseInit {
    if (this._statusText !== undefined) {
      return {
        headers,
        status: this._status,
        statusText: this._statusText,
      };
    }

    return {
      headers,
      status: this._status,
    };
  }
}
