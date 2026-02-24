import type {
  ExceptionFilter,
  ZipbulMiddleware,
  ZipbulRecord,
  ZipbulValue,
  Class,
  ClassToken,
  Context,
  MiddlewareRegistration,
  MiddlewareToken,
  PrimitiveArray,
  PrimitiveRecord,
  ProviderToken,
} from '@zipbul/common';
import type { CookieMap } from 'bun';

import type { ZipbulRequest } from './zipbul-request';
import type { ZipbulResponse } from './zipbul-response';
import type { RouteHandlerEntry } from './interfaces';

export type RouteKey = number;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export type HeadersInit = Headers | Array<[string, string]> | Record<string, string>;

export type HttpWorkerRpcCallable = (...args: ReadonlyArray<ZipbulValue>) => ZipbulValue | Promise<ZipbulValue>;

export type HttpWorkerRpc = Record<string, HttpWorkerRpcCallable>;

export type RequestParamMap = Record<string, string | undefined>;

export interface RequestQueryArray extends Array<RequestQueryValue> {}

export interface RequestQueryRecord extends Record<string, RequestQueryValue> {}

export type RequestQueryValue = string | RequestQueryArray | RequestQueryRecord;

export type RequestQueryMap = Record<string, RequestQueryValue | undefined>;

export type JsonPrimitive = string | number | boolean | null;

export interface JsonArray extends Array<JsonValue> {}

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type RequestBodyValue = JsonValue;

export type ResponseBodyValue = RequestBodyValue | string | Uint8Array | ArrayBuffer | null;

export interface HttpMiddlewareInstance extends ZipbulRecord {
  handle(context: Context, options?: MiddlewareOptions): void | boolean | Promise<void | boolean>;
}

export interface HttpMiddlewareConstructor<TOptions = MiddlewareOptions> extends Class<HttpMiddlewareInstance> {
  new (options?: TOptions): HttpMiddlewareInstance;
}

export type HttpMiddlewareToken<_TOptions = MiddlewareOptions> = Class<HttpMiddlewareInstance> | symbol;

export interface HttpMiddlewareRegistration<TOptions = MiddlewareOptions> {
  token: HttpMiddlewareToken<TOptions>;
  options?: TOptions;
}

export interface ZipbulRequestInit {
  readonly url: string;
  readonly httpMethod: HttpMethod;
  readonly headers: HeadersInit;
  readonly requestId?: string;
  readonly params?: RequestParamMap;
  readonly query?: RequestQueryMap;
  readonly body?: RequestBodyValue;
  readonly isTrustedProxy?: boolean;
  readonly ip?: string | null;
  readonly ips?: string[];
}

export interface AdaptiveRequest {
  httpMethod: HttpMethod;
  url: string;
  headers: HeadersInit;
  body?: RequestBodyValue;
  queryParams: RequestQueryMap;
  params: RequestParamMap;
  ip: string;
  ips: string[];
  isTrustedProxy: boolean;
  query?: RequestQueryMap;
}

export type HttpWorkerResponseBody = string | Uint8Array | ArrayBuffer | null;

export type RouteHandlerArgument =
  | ZipbulRequest
  | ZipbulResponse
  | RequestBodyValue
  | RequestParamMap
  | RequestQueryMap
  | Headers
  | CookieMap
  | bigint
  | symbol
  | null
  | undefined;

export type RouteHandlerResult = ZipbulResponse | Response | RequestBodyValue | bigint | null | undefined | void;

export type RouteHandlerValue = RouteHandlerArgument;

export type RouteHandlerFunction = (...args: readonly RouteHandlerArgument[]) => RouteHandlerResult | Promise<RouteHandlerResult>;

export type ControllerInstance = Record<string, RouteHandlerValue | RouteHandlerFunction>;

export type ContainerInstance =
  | ZipbulValue
  | ControllerInstance
  | ZipbulMiddleware
  | ExceptionFilter
  | RouteHandlerValue
  | RouteHandlerFunction
  | null
  | undefined;

