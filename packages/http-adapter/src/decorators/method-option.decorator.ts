import type { HttpStatus } from '../enums';

/**
 * Enables raw request body capture for this handler.
 *
 * When present, the adapter buffers the raw bytes (`Uint8Array`) before
 * content-type decoding. The raw bytes are accessible via `req.rawBody`
 * after body parsing. Used for webhook signature verification (Stripe, GitHub, etc.).
 *
 * Streaming body paths (multipart, octet-stream) are not affected —
 * `req.rawBody` remains `null` even with `@RawBody()`.
 *
 * @returns A no-op method decorator. Actual wiring happens at AOT build time.
 *
 * @example
 * ```ts
 * ⁣@Post('/webhook')
 * ⁣@RawBody()
 * handleWebhook(ctx: HttpContext) {
 *   const raw = ctx.request.rawBody;
 *   const signature = computeHmac(raw);
 * }
 * ```
 *
 * @public
 */
export function RawBody(): MethodDecorator {
  return () => {};
}

/**
 * Marks this handler as an SSE (Server-Sent Events) endpoint.
 *
 * When `@Sse()` is present, an `AsyncIterable` return value is formatted
 * as SSE (`text/event-stream` + `data:` framing). Without `@Sse()`,
 * `AsyncIterable` is sent as raw streaming chunks.
 *
 * @returns A no-op method decorator. Actual wiring happens at AOT build time.
 *
 * @example
 * ```ts
 * ⁣@Get('/events')
 * ⁣@Sse()
 * async *events() {
 *   yield { message: 'hello' };
 * }
 * ```
 *
 * @public
 */
export function Sse(): MethodDecorator {
  return () => {};
}

/**
 * Sets the per-route body size limit in bytes.
 * Overrides the global `bodyLimit` from `HttpServerOptions` for this handler.
 *
 * @param bytes - Maximum body size in bytes.
 * @returns A no-op method decorator. Actual wiring happens at AOT build time.
 *
 * @example
 * ```ts
 * ⁣@Post('/upload/avatar')
 * ⁣@BodyLimit(5 * 1024 * 1024) // 5MB
 * uploadAvatar(ctx: HttpContext) { ... }
 * ```
 *
 * @public
 */
export function BodyLimit(_bytes: number): MethodDecorator {
  return () => {};
}

/**
 * Sets the default HTTP status code for this handler's response.
 * The handler can override this with `ctx.response.setStatus()`.
 *
 * @param code - The HTTP status code.
 * @returns A no-op method decorator. Actual wiring happens at AOT build time.
 *
 * @example
 * ```ts
 * ⁣@Post('/users')
 * ⁣@Status(201)
 * createUser(ctx: HttpContext) { ... }
 * ```
 *
 * @public
 */
export function Status(_code: HttpStatus): MethodDecorator {
  return () => {};
}

/**
 * Sets a static redirect for this handler.
 * The handler still executes and can override by removing the Location header.
 *
 * @param url - The redirect target URL.
 * @param status - The redirect status code (default: 302).
 * @returns A no-op method decorator. Actual wiring happens at AOT build time.
 *
 * @example
 * ```ts
 * ⁣@Get('/old-path')
 * ⁣@Redirect('/new-path', 301)
 * oldHandler() { }
 * ```
 *
 * @public
 */
export function Redirect(_url: string, _status?: 301 | 302 | 303 | 307 | 308): MethodDecorator {
  return () => {};
}

/**
 * Sets the default Content-Type for this handler's response.
 * The handler can override this with `ctx.response.setContentType()`.
 *
 * @param type - The media type string.
 * @returns A no-op method decorator. Actual wiring happens at AOT build time.
 *
 * @example
 * ```ts
 * ⁣@Get('/export')
 * ⁣@ContentType('text/csv')
 * async *exportCsv() { yield 'a,b\n'; }
 * ```
 *
 * @public
 */
export function ContentType(_type: string): MethodDecorator {
  return () => {};
}

/**
 * Sets a static response header for this handler.
 * The handler can override this with `ctx.response.setHeader()`.
 *
 * @param name - The header name.
 * @param value - The header value.
 * @returns A no-op method decorator. Actual wiring happens at AOT build time.
 *
 * @example
 * ```ts
 * ⁣@Get('/api/data')
 * ⁣@Header('Cache-Control', 'max-age=3600')
 * getData(ctx: HttpContext) { ... }
 * ```
 *
 * @public
 */
export function Header(_name: string, _value: string): MethodDecorator {
  return () => {};
}
