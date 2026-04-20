import type {
  MiddlewareDefinition,
  Class,
  ClassToken,
  PrimitiveArray,
  PrimitiveRecord,
  ProviderToken,
} from '@zipbul/common';
import type {
  ResolvedExceptionFilter,
  ResolvedValidationEntry,
  PipelineStepFn,
  TokenRecord,
  ConstructorParamMetadata as CoreConstructorParamMetadata,
} from '@zipbul/core';
import { StatusCodes } from 'http-status-codes';

import type { HttpContext } from './http-context';
import type { HttpResponse } from './http-response';

import type { HttpMethod } from '@zipbul/shared';

export type { HttpMethod };
export { StatusCodes };

/**
 * Strict literal union of every HTTP status code defined in `StatusCodes`.
 *
 * TypeScript's numeric enum type permits silent widening from plain `number`
 * (e.g. `const n: number = 999; fn(n)` compiles against an enum parameter).
 * This derived type closes that hole by expanding the enum into an exact
 * literal union (`100 | 101 | ... | 511`), so any non-enum numeric argument —
 * literal or variable — is rejected at compile time.
 *
 * Use this everywhere a status code is accepted (`setStatus`, `@Status`,
 * `ErrorResponseData.status`, `httpError()`). The runtime value is still
 * a standard number — only the static type is narrowed.
 */
export type HttpStatus = `${StatusCodes}` extends `${infer N extends number}` ? N : never;

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

/**
 * Proxy/origin resolution result from Forwarded / X-Forwarded-* headers.
 *
 * Populated by the HTTP server's proxy trust evaluation logic.
 * All proxy fields are present only when a trusted proxy is detected.
 */
export interface HttpRequestOrigin {
  /** Protocol from URL parsing (e.g. 'http', 'https'). null if absent. */
  readonly urlProtocol: string | null;
  /** Host from URL parsing. null if absent. */
  readonly urlHost: string | null;
  /** Protocol from Forwarded/X-Forwarded-Proto. Present only behind trusted proxy. */
  readonly proxyProtocol?: string | null;
  /** Host from Forwarded/X-Forwarded-Host. Present only behind trusted proxy. */
  readonly proxyHost?: string | null;
  /** Port from Forwarded header. Present only behind trusted proxy. */
  readonly proxyPort?: number | null;
}

/**
 * Raw network-level data for constructing an HttpRequest.
 *
 * Contains only data that comes directly from the network or server configuration.
 * Derived/parsed properties (contentType, protocol, host, port, queryString)
 * are computed lazily by HttpRequest getters from these raw inputs.
 *
 * @public
 */
export interface HttpRequestData {
  /** Pre-assigned request ID (e.g. from upstream header). Omit for lazy generation. */
  readonly requestId?: string;
  /** Header name to read request ID from (e.g. 'X-Request-Id'). */
  readonly requestIdHeaderName?: string;
  /** Custom request ID generator. Falls back to crypto.randomUUID(). */
  readonly requestIdGenerator?: () => string;
  /** Original HTTP method as received. */
  readonly originalMethod: HttpMethod;
  /** Original URL as received (before rewriting). */
  readonly originalUrl: string;
  /** Validated HTTP method (may differ from originalMethod for HEAD→GET). */
  readonly method: HttpMethod;
  /** Request URL (may be rewritten by middleware). */
  readonly url: string;
  /** URL path component (without query string). */
  readonly path: string;
  /** Raw request headers. */
  readonly headers: Headers;
  /** Proxy/origin resolution result. */
  readonly origin: HttpRequestOrigin;
  /** Content-Length header value. null if absent or invalid. */
  readonly contentLength: number | null;
  /** Client IP address (after proxy resolution). null if unresolvable. */
  readonly ip: string | null;
  /** IP chain from X-Forwarded-For (empty if no trusted proxy). */
  readonly ips: readonly string[];
  /** Whether the request came through a trusted proxy. */
  readonly isTrustedProxy: boolean;
  /** Abort signal for the request lifecycle. */
  readonly signal: AbortSignal;
}

