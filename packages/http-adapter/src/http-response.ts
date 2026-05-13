import type { HttpRequest } from './http-request';
import type { ResponseBodyValue } from './types';

import { ContentType, HttpHeader, HttpStatus } from './enums';
import { reasonOf } from './utils';

const DANGEROUS_SCHEME_PATTERN = /^(?:javascript|data|vbscript):/i;

/** Fire-and-forget cancel — swallows errors from already-closed streams. */
function cancelStreamQuietly(response: Response | undefined): void {
  const body = response?.body;
  if (body === null || body === undefined) return;
  body.cancel().catch(() => {});
}

export class HttpResponse {
  private readonly req: HttpRequest;
  private _body: ResponseBodyValue | undefined;
  private _headers: Headers | undefined;
  private _contentType: string | undefined;
  private _contentLength: string | undefined;
  private _status: HttpStatus | undefined;
  private _statusText: string | undefined;

  /** Cached final Response — once built via end(), never rebuilt. */
  private _response: Response | undefined;

  /** Middleware/handler committed flag — pipeline stops processing. */
  private _committed = false;

  /** Tracks whether serialize() has been called to prevent double serialization. */
  private _serialized = false;

  /** Raw native Response before header merge (SSE, streaming, handler Response). */
  private _rawNativeResponse: Response | undefined;

  /** Cached merged native Response (raw + _headers). Created lazily in getNativeResponse(). */
  private _mergedNativeResponse: Response | undefined;

  constructor(req: HttpRequest, headers?: Headers) {
    this.req = req;
    this._headers = headers !== undefined ? new Headers(headers) : undefined;
  }

  // ── Pipeline control ────────────────────────────────────────

  /**
   * Marks the response as committed. Skips writeResponse and AfterHandle phases.
   * Serialization (serialize) and BeforeResponse still run.
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
    cancelStreamQuietly(this._rawNativeResponse);
    this._headers = undefined;
    this._contentType = undefined;
    this._contentLength = undefined;
    this._body = undefined;
    this._status = undefined;
    this._statusText = undefined;
    this._committed = false;
    this._serialized = false;
    this._rawNativeResponse = undefined;
    this._mergedNativeResponse = undefined;
    this._response = undefined;
  }

  // ── Status ──────────────────────────────────────────────────

  getStatus(): HttpStatus | undefined {
    return this._status;
  }

  setStatus(status: HttpStatus, statusText?: string): this {
    this._status = status;
    this._statusText = statusText ?? reasonOf(status);
    return this;
  }

  // ── Headers ─────────────────────────────────────────────────

  get headers(): Headers {
    return this.ensureHeaders();
  }

  getHeader(name: string): string | null {
    const normalized = name.toLowerCase();

    if (normalized === HttpHeader.ContentType) {
      return this._contentType ?? null;
    }

    if (normalized === HttpHeader.ContentLength) {
      return this._contentLength ?? null;
    }

    return this._headers?.get(name) ?? null;
  }

  setHeader(name: string, value: string): this {
    const normalized = name.toLowerCase();

    if (normalized === HttpHeader.ContentType) {
      this._contentType = value;
      this._headers?.set(name, value);
      return this;
    }

    if (normalized === HttpHeader.ContentLength) {
      this._contentLength = value;
      this._headers?.set(name, value);
      return this;
    }

    this.ensureHeaders().set(name, value);
    return this;
  }

  setHeaders(headers: Record<string, string>): this {
    for (const [name, value] of Object.entries(headers)) {
      this.ensureHeaders().set(name, value);
    }
    return this;
  }

  removeHeader(name: string): this {
    const normalized = name.toLowerCase();

    if (normalized === HttpHeader.ContentType) {
      this._contentType = undefined;
    } else if (normalized === HttpHeader.ContentLength) {
      this._contentLength = undefined;
    }

    this._headers?.delete(name);
    return this;
  }

  getContentType(): string | null {
    return this.getHeader(HttpHeader.ContentType);
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
      HttpHeader.ContentType,
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
    this.ensureHeaders().append(name, value);
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
    this._serialized = false;

    if (data instanceof ReadableStream) {
      cancelStreamQuietly(this._rawNativeResponse);
      this._body = undefined;
      this._rawNativeResponse = new Response(data);
      this._mergedNativeResponse = undefined;
      return this;
    }

    if (data instanceof Blob) {
      cancelStreamQuietly(this._rawNativeResponse);
      this._body = undefined;
      if (this.getContentType() === null && data.type) {
        this.setContentType(data.type);
      }
      this.setHeader(HttpHeader.ContentLength, data.size.toString());
      this._rawNativeResponse = new Response(data.stream());
      this._mergedNativeResponse = undefined;
      return this;
    }

    // Buffered body — clear native path
    cancelStreamQuietly(this._rawNativeResponse);
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
    this.setHeader(HttpHeader.Location, url);
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
    cancelStreamQuietly(this._rawNativeResponse);
    this._rawNativeResponse = response;
    this._mergedNativeResponse = undefined;
    this._body = undefined;
  }

  /**
   * Returns whether a native Response is set, without triggering the merge.
   * Used by WriteResponse step to decide whether to skip BeforeResponse phase.
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

    const headerOverrides = this.buildHeaders();

    if (headerOverrides === undefined) {
      return this._rawNativeResponse;
    }

    const merged = new Headers(this._rawNativeResponse.headers);
    for (const [key, value] of headerOverrides.entries()) {
      if (key === HttpHeader.SetCookie) {
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
    cancelStreamQuietly(this._rawNativeResponse);
  }

  // ── Serialize (Content-Type inference + JSON.stringify) ──────

  /**
   * Performs Content-Type inference and JSON serialization on the buffered body.
   * Converts JS objects/arrays/numbers/booleans to JSON strings.
   *
   * Called by Serialize step between AfterHandle and BeforeResponse phases,
   * so that BeforeResponse middleware receives serialized bytes (enabling compression, ETag, signing).
   *
   * No-op when the response has a native Response (SSE, streaming, Blob, handler Response)
   * or when the body is already a string/binary type.
   *
   * @public
   */
  serialize(): void {
    if (this._serialized) return;
    this._serialized = true;

    // Native Response — body is in the native Response, not in _body
    if (this._rawNativeResponse !== undefined) return;

    // No body — nothing to serialize
    if (this._body === undefined) return;

    // Content-Type inference from body type
    if (this.getContentType() === null) {
      this.setContentType(this.inferContentType());
    }

    // JSON serialization
    const contentType = this.getContentType();
    if (contentType?.startsWith(ContentType.Json) === true) {
      try {
        this._body = JSON.stringify(this._body);
      } catch (error) {
        this.setContentType(ContentType.Text);
        this._body = '[unserializable body]';

        if (typeof console !== 'undefined') {
          console.error('JSON serialization failed in HttpResponse.serialize():', error);
        }
      }
    }
  }

