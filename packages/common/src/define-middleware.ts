import type { Context } from './interfaces';

/**
 * Handler function for a middleware definition.
 * Receives the current execution context and optionally returns
 * `false` to abort the pipeline, or `void` to continue.
 *
 * @param ctx - The execution context for the current request.
 * @returns `void` to continue, `false` to halt the pipeline.
 *
 * @public
 */
export type MiddlewareHandlerFn = (ctx: Context) => void | boolean | Promise<void | boolean>;

/**
 * Immutable middleware definition produced by {@link defineMiddleware}.
 *
 * @public
 */
export interface MiddlewareDefinition {
  readonly handler: MiddlewareHandlerFn;
}

/**
 * Declares a middleware. This is an identity wrapper — it freezes
 * the handler into a `{ handler }` object. Its purpose is to serve
 * as a static marker for the AOT compiler and to provide a
 * type-safe, immutable middleware reference.
 *
 * @param handler - The middleware handler function.
 * @returns A frozen {@link MiddlewareDefinition}.
 *
 * @example
 * ```ts
 * // Option-less middleware
 * export const loggerMiddleware = defineMiddleware((ctx) => {
 *   const http = ctx.to(HttpContext);
 *   console.log(`[${http.request.method}] ${http.request.url}`);
 * });
 *
 * // Middleware with options (factory pattern)
 * export function corsMiddleware(options: CorsOptions): MiddlewareDefinition {
 *   return defineMiddleware((ctx) => {
 *     const http = ctx.to(HttpContext);
 *     handleCors(http, options);
 *   });
 * }
 * ```
 *
 * @public
 */
export function defineMiddleware(handler: MiddlewareHandlerFn): MiddlewareDefinition {
  return Object.freeze({ handler });
}