export interface ErrorResponseData {
  readonly status: HttpStatus;
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
  /** rawBody 캡처 활성화 여부. */
  readonly rawBody: boolean;
  /** SSE 엔드포인트 여부 (@Sse 데코레이터). */
  readonly sse: boolean;
  /** 라우트별 body 크기 제한 (bytes). undefined이면 전역 bodyLimit 적용. */
  readonly bodyLimit: number | undefined;
  /** @Status 데코레이터 기본 상태 코드. */
  readonly status: number | undefined;
  /** @Redirect 데코레이터 정적 리다이렉트. */
  readonly redirect: { readonly url: string; readonly status?: 301 | 302 | 303 | 307 | 308 } | undefined;
  /** @ContentType 데코레이터 기본 Content-Type. */
  readonly contentType: string | undefined;
  /** @Header 데코레이터 정적 응답 헤더. */
  readonly headers: readonly (readonly [string, string])[];
  /** Boot-time response default applier. */
  readonly applyResponseDefaults?: (response: HttpResponse) => void;
  /** 핸들러 함수 — 항상 `(ctx: HttpContext)` 단일 시그니처. */
  readonly handler: RouteHandlerFunction;
  /** AOT에서 추출된 validation 엔트리 목록. 빈 배열이면 검증 없음. */
  readonly validations: readonly ResolvedValidationEntry[];
  /** Pre-handler step functions. Boot-time resolved from compiledPre. */
  readonly pre: readonly PipelineStepFn[];
  /** Post-handler step functions. Boot-time resolved from compiledPost. */
  readonly post: readonly PipelineStepFn[];
  /** Merged exception filters (handler → controller → module → global). */
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

export type MatchRouteOutput = MatchRouteResult | MatchRouteNotFound | MatchRouteMethodNotAllowed;

export type ControllerInstance = Record<string, unknown>;

export type ContainerInstance =
  | ControllerInstance
  | RouteHandlerFunction
  | null
  | undefined;

export type ControllerConstructor = Class<ControllerInstance>;

export type MetadataRegistryKey = ClassToken;

export type { TokenRecord };

export interface TokenCarrier {
  readonly token: ProviderToken;
}

// http-adapter extends core's DecoratorArgument with protocol-specific types.
// core DecoratorArgument := ProviderToken | TokenRecord | ModuleMetadata | primitive | null | undefined
// http-adapter adds: MiddlewareDefinition, ErrorConstructor, PrimitiveArray, PrimitiveRecord, TokenCarrier
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

/**
 * Same structure as core's DecoratorMetadata but uses http-adapter's
 * wider DecoratorArgument union (includes MiddlewareDefinition, ErrorConstructor, etc.).
 */
export interface DecoratorMetadata {
  readonly name: string;
  readonly arguments?: readonly DecoratorArgument[];
}

export type { CoreConstructorParamMetadata as ConstructorParamMetadata };

export interface MethodMetadata {
  readonly name: string;
  readonly decorators?: readonly DecoratorMetadata[];
}

/**
 * http-adapter's ClassMetadata mirrors CoreClassMetadata structure but uses
 * the wider DecoratorMetadata/DecoratorArgument types.
 * Cannot use `extends CoreClassMetadata` because DecoratorArgument is a superset
 * of core's DecoratorArgument, violating covariance on the `decorators` field.
 *
 * CoreClassMetadata provides: decorators, constructorParams.
 * http-adapter adds: className (used by CLI compiler), methods (used by CLI compiler).
 */
export interface ClassMetadata {
  readonly className?: string;
  readonly decorators?: readonly DecoratorMetadata[];
  readonly methods?: readonly MethodMetadata[];
  readonly constructorParams?: readonly CoreConstructorParamMetadata[];
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
