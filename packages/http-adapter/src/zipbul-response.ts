import { CookieMap, type CookieInit } from 'bun';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import type { ZipbulRequest } from './zipbul-request';
import type { HttpWorkerResponse } from './interfaces';
import type { HeadersInit, ResponseBodyValue } from './types';

import { ContentType, HeaderField, HttpMethod } from './enums';

export class ZipbulResponse {
  private readonly req: ZipbulRequest;
  private _body: ResponseBodyValue | undefined;
  private _cookies: CookieMap;
  private _headers: Headers;
  private _status: StatusCodes | 0 = 0;
  private _statusText: string | undefined;
  private _workerResponse: HttpWorkerResponse;

  constructor(req: ZipbulRequest, res: Response | Headers) {
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

  end(): HttpWorkerResponse {
    if (this.isSent()) {
      return this._workerResponse;
    }

    this.build();

    return this._workerResponse;
  }

  build(): this {
    if (this.isSent()) {
      return this;
    }

    const location = this.getHeader(HeaderField.Location);

    if (typeof location === 'string' && location.length > 0) {
      if (!this._status) {
        this.setStatus(StatusCodes.MOVED_PERMANENTLY);
      }

      return this.setBody(undefined).buildWorkerResponse();
    }

    if (this.getContentType() === null) {
      this.setContentType(this.inferContentType());
    }

    const contentType = this.getContentType();

    if (this.req.httpMethod === HttpMethod.Head) {
      if (!this._status) {
        this.setStatus(StatusCodes.OK);
      }

      return this.setBody(undefined).buildWorkerResponse();
    }

    if (this._status === StatusCodes.NO_CONTENT || this._status === StatusCodes.NOT_MODIFIED) {
      return this.setBody(undefined).buildWorkerResponse();
    }

    if (!this._status && this._body === undefined) {
      return this.setStatus(StatusCodes.NO_CONTENT).setBody(undefined).buildWorkerResponse();
    }

    if (contentType?.startsWith(ContentType.Json) === true) {
      try {
        this.setBody(JSON.stringify(this._body));
      } catch {
        this.setContentType(ContentType.Text).setBody('[unserializable body]');
      }
    }

    return this.buildWorkerResponse();
  }

  private buildWorkerResponse(): this {
    if (this._cookies.size > 0) {
      this.setHeader(HeaderField.SetCookie, this._cookies.toSetCookieHeaders().join(', '));
    }

    const headers: Record<string, string> = this._headers.toJSON();
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

    try {
      return JSON.stringify(body);
    } catch {
      return '[unserializable body]';
    }
  }

  private buildStatusInit(headers: HeadersInit): ResponseInit {
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
