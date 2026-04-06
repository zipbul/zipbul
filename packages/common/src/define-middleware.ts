import type { Result, ResultAsync } from '@zipbul/result';
import type { AdapterClass } from './adapter/types';
import type { AdapterContext } from './interfaces';
import type { ContextKey } from './context-key';

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
  ctx: AdapterContext,
) => Result<void, unknown> | ResultAsync<void, unknown>;

/**
 * Factory function that creates a middleware handler.
 * Called once during pipeline assembly to produce the handler instance.
 *
 * @public
 */
export type MiddlewareFactory = () => MiddlewareHandlerFn;

/**
 * Immutable middleware definition produced by {@link defineMiddleware}.
 *
 * When `adapters` is provided, the middleware is only compatible with
 * the listed adapter classes. When omitted, the middleware is universal
 * (compatible with all adapters).
 *
 * When `provides` is specified, the middleware declares which context keys
 * it sets during execution. The AOT compiler uses this to verify that
 * handlers calling `ctx.use(key)` or `ctx.validated(key, Dto)` have the
 * required provider registered in their pipeline.
 *
 * @public
 */
export interface MiddlewareDefinition {
  readonly factory: MiddlewareFactory;
  readonly adapters?: readonly AdapterClass[];
  readonly provides?: readonly ContextKey<unknown>[];
}

/**
 * Configuration object for {@link defineMiddleware} (config overload).
 *
 * @public
 */
export interface DefineMiddlewareConfig {
  readonly factory: MiddlewareFactory;
  readonly adapters?: readonly AdapterClass[];
  readonly provides?: readonly ContextKey<unknown>[];
}

/**
 * Declares a middleware. This is an identity wrapper — it freezes
 * the definition into an immutable object. Its purpose is to serve
 * as a static marker for the AOT compiler and to provide a
 * type-safe, immutable middleware reference.
 *
 * @example
 * ```ts
 * // Universal middleware (all adapters)
 * export const timingMiddleware = defineMiddleware(() => (ctx) => {
 *   console.log('timing');
 * });
 *
 * // Adapter-specific middleware
 * export const corsMiddleware = defineMiddleware([HttpAdapter], () => (ctx) => {
 *   const http = ctx.to(HttpContext);
 *   handleCors(http);
 * });
 *
 * // Config object with provides
 * export const queryParser = defineMiddleware({
 *   provides: [queryInput],
 *   adapters: [HttpAdapter],
 *   factory: () => (ctx) => {
 *     const http = ctx.to(HttpContext);
 *     ctx.set(queryInput, parseQuery(http.request.queryString));
 *   },
 * });
 * ```
 *
 * @public
 */
export function defineMiddleware(config: DefineMiddlewareConfig): MiddlewareDefinition;
export function defineMiddleware(factory: MiddlewareFactory): MiddlewareDefinition;
export function defineMiddleware(adapters: readonly AdapterClass[], factory: MiddlewareFactory): MiddlewareDefinition;
export function defineMiddleware(
  configOrAdaptersOrFactory: DefineMiddlewareConfig | readonly AdapterClass[] | MiddlewareFactory,
  maybeFactory?: MiddlewareFactory,
): MiddlewareDefinition {
  // Config object overload
  if (typeof configOrAdaptersOrFactory === 'object' && !Array.isArray(configOrAdaptersOrFactory) && 'factory' in configOrAdaptersOrFactory) {
    const config = configOrAdaptersOrFactory;
    return Object.freeze({
      factory: config.factory,
      ...(config.adapters !== undefined ? { adapters: Object.freeze([...config.adapters]) } : {}),
      ...(config.provides !== undefined ? { provides: Object.freeze([...config.provides]) } : {}),
    });
  }

  // Factory-only overload
  if (typeof configOrAdaptersOrFactory === 'function') {
    return Object.freeze({ factory: configOrAdaptersOrFactory });
  }

  // Adapters + factory overload
  if (maybeFactory === undefined) {
    throw new Error('Factory function is required when adapters are specified.');
  }

  return Object.freeze({
    factory: maybeFactory,
    adapters: Object.freeze([...configOrAdaptersOrFactory]),
  });
}
