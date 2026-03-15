# HTTP Adapter 재설계 계획

## 1. 현재 상태

### 1.1 수치

| 영역 | 파일 수 | LOC |
|------|---------|-----|
| `router/` (자체 구현) | 35 | 3,663 |
| `middlewares/` (cors, query-parser) | 14 | ~800 |
| `route-handler.ts` | 1 | 791 |
| `http-adapter.ts` | 1 | 558 |
| `http-server.ts` | 1 | 148 |
| `http-request.ts` | 1 | 65 |
| `http-response.ts` | 1 | 259 |
| `adapter/` (context 레이어) | 5 | ~120 |
| `decorators/` | 10 | ~300 |
| `errors/` | 30+ | ~600 |
| `utils/` (ip 관련) | 4 | ~300 |
| `types.ts` + `interfaces.ts` + `enums.ts` | 3 | ~340 |
| 기타 (constants, worker, body-json.d.ts) | 3 | ~50 |

### 1.2 SRP 위반 분석

#### `HttpAdapter` (558 LOC) — 5개 책임 혼재

| 책임 | 메서드 | 판정 |
|------|--------|------|
| 파이프라인 훅 (parseInput, resolveHandler, handleResult) | 핵심 계약 | **유지** |
| 응답 직렬화 (writeSuccessResponse, writeErrorResponse) | ~60 LOC 무상태 로직 | **유지** (private 메서드. 상태 없으므로 별도 클래스 불필요) |
| JSON 검증 (isJsonValue, isZipbulArray, isZipbulRecord) | ~40 LOC | **삭제** (`rawReq.json()` 성공 시 이미 valid JSON) |
| 메타데이터 변환 (normalizeMetadataRegistry + 4개 helper) | ~60 LOC | **삭제** (AOT가 담당) |
| 서버 라이프사이클 (start, stop, cluster) | | `HttpServer`에 있어야 하나 현행 유지 |

#### `RouteHandler` (791 LOC) — 6개 책임 혼재

| 책임 | 메서드 | LOC | 판정 |
|------|--------|-----|------|
| 라우트 등록/매칭 | `register`, `match`, `registerController` | ~100 | **유지** |
| DI 토큰 해석 | `resolveProviderToken`, `extractZipbulTokenRef`, `isTokenCarrier`, `isTokenRecord`, `tryGetFromContainer`, `tryGetFromContainerBySuffix`, `normalizeToken`, `formatTokenLabel` | ~200 | **삭제** (AOT가 담당) |
| 컨트롤러 인스턴스 생성 | `tryCreateControllerInstance`, `resolveControllerConstructor` | ~60 | **삭제** (AOT가 담당) |
| 파라미터 팩토리 생성 | `paramFactory` closure, `normalizeParamKind`, `toRouteHandlerParamType`, `resolveParamType`, `isPrimitiveMetatype` | ~200 | **`param-resolver.ts`로 분리** |
| 미들웨어 수집 | `resolveMiddlewares` | ~35 | **삭제** (AOT가 담당) |
| 에러필터 수집 | `resolveErrorFilterEntries`, `resolveCatchTypes`, `findMetadataByClassName` | ~65 | **삭제** (AOT가 담당) |

#### `adapter/` 디렉토리 — 과도한 추상화 (3단계 간접 참조)

```
HttpServer.fetch() → new HttpContextAdapter(req, res, rawReq)
                   → new HttpContext(adapter)
                        → adapter.getRequest()   // 단순 위임
                        → adapter.getResponse()  // 단순 위임
```

`HttpAdapter` interface 구현체는 1개(`HttpContextAdapter`)뿐. 다형성 없음. `HttpContext`가 `req`/`res`/`rawRequest`를 직접 보유하면 interface + adapter 클래스 + contract interface 삭제 가능.

#### `types.ts` (226 LOC) — 중복 별칭

