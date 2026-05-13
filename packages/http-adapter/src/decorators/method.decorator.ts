import type { HttpMethodDecoratorOptions } from './interfaces';

export const Get =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Post =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Put =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Delete =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Patch =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Options =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Head =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};

/**
 * Declares a handler for a custom HTTP method not covered by the standard
 * seven (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS).
 *
 * The decorator is the single source of truth: the method token is collected
 * during the AOT handler-index scan at boot, validated (RFC 9110 §5.1 token),
 * and added to the server's allowed-methods set automatically. No additional
 * configuration is required.
 *
 * **Permanently forbidden methods** — `TRACE`, `CONNECT` — are rejected at
 * compile time (case-insensitive via `Uppercase<>`) and at scan time. See
 * `FORBIDDEN_HTTP_METHODS` in `../constants`.
 *
 * @param method - Custom HTTP method token (e.g. `'PURGE'`, `'PROPFIND'`).
 * @param pathOrOptions - Route path or options. Same as `@Get()` / `@Post()`.
 *
 * @example
 * ```ts
 * ⁣@RestController('cache')
 * class CacheController {
 *   ⁣@Method('PURGE', ':key')
 *   purge(ctx: HttpContext) {
 *     return { purged: ctx.request.params['key'] };
 *   }
 * }
 * ```
 *
 * @public
 */
export const Method =
  <const M extends string>(
    _method: Uppercase<M> extends typeof import('../constants').FORBIDDEN_HTTP_METHODS[number] ? never : M,
    _pathOrOptions?: string | HttpMethodDecoratorOptions,
  ): MethodDecorator =>
  () => {};
