import type {
  MiddlewareDefinition,
  ZipbulValue,
  Class,
  ClassToken,
  PrimitiveArray,
  PrimitiveRecord,
  ProviderToken,
} from '@zipbul/common';
import type { CookieMap } from 'bun';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';

import type { HttpMethod } from '@zipbul/shared';

export type { HttpMethod };

export type HeadersInit = Headers | Array<[string, string]> | Record<string, string>;

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

export interface HttpRequestInit {
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

export type HttpWorkerResponseBody = string | Uint8Array | ArrayBuffer | null;

export type RouteHandlerArgument =
  | HttpRequest
  | HttpResponse
  | RequestBodyValue
  | RequestParamMap
  | RequestQueryMap
  | Headers
  | CookieMap
  | bigint
  | symbol
  | null
  | undefined;

export type RouteHandlerResult = HttpResponse | Response | RequestBodyValue | bigint | null | undefined | void;

export type RouteHandlerFunction = (...args: readonly RouteHandlerArgument[]) => RouteHandlerResult | Promise<RouteHandlerResult>;

export type ControllerInstance = Record<string, RouteHandlerArgument | RouteHandlerFunction>;

export type ContainerInstance =
  | ControllerInstance
  | RouteHandlerArgument
  | RouteHandlerFunction
  | null
  | undefined;

export type ControllerConstructor = Class<ControllerInstance>;

export type MetadataRegistryKey = ClassToken;

export interface TokenRecord {
  readonly __zipbul_ref?: string;
  readonly __zipbul_lazy_ref?: string;
  readonly name?: string;
}

export interface TokenCarrier {
  readonly token: ProviderToken;
}

export type DecoratorArgument =
  | ProviderToken
  | TokenRecord
  | TokenCarrier
  | MiddlewareDefinition
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

export interface InternalRouteDefinition {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandlerFunction;
}
