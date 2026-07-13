import type { HttpRequest } from './http-request';
import type { RedirectStatus, ResponseBodyValue } from './types';

import { ContentType, HttpHeader, HttpStatus } from './enums';
import { reasonOf } from './utils';

const DANGEROUS_SCHEME_PATTERN = /^(?:javascript|data|vbscript):/i;

/** Fire-and-forget cancel — swallows errors from already-closed streams. */
function cancelStreamQuietly(response: Response | undefined): void {
  const body = response?.body;
  if (body === null || body === undefined) return;
  body.cancel().catch(() => {});
}

/** Fire-and-forget cancel for a bare stream (used when swapping bodies). */
function cancelBodyQuietly(body: ReadableStream | null | undefined): void {
  if (body === null || body === undefined) return;
  body.cancel().catch(() => {});
}

/**
 * Unions the tokens of a list-valued selecting header (`Vary`).
 *
 * A native Response's own `Vary` and a middleware-added one (e.g. `Accept-Encoding`
 * from compression) must BOTH survive, else a shared cache mis-selects the
 * representation (RFC 9110 §12.5.5). `*` already means unlimited variance.
 */
function unionVary(existing: string, addition: string): string {
  const seen = new Set(
    existing.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t !== ''),
  );
  if (seen.has('*')) return existing;

  const additions: string[] = [];
  for (const token of addition.split(',')) {
    const t = token.trim();
    if (t !== '' && !seen.has(t.toLowerCase())) {
      additions.push(t);
      seen.add(t.toLowerCase());
    }
  }
  if (additions.length === 0) return existing;
  return existing === '' ? additions.join(', ') : `${existing}, ${additions.join(', ')}`;
}

/**
 * Folds an override header entry into a base `Headers` under the merge rules
 * shared by every read and by the final wire assembly:
 *
 * 1. Native Response headers are the base (the handler's explicit choice wins).
 * 2. `Set-Cookie` is appended (RFC 6265: multiple allowed).
 * 3. `Vary` is unioned, never overwritten (RFC 9110 §12.5.5).
 * 4. Any other key is added only when the base lacks it.
 */
