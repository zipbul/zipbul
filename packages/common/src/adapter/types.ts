import type { Adapter } from './adapter';

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

/** Adapter class constructor type. Accepts any constructor args and produces an Adapter. */
export type AdapterClass = new (...args: any[]) => Adapter;

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
