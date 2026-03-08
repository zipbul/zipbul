import type { Adapter, AdapterClass, AdapterDependsOn } from '@zipbul/common';

import type { Application } from './application';

interface CreateApplicationOptions {
  //
}

/**
 * Bootstrap adapter — returned by adapter factory functions.
 * Installs an adapter instance into the application.
 */
export type BootstrapAdapter = {
  install(app: Application): Promise<void> | void;
};

/**
 * Configuration for addAdapter().
 *
 * `name` is optional for single-instance registration.
 * When the same adapter class is registered multiple times, `name` is required
 * to distinguish instances.
 *
 * @public
 */
export type AddAdapterConfig = {
  name?: string;
  dependsOn?: AdapterDependsOn;
};

/**
 * Internal adapter registry entry.
 */
export type AdapterEntry = {
  adapter: Adapter;
  adapterClass: AdapterClass;
  name?: string;
  dependsOn: AdapterDependsOn;
};

export type { CreateApplicationOptions };