| 타입 | 실체 | 사용처 | 판정 |
|------|------|--------|------|
| `RouteHandlerValue` | `= RouteHandlerArgument` | `ControllerInstance`, `ContainerInstance` 정의에서 사용 | **`RouteHandlerArgument`로 인라인 후 삭제** |
| `RouteParamValue` | `= RouteHandlerArgument` | `route-handler.ts`, `RouteHandlerEntry.paramFactory` 반환 타입 | **`RouteHandlerArgument`로 인라인 후 삭제** |
| `HttpContextValue` | `≈ RouteHandlerArgument` | 미사용 | **삭제** |
| `AdaptiveRequest` | 미사용 | 없음 | **삭제** |
| `RouteParamKind` | 14개 항목 중 7개가 별칭 | `route-handler.ts` | **정규형 7개만 남김** |
| `HttpMethod` (types.ts) | 문자열 리터럴 유니온 | 전역 사용 | **`enums.ts` HttpMethod와 통합** |

---

## 2. 삭제 대상

### 2.1 디렉토리 단위

| 경로 | LOC | 이유 |
|------|-----|------|
| `src/router/` 전체 | 3,663 | `@zipbul/router`로 대체 |
| `src/middlewares/` 전체 | ~800 | cors, query-parser는 사용자 영역. 프레임워크 코어 아님 |
| `src/adapter/` 전체 | ~120 | `HttpContext` → `src/http-context.ts`로 이동 + 단순화. 나머지 삭제 |

### 2.2 파일 단위

| 파일 | 이유 |
|------|------|
| `adapter/http-adapter.ts` (interface) | `HttpContext`가 직접 req/res 보유 시 불필요 |
| `adapter/http-context-adapter.ts` | 단순 위임 레이어. 구현체 1개뿐 |
| `adapter/interfaces.ts` | `HttpContextContract` → `HttpContext` 자체가 contract |
| `adapter/index.ts` | 디렉토리 삭제 |

### 2.3 코드 단위

| 파일 | 삭제 대상 | 이유 |
|------|-----------|------|
| `http-adapter.ts` | `isJsonValue`, `isZipbulArray`, `isZipbulRecord` (~40 LOC) | 불필요 검증 |
| `http-adapter.ts` | `normalizeMetadataRegistry` + 6개 helper (~60 LOC) | AOT가 정규화 |
| `route-handler.ts` | 토큰 해석군 8개 메서드 (~200 LOC) | AOT가 container key 제공 |
| `route-handler.ts` | `tryCreateControllerInstance` + `resolveControllerConstructor` (~60 LOC) | AOT가 DI 완료 |
| `route-handler.ts` | `resolveMiddlewares` (~35 LOC) | AOT가 수집 |
| `route-handler.ts` | `resolveErrorFilterEntries` + `resolveCatchTypes` + `findMetadataByClassName` (~65 LOC) | AOT가 수집 |
| `route-handler.ts` | `normalizeParamKind` + `toRouteHandlerParamType` (~60 LOC) | AOT가 정규화 |
| `route-handler.ts` | `resolveParamType` (~25 LOC) | AOT가 해석 |

### 2.4 배럴 export 삭제

미배포 상태이므로 breaking change 고려 불필요. 안 쓰는 것은 전부 삭제.

`index.ts`에서 제거:
- `corsMiddleware`, `CorsOptions`, `QueryParser`, `queryParserMiddleware`, `QueryParserOptions` — 미들웨어 삭제
- `HttpContextAdapter` — adapter 레이어 삭제
- `ArgumentMetadata` — 미사용
- `HttpProtocol` — 미사용
- `RouteHandlerEntry` type export — 재정의 후 필요 시 재export

---

## 3. 목표 구조 (SRP 적용)

### 3.1 디렉토리 트리

