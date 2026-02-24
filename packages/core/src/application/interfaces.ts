import type { ZipbulAdapter, Context, AdapterDependsOn } from '@zipbul/common';

import type { ZipbulApplication } from './zipbul-application';

interface CreateApplicationOptions {
  //
}

/**
 * Bootstrap adapter — returned by adapter factory functions.
 * Installs an adapter instance into the application.
 */
export type BootstrapAdapter = {
  install(app: ZipbulApplication): Promise<void> | void;
};

/**
 * Configuration for addAdapter().
 */
export type AddAdapterConfig = {
  name: string;
  protocol: string;
  dependsOn?: AdapterDependsOn;
};

/**
 * Internal adapter registry entry.
 */
export type AdapterEntry = {
  adapter: ZipbulAdapter;
  name: string;
  protocol: string;
  dependsOn: AdapterDependsOn;
};

export type { CreateApplicationOptions };
