import type {
  ZipbulApplicationOptions,
  ZipbulContainer,
  ExceptionFilter,
  ZipbulMiddleware,
  ZipbulValue,
  Class,
  Context,
  ExceptionFilterToken,
  ProviderToken,
} from '@zipbul/common';

import type { ZipbulRequest } from './zipbul-request';
import type { ZipbulResponse } from './zipbul-response';
import type { RouteHandlerParamType } from './decorators';
import type {
  ClassMetadata,
  ControllerConstructor,
  HttpMiddlewareRegistration,
  HttpMiddlewareToken,
  RouteHandlerArgument,
  RouteHandlerResult,
  HttpWorkerResponseBody,
  MetadataRegistryKey,
  MiddlewareOptions,
  RouteHandlerFunction,
  RouteParamType,
  RouteParamValue,
  SystemError,
} from './types';

export enum HttpMiddlewareLifecycle {
  BeforeRequest = 'BeforeRequest',
  AfterRequest = 'AfterRequest',
  BeforeHandler = 'BeforeHandler',
  BeforeResponse = 'BeforeResponse',
  AfterResponse = 'AfterResponse',
}

export type MiddlewareRegistrationInput<TOptions = MiddlewareOptions> =
  | HttpMiddlewareRegistration<TOptions>
  | HttpMiddlewareToken<TOptions>;

export type HttpMiddlewareRegistry = Partial<Record<string, readonly MiddlewareRegistrationInput[]>>;

export interface ZipbulHttpServerOptions extends ZipbulApplicationOptions {
  readonly port?: number;
  readonly bodyLimit?: number;
  readonly trustProxy?: boolean;
  readonly workers?: number;
  readonly reusePort?: boolean;
  readonly middlewares?: HttpMiddlewareRegistry;
  readonly errorFilters?: readonly ExceptionFilterToken[];
}

export type InternalRouteMethod = 'GET';

export type InternalRouteHandler = (...args: readonly RouteHandlerArgument[]) => RouteHandlerResult;

export interface InternalRouteEntry {
  readonly method: InternalRouteMethod;
  readonly path: string;
  readonly handler: InternalRouteHandler;
}

export interface ZipbulHttpServerBootOptions extends ZipbulHttpServerOptions {
  readonly options?: ZipbulHttpServerOptions;
  readonly metadata?: Map<MetadataRegistryKey, ClassMetadata>;
  readonly scopedKeys?: Map<ProviderToken, string>;
  readonly internalRoutes?: readonly InternalRouteEntry[];
  readonly middlewares?: HttpMiddlewareRegistry;
  readonly errorFilters?: readonly ExceptionFilterToken[];
  readonly logger?: ZipbulValue;
}

export interface HttpAdapterStartContext extends Context {
  readonly container: ZipbulContainer;
  readonly entryModule?: Class;
}

export interface ZipbulHttpInternalChannel {
  get(path: string, handler: InternalRouteHandler): void;
}

export type ZipbulHttpInternalHost = Record<symbol, ZipbulHttpInternalChannel | undefined>;

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
  readonly options: ZipbulHttpServerOptions;
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
  readonly middlewares: ZipbulMiddleware[];
  readonly errorFilters: Array<ExceptionFilter<SystemError>>;
  readonly paramFactory: (req: ZipbulRequest, res: ZipbulResponse) => Promise<readonly RouteParamValue[]>;
}

export interface ArgumentMetadata {
  type: 'body' | 'query' | 'param' | 'custom';
  metatype?: RouteParamType;
  data?: string;
}

export interface PipeTransform<T = RouteParamValue, R = RouteParamValue> {
  transform(value: T, metadata: ArgumentMetadata): R | Promise<R>;
}
