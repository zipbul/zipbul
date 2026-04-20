import type { Adapter, AdapterClass, AdapterDependsOn } from '@zipbul/common';

import type { WorkerGroupConfig } from '../cluster/interfaces';

/**
 * Options for `createApplication()`.
 *
 * @public
 */
interface CreateApplicationOptions {
  /**
   * Number of worker threads for cluster mode.
   * Omitted or 1 = single-process mode.
   * 2+ = cluster mode with automatic adapter grouping.
   *
   * @public
   */
  workers?: number;

  /**
   * Explicit worker group configuration.
   * Overrides automatic grouping from `workers`.
   * Each group defines its adapter assignment and worker count.
   *
   * @public
   */
  cluster?: readonly WorkerGroupConfig[];
}

/**
 * Extracts the constructor options type from an adapter class.
 *
 * Resolves to the first constructor parameter type when the adapter declares
 * concrete options. When the generic parameter is the abstract `AdapterClass`
 * base (tests, internal generic contexts) the first ctor param is `unknown`
 * — fall through to an open record so callers can still pass adapter-specific
 * fields. `AttachOptions` adds `name`/`dependsOn` on top.
 *
 * @public
 */
export type AdapterOptions<TAdapter extends AdapterClass> =
  ConstructorParameters<TAdapter> extends [infer TOptions, ...unknown[]]
    ? TOptions extends Record<string, unknown>
      ? TOptions
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * Options for {@link Application.attach}.
 *
 * Merges the target adapter's own constructor options with framework-level
 * registration options (`name`, `dependsOn`).
 *
 * @public
 */
export type AttachOptions<TAdapter extends AdapterClass> = AdapterOptions<TAdapter> & {
  name?: string;
  dependsOn?: AdapterDependsOn;
};

/**
 * Internal adapter registry entry.
 */
export type AdapterEntry = {
  adapter: Adapter;
  adapterClass: AdapterClass;
  name?: string | undefined;
  dependsOn: AdapterDependsOn;
};

export type { CreateApplicationOptions };
