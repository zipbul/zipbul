import type { Result, ResultAsync } from '@zipbul/result';
import type { AdapterClass } from './adapter/types';
import type { AdapterContext } from './interfaces';
import type { ContextKey } from './context-key';
import type { MiddlewareAugments, MiddlewareAugmentsInput, MiddlewareAugmentSpec, AugmentSupplyFn } from './augment';

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
  /** Declarative context augments — carried on the definition so the runtime can compose supply steps and run collision checks. */
  readonly augments?: MiddlewareAugments;
}

interface DefineMiddlewareConfigBase {
  readonly adapters?: readonly AdapterClass[];
  readonly provides?: readonly ContextKey<unknown>[];
}

/**
 * Configuration object for {@link defineMiddleware} (config overload).
 *
 * `factory` may be omitted when `augments` is present (an augments-only
 * middleware) — a noop factory is synthesized so the definition shape stays
 * uniform. `augments` requires a non-empty `adapters` array: namespace
 * strings (e.g. `request`) only have meaning per adapter context schema.
 *
 * @public
 */
export type DefineMiddlewareConfig =
  | (DefineMiddlewareConfigBase & { readonly factory: MiddlewareFactory; readonly augments?: MiddlewareAugmentsInput })
  | (DefineMiddlewareConfigBase & { readonly augments: MiddlewareAugmentsInput; readonly factory?: MiddlewareFactory });

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
 * // Config object with augments — declares a typed `request.getQuery(dto)`
 * // accessor. The bare `(ctx) => raw` supply fills the raw slot; the framework
 * // wires baker DTO validation from the handler's `getQuery(SomeDto)` call
 * // site (exactly like `getBody`/`getParams`). A supply may return an `Err`
 * // (value-or-error) to short-circuit the request into a 4xx.
 * export const queryParser = defineMiddleware({
 *   adapters: [HttpAdapter],
 *   augments: {
 *     request: {
 *       getQuery: (ctx) => parseQuery(ctx.to(HttpContext).request.queryString),
 *     },
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
  // Config object overload — discriminated by `factory` OR `augments` so an
  // augments-only config never falls through to the array/function branches.
  if (
    typeof configOrAdaptersOrFactory === 'object'
    && !Array.isArray(configOrAdaptersOrFactory)
    && ('factory' in configOrAdaptersOrFactory || 'augments' in configOrAdaptersOrFactory)
  ) {
    const config = configOrAdaptersOrFactory;
    const augments = config.augments !== undefined ? freezeAugments(config.augments, config.adapters) : undefined;

    return Object.freeze({
      // Augments-only middleware: synthesize a noop so `factory` stays
      // required on MiddlewareDefinition and every runtime call site is
      // unchanged. The framework composes the supply step separately.
      factory: config.factory ?? NOOP_FACTORY,
      ...(config.adapters !== undefined ? { adapters: Object.freeze([...config.adapters]) } : {}),
      ...(config.provides !== undefined ? { provides: Object.freeze([...config.provides]) } : {}),
      ...(augments !== undefined ? { augments } : {}),
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

const NOOP_HANDLER: MiddlewareHandlerFn = () => undefined;
const NOOP_FACTORY: MiddlewareFactory = () => NOOP_HANDLER;

/**
 * True only for a PLAIN function (arrow or `function`) — rejects async,
 * generator, and async-generator functions (distinct `[object *Function]`
 * tags) and class constructors (which report `[object Function]` but stringify
 * as `class …`). A supply must be a synchronous `(ctx) => raw`; the other
 * callables would ship a Promise/iterator into baker validation or throw at
 * construction.
 */
function isPlainSupplyFunction(value: unknown): value is AugmentSupplyFn {
  if (typeof value !== 'function') {
    return false;
  }

  // Whitelist: only `[object Function]` — leaves out AsyncFunction /
  // GeneratorFunction / AsyncGeneratorFunction.
  if (Object.prototype.toString.call(value) !== '[object Function]') {
    return false;
  }

  // A class also reports `[object Function]`; its source starts with `class`.
  return !/^class[\s{]/.test(Function.prototype.toString.call(value));
}

/**
 * Validates, normalizes, and deep-freezes the augments slot. Augments require a
 * non-empty `adapters` array (namespace strings only have meaning per adapter
 * context schema). Each property value is either a bare supply function (the
 * preferred floor-level form — a plain synchronous `(ctx) => raw`, normalized to
 * a `validated-accessor` spec). Anything else — async/generator/class callables,
 * non-callables — is a boot-time programmer error.
 */
function freezeAugments(
  augments: MiddlewareAugmentsInput,
  adapters: readonly AdapterClass[] | undefined,
): MiddlewareAugments {
  if (adapters === undefined || adapters.length === 0) {
    throw new Error('Middleware augments require a non-empty adapters array.');
  }

  const namespaces: Record<string, Readonly<Record<string, MiddlewareAugmentSpec>>> = {};

  for (const [namespace, props] of Object.entries(augments)) {
    const frozenProps: Record<string, MiddlewareAugmentSpec> = {};

    for (const [prop, entry] of Object.entries(props)) {
      if (typeof entry !== 'function') {
        throw new Error(`augments.${namespace}.${prop} must be a supply function ((ctx) => raw).`);
      }

      if (!isPlainSupplyFunction(entry)) {
        throw new Error(
          `augments.${namespace}.${prop} supply must be a plain synchronous function `
          + '(not an async, generator, or class value).',
        );
      }

      // Bare supply function → validated-accessor spec.
      frozenProps[prop] = Object.freeze({ kind: 'validated-accessor' as const, supply: entry });
    }

    namespaces[namespace] = Object.freeze(frozenProps);
  }

  return Object.freeze(namespaces);
}