```
src/
├── http-adapter.ts          # Adapter 서브클래스. 파이프라인 훅 + 응답 직렬화
├── http-server.ts           # Bun.serve 라이프사이클 + 요청 디스패치
├── http-context.ts          # Context 구현. req/res/rawRequest 직접 보유
├── http-request.ts          # 요청 DTO
├── http-response.ts         # 응답 빌더 + 직렬화
├── route-handler.ts         # 라우트 등록/매칭 (@zipbul/router 래퍼)
├── param-resolver.ts        # 파라미터 팩토리 생성 (decorator → req 값 매핑)
├── adapter-definition.ts    # defineAdapter(HttpAdapter) — AOT용
├── http-worker.ts           # Worker 스크립트 (cluster)
│
├── decorators/              # 데코레이터
│   ├── class.decorator.ts
│   ├── method.decorator.ts
│   ├── parameter.decorator.ts
│   ├── constants.ts
│   ├── enums.ts             # MetadataKey enum
│   ├── interfaces.ts        # RestControllerDecoratorOptions 등
│   ├── types.ts             # RouteHandlerParamType
│   └── index.ts
│
├── errors/                  # HTTP 에러 클래스 (변경 없음)
│   ├── http-error.ts
│   ├── bad-request.error.ts
│   ├── ...
│   └── index.ts
│
├── utils/                   # IP 해석 (291 LOC — 유지)
│   ├── ip.ts
│   ├── interfaces.ts
│   └── index.ts
│
├── enums.ts                 # HttpMethod, HeaderField, ContentType
├── interfaces.ts            # HttpServerOptions, RouteHandlerEntry, HttpWorkerResponse
├── types.ts                 # 정리된 타입
├── constants.ts             # HTTP_CONTEXT_TYPE
├── body-json.d.ts           # Bun body.json() 타입 오버라이드
└── index.ts                 # 배럴
```

### 3.2 클래스별 책임 (SRP)

#### `HttpAdapter` — 파이프라인 훅 + 응답 변환

```
책임: Adapter 추상 클래스의 프로토콜 훅 구현
의존: HttpContext, RouteHandler
```

- `parseInput(context)` — body 파싱
- `resolveHandler(context)` — 라우트 매칭 → 핸들러 호출
- `handleResult(result, context)` — 성공/에러 응답 작성
- `forceCloseConnection(context)` — 500 응답
- `runExceptionFilters(error, context)` — 라우트 필터 우선 체크
- `start(context)` / `stop()`

`writeSuccessResponse`, `writeErrorResponse`는 private 메서드로 유지. 무상태 ~60 LOC이므로 별도 클래스(`ResponseWriter`)로 분리하지 않는다. 프로젝트 가이드라인: "Class 사용 기준: 상태 캡슐화" — 상태 없는 클래스는 만들지 않는다.

삭제: `isJsonValue` 계열, `normalizeMetadataRegistry` 계열

#### `HttpServer` — Bun 서버 라이프사이클

```
책임: Bun.serve 생성, 요청 수신 → HttpContext 생성 → adapter.dispatchRequest
의존: HttpRequest, HttpResponse, HttpContext, HttpAdapter
```

- `boot(options, adapter)` — 서버 시작. 파라미터 시그니처 변경 (아래 3.5 참고)
- `fetch(req)` — URL 파싱 1회, HttpRequest/HttpResponse 생성, 디스패치
- `toResponse(workerRes)` — 내부 응답 → native Response

#### `HttpContext` — 요청 컨텍스트

```
책임: 단일 요청의 req/res/rawRequest를 보유하는 Context 구현
의존: HttpRequest, HttpResponse
```

생성자 변경:
```typescript
// Before (3단계 간접)
const contextAdapter = new HttpContextAdapter(req, res, rawReq);
const context = new HttpContext(contextAdapter);

// After (직접 보유)
const context = new HttpContext(req, res, rawReq);
```

- `request` / `response` / `rawRequest` — 직접 프로퍼티
- `routeErrorFilters` — 라우트별 에러필터
- `to(ctor)` — 타입 캐스트
- `getType()` — `'http'`

