import type {
  MiddlewareDefinition,
  Class,
  ClassToken,
  PrimitiveArray,
  PrimitiveRecord,
  ProviderToken,
} from '@zipbul/common';
import type { TokenRecord } from '@zipbul/core';

import type { HttpMethod } from '../enums';
import type { HttpContext } from '../http-context';
import type {
  RequestQueryArray,
  RequestQueryRecord,
  JsonArray,
  JsonObject,
  TokenCarrier,
  MatchRouteResult,
  MatchRouteNotFound,
  MatchRouteMethodNotAllowed,
} from '../interfaces';

export type HeadersInit = Headers | Array<[string, string]> | Record<string, string>;

export type RequestParamMap = Record<string, string | undefined>;

export type RequestQueryValue = string | RequestQueryArray | RequestQueryRecord;

export type RequestQueryMap = Record<string, RequestQueryValue | undefined>;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type RequestBodyValue = JsonValue | string | ReadableStream<Uint8Array> | undefined;

export type ResponseBodyValue =
  | JsonValue | string | Uint8Array | ArrayBuffer
  | ReadableStream<Uint8Array> | Blob
  | null;

export type RouteHandlerResult = Response | AsyncIterable<unknown> | RequestBodyValue | bigint | null | undefined | void;

export type RouteHandlerFunction = (ctx: HttpContext) => RouteHandlerResult | Promise<RouteHandlerResult>;

export type ControllerInstance = Record<string, unknown>;

export type ContainerInstance =
  | ControllerInstance
  | RouteHandlerFunction
  | null
  | undefined;

export type ControllerConstructor = Class<ControllerInstance>;

export type MetadataRegistryKey = ClassToken;

export type ParamTypeReference = ProviderToken;

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

export type TrustProxyConfig =
  | boolean
  | number
  | string
  | readonly string[]
  | ((ip: string, hopIndex: number) => boolean);

export type MatchRouteOutput = MatchRouteResult | MatchRouteNotFound | MatchRouteMethodNotAllowed;

export type HttpTlsOptions =
  | import('bun').TLSOptions
  | readonly import('bun').TLSOptions[];

export type InternalRouteMethod = 'GET';

export type InternalRouteHandler = (ctx: HttpContext) => RouteHandlerResult;

export type HttpMethodToken = HttpMethod | (string & {});
