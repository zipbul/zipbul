import type {
  MiddlewareDefinition,
  Class,
  ClassToken,
  GuardHandlerFn,
  PrimitiveArray,
  PrimitiveRecord,
  ProviderToken,
} from '@zipbul/common';
import type { ResolvedExceptionFilter, ResolvedMiddleware, ResolvedValidationEntry } from '@zipbul/core';
import { StatusCodes } from 'http-status-codes';

import type { HttpContext } from './http-context';

import type { HttpMethod } from '@zipbul/shared';

export type { HttpMethod };
export { StatusCodes };

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

export interface ContentTypeInfo {
  readonly mediaType: string;
  readonly charset: string | null;
  readonly boundary: string | null;
  readonly params: ReadonlyMap<string, string>;
}

export interface HttpRequestData {
  readonly requestId: string;
  readonly originalMethod: HttpMethod;
  readonly originalUrl: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly path: string;
  readonly headers: Headers;
  readonly protocol: string | null;
  readonly host: string | null;
  readonly hostname: string | null;
  readonly port: number;
  readonly queryString: string | null;
  readonly contentType: ContentTypeInfo | null;
  readonly contentLength: number | null;
  readonly ip: string | null;
  readonly ips: readonly string[];
  readonly isTrustedProxy: boolean;
  readonly signal: AbortSignal;
}

export interface ErrorResponseData {
  readonly status: StatusCodes;
  readonly message: string;
  readonly errors?: readonly JsonValue[];
}

export type RequestBodyValue = JsonValue | string | ReadableStream<Uint8Array> | undefined;

export type ResponseBodyValue =
  | JsonValue | string | Uint8Array | ArrayBuffer
  | ReadableStream<Uint8Array> | Blob
  | null;

export type RouteHandlerResult = Response | AsyncIterable<unknown> | RequestBodyValue | bigint | null | undefined | void;

export type RouteHandlerFunction = (ctx: HttpContext) => RouteHandlerResult | Promise<RouteHandlerResult>;

export type { ResolvedValidationEntry };

export interface MatchedRouteMetadata {
  /** rawBody 캡처 활성화 여부 */
  readonly rawBody: boolean;
  /** SSE 엔드포인트 여부 (@Sse 데코레이터) */
  readonly sse: boolean;
  /** 라우트별 body 크기 제한 (bytes). undefined이면 전역 bodyLimit 적용 */
  readonly bodyLimit: number | undefined;
  /** @Status 데코레이터 기본 상태 코드 */
  readonly status: number | undefined;
  /** @Redirect 데코레이터 정적 리다이렉트 */
  readonly redirect: { readonly url: string; readonly status?: 301 | 302 | 303 | 307 | 308 } | undefined;
  /** @ContentType 데코레이터 기본 Content-Type */
  readonly contentType: string | undefined;
  /** @Header 데코레이터 정적 응답 헤더 */
  readonly headers: readonly (readonly [string, string])[];
  /** 라우트에 등록된 미들웨어 */
  readonly middlewares: readonly ResolvedMiddleware[];
  /** 라우트에 등록된 가드 */
  readonly guards: readonly GuardHandlerFn[];
  /** 라우트에 등록된 예외 필터 */
  readonly exceptionFilters: readonly ResolvedExceptionFilter[];
  /** 핸들러 함수 — 항상 `(ctx: HttpContext)` 단일 시그니처 */
  readonly handler: RouteHandlerFunction;
  /** AOT에서 추출된 Validated<T> 접근 목록. 빈 배열이면 검증 없음 */
  readonly validations: readonly ResolvedValidationEntry[];
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

export type MatchRouteOutput = MatchRouteResult | MatchRouteNotFound | MatchRouteMethodNotAllowed;

export type ControllerInstance = Record<string, unknown>;

export type ContainerInstance =
  | ControllerInstance
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

export interface DecoratorMetadata {
  readonly name: string;
  readonly arguments?: readonly DecoratorArgument[];
}

export interface ConstructorParamMetadata {
  readonly type?: ParamTypeReference;
  readonly decorators?: readonly DecoratorMetadata[];
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

export type TrustProxyConfig =
  | boolean
  | number
  | string
  | readonly string[]
  | ((ip: string, hopIndex: number) => boolean);

export interface RequestIdOptions {
  /** 수신 요청에서 기존 ID를 추출할 헤더명 */
  header?: string;
  /** 헤더에 ID가 없을 때 생성 함수. 기본 crypto.randomUUID() */
  generate?: () => string;
}
