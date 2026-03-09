import type { Result, ResultAsync } from '@zipbul/result';
import type { AdapterClass } from './adapter/types';
import type { Context } from './interfaces';

/**
 * Handler function for a middleware definition.
 * Receives the current execution context and returns a {@link Result}
 * indicating whether to continue (`void`) or halt (`Err<unknown>`).
 *
 * @param ctx - The execution context for the current request.
 * @returns `void` to continue, `Err<unknown>` to halt the pipeline.
 *
 * @public
 */
export type MiddlewareHandlerFn = (
  ctx: Context,
) => Result<void, unknown> | ResultAsync<void, unknown>;

/**
 * Immutable middleware definition produced by {@link defineMiddleware}.
 *
 * When `adapters` is provided, the middleware is only compatible with
 * the listed adapter classes. When omitted, the middleware is universal
 * (compatible with all adapters).
 *
 * @public
 */
export interface MiddlewareDefinition {
  readonly handler: MiddlewareHandlerFn;
  readonly adapters?: readonly AdapterClass[];
}

/**
 * Declares a middleware. This is an identity wrapper — it freezes
 * the definition into an immutable object. Its purpose is to serve
 * as a static marker for the AOT compiler and to provide a
 * type-safe, immutable middleware reference.
 *
 * @param handler - The middleware handler function (universal middleware).
 * @returns A frozen {@link MiddlewareDefinition}.
 *
 * @example
 * ```ts
 * // Universal middleware (all adapters)
 * export const timingMiddleware = defineMiddleware((ctx) => {
 *   console.log('timing');
 * });
 *
 * // Adapter-specific middleware
 * export const corsMiddleware = defineMiddleware([HttpAdapter], (ctx) => {
 *   const http = ctx.to(HttpContext);
 *   handleCors(http);
 * });
 *
 * // Factory pattern with adapter constraint
 * export function rateLimitMiddleware(opts: RateLimitOptions): MiddlewareDefinition {
 *   return defineMiddleware([HttpAdapter], (ctx) => { ... });
 * }
 * ```
 *
 * @public
 */
export function defineMiddleware(handler: MiddlewareHandlerFn): MiddlewareDefinition;
export function defineMiddleware(adapters: readonly AdapterClass[], handler: MiddlewareHandlerFn): MiddlewareDefinition;
export function defineMiddleware(
  adaptersOrHandler: readonly AdapterClass[] | MiddlewareHandlerFn,
  maybeHandler?: MiddlewareHandlerFn,
): MiddlewareDefinition {
  if (typeof adaptersOrHandler === 'function') {
    return Object.freeze({ handler: adaptersOrHandler });
  }

  if (maybeHandler === undefined) {
    throw new Error('Handler function is required when adapters are specified.');
  }

  return Object.freeze({
    handler: maybeHandler,
    adapters: Object.freeze([...adaptersOrHandler]),
  });
}
