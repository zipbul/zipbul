import type {
  ApplicationOptions,
  CompiledHandlerEntry,
  ZipbulContainer,
  ExceptionFilterEntry,
  MiddlewareDefinition,
  Class,
  Context,
  ExceptionFilterToken,
  ProviderToken,
} from '@zipbul/common';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type {
  ClassMetadata,
  ControllerConstructor,
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
  readonly workers?: number;
  readonly reusePort?: boolean;
  readonly errorFilters?: readonly ExceptionFilterToken[];
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
  readonly options?: HttpServerOptions;
  readonly metadata?: Map<MetadataRegistryKey, ClassMetadata>;
  readonly scopedKeys?: Map<ProviderToken, string>;
  readonly internalRoutes?: readonly InternalRouteEntry[];
  readonly errorFilters?: readonly ExceptionFilterToken[];
  readonly logger?: unknown;
  readonly handlerIndex?: readonly CompiledHandlerEntry[];
  readonly controllerInstances?: Map<string, unknown>;
}

export interface HttpAdapterStartContext extends Context {
  readonly container: ZipbulContainer;
  readonly entryModule?: Class;
}

export interface HttpWorkerEntryModule {
  readonly path?: string;
  readonly className: string;
  readonly manifestPath?: string;
  readonly manifest?: HttpWorkerManifest;
}

export interface HttpWorkerInitParams {
  readonly entryModule: HttpWorkerEntryModule;
  readonly options: HttpServerOptions;
}

export interface HttpWorkerManifest {
  createContainer(): ZipbulContainer;
  createMetadataRegistry?(): Map<ControllerConstructor, ClassMetadata>;
  createScopedKeysMap?(): Map<ProviderToken, string>;
  registerDynamicModules?(container: ZipbulContainer): Promise<void> | void;
}

export interface HttpWorkerResponse {
  readonly body: HttpWorkerResponseBody;
  readonly init: ResponseInit;
}

export interface RouteHandlerEntry {
  readonly handler: RouteHandlerFunction;
  readonly methodName: string;
  readonly middlewares: MiddlewareDefinition[];
  readonly errorFilters: readonly ExceptionFilterEntry[];
  readonly paramFactory: (req: HttpRequest, res: HttpResponse) => Promise<readonly RouteParamValue[]>;
}
