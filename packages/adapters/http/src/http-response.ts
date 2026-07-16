import type { HttpRequest } from './http-request';
import type { BodySlot, BufferedBodyValue, RedirectStatus, ResponseBodyValue } from './types';

import { ContentType, HttpHeader, HttpStatus, ResponseBodyKind } from './enums';
import { reasonOf } from './utils';

const DANGEROUS_SCHEME_PATTERN = /^(?:javascript|data|vbscript):/i;

/** Fire-and-forget cancel — swallows errors from already-closed streams. */
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
 * Headers that describe the *representation* rather than the exchange —
 * discarded whenever the whole representation is swapped for a different one
 * ({@link HttpResponse.replaceRepresentation}). CORS/security/Set-Cookie/Vary
 * describe the exchange, not the body, and are never in this list.
 */
const REPRESENTATION_METADATA_HEADERS: readonly string[] = [
  HttpHeader.ContentEncoding,
  HttpHeader.ETag,
  HttpHeader.CacheControl,
  HttpHeader.LastModified,
  HttpHeader.ContentDigest,
  HttpHeader.ReprDigest,
];

export class HttpResponse {
  private readonly req: HttpRequest;

  private _headers: Headers;
  private _status: HttpStatus | undefined;
  private _statusText: string | undefined;
  private _body: BodySlot = { kind: ResponseBodyKind.None };

  /** Middleware/handler committed flag — pipeline stops processing. */
  private _committed = false;

  /** Cached final Response — once built via end(), never rebuilt. */
  private _response: Response | undefined;

