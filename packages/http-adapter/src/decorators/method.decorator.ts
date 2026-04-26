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
 * The method string must also be listed in `HttpServerOptions.customMethods`
 * so that the server accepts the method instead of returning 501.
 *
 * **Permanently forbidden methods** — `TRACE`, `CONNECT` — are rejected at
 * compile time (case-insensitive via `Uppercase<>`) and at runtime. See
 * {@link ForbiddenHttpMethod}.
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
    _method: Uppercase<M> extends import('../http-method').ForbiddenHttpMethod ? never : M,
    _pathOrOptions?: string | HttpMethodDecoratorOptions,
  ): MethodDecorator =>
  () => {};
