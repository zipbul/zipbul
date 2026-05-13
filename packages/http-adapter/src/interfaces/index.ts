import type {
  ApplicationOptions,
  CompiledHandlerEntry,
  ProviderToken,
} from '@zipbul/common';
import type {
  ResolvedExceptionFilter,
  ResolvedValidationEntry,
  PipelineStepFn,
  ConstructorParamMetadata,
} from '@zipbul/core';

import type { HttpMethod, HttpStatus } from '../enums';
import type { HttpResponse } from '../http-response';
import type {
  RequestQueryValue,
  JsonValue,
  RouteHandlerFunction,
  DecoratorArgument,
  TrustProxyConfig,
  MetadataRegistryKey,
  HttpTlsOptions,
  InternalRouteHandler,
  InternalRouteMethod,
} from '../types';

export interface RequestQueryArray extends Array<RequestQueryValue> {}

export interface RequestQueryRecord extends Record<string, RequestQueryValue> {}

export interface JsonArray extends Array<JsonValue> {}

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ContentTypeInfo {
  readonly mediaType: string;
  readonly charset: string | null;
  readonly boundary: string | null;
  readonly params: ReadonlyMap<string, string>;
}

/**
 * Proxy/origin resolution result from Forwarded / X-Forwarded-* headers.
 */
export interface HttpRequestOrigin {
  readonly urlProtocol: string | null;
  readonly urlHost: string | null;
  readonly proxyProtocol?: string | null;
  readonly proxyHost?: string | null;
  readonly proxyPort?: number | null;
}

/**
 * Raw network-level data for constructing an HttpRequest.
 */
export interface HttpRequestData {
  readonly requestId?: string;
  readonly requestIdHeaderName?: string;
  readonly requestIdGenerator?: () => string;
  readonly originalMethod: HttpMethod;
  readonly originalUrl: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly path: string;
  readonly headers: Headers;
  readonly origin: HttpRequestOrigin;
  readonly contentLength: number | null;
  readonly ip: string | null;
  readonly ips: readonly string[];
  readonly isTrustedProxy: boolean;
  readonly signal: AbortSignal;
}

export interface ErrorResponseData {
  readonly status: HttpStatus;
  readonly message: string;
  readonly errors?: readonly JsonValue[];
}

export interface MatchedRouteMetadata {
  readonly rawBody: boolean;
  readonly sse: boolean;
  readonly bodyLimit: number | undefined;
  readonly status: number | undefined;
  readonly redirect: { readonly url: string; readonly status?: 301 | 302 | 303 | 307 | 308 } | undefined;
  readonly contentType: string | undefined;
  readonly headers: readonly (readonly [string, string])[];
  readonly applyResponseDefaults?: (response: HttpResponse) => void;
  readonly handler: RouteHandlerFunction;
  readonly validations: readonly ResolvedValidationEntry[];
  readonly pre: readonly PipelineStepFn[];
  readonly post: readonly PipelineStepFn[];
  readonly filters: readonly ResolvedExceptionFilter[];
}

export interface MatchRouteResult {
  readonly kind: 'matched';
  readonly route: MatchedRouteMetadata;
  readonly params: Record<string, string | undefined>;
}

export interface MatchRouteNotFound {
  readonly kind: 'not-found';
}

export interface MatchRouteMethodNotAllowed {
  readonly kind: 'method-not-allowed';
  readonly allowedMethods: readonly string[];
}

export interface TokenCarrier {
  readonly token: ProviderToken;
}

export interface DecoratorMetadata {
  readonly name: string;
  readonly arguments?: readonly DecoratorArgument[];
}

export interface MethodMetadata {
  readonly name: string;
  readonly decorators?: readonly DecoratorMetadata[];
}

export interface ClassMetadata {
  readonly className?: string;
  readonly decorators?: readonly DecoratorMetadata[];
  readonly methods?: readonly MethodMetadata[];
  readonly constructorParams?: readonly ConstructorParamMetadata[];
}

export interface InternalRouteDefinition {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandlerFunction;
}

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