삭제: `assertHttpAdapter`, `isHttpAdapter` 타입 가드

#### `RouteHandler` — 라우트 레지스트리

```
책임: @zipbul/router 위에 라우트 등록/매칭
의존: @zipbul/router, ParamResolver, ZipbulContainer
```

- `register(metadataRegistry, scopedKeys)` — 메타데이터에서 라우트 추출 → `router.add(method, path, entry)`
- `match(method, path)` — `router.match(method, path)` → `MatchOutput<RouteHandlerEntry> | null`
- `registerInternalRoutes(routes)` — 내부 라우트

`@zipbul/router` API 매핑:
```typescript
// Before (callback 패턴)
this.router.add(method, path, params => ({ entry, params }));
const result = this.router.match(method, path);
// result = { entry, params }

// After (value 패턴)
this.router.add(method, path, entry);
const result = this.router.match(method, path);
// result = { value: entry, params, meta } | null
```

`MatchResult` 타입 변경: `{ entry, params }` → `@zipbul/router`의 `MatchOutput<RouteHandlerEntry>` 사용. `matchResult.entry` → `matchResult.value`.

AOT 확장 후: `register(compiledHandlers: CompiledHandlerEntry[])` — 단순 루프

#### `ParamResolver` (신규) — 파라미터 해석

```
책임: 메서드 파라미터 메타데이터 → paramFactory 함수 생성
의존: @zipbul/baker (deserialize)
```

- `buildParamFactory(paramConfigs)` → `(req, res) => Promise<unknown[]>`

현재 `RouteHandler.registerController` 안의 150 LOC closure + helper를 분리. `normalizeParamKind`, `isPrimitiveMetatype` 등 helper도 함께 이동.

AOT 확장 후 역할 분담:
- AOT: decorator 이름 → ParamKind 정규화 (예: `"Body"` → `"body"`)
- ParamResolver: ParamKind → req 값 추출 (예: `"body"` → `req.body`)

### 3.3 타입 정리

**`types.ts` 목표:**

```typescript
// HttpMethod — @zipbul/shared에서 가져옴 (enums.ts에서 re-export)

export type RequestParamMap = Record<string, string | undefined>;
export type RequestQueryMap = Record<string, RequestQueryValue | undefined>;
export type RequestQueryValue = string | RequestQueryValue[] | Record<string, RequestQueryValue>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type RequestBodyValue = JsonValue;
export type ResponseBodyValue = string | Uint8Array | ArrayBuffer | JsonValue | null;

export type ParamKind =
  | 'body' | 'param' | 'query' | 'header'
  | 'cookie' | 'request' | 'response' | 'ip';

export type HeadersInit = Record<string, string>;
export type HttpWorkerResponseBody = string | Uint8Array | ArrayBuffer | null;

// 기존 RouteHandlerArgument는 유지 (RouteHandlerValue, RouteParamValue는 인라인 후 삭제)
export type RouteHandlerArgument = HttpRequest | HttpResponse | RequestBodyValue | ...;
export type RouteHandlerFunction = (...args: readonly RouteHandlerArgument[]) => ...;
export type ControllerInstance = Record<string, RouteHandlerArgument | RouteHandlerFunction>;
export type ContainerInstance = ...;
```

삭제: `RouteHandlerValue` (→ `RouteHandlerArgument`로 인라인), `RouteParamValue` (→ 동일), `HttpContextValue`, `AdaptiveRequest`, `HttpContextConstructor`, `DecoratorTarget`, `DecoratorPropertyKey`, `RouteDecoratorArgument`, `MiddlewareOptions`

**`interfaces.ts` 목표:**

