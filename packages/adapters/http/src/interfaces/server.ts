import type { ApplicationOptions, CompiledHandlerEntry, ProviderToken } from '@zipbul/common';

import type { HttpTlsOptions, MetadataRegistryKey, TrustProxyConfig } from '../types';

import type { ClassMetadata } from './metadata';
import type { InternalRouteEntry } from './route';

export interface RequestIdOptions {
  header?: string;
  generate?: () => string;
}

export interface HttpServerOptions extends ApplicationOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly bodyLimit?: number;
  readonly maxUriLength?: number;
  readonly trustProxy?: TrustProxyConfig;
  readonly reusePort?: boolean;
  readonly name?: string;
  readonly logLevel?: string;
  readonly requestId?: RequestIdOptions;
  readonly textMediaTypes?: readonly string[];
  readonly idleTimeout?: number;
  readonly tls?: HttpTlsOptions;
}

export interface HttpServerBootOptions extends HttpServerOptions {
  readonly metadata?: Map<MetadataRegistryKey, ClassMetadata>;
  readonly scopedKeys?: Map<ProviderToken, string>;
  readonly internalRoutes?: readonly InternalRouteEntry[];
  readonly logger?: unknown;
  readonly handlerIndex?: readonly CompiledHandlerEntry[];
  /**
   * Lazy controller factories from the AOT runtime. Each entry constructs
   * its controller on first invocation, after any container overrides have
   * been applied.
   */
  readonly controllerFactories?: ReadonlyMap<string, () => unknown>;
}

export interface HttpWorkerEntryModule {
  readonly className: string;
  readonly manifestPath?: string;
}

export interface HttpWorkerInitParams {
  readonly entryModule: HttpWorkerEntryModule;
  readonly options: HttpServerOptions;
}
