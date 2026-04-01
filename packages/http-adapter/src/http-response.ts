import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import type { HttpRequest } from './http-request';
import type { ResponseBodyValue } from './types';

import { ContentType, HeaderField } from './enums';

const DANGEROUS_SCHEME_PATTERN = /^(?:javascript|data|vbscript):/i;

export class HttpResponse {
  private readonly req: HttpRequest;
  private _body: ResponseBodyValue | undefined;
  private _headers: Headers;
  private _status: StatusCodes | 0 = 0;
  private _statusText: string | undefined;

  /** Cached final Response — once built via end(), never rebuilt. */
  private _response: Response | undefined;

  /** Middleware/handler committed flag — pipeline stops processing. */
  private _committed = false;

  /** Raw native Response before header merge (SSE, streaming, handler Response). */
  private _rawNativeResponse: Response | undefined;

  /** Cached merged native Response (raw + _headers). Created lazily in getNativeResponse(). */
  private _mergedNativeResponse: Response | undefined;

  constructor(req: HttpRequest, headers: Headers) {
    this.req = req;
    this._headers = new Headers(headers);
  }

  // ── Pipeline control ────────────────────────────────────────

  /**
   * Marks the response as committed. The pipeline stops processing
   * remaining phases but does not build the Response yet.
   * Response finalizers still run.
   *
   * @public
   */
  send(): void {
    this._committed = true;
  }

  /**
   * Returns whether the response has been committed or already built.
   *
   * @public
   */
  isSent(): boolean {
    return this._committed || this._response !== undefined;
  }

  /**
   * Builds and caches the final `Response`. Idempotent — subsequent
   * calls return the cached Response without rebuilding.
   *
   * @returns The built `Response`.
   * @public
   */
  end(): Response {
    if (this._response !== undefined) return this._response;
    this._response = this.build();
    return this._response;
  }

  // ── State reset ─────────────────────────────────────────────

  /**
   * Resets all response state including stream references.
   * Used by error recovery paths that need a clean slate.
   *
   * @public
   */
  reset(): void {
    this._rawNativeResponse?.body?.cancel();
    this._headers = new Headers();
    this._body = undefined;
    this._status = 0;
    this._statusText = undefined;
    this._committed = false;
    this._rawNativeResponse = undefined;
    this._mergedNativeResponse = undefined;
    this._response = undefined;
  }

  // ── Status ──────────────────────────────────────────────────

  getStatus(): StatusCodes | 0 {
    return this._status;
  }

  setStatus(status: StatusCodes, statusText?: string): this {
    this._status = status;
    this._statusText = statusText ?? getReasonPhrase(status);
    return this;
  }

  // ── Headers ─────────────────────────────────────────────────

  get headers(): Headers {
    return this._headers;
  }

  getHeader(name: string): string | null {
    return this._headers.get(name);
  }

  setHeader(name: string, value: string): this {
    this._headers.set(name, value);
    return this;
  }

  setHeaders(headers: Record<string, string>): this {
    for (const [name, value] of Object.entries(headers)) {
      this._headers.set(name, value);
    }
    return this;
  }

  removeHeader(name: string): this {
    this._headers.delete(name);
    return this;
  }

  getContentType(): string | null {
    return this.getHeader(HeaderField.ContentType);
  }

  /**
   * Sets the Content-Type header. Appends `charset=utf-8` only for
   * text types and JSON — binary types are left as-is (F-RES-1 fix).
   *
   * @param contentType - The media type string.
   * @returns `this` for chaining.
   * @public
   */
  setContentType(contentType: string): this {
    const needsCharset = !contentType.includes('charset=')
      && (contentType.startsWith('text/')
        || contentType === 'application/json'
        || contentType.endsWith('+json'));
    this.setHeader(
      HeaderField.ContentType,
      needsCharset ? `${contentType}; charset=utf-8` : contentType,
    );
    return this;
  }

