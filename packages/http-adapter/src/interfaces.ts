import type {
  ApplicationOptions,
  CompiledHandlerEntry,
  ZipbulContainer,
  ResolvedMiddleware,
  ResolvedExceptionFilter,
  Class,
  Context,
  ProviderToken,
  GuardHandlerFn,
} from '@zipbul/common';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type {
  ClassMetadata,
  RouteHandlerArgument,
  RouteHandlerResult,
  HttpWorkerResponseBody,
  MetadataRegistryKey,
  RouteHandlerFunction,
  RouteParamValue,
} from './types';

export interface HttpServerOptions extends ApplicationOptions {
  readonly port?: number;
  readonly bodyLimit?: number;
  readonly trustProxy?: boolean;
  readonly reusePort?: boolean;
  readonly name?: string;
  readonly logLevel?: string;
}

export type InternalRouteMethod = 'GET';

export type InternalRouteHandler = (...args: readonly RouteHandlerArgument[]) => RouteHandlerResult;

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

export interface RouteHandlerEntry {
  readonly handler: RouteHandlerFunction;
  readonly methodName: string;
  readonly middlewares: readonly ResolvedMiddleware[];
  readonly exceptionFilters: readonly ResolvedExceptionFilter[];
  readonly guards: readonly GuardHandlerFn[];
  readonly paramFactory: (req: HttpRequest, res: HttpResponse) => Promise<readonly RouteParamValue[]>;
}