```typescript
export interface HttpServerOptions {
  readonly port?: number;
  readonly bodyLimit?: number;
  readonly trustProxy?: boolean;
  readonly workers?: number;
  readonly reusePort?: boolean;
}

export interface HttpServerBootParams {
  readonly container: ZipbulContainer;
  readonly metadata?: Map<MetadataRegistryKey, ClassMetadata>;
  readonly scopedKeys?: Map<ProviderToken, string>;
  readonly internalRoutes?: readonly InternalRouteEntry[];
  readonly errorFilters?: readonly ExceptionFilterToken[];
}

export interface HttpWorkerResponse {
  readonly body: HttpWorkerResponseBody;
  readonly init: ResponseInit;
}

export interface RouteHandlerEntry {
  readonly handler: RouteHandlerFunction;
  readonly middlewares: MiddlewareDefinition[];
  readonly errorFilters: readonly ExceptionFilterEntry[];
  readonly paramFactory: (req: HttpRequest, res: HttpResponse) => Promise<readonly unknown[]>;
}
```

`HttpServerBootOptions` (자기참조) → `HttpServerOptions`(설정) + `HttpServerBootParams`(부트 인자)로 분리. `boot(params: HttpServerBootParams, options: HttpServerOptions, adapter)`.

삭제: `HttpServerBootOptions`, `ArgumentMetadata`, `HttpInternalHost`, `WorkerInitParams`, `WorkerOptions`

### 3.4 `HttpMethod` / `HeaderField` — `@zipbul/shared` 사용 결정

`@zipbul/shared@0.0.11` (npm, 외부 패키지)이 제공하는 것:

| export | 형태 | 내용 |
|--------|------|------|
| `HttpMethod` | **type** (open union) | `'GET' \| 'HEAD' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| 'OPTIONS' \| (string & {})` |
| `HttpHeader` | **enum** | CORS 헤더 10개만 (Origin, Vary, AccessControl*) |
| `HttpStatus` | **enum** | Ok(200), NoContent(204) 2개만 |

**결정:**

| 항목 | 결정 | 이유 |
|------|------|------|
| `HttpMethod` | **`@zipbul/shared`의 `HttpMethod` type 사용** | open union이라 확장 가능. `@zipbul/router`도 이미 `@zipbul/shared`를 의존. http-adapter의 `enum HttpMethod`와 `types.ts`의 리터럴 유니온 둘 다 삭제 |
| `HttpHeader` | **http-adapter에서 자체 `HeaderField` enum 유지** | shared의 HttpHeader는 CORS 전용 10개뿐. http-adapter가 필요한 헤더(SetCookie, ContentType, Location, Forwarded, XForwardedFor, XRealIp)와 겹치지 않음 |
| `HttpStatus` | **현행 `http-status-codes` npm 패키지 유지** | shared의 HttpStatus는 2개뿐. 전체 status code가 필요 |

`@zipbul/shared`를 `packages/http-adapter/package.json`의 `dependencies`에 추가 (4.2에 반영).

### 3.5 `enums.ts` 정리

`HttpMethod` enum 삭제 (`@zipbul/shared`의 type으로 대체). `HttpProtocol` 삭제 (미사용). CORS 전용 헤더 삭제.

```typescript
export enum HeaderField {
  SetCookie = 'set-cookie',
  ContentType = 'content-type',
  Location = 'location',
  Forwarded = 'forwarded',
  XForwardedFor = 'x-forwarded-for',
  XRealIp = 'x-real-ip',
}

export enum ContentType {
  Text = 'text/plain',
  Json = 'application/json',
}

// HttpMethod — @zipbul/shared에서 re-export
export type { HttpMethod } from '@zipbul/shared';
```

삭제:
- `enum HttpMethod` — `@zipbul/shared`의 `type HttpMethod`로 대체
- `HeaderField.Origin`, `HeaderField.Vary` — CORS 전용
- `HeaderField.AccessControl*` 전체 (8개) — CORS 전용
- `HttpProtocol` enum — 미사용

### 3.6 크로스 패키지 의존: `@zipbul/scalar` 내부 라우트

**현재 구조:**
```
Scalar (Configurer) → AdapterCollection.http.get(name) → adapter[Symbol.for('zipbul:http:internal')]
```