  /**
   * Appends a header value. Delegates to Web Headers API `append()`
   * which correctly handles multi-value headers like Set-Cookie (RFC 6265).
   *
   * @param name - Header name.
   * @param value - Header value to append.
   * @returns `this` for chaining.
   * @public
   */
  appendHeader(name: string, value: string): this {
    this._headers.append(name, value);
    return this;
  }

  // ── Body (all types unified) ────────────────────────────────

  getBody(): ResponseBodyValue | undefined {
    return this._body;
  }

  /**
   * Sets the response body. Handles all body types through a unified API:
   * - `ReadableStream` → native Response passthrough
   * - `Blob` → stream() conversion with manual Content-Length (prevents Blob.type auto-CT)
   * - All others → buffered body path
   *
   * Mutually exclusive: `_body` and `_rawNativeResponse` — last `setBody()` call wins.
   *
   * @param data - The response body value.
   * @returns `this` for chaining.
   * @public
   */
  setBody(data: ResponseBodyValue | undefined): this {
    if (data instanceof ReadableStream) {
      this._rawNativeResponse?.body?.cancel();
      this._body = undefined;
      this._rawNativeResponse = new Response(data);
      this._mergedNativeResponse = undefined;
      return this;
    }

    if (data instanceof Blob) {
      this._rawNativeResponse?.body?.cancel();
      this._body = undefined;
      if (this.getContentType() === null && data.type) {
        this.setContentType(data.type);
      }
      this.setHeader(HeaderField.ContentLength, data.size.toString());
      this._rawNativeResponse = new Response(data.stream());
      this._mergedNativeResponse = undefined;
      return this;
    }

    // Buffered body — clear native path
    this._rawNativeResponse?.body?.cancel();
    this._body = data;
    this._rawNativeResponse = undefined;
    this._mergedNativeResponse = undefined;
    return this;
  }

  // ── Convenience ─────────────────────────────────────────────

  redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): this {
    if (DANGEROUS_SCHEME_PATTERN.test(url)) {
      throw new Error(`Redirect to dangerous scheme is not allowed: ${url.slice(0, url.indexOf(':') + 1)}`);
    }
    if (status !== undefined) {
      this.setStatus(status);
    }
    this.setHeader(HeaderField.Location, url);
    return this;
  }

  // ── Native Response (lazy merge) ────────────────────────────

  /**
   * Stores a native `Response` for passthrough (SSE, streaming, handler Response).
   * Merging with `_headers` happens lazily in `getNativeResponse()`.
   *
   * @param response - The native Response to passthrough.
   * @public
   */
  setNativeResponse(response: Response): void {
    this._rawNativeResponse?.body?.cancel();
    this._rawNativeResponse = response;
    this._mergedNativeResponse = undefined;
    this._body = undefined;
  }

  /**
   * Returns whether a native Response is set, without triggering the merge.
   * Used by `handleResult` to decide whether to skip BeforeResponse phase.
   *
   * @public
   */
  hasNativeResponse(): boolean {
    return this._rawNativeResponse !== undefined;
  }

  /**
   * Returns the native Response with `_headers` merged in.
   * Creates and caches the merged Response on first call.
   *
   * INVARIANT: Call only in `fetch()` after all finalizers have completed.
   * Calling earlier would cache a stale merge missing finalizer headers.
   *
   * Merge rules:
   * 1. Native Response headers are the base (handler's explicit choice)
   * 2. `Set-Cookie` from `_headers` is always appended (RFC 6265: multiple allowed)
   * 3. `_headers` keys not already in native Response are added (middleware defaults)
   *
   * @returns The merged Response, or `undefined` if no native Response set.
   * @public
   */
  getNativeResponse(): Response | undefined {
    if (this._rawNativeResponse === undefined) return undefined;
    if (this._mergedNativeResponse !== undefined) return this._mergedNativeResponse;

    const merged = new Headers(this._rawNativeResponse.headers);
    for (const [key, value] of this._headers.entries()) {
      if (key === 'set-cookie') {
        merged.append(key, value);
      } else if (!merged.has(key)) {
        merged.set(key, value);
      }
    }

    this._mergedNativeResponse = new Response(this._rawNativeResponse.body, {
      status: this._rawNativeResponse.status,
      statusText: this._rawNativeResponse.statusText,
      headers: merged,
    });
    return this._mergedNativeResponse;
  }

  /**
   * Cancels the raw native Response stream. Used in error paths
   * to release file descriptors when the response won't be sent.
   *
   * @public
   */
  cancelNativeStream(): void {
    this._rawNativeResponse?.body?.cancel();
  }

  // ── Build (buffered body → Response) ────────────────────────

  private build(): Response {
    const location = this.getHeader(HeaderField.Location);

    // 1. Redirect: Location header → default 302, body removed
    if (typeof location === 'string' && location.length > 0) {
      if (!this._status) {
        this.setStatus(StatusCodes.MOVED_TEMPORARILY);
      }
      this._body = undefined;
      return this.createResponse();
    }

    // 2. 204/304: body removed per RFC — checked before Content-Type inference
    if (this._status === StatusCodes.NO_CONTENT || this._status === StatusCodes.NOT_MODIFIED) {
      this._body = undefined;
      return this.createResponse();
    }

    // 3. Auto 204: no status + no body — skip Content-Type
    if (!this._status && this._body === undefined) {
      this.setStatus(StatusCodes.NO_CONTENT);
      return this.createResponse();
    }

    // 4. Content-Type inference from body type
    if (this.getContentType() === null) {
      this.setContentType(this.inferContentType());
    }

    // 5. JSON serialization
    const contentType = this.getContentType();
    if (contentType?.startsWith(ContentType.Json) === true) {
      try {
        this._body = JSON.stringify(this._body);
      } catch (error) {
        this.setContentType(ContentType.Text);
        this._body = '[unserializable body]';

        if (typeof console !== 'undefined') {
          console.error('JSON serialization failed in HttpResponse.build():', error);
        }
      }
    }

    // 5. HEAD: Content-Length from serialized body, then body removed (RFC 9110 §9.3.2)
    if (this.req.method === 'HEAD') {
      if (!this._status) {
        this.setStatus(StatusCodes.OK);
      }

      if (typeof this._body === 'string') {
        this.setHeader(HeaderField.ContentLength, Buffer.byteLength(this._body, 'utf-8').toString());
      } else if (this._body instanceof Uint8Array) {
        this.setHeader(HeaderField.ContentLength, this._body.byteLength.toString());
      } else if (this._body instanceof ArrayBuffer) {
        this.setHeader(HeaderField.ContentLength, this._body.byteLength.toString());
      }

      this._body = undefined;
      return this.createResponse();
    }

    return this.createResponse();
  }

  /**
   * Creates the final `Response` from current state.
   * Validates status range — out-of-range status falls back to 500.
   */
  private createResponse(): Response {
    const body = this.normalizeBody();
    const status = this._status || StatusCodes.OK;

    // Status range validation (integrates former toResponse logic)
    if (status < 100 || status > 599) {
      return new Response('Internal Server Error', {
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        headers: this._headers,
      });
    }

    const init: ResponseInit = {
      status,
      headers: this._headers,
    };
    if (this._statusText !== undefined) {
      init.statusText = this._statusText;
    }

    return new Response(body, init);
  }

  private inferContentType(): string {
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

  private normalizeBody(): BodyInit | null {
    if (this._body === undefined || this._body === null) {
      return null;
    }
    if (typeof this._body === 'string') {
      return this._body;
    }
    if (this._body instanceof Uint8Array) {
      return this._body;
    }
    if (this._body instanceof ArrayBuffer) {
      return this._body;
    }
    if (typeof this._body === 'number' || typeof this._body === 'boolean') {
      return this._body.toString();
    }
    throw new Error('normalizeBody received an unserialized object — build() should have serialized it');
  }
}
