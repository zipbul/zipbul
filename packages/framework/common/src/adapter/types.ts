import type { MiddlewareDefinition } from '../define-middleware';
import type { ExceptionFilterDefinition } from '../define-exception-filter';
import type { GuardDefinition } from '../define-guard';
import type { AdapterContext, ApplicationContext, ZipbulContainer } from '../interfaces';

/**
 * Reference to a decorator function.
 *
 * `any` is intentional here: decorator factories accept heterogeneous
 * argument lists whose shapes are defined by each adapter, so a
 * single generic signature cannot capture all variants without
 * resorting to complex conditional types that provide no safety
 * benefit at the framework boundary.
 */
export type DecoratorRef = (...args: any[]) => any;

/** Adapter-specific entry decorators provided to user code. */
export interface AdapterEntryDecorators {
  readonly controller: DecoratorRef;
  readonly handlers: readonly DecoratorRef[];
  /**
   * Method/class decorators that configure handler behavior without creating routes.
   * AOT scans both class-level and method-level decorators for these names.
   * Class-level applies to all handlers in the controller; method-level to that handler only.
   *
   * @example `[RawBody]` (HTTP), `[Retry]` (Queue)
   * @public
   */
  readonly options?: readonly DecoratorRef[];
}

/**
 * Adapter clustering strategy.
 *
 * Determines how the framework assigns adapters to worker groups in cluster mode.
 *
 * @public
 */
export enum ClusterStrategy {
  /**
   * Port sharing via reusePort for horizontal scaling.
   * N workers run identical adapter instances. Kernel distributes traffic.
   *
   * @example HTTP, gRPC Unary, MQ Consumer
   */
  Shared = 'Shared',

  /**
   * Exactly 1 worker runs this adapter.
   * Duplicate execution causes side effects.
   *
   * @example Cron, Leader Election, Scheduler
   */
  Exclusive = 'Exclusive',
}

/**
 * Public contract for all protocol adapters.
 *
 * Defined in `@zipbul/common` so that `AdapterClass` can reference it
 * without creating a circular dependency on `@zipbul/core`.
 * The `Adapter` abstract class in `@zipbul/core` structurally satisfies
 * this interface and provides shared implementation.
 *
 * @public
 */
export interface Adapter {
  /** Adapter-specific entry decorators (controller + handler + option decorators). */
  readonly decorators: AdapterEntryDecorators;

  /** Clustering strategy for this adapter. */
  readonly clusterStrategy: ClusterStrategy;

  /**
   * Boots the adapter and begins accepting requests.
   *
   * @param context - The application startup context.
   * @public
   */
  start(context: ApplicationContext): Promise<void>;

  /**
   * Optional test-mode boot path used by `@zipbul/testing` to wire routes
   * and pipeline state without binding a transport. Adapters that don't
   * implement it are skipped by the toolkit (their providers stay
   * registered, their test surface — if any — remains callable, but no
   * transport binds and no start hook fires).
   *
   * Long-term: this hook is provisional pending a proper
   * `prepare(ctx)` / `listen(ctx)` split of the lifecycle.
   *
   * @public
   */
  startTest?(context: ApplicationContext): Promise<void>;

  /**
   * Gracefully shuts down the adapter.
   *
   * @public
   */
  stop(): Promise<void>;

  /**
   * Stops accepting new connections and waits for in-flight work to complete.
   *
   * @param timeoutMs - Maximum time to wait for drain completion.
   * @public
   */
  drain(timeoutMs: number): Promise<void>;

  /**
   * Drives the full request pipeline with a 3-Phase error boundary.
   *
   * @param context - The current execution context.
   * @public
   */
  dispatchRequest(context: AdapterContext): Promise<void>;

  /**
   * Receives the adapter's complete AOT-compiled configuration as a single
   * slice and applies it once. The adapter is a passive consumer: it stores the
   * compiled middleware/guard/exception-filter definitions and resolves them
   * against the DI container in {@link Adapter.initializePipeline}. There is no
   * incremental/imperative registration — the compiler is the single source of
   * truth, the bootstrap hands each adapter its slice exactly once.
   *
   * @param config - The adapter's compiled config (phase-keyed middleware plus
   *   optional guards and exception filters).
   * @public
   */
  applyConfig(config: AdapterConfig): void;

  /**
   * Resolves all definition factories within the given DI container.
   *
   * @param container - The application DI container.
   * @public
   */
  initializePipeline(container: ZipbulContainer): void;

}

/**
 * The compiled, per-adapter configuration slice produced by the AOT compiler
 * and handed to {@link Adapter.applyConfig} at bootstrap. All fields optional;
 * middleware is keyed by pipeline phase.
 *
 * @public
 */
export interface AdapterConfig {
  middlewares?: Readonly<Record<string, readonly MiddlewareDefinition[]>>;
  guards?: readonly GuardDefinition[];
  exceptionFilters?: readonly ExceptionFilterDefinition[];
}

/** Adapter class constructor type. Produces an instance satisfying the {@link Adapter} contract. */
export type AdapterClass = new (...args: any[]) => Adapter;

/**
 * Adapter dependency declaration.
 *
 * - `AdapterClass` — depends on **all** instances of that adapter class.
 * - `string` — depends on the specific adapter instance registered with that `name`.
 * - Empty array = standalone (no dependency on other adapters).
 *
 * @public
 */
export type AdapterDependsOn = readonly (AdapterClass | string)[];