Scalar는 http-adapter를 직접 import하지 않는다. `dependsOn` 패턴과 `AdapterCollection`을 통해 런타임에 어댑터 인스턴스를 얻고, Symbol.for로 duck-type 접근한다.

**문제:** Symbol.for는 비공식 프로토콜. 타입 안전하지 않고, 어댑터 API를 거치지 않는 우회.

**설계 방향:** `HttpAdapter`에 public 메서드로 내부 라우트 등록 API를 노출. Symbol.for 제거.

```typescript
// HttpAdapter
public registerInternalRoute(method: string, path: string, handler: InternalRouteHandler): void {
  this.internalRoutes.push({ method, path, handler });
}
```

Scalar는 `AdapterCollection`으로 인스턴스를 얻은 뒤 이 메서드를 호출:
```typescript
// scalar/setup.ts
const httpAdapter = adapters.http.get('zipbul-http');
httpAdapter.registerInternalRoute('GET', '/api-docs', handler);
```

이 변경은 http-adapter + scalar 동시 수정. Phase 1 Step으로 포함.

### 3.6 기존 버그

`http-adapter.ts:77` — `handlers` 파라미터명인데 `handler`(단수)로 push. 사전 수정 필요:
```typescript
// Before (버그)
get: (path: string, handlers: InternalRouteHandler) => {
  this.internalRoutes.push({ method: 'GET', path, handler }); // handler는 미정의
},

// After
get: (path: string, handler: InternalRouteHandler) => {
  this.internalRoutes.push({ method: 'GET', path, handler });
},
```

### 3.7 `HttpResponse` 직렬화 경로 단일화

현재 두 경로:
1. `build()` (line 175-181): content-type이 JSON이면 `JSON.stringify(body)` → `setBody(string)`
2. `normalizeWorkerBody()` (line 238-240): fallback으로 object에 `JSON.stringify`

실제로 동일 요청에서 double stringify는 발생하지 않는다 (build가 stringify하면 body가 string이 되어 normalizeWorkerBody는 passthrough). 그러나 이 불변성이 코드 구조가 아닌 실행 순서 우연에 의존.

수정 방향: `build()`를 body 직렬화의 유일한 권한자로 만든다. `normalizeWorkerBody()`는 primitive 변환만 수행하고, object를 받으면 에러(build가 직렬화에 실패했다는 의미).

---

## 4. 의존성 정리

### 4.1 루트 `package.json`

| 패키지 | 현재 | 변경 |
|--------|------|------|
| `@zipbul/baker` | 루트 `dependencies` | **삭제** (이미 `common`, `core`에 선언) |
| `@zipbul/router` | 루트 `dependencies` | **삭제** |

### 4.2 `packages/http-adapter/package.json`

| 패키지 | 현재 | 변경 |
|--------|------|------|
| `@zipbul/router` | 없음 | **`dependencies`에 추가** (구현 디테일) |
| `@zipbul/shared` | 없음 | **`dependencies`에 추가** (`HttpMethod` type 사용) |
| `http-status-codes` | `dependencies` | 유지 |
| `@zipbul/baker` | `peerDependencies` | 유지 |
| `@zipbul/common` | `peerDependencies` (workspace:*) | 유지 |
| `@zipbul/core` | `peerDependencies` (workspace:*) | 유지 |
| `@zipbul/logger` | `peerDependencies` (workspace:*) | 유지 |

---

## 5. AOT 컴파일러 확장 (중기, 어댑터 중립)

### 5.1 원칙

- 컴파일러는 프로토콜을 모른다
- decorator 이름과 인자를 **있는 그대로** 전달
- 토큰 해석, container key 생성, 경로 resolve만 컴파일 타임에 완료
- 어댑터가 decorator 이름의 의미를 런타임에 해석

### 5.2 현재 AOT 출력

