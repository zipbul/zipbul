import type { Adapter, AdapterClass, AdapterDependsOn } from '@zipbul/common';

interface CreateApplicationOptions {
  //
}

/**
 * Extracts the constructor options type from an adapter class.
 *
 * Resolves to the first constructor parameter type if it exists,
 * otherwise `Record<string, never>` (empty object).
 *
 * @public
 */
export type AdapterOptions<TAdapter extends AdapterClass> =
  ConstructorParameters<TAdapter> extends [infer TOptions, ...unknown[]]
    ? TOptions extends Record<string, unknown>
      ? TOptions
      : Record<string, never>
    : Record<string, never>;

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
