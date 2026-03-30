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