```typescript
registerRuntimeContext({
  container: __container__,
  metadataRegistry,     // Map<ClassRef, raw ClassMetadata> — 해석 안 된 상태
  scopedKeys,           // Map<ClassRef|string, 'Module::Class'>
  isAotRuntime: true,
  adapterConfig,        // { 'HttpAdapter': { middlewares, errorFilters } }
});
```

`handlerIndex`는 manifest.json에 ID 문자열 목록으로만 존재:
```json
{ "handlerIndex": [{ "id": "HttpAdapter:src/user.controller.ts#UserController.findAll" }] }
```

### 5.3 확장 목표

`handlerIndex`를 런타임 실행 가능한 resolved 레지스트리로 확장:

```typescript
interface CompiledHandlerEntry {
  readonly adapterId: string;                  // "HttpAdapter"
  readonly controllerKey: string;              // "AppModule::UserController" — container.get()용
  readonly methodName: string;                 // "findAll"
  readonly handlerDecorator: string;           // "Get" — 이름만. 의미는 어댑터가 해석
  readonly handlerDecoratorArgs: unknown[];    // ["/users"] — 어댑터가 해석
  readonly params: CompiledParamEntry[];
  readonly middlewareRefs: unknown[];          // resolve된 MiddlewareDefinition 참조
  readonly errorFilterKeys: string[];          // container keys
}

interface CompiledParamEntry {
  readonly name: string;              // 파라미터 변수명
  readonly decoratorName?: string;    // "Body", "Param" 등 — 어댑터가 해석
  readonly decoratorArgs?: unknown[];
  readonly metatypeKey?: string;      // container key 또는 "string", "number" 등
}
```

어댑터 중립인 이유:
- HTTP 어댑터: `handlerDecorator: "Get"` → GET method, `decoratorArgs[0]` → path
- WebSocket 어댑터: `handlerDecorator: "OnMessage"` → message event
- 컴파일러는 "Get"이 HTTP GET인지 모름. 문자열일 뿐

### 5.4 설계 결정 필요 사항

#### 5.4.1 `controllerKey` 해석 — ModuleGraph 접근 필요

현재 `AdapterDefinitionResolver.resolve()`는 `{ fileMap, projectRoot }`만 받는다. `controllerKey`(예: `"AppModule::UserController"`)를 생성하려면 `ModuleGraph` 접근이 필요하나, resolver는 graph를 받지 않는다.

선택지:
1. `AdapterResolveParams`에 `ModuleGraph` 또는 `scopedKeysMap` 추가
2. `buildHandlerIndex()`를 `ManifestGenerator`로 이동 (이미 graph 접근 가능)
3. `build.command.ts`에서 후처리: resolver가 className만 수집 → manifest generator가 controllerKey를 붙임

**권장: 선택지 3.** resolver는 adapter-neutral한 수집만, key 해석은 graph를 가진 generator가 담당. 관심사 분리 유지.

#### 5.4.2 런타임 노출 채널

현재 `RuntimeContext`에 `handlerIndex` 필드 없음.

선택지:
1. `RuntimeContext`에 `handlerIndex` 추가 (core 패키지 변경)
2. `runtime.ts`에서 standalone export → 어댑터가 직접 import

**권장: 선택지 1.** 기존 `adapterConfig`도 `RuntimeContext`를 통해 노출되는 패턴. 일관성.

#### 5.4.3 metadataRegistry와 handlerIndex 중복

확장 후 method/parameter 메타데이터가 양쪽에 존재:
- `metadataRegistry`: 전체 ClassMetadata (DTO validation, 프로퍼티 메타 등)
- `handlerIndex`: 핸들러 메서드 메타 (subset)

원칙: **handlerIndex = 핸들러 등록 전용. metadataRegistry = DTO/프로퍼티 validation 전용.** 어댑터는 핸들러 등록 시 metadataRegistry의 methods를 읽지 않는다.

### 5.5 컴파일러 변경 범위

