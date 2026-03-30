import type {
  ApplicationOptions,
  CompiledHandlerEntry,
  ZipbulContainer,
  Class,
  Context,
  ProviderToken,
} from '@zipbul/common';

import type {
  ClassMetadata,
  RouteHandlerResult,
  HttpWorkerResponseBody,
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
  readonly bodyLimit?: number;
  readonly trustProxy?: TrustProxyConfig;
  readonly reusePort?: boolean;
  readonly name?: string;
  readonly logLevel?: string;
  readonly requestId?: RequestIdOptions;
  readonly customMethods?: readonly string[];
  readonly textMediaTypes?: readonly string[];
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
}

export interface HttpAdapterStartContext extends Context {
  readonly container: ZipbulContainer;
  readonly entryModule?: Class;
}

export interface HttpWorkerEntryModule {
  readonly className: string;
  readonly manifestPath?: string;
}

export interface HttpWorkerInitParams {
  readonly entryModule: HttpWorkerEntryModule;
  readonly options: HttpServerOptions;
}

export interface HttpWorkerResponse {
  readonly body: HttpWorkerResponseBody;
  readonly init: ResponseInit;
}