function foldOverride(base: Headers, key: string, value: string): void {
  if (key === HttpHeader.SetCookie) {
    base.append(key, value);
    return;
  }
  if (key === HttpHeader.Vary && base.has(key)) {
    base.set(key, unionVary(base.get(key) as string, value));
    return;
  }
  if (!base.has(key)) {
    base.set(key, value);
  }
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

  /**
   * Returns the status that will actually be sent.
   *
   * A native Response ships its own status verbatim (see {@link getNativeResponse}),
   * so it takes precedence here: a middleware gate that read the buffered status
   * instead would, for example, see 200 for a handler's 206 and compress a
   * partial representation. Status `0` (`Response.error()`) is not a wire status —
   * it falls through to the buffered value.
   */
  getStatus(): HttpStatus | undefined {
    const nativeStatus = this._rawNativeResponse?.status;
    if (nativeStatus !== undefined && nativeStatus !== 0) {
      return nativeStatus as HttpStatus;
    }
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

  /**
   * Returns the header value that will actually be sent — the same merged view
   * the wire gets, so a middleware never reads one thing and ships another.
   *
   * `Set-Cookie` is multi-valued and cannot be represented as a single string
   * (`Headers.get` comma-folds it into an invalid value), so it always reads
   * `null` here; the wire keeps every cookie.
   */
  getHeader(name: string): string | null {
    const normalized = name.toLowerCase();

    if (normalized === HttpHeader.SetCookie) {
      return null;
    }

    return this.mergedHeaderValue(normalized);
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
    this._mergedNativeResponse = undefined;
    return this;
  }

  setHeaders(headers: Record<string, string>): this {
    for (const [name, value] of Object.entries(headers)) {
      this.setHeader(name, value);
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
    this._mergedNativeResponse = undefined;
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
    // 헤더 변경은 캐시된 native 병합 결과를 무효화한다 — 안 그러면 병합이 한 번
    // 계산된 뒤의 append(예: BeforeResponse 미들웨어의 Vary)가 전송에 반영되지 않는다.
    this._mergedNativeResponse = undefined;
    return this;
  }

  // ── Body (all types unified) ────────────────────────────────

  getBody(): ResponseBodyValue | undefined {
    return this._body;
  }

  /**
   * Returns the streaming body (SSE, streaming, Blob, handler Response), or
   * `null` when the body is buffered or absent.
   *
   * This is the encapsulated way to reach a streaming body: middleware that
   * needs to wrap it (compression) gets the stream, not the whole Response, and
   * so cannot reach around the header/status model. Reading it does not consume
   * it; passing it to a transform does — pair with {@link replaceBodyStream}.
   */
  getBodyStream(): ReadableStream | null {
    return this._rawNativeResponse?.body ?? null;
  }

  /**
   * Swaps the streaming body while keeping the response's headers and status.
   *
   * The existing native headers are hoisted into the override store, and the new
   * native carries the body alone. That inversion is the point: after the swap
   * every header lives where `setHeader`/`removeHeader` can reach it, so a
   * middleware that re-encodes the body can actually drop the now-false
   * `Content-Length`/integrity fields and weaken the `ETag` — with the headers
   * left on the native they would win the merge and ship stale metadata.
   *
   * With no native response set this is just {@link setBody}.
   *
   * @param stream - The replacement body.
   * @returns `this` for chaining.
   * @public
   */
  replaceBodyStream(stream: ReadableStream): this {
    const native = this._rawNativeResponse;
    if (native === undefined) {
      return this.setBody(stream);
    }

    const target = this.ensureHeaders();
    for (const [key, value] of native.headers.entries()) {
      if (key === HttpHeader.SetCookie) continue; // handled below — entries() folds cookies
      if (key === HttpHeader.Vary && target.has(key)) {
        target.set(key, unionVary(target.get(key) as string, value));
        continue;
      }
      target.set(key, value);
      if (key === HttpHeader.ContentType) this._contentType = value;
      if (key === HttpHeader.ContentLength) this._contentLength = value;
    }
    for (const cookie of native.headers.getSetCookie()) {
      target.append(HttpHeader.SetCookie, cookie);
    }

    const init: ResponseInit = {
      ...(native.status !== 0 ? { status: native.status } : {}),
      ...(native.statusText !== '' ? { statusText: native.statusText } : {}),
    };

    cancelBodyQuietly(native.body);
    this._body = undefined;
    this._rawNativeResponse = new Response(stream, init);
    this._mergedNativeResponse = undefined;
    this._serialized = false;
    return this;
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

      const native = new Response(data.stream());
      // `new Response(blob.stream())` still infers `Content-Type` from the Blob in
      // Bun, and a native header beats the override store — which would silently
      // override an explicitly-set Content-Type (and drop the charset we add for
      // text types). Strip it so the resolved value above is the one that ships.
      native.headers.delete(HttpHeader.ContentType);
      this._rawNativeResponse = native;
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

  redirect(url: string, status?: RedirectStatus): this {
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
   * Returns the raw native Response, pre-merge.
   *
   * Adapter-internal. Middleware must not reach past the response model: read
   * through {@link getHeader}/{@link getStatus} (which report the merged, wire-true
   * value) and swap bodies with {@link replaceBodyStream}. Handing out the raw
   * Response leaks the two-store representation and lets callers ship headers that
   * disagree with what they just read.
   *
   * @returns The raw native Response, or `undefined` if none is set.
   * @internal
   */
  peekNativeResponse(): Response | undefined {
    return this._rawNativeResponse;
  }

  /**
   * Returns the native Response with `_headers` merged in.
   * Creates and caches the merged Response on first call.
   *
   * Adapter-internal: this is the send-boundary assembly, called once by the
   * server after every finalizer has run. Middleware reads go through
   * {@link getHeader}/{@link getStatus}, which report this same merged view, so
   * nothing needs the assembled Response mid-pipeline.
   *
   * Merge rules live in {@link mergedHeaders} — the single definition every read
   * and this assembly share.
   *
   * @returns The merged Response, or `undefined` if no native Response set.
   * @internal
   */
  getNativeResponse(): Response | undefined {
    if (this._rawNativeResponse === undefined) return undefined;
    if (this._mergedNativeResponse !== undefined) return this._mergedNativeResponse;

    const headerOverrides = this.buildHeaders();

    if (headerOverrides === undefined) {
      return this._rawNativeResponse;
    }

    const merged = this.mergedHeaders(this._rawNativeResponse, headerOverrides);

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

    // Already-serialized bodies: a string or binary body needs no JSON
    // serialization regardless of Content-Type — re-stringifying a Uint8Array
    // set by a BeforeResponse middleware (e.g. compression) would corrupt it
    // into `{"0":31,"1":139,...}`. Honors the documented no-op contract above.
    if (
      typeof this._body === 'string'
      || this._body instanceof Uint8Array
      || this._body instanceof ArrayBuffer
    ) {
      return;
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
      // Body is dropped — content-coupled metadata (Content-Encoding set by a
      // BeforeResponse middleware, stale Content-Length) would describe content
      // that no longer exists. RFC 9110 §8.4: Content-Encoding is a property of
      // the (now absent) representation content.
      this._headers?.delete(HttpHeader.ContentEncoding);
      this._headers?.delete(HttpHeader.ContentLength);
      return this.createResponse();
    }

    // 2. 204/205/304: body removed per RFC — checked before Content-Type inference
    if (
      this._status === HttpStatus.NoContent ||
      this._status === HttpStatus.ResetContent ||
      this._status === HttpStatus.NotModified
    ) {
      this._body = undefined;
      // RFC 9110 §15.3.5/§15.3.6: 204/205 MUST NOT contain content. Content-Type
      // describes non-existent content and MUST be removed. 304 MAY carry
      // Content-Type (RFC 9110 §15.4.5) so only strip for 204/205. Likewise
      // Content-Encoding/Content-Length describe absent content on 204/205,
      // while on 304 they are permitted representation metadata for cache updates.
      if (this._status !== HttpStatus.NotModified) {
        this._contentType = undefined;
        this._headers?.delete(HttpHeader.ContentType);
        this._headers?.delete(HttpHeader.ContentEncoding);
        this._headers?.delete(HttpHeader.ContentLength);
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

    // Status range validation: Fetch Response constructor only accepts
    // 200–599 (and the special-case 101 for switching protocols).
    if (status !== 101 && (status < 200 || status > 599)) {
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
    if (this._body instanceof Uint8Array || this._body instanceof ArrayBuffer) {
      return 'application/octet-stream';
    }
    if (
      this._body !== null &&
      (typeof this._body === 'object' ||
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

  /**
   * The merged header set — the native response's own headers as the base, with
   * the override store folded in under {@link foldOverride}'s rules. This is the
   * one place the merge is defined; every public read and the final wire
   * assembly go through it, so a read can never disagree with what is sent.
   */
  private mergedHeaders(native: Response, overrides: Headers | undefined): Headers {
    const merged = new Headers(native.headers);
    if (overrides === undefined) return merged;

    for (const [key, value] of overrides.entries()) {
      if (key === HttpHeader.SetCookie) continue; // entries() folds cookies — appended below
      foldOverride(merged, key, value);
    }
    for (const cookie of overrides.getSetCookie()) {
      merged.append(HttpHeader.SetCookie, cookie);
    }
    return merged;
  }

  /** Single-header view of {@link mergedHeaders} — used by every public read. */
  private mergedHeaderValue(normalized: string): string | null {
    const overrides = this.buildHeaders();
    const native = this._rawNativeResponse;

    if (native === undefined) {
      return overrides?.get(normalized) ?? null;
    }

    return this.mergedHeaders(native, overrides).get(normalized);
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
