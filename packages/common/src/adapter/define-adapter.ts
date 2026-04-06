import type { ContextKey } from '../context-key';
import type { AdapterClass } from './types';

/**
 * Configuration for {@link defineAdapter}.
 *
 * Declares the full static schema of an adapter: its class, context type,
 * protocol-specific steps/phases, pipeline ordering, and provided context keys.
 * The AOT compiler reads this declaration to generate optimized per-handler pipelines
 * and verify context key providers at build time.
 *
 * @typeParam TContext - The adapter's context implementation class.
 * @typeParam TStep - Enum of adapter-specific pipeline steps.
 * @typeParam TPhase - Enum of adapter-specific middleware phases.
 *
 * @public
 */
export interface DefineAdapterConfig<
  TContext = unknown,
  TStep extends Record<string, string> = Record<string, string>,
  TPhase extends Record<string, string> = Record<string, never>,
> {
  /** The adapter class. */
  readonly adapter: AdapterClass;
  /** The adapter's context class. Used for type-level validation of context key accessors. */
  readonly context: new (...args: readonly unknown[]) => TContext;
  /** Adapter-specific step enum. Values appear in `pipeline`. */
  readonly step: TStep;
  /** Adapter-specific middleware phase enum. Values appear in `pipeline`. Optional for adapters without phases. */
  readonly phase?: TPhase;
  /**
   * Declarative pipeline step sequence. Contains CoreStep, adapter step, and adapter phase values.
   * The AOT compiler reads this array to generate optimized per-handler pipelines
   * by eliminating steps with no registered handlers.
   *
   * CoreStep.Handler marks the error boundary: steps before it run under exception
   * filter catch (Phase 1), steps after run under emergency teardown catch (Phase 2).
   */
  readonly pipeline: readonly string[];
  /** Context keys that adapter steps provide. The compiler uses this to verify `ctx.use()`/`ctx.validated()` calls. */
  readonly provides?: readonly ContextKey<unknown>[];
}

/**
 * Declares an adapter's static schema for AOT compilation.
 *
 * The AOT compiler looks for `defineAdapter(...)` call expressions and extracts
 * the configuration object at build time. The returned config is frozen and
 * serves as the single source of truth for pipeline structure, phases, steps,
 * and provided context keys.
 *
 * @param config - The adapter's static schema.
 * @returns The same config object, frozen.
 *
 * @example
 * ```ts
 * export const httpAdapterDefinition = defineAdapter({
 *   adapter: HttpAdapter,
 *   context: HttpContext,
 *   step: HttpStep,
 *   phase: HttpPhase,
 *   pipeline: [
 *     HttpPhase.OnRequest,
 *     HttpStep.ResolveRoute,
 *     HttpPhase.BeforeParse,
 *     HttpStep.ParseBody,
 *     HttpPhase.BeforeValidate,
 *     CoreStep.Validation,
 *     CoreStep.Guard,
 *     HttpPhase.BeforeHandle,
 *     CoreStep.Handler,
 *     HttpStep.WriteResponse,
 *     HttpPhase.AfterHandle,
 *     HttpStep.Serialize,
 *     HttpPhase.BeforeResponse,
 *     HttpPhase.AfterResponse,
 *   ],
 *   provides: [bodyInput, paramsInput],
 * });
 * ```
 *
 * @public
 */
export function defineAdapter<
  TContext,
  TStep extends Record<string, string>,
  TPhase extends Record<string, string> = Record<string, never>,
>(config: DefineAdapterConfig<TContext, TStep, TPhase>): DefineAdapterConfig<TContext, TStep, TPhase> {
  return Object.freeze({
    adapter: config.adapter,
    context: config.context,
    step: config.step,
    ...(config.phase !== undefined ? { phase: config.phase } : {}),
    pipeline: Object.freeze([...config.pipeline]),
    ...(config.provides !== undefined ? { provides: Object.freeze([...config.provides]) } : {}),
  }) as DefineAdapterConfig<TContext, TStep, TPhase>;
}
