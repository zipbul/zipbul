import type {
  ApplicationOptions,
  CompiledHandlerEntry,
  ContextKey,
  ProviderToken,
} from '@zipbul/common';

import type {
  ClassMetadata,
  RouteHandlerResult,
  MetadataRegistryKey,
  TrustProxyConfig,
  RequestIdOptions,
} from './types';
import type { HttpContext } from './http-context';

/**
 * TLS configuration for the HTTP server.
 * Re-exports Bun's native `TLSOptions` to avoid type duplication.
 *
 * @public
 */
export type HttpTlsOptions = import('bun').TLSOptions;

export interface HttpServerOptions extends ApplicationOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly bodyLimit?: number;
  readonly trustProxy?: TrustProxyConfig;
  readonly reusePort?: boolean;
  readonly name?: string;
  readonly logLevel?: string;
  readonly requestId?: RequestIdOptions;
  readonly customMethods?: readonly string[];
  readonly textMediaTypes?: readonly string[];
  /** Idle connection timeout in seconds. Default: 30. */
  readonly idleTimeout?: number;
  /** TLS configuration. When provided, the server starts with HTTPS. */
  readonly tls?: HttpTlsOptions;
}

export type InternalRouteMethod = 'GET';

export type InternalRouteHandler = (ctx: HttpContext) => RouteHandlerResult;

export interface InternalRouteEntry {
  readonly method: InternalRouteMethod;
  readonly path: string;
  readonly handler: InternalRouteHandler;
}

export interface HttpServerBootOptions extends HttpServerOptions {
  readonly metadata?: Map<MetadataRegistryKey, ClassMetadata>;
  readonly scopedKeys?: Map<ProviderToken, string>;
  readonly internalRoutes?: readonly InternalRouteEntry[];
  readonly logger?: unknown;
  readonly handlerIndex?: readonly CompiledHandlerEntry[];
  readonly controllerInstances?: Map<string, unknown>;
  readonly contextKeyIndex?: ReadonlyMap<string, ContextKey<unknown>>;
}

export interface HttpWorkerEntryModule {
  readonly className: string;
  readonly manifestPath?: string;
}

export interface HttpWorkerInitParams {
  readonly entryModule: HttpWorkerEntryModule;
  readonly options: HttpServerOptions;
}