  constructor(req: HttpRequest, headers?: Headers) {
    this.req = req;
    this._headers = headers !== undefined ? new Headers(headers) : new Headers();
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
   * Resets all response state including the body slot.
   * Used by error recovery paths that need a clean slate.
   *
   * @public
   */
  reset(): void {
    this.discardBody();
    this._headers = new Headers();
    this._status = undefined;
    this._statusText = undefined;
    this._committed = false;
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
    return this._headers;
  }

  /**
   * `Set-Cookie` is multi-valued and cannot be represented as a single string
   * (`Headers.get` comma-folds it into an invalid value), so it always reads
   * `null` here; the wire keeps every cookie.
   */
  getHeader(name: string): string | null {
    if (name.toLowerCase() === HttpHeader.SetCookie) return null;
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
    this._headers.set(
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
    this._headers.append(name, value);
    return this;
  }

  // ── Body model operations ───────────────────────────────────

  /**
   * The only way this class discards a body: unifies "clear the slot" and
   * "cancel the stream it held" into one operation so no call site can do
   * one without the other (the source of the fd/cursor leak this replaces —
   * see the class-level design notes).
   */
  private discardBody(): void {
    if (this._body.kind === ResponseBodyKind.Stream) cancelBodyQuietly(this._body.readable);
    this._body = { kind: ResponseBodyKind.None };
  }

  /**
   * Replaces the buffered representation entirely: discards the current body
   * (any stream it held is cancelled) and the metadata that described the
   * discarded representation (Content-Encoding, ETag, Cache-Control,
   * Last-Modified, Content-Digest, Repr-Digest) — all of it describes bytes
   * that no longer exist. Exchange headers (CORS, security, Set-Cookie, Vary)
   * describe the exchange, not the body, and survive.
   *
   * Buffered representations only — streams go through {@link setBody} /
   * {@link replaceBodyStream}.
   *
   * @public
   */
  replaceRepresentation(body: BufferedBodyValue): this {
    this.setBody(body);
    for (const header of REPRESENTATION_METADATA_HEADERS) this._headers.delete(header);
    return this;
  }

  getBody(): ResponseBodyValue | undefined {
    return this._body.kind === ResponseBodyKind.Buffered ? this._body.value : undefined;
  }

  /**
   * Returns the streaming body (SSE, streaming, Blob, handler Response), or
   * `null` when the body is buffered or absent.
   */
  getBodyStream(): ReadableStream | null {
    return this._body.kind === ResponseBodyKind.Stream ? this._body.readable : null;
  }

  /**
   * The body slot's kind. `Stream` covers a handler-supplied `Response`, a raw
   * stream, and a Blob-backed body; it is not "streaming" in the runtime
   * sense — a bodiless handler `Response` is `Stream` with `readable: null`.
   */
  get bodyKind(): ResponseBodyKind {
    return this._body.kind;
  }

  /**
   * Swaps the streaming body while keeping the response's headers and status.
   * Handing back the current stream is a no-op (a middleware that decides
   * mid-flight not to transform must not cancel-and-reuse its own body).
   *
   * @param stream - The replacement body.
   * @returns `this` for chaining.
   * @public
   */
  replaceBodyStream(stream: ReadableStream): this {
    if (this._body.kind === ResponseBodyKind.Stream && this._body.readable === stream) {
      return this;
    }
    this.discardBody();
    this._headers.delete(HttpHeader.ContentLength);
    this._body = { kind: ResponseBodyKind.Stream, readable: stream, blobBacked: false };
    return this;
  }

  /**
   * Sets the response body. Handles all body types through a unified API:
   * - `ReadableStream` → stream slot passthrough
   * - `Blob` → stream() conversion with manual Content-Length (prevents Blob.type auto-CT)
   * - `undefined` → discards the body (≡ {@link discardBody}) — auto-204 candidate
   * - All others → buffered slot, explicit `null` included (→ 200 with an empty body)
   *
   * `Content-Length` is always cleared first — it describes the previous
   * body's byte length, which the new body does not share. The Blob branch
   * re-declares it from the Blob's own known size.
   *
   * @param data - The response body value.
   * @returns `this` for chaining.
   * @public
   */
  setBody(data: ResponseBodyValue | undefined): this {
    this.discardBody();
    this._headers.delete(HttpHeader.ContentLength);

    if (data instanceof ReadableStream) {
      this._body = { kind: ResponseBodyKind.Stream, readable: data, blobBacked: false };
      return this;
    }

    if (data instanceof Blob) {
      // Content-Type is declared, not derived from bytes (§9) — a Blob only
      // fills an empty slot; File is a Blob subclass, covered the same way.
      if (this.getContentType() === null && data.type) {
        this.setContentType(data.type);
      }
      this.setHeader(HttpHeader.ContentLength, data.size.toString());
      this._body = {
        kind: ResponseBodyKind.Stream,
        readable: data.stream(),
        blobBacked: data.type !== '',
      };
      return this;
    }

    if (data === undefined) return this;

    this._body = { kind: ResponseBodyKind.Buffered, value: data };
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

  // ── Native Response decomposition (entry boundary) ──────────

  /**
   * Decomposes a handler-supplied `Response` into this model at the pipeline
   * boundary — the only entry point (`response-writer/write-success.ts`).
   * There is no native `Response` stored anywhere after this call: headers,
   * status, and body are absorbed, and the shell is discarded.
   *
   * Header/cookie precedence is last-write-wins, same as every other write
   * to this model (`Set-Cookie` appends, `Vary` unions) — the handler's
   * `Response` is simply a later write in the pipeline, not a privileged one.
   *
   * `Response.error()` (status `0`, `type: 'error'`) is not a wire response —
   * passing it through would ship a malformed response. It normalizes to a
   * generic server error (or whatever status was already set before this
   * call, which wins), with its body cancelled rather than adopted.
   *
   * @param response - The native Response to decompose.
   * @public
   */
  setNativeResponse(response: Response): void {
    this.discardBody();

    if (response.type === 'error' || response.status === 0) {
      cancelBodyQuietly(response.body);
      this._status ??= HttpStatus.InternalServerError;
      // A normalized error response is a different representation than
      // whatever a prior step described (ETag, Cache-Control, a real
      // Content-Length) — that metadata is now false and must not ride
      // along. The slot stays Stream{readable: null}, not Buffered: it is
      // still the marker that a handler-side response applied here, which
      // the AfterHandle skip contract depends on.
      this._headers.delete(HttpHeader.ContentLength);
      for (const header of REPRESENTATION_METADATA_HEADERS) this._headers.delete(header);
      this._body = { kind: ResponseBodyKind.Stream, readable: null, blobBacked: false };
      return;
    }

    // Must run before folding headers below: this Response's own
    // Content-Length is the true length of the body being adopted and must
    // survive the fold; a later delete would wipe it out too.
    this._headers.delete(HttpHeader.ContentLength);

    this._status = response.status as HttpStatus;
    this._statusText = response.statusText !== '' ? response.statusText : undefined;

    for (const [key, value] of response.headers.entries()) {
      if (key === HttpHeader.SetCookie) continue; // entries() folds cookies — appended below
      if (key === HttpHeader.Vary && this._headers.has(key)) {
        this._headers.set(key, unionVary(this._headers.get(key)!, value));
        continue;
      }
      this._headers.set(key, value);
    }
    for (const cookie of response.headers.getSetCookie()) {
      this._headers.append(HttpHeader.SetCookie, cookie);
    }

    this._body = {
      kind: ResponseBodyKind.Stream,
      readable: response.body,
      // Whether the handler built this Response from a Blob is not
      // observable from here — assume conservatively that it might be. The
      // cost only materializes when the wire has no Content-Type (§5).
      blobBacked: response.body !== null,
    };
  }

  /**
   * Cancels the current body if it is a stream. Used by error paths to
   * release file descriptors when the response won't be sent.
   *
   * @public
   */
  cancelBody(): void {
    this.discardBody();
  }

  // ── Serialize (Content-Type inference + JSON.stringify) ──────

  /**
   * Performs Content-Type inference and JSON serialization on the buffered
   * body. Converts JS objects/arrays/numbers/booleans to JSON strings.
   *
   * Called by Serialize step between AfterHandle and BeforeResponse phases,
   * so that BeforeResponse middleware receives serialized bytes (enabling compression, ETag, signing).
   *
   * No-op when the body is a stream (SSE, streaming, Blob, handler Response)
   * or absent. Serialization is decided by the body's type, never by a
   * Content-Type label — a leftover label from an earlier step (e.g.
   * `@ContentType('text/html')`) must not suppress serializing an error
   * body written after it.
   *
   * Naturally idempotent: once a value is serialized it becomes a `string`,
   * which the type check below already treats as "leave it alone" — no
   * separate "already serialized" flag is needed.
   *
   * @public
   */
  serialize(): void {
    if (this._body.kind !== ResponseBodyKind.Buffered) return;

    const value = this._body.value;

    if (this.getContentType() === null) {
      this.setContentType(this.inferContentType(value));
    }

    // Already-serialized values: a string is JSON text (or plain text)
    // already; binary bodies must never be stringified (would corrupt a
    // Uint8Array into `{"0":31,...}`); `null` means an intentionally empty
    // body, not a value to encode.
    if (
      typeof value === 'string'
      || value instanceof Uint8Array
      || value instanceof ArrayBuffer
      || value === null
    ) {
      return;
    }

    try {
      this._body = { kind: ResponseBodyKind.Buffered, value: JSON.stringify(value) };
    } catch (error) {
      this.setContentType(ContentType.Text);
      this._body = { kind: ResponseBodyKind.Buffered, value: '[unserializable body]' };

      if (typeof console !== 'undefined') {
        console.error('JSON serialization failed in HttpResponse.serialize():', error);
      }
    }
  }

  // ── Build (model → Response) ────────────────────────────────

  private build(): Response {
    // Safety net: ensure serialization ran even if called outside the pipeline (e.g. tests, edge cases).
    // Idempotent — no-op if already called by Serialize step.
    this.serialize();

    // Out-of-range status must be normalized to a generic 500 representation
    // before the RFC branches below run — normalizing it later, inside
    // createResponse(), let a branch that must drop the body (HEAD, 204/205,
    // a 3xx redirect) discard whatever was there and then have the fallback
    // re-inject a body afterward, violating that branch's own no-body
    // contract (e.g. a HEAD response shipping "Internal Server Error").
    const s = this._status;
    if (s !== undefined && s !== 101 && (s < 200 || s > 599)) {
      this.setStatus(HttpStatus.InternalServerError);
      this.setContentType('text/plain');
      this.replaceRepresentation('Internal Server Error');
    }

    const location = this.getHeader(HttpHeader.Location);
    const status = this._status;

    // 1. Redirect: RFC 9110 §10.2.2 — the meaning of Location is subordinate
    // to status. Only a 3xx (or no status yet, defaulting to 302) makes this
    // a redirect; on e.g. 201 Created, Location names the created resource
    // and its body must ship.
    if (
      typeof location === 'string' && location.length > 0
      && (status === undefined || (status >= 300 && status <= 399))
    ) {
      if (status === undefined) {
        this.setStatus(HttpStatus.Found);
      }
      this.discardBody();
      // Body is dropped — content-coupled metadata (Content-Encoding set by a
      // BeforeResponse middleware, stale Content-Length, integrity digests)
      // would describe content that no longer exists.
      this._headers.delete(HttpHeader.ContentEncoding);
      this._headers.delete(HttpHeader.ContentLength);
      this._headers.delete(HttpHeader.ContentDigest);
      this._headers.delete(HttpHeader.ReprDigest);
      return this.createResponse();
    }

    // 2. 101: RFC 9110 §15.2.2 — Switching Protocols has no representation at
    // all, so no Content-Type/-Length/-Encoding to strip, just the body.
    if (this._status === HttpStatus.SwitchingProtocols) {
      this.discardBody();
      return this.createResponse();
    }

    // 3. 204/205/304: body removed per RFC — checked before Content-Type inference.
    if (
      this._status === HttpStatus.NoContent
      || this._status === HttpStatus.ResetContent
      || this._status === HttpStatus.NotModified
    ) {
      this.discardBody();
      // RFC 9110 §15.3.5/§15.3.6: 204/205 MUST NOT contain content, so
      // Content-Type/-Encoding/-Length and integrity digests (which describe
      // that now-absent content) are removed. 304 is exempt (RFC 9110
      // §15.4.5): validators and representation metadata remain valid
      // cache-revalidation data.
      if (this._status !== HttpStatus.NotModified) {
        this._headers.delete(HttpHeader.ContentType);
        this._headers.delete(HttpHeader.ContentEncoding);
        this._headers.delete(HttpHeader.ContentLength);
        this._headers.delete(HttpHeader.ContentDigest);
        this._headers.delete(HttpHeader.ReprDigest);
      }
      return this.createResponse();
    }

    // 4. Auto 204: untouched state — no status was ever set and no body was
    // ever assigned.
    if (this._body.kind === ResponseBodyKind.None && this._status === undefined) {
      this.setStatus(HttpStatus.NoContent);
      return this.createResponse();
    }

    // 5. HEAD: RFC 9110 §9.3.2 — body must not be sent. A buffered body's
    // Content-Length is computed first (what a GET would have shipped); a
    // stream's Content-Length, if any, was already declared by setBody's Blob
    // branch and survives untouched.
    if (this.req.method === 'HEAD') {
      if (this._status === undefined) {
        this.setStatus(HttpStatus.Ok);
      }

      if (this._body.kind === ResponseBodyKind.Buffered) {
        const value = this._body.value;
        if (typeof value === 'string') {
          this.setHeader(HttpHeader.ContentLength, Buffer.byteLength(value, 'utf-8').toString());
        } else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
          this.setHeader(HttpHeader.ContentLength, value.byteLength.toString());
        }
      }

      this.discardBody();
      return this.createResponse();
    }

    return this.createResponse();
  }

  /**
   * Assembles the final `Response` from the current model — the single
   * assembly point every `build()` branch funnels through.
   */
  private createResponse(): Response {
    const body = this._body.kind === ResponseBodyKind.Stream
      ? this.wireBody(this._body)
      : this.normalizeBody();

    return new Response(body, {
      status: this._status ?? HttpStatus.Ok,
      ...(this._statusText !== undefined ? { statusText: this._statusText } : {}),
      headers: this._headers,
    });
  }

  /**
   * Isolates a Bun runtime quirk: Bun infers `Content-Type` from a
   * Blob-backed stream at send time, even after `removeHeader` deleted it in
   * memory. Breaking the Blob backing (`pipeThrough`) defeats the inference,
   * but costs ~17µs — only paid when the wire would otherwise ship no
   * Content-Type at all.
   */
  private wireBody(slot: Extract<BodySlot, { kind: ResponseBodyKind.Stream }>): ReadableStream | null {
    if (slot.readable === null || !slot.blobBacked) return slot.readable;
    if (this._headers.has(HttpHeader.ContentType)) return slot.readable;
    return slot.readable.pipeThrough(new TransformStream());
  }

  private inferContentType(value: BufferedBodyValue): string {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return 'application/octet-stream';
    }
    if (
      value !== null
      && (typeof value === 'object' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      return ContentType.Json;
    }
    return ContentType.Text;
  }

  private normalizeBody(): string | Uint8Array | ArrayBuffer | null {
    if (this._body.kind === ResponseBodyKind.None) return null;
    if (this._body.kind === ResponseBodyKind.Stream) {
      // Unreachable: build() only calls normalizeBody() for non-Stream slots.
      throw new Error('normalizeBody received a Stream body — build() should have routed it through wireBody()');
    }

    const value = this._body.value;
    if (value === null) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value.toString();

    throw new Error('normalizeBody received an unserialized object — build() should have serialized it');
  }
}