  // ── Build (buffered body → Response) ────────────────────────

  private build(): Response {
    // Safety net: ensure serialization ran even if called outside the pipeline (e.g. tests, edge cases).
    // Idempotent — no-op if already called by Serialize step.
    this.serialize();

    const location = this.getHeader(HttpHeader.Location);

    // 1. Redirect: Location header → default 302, body removed
    if (typeof location === 'string' && location.length > 0) {
      if (this._status === undefined) {
        this.setStatus(HttpStatus.Found);
      }
      this._body = undefined;
      return this.createResponse();
    }

    // 2. 204/304: body removed per RFC — checked before Content-Type inference
    if (this._status === HttpStatus.NoContent || this._status === HttpStatus.NotModified) {
      this._body = undefined;
      // RFC 9110 §15.3.5: 204 MUST NOT contain content. Content-Type describes
      // non-existent content and MUST be removed. 304 MAY carry Content-Type
      // (RFC 9110 §15.4.5) so only strip for 204.
      if (this._status === HttpStatus.NoContent) {
        this._contentType = undefined;
        this._headers?.delete(HttpHeader.ContentType);
      }
      return this.createResponse();
    }

    // 3. Auto 204: no status + no body — skip Content-Type
    if (this._status === undefined && this._body === undefined) {
      this.setStatus(HttpStatus.NoContent);
      return this.createResponse();
    }

    // 4. HEAD: Content-Length from serialized body, then body removed (RFC 9110 §9.3.2)
    if (this.req.method === 'HEAD') {
      if (this._status === undefined) {
        this.setStatus(HttpStatus.Ok);
      }

      if (typeof this._body === 'string') {
        this.setHeader(HttpHeader.ContentLength, Buffer.byteLength(this._body, 'utf-8').toString());
      } else if (this._body instanceof Uint8Array) {
        this.setHeader(HttpHeader.ContentLength, this._body.byteLength.toString());
      } else if (this._body instanceof ArrayBuffer) {
        this.setHeader(HttpHeader.ContentLength, this._body.byteLength.toString());
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
    const status = this._status ?? HttpStatus.Ok;
    const headers = this.buildHeaders();

    // Status range validation (integrates former toResponse logic)
    if (status < 100 || status > 599) {
      return new Response('Internal Server Error', {
        status: HttpStatus.InternalServerError,
        ...(headers !== undefined ? { headers } : {}),
      });
    }

    const init: ResponseInit = {
      status,
      ...(headers !== undefined ? { headers } : {}),
      ...(this._statusText !== undefined ? { statusText: this._statusText } : {}),
    };

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

  private normalizeBody(): string | Uint8Array | ArrayBuffer | null {
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

  private ensureHeaders(): Headers {
    if (this._headers === undefined) {
      this._headers = new Headers();

      if (this._contentType !== undefined) {
        this._headers.set(HttpHeader.ContentType, this._contentType);
      }

      if (this._contentLength !== undefined) {
        this._headers.set(HttpHeader.ContentLength, this._contentLength);
      }
    }

    return this._headers;
  }

  private buildHeaders(): Headers | undefined {
    if (this._headers === undefined) {
      if (this._contentType === undefined && this._contentLength === undefined) {
        return undefined;
      }

      const headers = new Headers();

      if (this._contentType !== undefined) {
        headers.set(HttpHeader.ContentType, this._contentType);
      }

      if (this._contentLength !== undefined) {
        headers.set(HttpHeader.ContentLength, this._contentLength);
      }

      return headers;
    }

    return this._headers;
  }
}
