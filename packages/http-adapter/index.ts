import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { HttpAdapter } from './src/http-adapter';
export { adapterDefinition } from './src/adapter-definition';

export { HttpContext } from './src/http-context';

export { HttpRequest } from './src/http-request';
export { HttpResponse } from './src/http-response';

export {
  HttpAdapterPhase,
  HttpAdapterStep,
  ContentType,
  HttpHeader,
  HttpStatus,
  HttpMethod,
} from './src/enums';
export type { HttpMethodToken } from './src/types';

export { HTTP_STATUS_REASON, FORBIDDEN_HTTP_METHODS } from './src/constants';
export { reasonOf } from './src/utils/reason-of';
export { isForbiddenHttpMethod } from './src/utils/is-forbidden-http-method';
export { isHttpAdapterPhase } from './src/utils/is-http-adapter-phase';

export type {
  HttpServerOptions,
  HttpServerBootOptions,
  ContentTypeInfo,
  ErrorResponseData,
  HttpRequestData,
  HttpRequestOrigin,
  MatchedRouteMetadata,
  MatchRouteResult,
  MatchRouteNotFound,
  MatchRouteMethodNotAllowed,
  RequestIdOptions,
  InternalRouteEntry,
} from './src/interfaces';

export type {
  HttpTlsOptions,
  MatchRouteOutput,
  RequestBodyValue,
  ResponseBodyValue,
  RouteHandlerResult,
  RouteHandlerFunction,
  TrustProxyConfig,
  InternalRouteMethod,
  InternalRouteHandler,
} from './src/types';

export type { HttpServerMetrics } from './src/http-server';

export type { ResolvedValidationEntry } from '@zipbul/core';

export { httpError } from './src/http-error';

export { ServerSentEvent, isAsyncIterable, formatSSEChunk } from './src/server-sent-event';
export type { ServerSentEventOptions } from './src/server-sent-event';

export { RestController, Controller } from './src/decorators/class.decorator';
export { Delete, Get, Head, Method, Options, Patch, Post, Put } from './src/decorators/method.decorator';
export { RawBody, Sse, BodyLimit, Status, Redirect, ContentType as ContentTypeDecorator, Header } from './src/decorators/method-option.decorator';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