export type ControllerConstructor = Class<ControllerInstance>;

export type HttpContextValue =
  | ZipbulRequest
  | ZipbulResponse
  | RequestBodyValue
  | RequestParamMap
  | RequestQueryMap
  | Headers
  | CookieMap
  | bigint
  | symbol
  | null
  | undefined;

export type HttpContextConstructor<TContext> = ClassToken<TContext>;

export type MetadataRegistryKey = ClassToken;

export interface TokenRecord {
  readonly __zipbul_ref?: string;
  readonly __zipbul_forward_ref?: string;
  readonly name?: string;
}

export interface TokenCarrier {
  readonly token: ProviderToken;
}

export type DecoratorArgument =
  | ProviderToken
  | TokenRecord
  | TokenCarrier
  | MiddlewareToken
  | MiddlewareRegistration
  | ErrorConstructor
  | PrimitiveArray
  | PrimitiveRecord
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

export type ParamTypeReference = ProviderToken;

export type LazyParamTypeFactory = () => ParamTypeReference;

export type RouteParamType = ParamTypeReference;

export type RouteParamValue = RouteHandlerArgument;

export type RouteParamKind =
  | 'body'
  | 'param'
  | 'params'
  | 'query'
  | 'queries'
  | 'header'
  | 'headers'
  | 'cookie'
  | 'cookies'
  | 'request'
  | 'req'
  | 'response'
  | 'res'
  | 'ip';

export interface ErrorLike {
  readonly name?: string;
  readonly message?: string;
  readonly stack?: string;
}

export type SystemError = Error | ErrorLike | string | number | boolean;

export interface SystemErrorHandlerLike {
  handle(error: SystemError, ctx: Context): void | Promise<void>;
}

export interface ErrorHandlingStageParams {
  readonly error: SystemError;
  readonly stage: string;
  readonly allowBody: boolean;
}

export interface ErrorFilterRunParams {
  readonly error: SystemError;
  readonly ctx: Context;
  readonly entry?: RouteHandlerEntry;
}

export interface ErrorFilterRunResult {
  readonly originalError: SystemError;
  readonly currentError: SystemError;
}

export interface ShouldCatchParams {
  readonly error: SystemError;
  readonly filter: ExceptionFilter<SystemError>;
}

export interface MatchCatchArgumentParams {
  readonly error: SystemError;
  readonly arg: DecoratorArgument;
}

export interface ResolveTokenOptions {
  readonly strict?: boolean;
}

export interface ResolveTokenContext {
  readonly strict: boolean;
  readonly token: string;
}

export type MiddlewareOptions = Record<string, string | number | boolean | null | undefined>;

export type DecoratorTarget = Record<string, string | number | boolean | symbol | null | undefined>;

export type DecoratorPropertyKey = string | symbol;

export type RouteDecoratorArgument = string | MiddlewareOptions | undefined;

export interface DecoratorMetadata {
  readonly name: string;
  readonly arguments?: readonly DecoratorArgument[];
}

export interface ConstructorParamMetadata {
  readonly type?: ParamTypeReference;
  readonly decorators?: readonly DecoratorMetadata[];
}

export interface ParameterMetadata {
  readonly index?: number;
  readonly name?: string;
  readonly type?: ParamTypeReference;
  readonly decorators?: readonly DecoratorMetadata[];
}

export interface MethodMetadata {
  readonly name: string;
  readonly decorators?: readonly DecoratorMetadata[];
  readonly parameters?: readonly ParameterMetadata[];
}

export interface ClassMetadata {
  readonly className?: string;
  readonly decorators?: readonly DecoratorMetadata[];
  readonly methods?: readonly MethodMetadata[];
  readonly constructorParams?: readonly ConstructorParamMetadata[];
}

export interface MatchResult {
  readonly entry: RouteHandlerEntry;
  readonly params: Record<string, string | undefined>;
}

export interface InternalRouteDefinition {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandlerFunction;
}