**`packages/cli/src/compiler/` 내부 (~5 파일):**

| 파일 | 변경 |
|------|------|
| `analyzer/interfaces.ts` | `HandlerIndexEntry` 확장 (methodName, params 등 추가) |
| `analyzer/adapter-definition-resolver.ts` | `buildHandlerIndex()`에서 method/param 메타 수집 |
| `analyzer/graph/interfaces.ts` | `AdapterResolveParams` 변경 없음 (선택지 3 시) |
| `generator/manifest-generator.ts` | handlerIndex 코드 생성 → runtime.ts에 export |
| `generator/interfaces.ts` | `HandlerIndexEntry` 참조 업데이트 |

**`packages/cli/src/bin/` (~2 파일):**

| 파일 | 변경 |
|------|------|
| `build.command.ts` | resolver 결과와 graph를 조합하여 controllerKey 해석 |
| `dev.command.ts` | 동일 |

**`packages/common/` (~1 파일):**

| 파일 | 변경 |
|------|------|
| 신규 interface 파일 | `CompiledHandlerEntry`, `CompiledParamEntry` 정의 |

**`packages/core/` (~2 파일):**

| 파일 | 변경 |
|------|------|
| `runtime/interfaces.ts` | `RuntimeContext`에 `handlerIndex` 추가 |
| `runtime/runtime-context.ts` | 새 필드 처리 |

합계: ~10 파일. 컨테이너드 변경.

---

## 6. 실행 순서

```
Phase 1: 삭제 + 교체
├── Step 1: 의존성 정리 (루트 deps 제거, http-adapter에 @zipbul/router + @zipbul/shared 추가)
├── Step 2: router/ 삭제 → @zipbul/router 적용
├── Step 3: middlewares/ 삭제
├── Step 4: adapter/ 레이어 제거 → HttpContext 단순화 (src/http-context.ts)
├── Step 5: Symbol.for 내부 라우트 → public 메서드 전환 (http-adapter + scalar 동시)
├── Step 6: HttpMethod → @zipbul/shared type 전환, enums 정리
├── Step 7: index.ts 배럴 정리 (삭제된 export 제거)
├── Step 8: 기존 버그 수정 (http-adapter.ts:77 handler 변수명)
└── Step 9: examples/ import 경로 확인 및 조정

Phase 2: SRP 리팩토링 (http-adapter 패키지 내부)
├── Step 10: ParamResolver 분리 (RouteHandler에서)
├── Step 11: HttpAdapter 정리 (isJsonValue 삭제, metadata 변환 삭제)
├── Step 12: HttpServer 정리 (URL 이중파싱 제거, HttpServerBootParams 도입)
├── Step 13: HttpResponse 직렬화 경로 단일화 (build()가 유일한 직렬화 권한)
├── Step 14: 타입 정리 (별칭 인라인, 미사용 삭제)
└── Step 15: 미사용 코드 삭제 (knip 실행으로 검증)

Phase 3: AOT 확장 (cli + common + core + http-adapter)
├── Step 16: CompiledHandlerEntry/CompiledParamEntry 인터페이스 정의 (common)
├── Step 17: RuntimeContext에 handlerIndex 추가 (core)
├── Step 18: AdapterDefinitionResolver.buildHandlerIndex 확장 (cli)
├── Step 19: ManifestGenerator에서 handlerIndex를 runtime.ts에 export (cli)
├── Step 20: build/dev command에서 controllerKey 후처리 (cli)
└── Step 21: RouteHandler를 CompiledHandlerEntry 기반으로 최종 단순화 (http-adapter)
```

Phase 1은 http-adapter + scalar + 루트 패키지 변경.
Phase 2는 http-adapter 내부만.
Phase 3는 cli + common + core + http-adapter 연동.
Phase 1 내부 Step은 순서대로. Phase 2 내부 Step은 대부분 병렬 가능.
Phase 3는 Phase 2 완료 후.
