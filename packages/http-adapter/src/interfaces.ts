import type {
  ApplicationOptions,
  CompiledHandlerEntry,
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
import type { ForbiddenHttpMethod } from './http-method';

/**
 * Maps a tuple of method strings, replacing any element whose uppercase form
 * is a {@link ForbiddenHttpMethod} (`'TRACE'` / `'CONNECT'`) with `never`.
 *
 * Used to reject forbidden methods at compile time when users pass literal
 * (or `as const`) arrays to `customMethods`. Computed runtime arrays bypass
 * this check and are caught by the boot-time validator.
 *
 * @public
 */
export type SafeCustomMethods<T extends readonly string[]> = {
  readonly [K in keyof T]: Uppercase<T[K] & string> extends ForbiddenHttpMethod ? never : T[K];
};

/**
 * TLS configuration for the HTTP server.
 * Accepts a single `TLSOptions` or an array for SNI (multi-domain hosting),
 * where each entry specifies its own `serverName`.
 *
 * @public
 */
export type HttpTlsOptions =
  | import('bun').TLSOptions
  | readonly import('bun').TLSOptions[];

export interface HttpServerOptions extends ApplicationOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly bodyLimit?: number;
  /** Maximum request URI length in bytes. Exceeding requests receive 414. Default: 8192. */
  readonly maxUriLength?: number;
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
}

export interface HttpWorkerEntryModule {
  readonly className: string;
  readonly manifestPath?: string;
}

export interface HttpWorkerInitParams {
  readonly entryModule: HttpWorkerEntryModule;
  readonly options: HttpServerOptions;
}

