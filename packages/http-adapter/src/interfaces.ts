import type {
  ApplicationOptions,
  ZipbulContainer,
  ExceptionFilter,
  MiddlewareDefinition,
  ZipbulValue,
  Class,
  Context,
  ExceptionFilterToken,
  ProviderToken,
} from '@zipbul/common';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type { RouteHandlerParamType } from './decorators';
import type {
  ClassMetadata,
  ControllerConstructor,
  RouteHandlerArgument,
  RouteHandlerResult,
  HttpWorkerResponseBody,
  MetadataRegistryKey,
  RouteHandlerFunction,
  RouteParamType,
  RouteParamValue,
  SystemError,
} from './types';

export interface HttpServerOptions extends ApplicationOptions {
  readonly port?: number;
  readonly bodyLimit?: number;
  readonly trustProxy?: boolean;
  readonly workers?: number;
  readonly reusePort?: boolean;
  readonly errorFilters?: readonly ExceptionFilterToken[];
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
  readonly logger?: ZipbulValue;
}

export interface HttpAdapterStartContext extends Context {
  readonly container: ZipbulContainer;
  readonly entryModule?: Class;
}

export interface HttpInternalChannel {
  get(path: string, handler: InternalRouteHandler): void;
}

export type HttpInternalHost = Record<symbol, HttpInternalChannel | undefined>;

export interface WorkerInitParams {
  rootModuleClassName: string;
  options: WorkerOptions;
}

export interface WorkerOptions {}

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
  readonly paramType: RouteHandlerParamType[];
  readonly paramRefs: readonly RouteParamType[];
  readonly controllerClass: ControllerConstructor | null;
  readonly methodName: string;
  readonly middlewares: MiddlewareDefinition[];
  readonly errorFilters: Array<ExceptionFilter<SystemError>>;
  readonly paramFactory: (req: HttpRequest, res: HttpResponse) => Promise<readonly RouteParamValue[]>;
}

export interface ArgumentMetadata {
  type: 'body' | 'query' | 'param' | 'custom';
  metatype?: RouteParamType;
  data?: string;
}
