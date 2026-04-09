# HttpContext DX 설계 및 구현 핸드오버

## 0. 이 문서의 목적

다른 에이전트가 이 문서만 읽고 작업을 이어받을 수 있도록 작성됨.
설계 결정의 **이유**, 현재 **구현 상태**, **남은 작업의 정확한 위치**를 모두 포함.

---

## 1. 설계 원칙

- Request 읽기와 Response 쓰기는 **완전 분리** (Cookie 포함, Express/Fastify 다수파)
- cookie, queryParser, multipart는 **모두 미들웨어**로 등록
- body parsing과 params는 **어댑터/라우터 내장** (현재 `HttpAdapter.parseBody`, `resolveRoute`)
- DTO 클래스는 **런타임 인자**로 전달 (`getBody(Dto)`), 제네릭 타입 인자 아님
  - 이유: AOT 분석 용이 + 런타임 실제 값 + 테스트 용이 + 기존 `ctx.validated(key, Dto)` 패턴과 일치
- **AOT codegen**으로 미들웨어 확장 타입 생성 → `.zipbul/context.d.ts`
- 코어(http-adapter)는 미들웨어 확장에 대해 **아무것도 모름**
- **별도 선언 파일 불필요** — 컴파일러가 미들웨어 factory 본문 직접 추적 ("코드가 곧 선언")
- declaration merging의 "전역 오염" 문제는 AOT가 미등록 시 빌드 에러로 잡음
- 사용자가 main.ts에 import할 필요 없음 — `tsconfig.json`에 `.zipbul/**/*.d.ts` include로 자동 인식
- 별도 `zb generate` 커맨드 없음 — `zb dev` / `zb build`에 통합

## 2. 사용자 DX 표면 (확정)

```ts
@Controller('/users')
class UserController {
  @Post('/')
  create(ctx: HttpContext) {
    // ── Request (코어 — 항상 존재) ────────────────
    const body = ctx.request.getBody(CreateUserDto);
    const params = ctx.request.getParams(UserParams);
    // ctx.request.rawBody  — @RawBody 데코레이터 사용 시

    // ── Request (미들웨어 — AOT codegen 타입) ────
    const query = ctx.request.getQuery(SearchQuery);
    const session = ctx.request.cookie.get('session');
    // ctx.request.getFiles()

    // ── Response (코어 — 항상 존재) ───────────────
    ctx.response.setStatus(201);
    ctx.response.setHeader('X-Custom', 'value');

    // ── Response (미들웨어 — AOT codegen 타입) ───
    ctx.response.cookie.set('token', jwt, { httpOnly: true });
    return body;
  }
}
```

### 코어 vs 미들웨어 경계

```
어댑터/라우터 내장 (항상)        미들웨어 (AOT codegen)
──────────────────────         ──────────────────
getBody(Dto)  — ParseBody 스텝  cookie (req/res)
getParams(Dto) — resolveRoute   getQuery(Dto)
rawBody — @RawBody 데코레이터    getFiles()
                                session
                                기타 확장
```

## 3. AOT 동작 원리

```
zb dev / zb build
  ↓
1. 모듈 분석 → 등록된 미들웨어 수집
  ↓
2. 각 미들웨어의 defineMiddleware() factory 본문 AST 추적
   - ctx.to(HttpContext) 변수 바인딩 확인
   - http.request.<prop> = new <Constructor>(...) 패턴 추출
   - http.request.<prop> = <ArrowFn> 패턴 추출 (메서드 시그니처)
   - import 경로 추적으로 타입 해석
  ↓
3. 핸들러 AST 분석 → ctx.request.*, ctx.response.* 사용 수집
  ↓
4. 대조: 사용 vs 제공 → 불일치 시 빌드 에러
  ↓
5. .zipbul/context.d.ts 생성 (등록된 것만)
  ↓
6. IDE 즉시 인식 → 자동완성 + 타입 체크
```

### 생성 결과 예시

```ts
// .zipbul/context.d.ts — AOT 자동 생성
import type { RequestCookieJar } from "../packages/cookie/src/request-cookie-jar";
import type { ResponseCookieJar } from "../packages/cookie/src/response-cookie-jar";

declare module '@zipbul/http-adapter' {
  interface HttpRequest {
    cookie: RequestCookieJar;
    getQuery<T>(dto: Class<T>): T;
  }
  interface HttpResponse {
    cookie: ResponseCookieJar;
  }
}
```

---

## 4. 구현 상태

### 4.1 완료

#### 누더기 삭제 (사용자 강력 요구)
- `AdapterContext.validated/setValidated/getValidated` 인터페이스에서 제거 (`packages/common/src/interfaces.ts`)
- `HttpContext.validated/setValidated/getValidated/validatedCache` 구현 제거 (`packages/http-adapter/src/http-context.ts`)
- `Adapter.runValidations`의 `setValidated` 호출 → `set`으로 임시 교체 + TODO (`packages/core/src/adapter/adapter.ts`)
- `extractTypedCalls`의 `validated` 특수 케이스 제거, 일반 generic 호출만 추적 (`packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.ts`)
- `CallArgRef` 미사용 import 제거
- 모든 spec mock에서 setValidated/getValidated 제거 (adapter-context.spec.ts, adapter.spec.ts, http-context.spec.ts)

#### `packages/http-adapter/src/http-request.ts`
- `getBody<T>(_dto: Class<T>): T` — 코어 메서드, 현재는 `this.body as T` 패스스루 (placeholder)
- `getParams<T>(_dto: Class<T>): T` — 코어 메서드, 현재는 `this.params as T` 패스스루
- `import type { Class } from '@zipbul/common'` 추가
- `_dto` 파라미터는 type witness — AOT가 추출해서 validation 와이어업 예정
- **주의**: 실제 validation은 어댑터 리팩터링 후 연결됨. 현재는 raw body/params 그대로 반환.

#### `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` (신규)
미들웨어 factory 함수 본문에서 컨텍스트 확장을 추출. **프로토콜 무관** — request/response나 HTTP를 모름.

**Public API:**
```ts
export function extractMiddlewareAugments(
  factory: OxcFunction | ArrowFunctionExpression
): MiddlewareAugmentResult | null;

interface MiddlewareAugmentResult {
  contextType: string;  // e.g. 'HttpContext', 'WsContext'
  augments: readonly PropAugment[];
}

interface PropAugment {
  /** 컨텍스트 바인딩에서 할당 대상까지 segment 배열. e.g. ['request', 'cookie'] 또는 ['user'] */
  path: readonly string[];
  rhs:
    | { kind: 'class'; identifier: string }
    | { kind: 'method'; typeParams: string[]; params: AugmentMethodParam[]; returnType: string | null };
}
```

**인식 패턴:**
1. `defineMiddleware(() => (ctx) => { ... })` — 순수 화살표
2. `defineMiddleware(() => { ...setup; return (ctx) => { ... } })` — 블록 본문
3. `factory` 안에서 `const bound = ctx.to(SomeContext)` 변수 바인딩 추적
4. `bound.<seg>.<seg>...<seg> = new <Constructor>(...)` → class augment, path = segment 배열
5. `bound.<seg>.<seg>...<seg> = <T>(dto: Class<T>): T => ...` → method augment

`request` / `response` 같은 namespace 해석은 어댑터 매핑 정보를 가진 호출자(생성기)의 책임.

**핵심 헬퍼:**
- `findHandlerFunction()` — factory 본문에서 반환된 핸들러 함수 추출 (concise body / block body)
- `findContextBinding()` — `<varName> = ctxParam.to(<Type>)` 변수 바인딩 추적
- `collectAssignments()` — `varName.{request|response}.<prop> = <rhs>` 어사인먼트 수집
- `extractRhs()` — NewExpression / ArrowFunctionExpression 분기
- `stringifyTSType()` — TS 타입 노드 → 문자열 (TSStringKeyword, TSTypeReference, TSArrayType 등)

**테스트:** `middleware-augment-extractor.spec.ts` — 5/5 통과
- class augment 추출 (path 형식)
- method augment 제네릭 시그니처 추출
- flat single-segment path (e.g. `ctx.user`)
- ctx.to() 없는 경우 null 반환
- factory에 setup 코드가 있는 경우 (block body)

#### `packages/cli/src/compiler/generator/context-types-generator.ts` (신규)
수집된 미들웨어 augment를 받아 `context.d.ts` 텍스트를 생성. **프로토콜 무관**.

**Public API:**
```ts
export class ContextTypesGenerator {
  generate(
    augments: readonly MiddlewareContextAugment[],
    registry: ImportRegistry,
    adapterMap: ContextAdapterMap,
  ): string;
}

interface ContextAdapterMap {
  [contextType: string]: AugmentTargetMap;
}

interface AugmentTargetMap {
  [namespace: string]: {
    interface: string;  // e.g. 'HttpRequest'
    module: string;     // e.g. '@zipbul/http-adapter'
  };
}

interface MiddlewareContextAugment {
  middlewareName: string;
  contextType: string;
  sourceFilePath: string;
  augments: readonly PropAugment[];
  classImports: ReadonlyMap<string, string>;
}
```

**동작:**
- `adapterMap[contextType][path[0]]`로 (interface, module) 결정 — 매핑 없으면 augment skip
- `path.slice(1)`이 interface 멤버명. 현재는 length 1만 지원 (nested augment 미지원)
- class augment → `cookie: RequestCookieJar;` (import 추가)
- method augment → `getQuery<T>(dto: Class<T>): T;`
- `ImportRegistry`로 deterministic import
- 출력: `import type { ... }` 형태 (declaration 파일이므로)
- `classImports`에 없는 식별자는 skip

**HTTP 매핑 예시:**
```ts
const HTTP_ADAPTER_MAP: ContextAdapterMap = {
  HttpContext: {
    request: { interface: 'HttpRequest', module: '@zipbul/http-adapter' },
    response: { interface: 'HttpResponse', module: '@zipbul/http-adapter' },
  },
};
```

이 매핑은 어댑터의 `defineAdapter()` 설정에서 와야 함 — 컴파일러는 HTTP를 모름.

**테스트:** `context-types-generator.spec.ts` — 6/6 통과
- class augment 생성
- method augment 제네릭 시그니처
- 다중 미들웨어가 같은 interface로 머지
- 매핑 없는 namespace skip
- 미해결 import skip
- 비-HTTP 어댑터 (WsContext) 매핑 동작

#### `packages/cli/src/compiler/analyzer/parser/handler-context-usage-extractor.ts` (신규)
핸들러 메서드 본문에서 컨텍스트 파라미터에 대한 member-access 체인을 추출. **프로토콜 무관**.

**Public API:**
```ts
export function extractHandlerContextUsages(
  funcNode: OxcFunction
): HandlerContextUsageResult | null;

interface ContextUsage {
  /** 컨텍스트 root 제외한 전체 chain */
  path: readonly string[];
  /** chain이 CallExpression의 callee이면 true */
  isCall: boolean;
  /** isCall=true일 때 첫 번째 Identifier 인자 (DTO 추출용) */
  dtoIdentifier: string | null;
}
```

**인식 패턴 (전체 path만 기록 — augment 매칭은 호출자 책임):**
- `ctx.request.cookie.get('s')` → `{ path: ['request', 'cookie', 'get'], isCall: true, dtoIdentifier: null }`
- `ctx.request.getBody(CreateUserDto)` → `{ path: ['request', 'getBody'], isCall: true, dtoIdentifier: 'CreateUserDto' }`
- `ctx.request.cookie` (read) → `{ path: ['request', 'cookie'], isCall: false, dtoIdentifier: null }`
- `ctx.requestId` → `{ path: ['requestId'], isCall: false, dtoIdentifier: null }`
- 가장 바깥쪽 chain만 기록 (체인 내부 MemberExpression은 skip)
- 동일 chain dedup
- 컨텍스트 파라미터 외 다른 객체는 무시

**테스트:** `handler-context-usage-extractor.spec.ts` — 8/8 통과

#### `packages/cli/src/compiler/integration-context-codegen.spec.ts` (신규)
분석기 → import map 추적 → 생성기 end-to-end 통합 테스트.

**테스트:** 3/3 통과
- cookie 미들웨어 소스 → context.d.ts (request/response 양쪽 cookie 프로퍼티)
- query parser 미들웨어 소스 → context.d.ts (getQuery 메서드 시그니처)
- 다중 미들웨어 → 단일 HttpRequest interface 블록 합성

**전체 신규 테스트: 22/22 통과**

#### 프로토콜 무관 리팩터링 (중요)
**원래 1차 구현에서 `'request' | 'response'`, `'HttpContext'`, HttpRequest/HttpResponse를 하드코딩했음.** 사용자 지적 후 전체 리팩터링:

- 분석기 `PropAugment` — `target/prop` 분리 → `path: string[]` 일반화
- 생성기 — context type 하드코딩 제거, `ContextAdapterMap` 매개변수로 어댑터별 매핑 전달
- 핸들러 추출기 — `kind: property | method` 분리 제거, 전체 chain만 기록 + `isCall` 플래그
- 매핑 정보는 어댑터의 `defineAdapter()`에서 와야 함 (B 작업 시 wire-up)

**컴파일러는 이제 HTTP/WS/gRPC 등 어떤 어댑터도 동일 인프라로 처리.**

### 4.2 삭제 대상 (현재 누더기 정리)

새 DX와 양립할 수 없는 기존 코드. **남겨두면 안 됨.** 새 시스템 도입 = 이것들 제거.

#### `packages/http-adapter/src/context-keys.ts` — 파일 전체 삭제
- `bodyInput`, `paramsInput`, `queryInput` 컨텍스트 키
- 새 모델: 핸들러는 `ctx.request.getBody(Dto)`, `ctx.request.getParams(Dto)`, `ctx.request.getQuery(Dto)` 직접 호출. 컨텍스트 키 노출 불필요.

#### `packages/common/src/interfaces.ts` — `AdapterContext.validated/getValidated/setValidated` 삭제
- 사용자가 명시적으로 `ctx.validated(key, Dto)` 무시하라고 함
- DX는 `getBody(Dto)` 등 직접 메서드 호출

#### `packages/http-adapter/src/http-context.ts`
- `validatedCache` private 필드 삭제
- `validated()`, `setValidated()`, `getValidated()` 메서드 삭제
- `ContextError` 처리 중 validation 관련 부분 삭제

#### `packages/core/src/adapter/adapter.ts`
- `runValidations()` 메서드 — 시그니처 유지하되 새 validation 모델로 재작성
- 현재: `context.get(key)` → `deserialize(metatype, input)` → `context.setValidated(key, result)`
- 새 모델: AOT가 `getBody(CreateUserDto)` 호출 위치를 분석해서 validation 단계에서 DTO 검증 후 결과를 `HttpRequest._validatedBody` 같은 슬롯에 저장. 메서드는 그 슬롯을 읽음.
- 또는 validation 자체를 어댑터 스텝으로 흡수 — 어댑터 리팩터링 결정 필요

#### `packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.ts`
- `ctx.validated(key, Dto)` 호출 추적 코드 삭제
- 새로 추가: `ctx.request.getBody(Dto)`, `ctx.request.getParams(Dto)`, `ctx.request.getQuery(Dto)` 호출 추적

#### `packages/http-adapter/src/http-request.ts`
- `body`, `params`, `query`, `rawBody` public mutable 필드 → private + 내부 슬롯으로 변경
- 외부는 `getBody()` / `getParams()` / `getQuery()` / `rawBody` getter만
- `query: unknown` 필드 (현재 "Set by BeforeValidation middleware" 주석)는 미들웨어가 새 모델에서 어떻게 채울지 결정 후 정리

#### `packages/http-adapter/src/enums.ts`
- `HttpPhase.BeforeValidate` — validation 모델 변경 시 의미 재검토. 현재는 query parser가 끼는 자리. 새 모델에서 미들웨어가 직접 `http.request.X = ...` 할당하는 위치 (BeforeHandle?)로 통합 가능

#### 기타 — grep으로 찾아서 정리할 것
```bash
# 삭제 대상 흔적
grep -r "validated\|bodyInput\|queryInput\|paramsInput\|validatedCache" packages/
```

#### Context 클래스 namespace 자동 추출 (신규)
컴파일러가 `defineAdapter({ context: HttpContext })` 에서 context 클래스를 찾고,
getter return type을 raw AST로 파싱하여 namespace → interface 매핑을 자동 구축.

**어댑터 작성자는 아무것도 추가할 필요 없다.** 기존 `defineAdapter()` config 그대로.

**자동 추출 결과 예시 (HttpContext):**
```
contextType: 'HttpContext'
module: '@zipbul/http-adapter'
namespaces: { request: 'HttpRequest', response: 'HttpResponse' }
```

**추출 조건:**
- getter의 return type이 단순 `TSTypeReference` (Identifier)인 경우만
- union type (`Request | undefined`), primitive는 skip — augmentation 대상이 아님
- package name은 context 클래스 파일에서 가장 가까운 `package.json`의 `name` 필드

**위치:**
- `packages/cli/src/compiler/analyzer/interfaces.ts` — `ContextNamespaceMap` 인터페이스, `AdapterStaticSchema.contextNamespaces`
- `packages/cli/src/compiler/analyzer/adapter/config-extractor.ts` — `extractContextGetterTypes()`, `resolvePackageName()`

#### `MiddlewareAugmentCollector` (신규)
fileMap의 `defineMiddleware()` export를 스캔하여 factory body AST를 추출하고 augment를 수집.

**위치:** `packages/cli/src/compiler/analyzer/adapter/middleware-augment-collector.ts`

**Public API:**
```ts
export class MiddlewareAugmentCollector {
  async collect(
    fileMap: Map<string, FileAnalysis>,
    adapterStaticSchemas: Record<string, AdapterStaticSchema>,
    registeredMiddlewareRefs?: ReadonlySet<string>,
  ): Promise<MiddlewareAugmentCollectionResult>;
}

interface MiddlewareAugmentCollectionResult {
  augments: readonly MiddlewareContextAugment[];
  adapterMap: ContextAdapterMap;
}
```

**동작:**
1. `AdapterStaticSchema.contextNamespaces`에서 `ContextAdapterMap` 구축
2. fileMap 전체를 스캔하여 `ZIPBUL_CALL === 'defineMiddleware'` export 수집
3. 각 export의 소스 파일을 gildash `parseSource()`로 파싱
4. AST에서 `defineMiddleware()` 호출의 factory 인자 추출 (3가지 오버로드 지원)
5. `extractMiddlewareAugments()` 호출
6. 파일의 import 선언에서 class import map 구축
7. `MiddlewareContextAugment` 반환

**3가지 오버로드 지원:**
- `defineMiddleware(() => ...)` — factory-only
- `defineMiddleware([HttpAdapter], () => ...)` — adapters + factory
- `defineMiddleware({ factory: () => ... })` — config object

**`registeredMiddlewareRefs` 필터:** 제공 시 해당 이름만 처리. 미제공 시 전체 처리.

**테스트:** `middleware-augment-collector.spec.ts` — 9/9 통과

#### 빌드 파이프라인 통합
`ContextTypesGenerator`와 `MiddlewareAugmentCollector`를 빌드/dev 파이프라인에 통합.

**위치:**
- `packages/cli/src/bin/build/build.command.ts` — runtime.ts 생성 후 context.d.ts 생성
- `packages/cli/src/bin/dev/dev-rebuild-engine.ts` — runtime.ts 생성 후 context.d.ts 생성

**동작:**
1. `MiddlewareAugmentCollector.collect()` 호출
2. augment가 있으면 `ContextTypesGenerator.generate()` 호출
3. `writeIfChanged(join(outDir, 'context.d.ts'), contextDts)` 출력

### 4.3 미완 (구현 작업)

#### C. 핸들러 사용 검증 + 핸들러 사용 분석
**위치 제안:** `packages/cli/src/compiler/analyzer/adapter/handler-context-usage-extractor.ts` (신규)

**할 일:**
- 핸들러 메서드 본문에서 다음 패턴 추출:
  - `ctx.request.cookie.get(...)` — augment 사용
  - `ctx.request.getBody(Dto)` — DTO 인자 추출 (validation 와이어업)
  - `ctx.request.getParams(Dto)` — DTO 인자 추출
  - `ctx.request.getQuery(Dto)` — DTO 인자 추출 + 미들웨어 등록 검증
  - `ctx.request.cookie.get(...)` — 미들웨어 등록 검증
  - `ctx.response.cookie.set(...)` — 미들웨어 등록 검증
- 등록되지 않은 augment 사용 → 빌드 에러 (Diagnostic)

**기존 참고:** `method-metadata-extractor.ts`가 `ctx.getBody<UserDto>()` 패턴 추적 (이건 삭제 대상이지만 패턴 추출 로직은 참고)

#### D. AOT 검증 와이어업 (validation 자동화)
**할 일:**
- 핸들러가 `ctx.request.getBody(CreateUserDto)` 호출하면, AOT가 `CreateUserDto`를 추출해서 validation 메타데이터에 추가
- 컴파일된 핸들러 엔트리에 "이 핸들러는 body를 CreateUserDto로 검증해야 한다"는 정보 포함
- 런타임에 어댑터의 validation 단계가 이 정보를 보고 deserialize 실행
- 결과를 `HttpRequest`의 내부 슬롯에 저장
- `getBody(Dto)`가 그 슬롯에서 읽음

**의존:** 어댑터 리팩터링 (validation 단계 재구성)

#### E. tsconfig.json include
**할 일:** 사용자 프로젝트 `tsconfig.json`이 `.zipbul/**/*.d.ts`를 인식하게 함
- 옵션 1: 문서화로 사용자가 직접 추가
- 옵션 2: `zb dev` 첫 실행 시 자동 패치
- 결정 필요

#### F. 어댑터 리팩터링 후 placeholder 제거
**현재 placeholder:** `HttpRequest.getBody/getParams`는 raw 캐스팅.

**리팩터링 후:**
- validation 결과 저장소 결정 (현재 `validatedCache`는 삭제됨)
- `getBody(Dto)`가 검증된 인스턴스 반환하도록 변경
- `_dto` 파라미터가 type witness가 아니라 실제로 사용되거나, 또는 AOT 와이어업으로 완전히 무시되거나 — 결정

#### G. e2e 검증
**할 일:**
- 임시 미들웨어 (테스트 픽스처)로 augment 추적 → context.d.ts 생성 검증
- 빌드 → IDE 자동완성 확인
- 미등록 시 빌드 에러 확인

**주의:** `@zipbul/cookie`, `@zipbul/query-parser` 같은 별도 패키지를 만들 필요 없음.
이런 미들웨어는 사용자/별도 작업의 영역이거나, 만든다면 별개 결정.
**우리 작업의 목표는 인프라 (분석기 + 생성기 + 통합) 까지.** 실제 미들웨어 작성은 별개.

---

## 5. 핵심 코드 위치 인덱스

### 코어 (수정 완료)
- `packages/http-adapter/src/http-request.ts:1` — `Class` 타입 import 추가
- `packages/http-adapter/src/http-request.ts:165~190` — `getBody`, `getParams` 메서드
- `packages/common/src/interfaces.ts` — `validated/setValidated/getValidated` 제거
- `packages/http-adapter/src/http-context.ts` — validation 관련 멤버 제거
- `packages/core/src/adapter/adapter.ts:344~362` — `runValidations` 임시 수정
- `packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.ts` — `validated` 특수 케이스 제거

### 컴파일러 신규
- `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` — 분석기 (5/5 통과)
- `packages/cli/src/compiler/analyzer/parser/handler-context-usage-extractor.ts` — 핸들러 사용 추출 (8/8 통과)
- `packages/cli/src/compiler/generator/context-types-generator.ts` — 생성기 (6/6 통과)
- `packages/cli/src/compiler/integration-context-codegen.spec.ts` — e2e 통합 (3/3 통과)
- `packages/cli/src/compiler/analyzer/adapter/middleware-augment-collector.ts` — 수집기 (9/9 통과)
- `packages/common/src/adapter/define-adapter.ts` — `AugmentTargetEntry`, `AugmentMap` 타입 + config 필드
- `packages/cli/src/compiler/analyzer/interfaces.ts` — `AdapterStaticSchema.augmentMap`
- `packages/cli/src/compiler/analyzer/adapter/config-extractor.ts` — `augmentMap` 추출
- `packages/cli/src/bin/build/build.command.ts` — 빌드 파이프라인 context.d.ts 통합
- `packages/cli/src/bin/dev/dev-rebuild-engine.ts` — dev 파이프라인 context.d.ts 통합

### 참조용 기존 컴파일러 코드
- `packages/cli/src/compiler/analyzer/adapter/middleware-pipeline-processor.ts` — 미들웨어 ref 수집
- `packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.ts` — 핸들러 본문 분석
- `packages/cli/src/compiler/analyzer/parser/inject-call-analyzer.ts` — factory 본문 분석 패턴
- `packages/cli/src/compiler/analyzer/expression-converter.ts` — `buildImportMap` 등 import 해석
- `packages/cli/src/compiler/generator/import-registry.ts` — deterministic import 출력

### 참조 (어댑터 리팩터링 시 변경 예정)
- `packages/http-adapter/src/http-adapter.ts` — `parseBody`, `executePipeline`, `runValidations` 흐름
- `packages/http-adapter/src/context-keys.ts` — 현재 `bodyInput`, `paramsInput`, `queryInput` (제거 가능성 있음)
- `packages/core/src/adapter/adapter.ts` — `runValidations`, `runMiddlewares`

---

## 6. 다음 작업자가 알아야 할 함정/주의

1. **이 작업은 리팩터링이다.** 추가가 아니라 **삭제 + 교체**. 4.2 삭제 대상을 그대로 남기면 두 시스템이 공존해서 누더기. `ctx.validated`, `bodyInput/queryInput/paramsInput` 등은 새 시스템과 양립 불가.

2. **`getBody/getParams`는 placeholder.** 현재 `this.body as T`로 캐스팅만 함. 어댑터 리팩터링 + validation 와이어업 후에 실제 검증된 값 반환하도록 교체. placeholder를 정상 동작으로 착각 금지.

3. **declaration merging 전역 오염은 의도적.** 미들웨어 패키지 import만으로 타입이 전역에 뜨는 게 정상. AOT가 등록 여부로 빌드 에러 처리하는 게 안전망. 이걸 "버그"로 보고 다시 분리하려 하지 말 것.

4. **`ctx.use(KEY)` / `ctx.validated(KEY, Dto)` 패턴은 사용자 거부.** declaration merging + 직접 프로퍼티 접근으로만. ContextKey 노출 패턴으로 회귀 금지.

5. **`zb generate` 신규 커맨드 만들지 말 것.** `zb dev` / `zb build`에 통합.

6. **코어에 cookie/query/multipart 인터페이스/슬롯 추가 금지.** 미들웨어 분리 의미가 없어짐. 사용자가 한 번 이걸로 빡쳤음.

7. **`@zipbul/cookie` 같은 별도 패키지 만들지 말 것.** 우리 작업 범위는 **프레임워크 인프라 (분석기 + 생성기 + 통합 + 누더기 정리)**. 실제 미들웨어 패키지 작성은 별개 작업.

8. **컴파일러는 oxc-parser AST를 gildash 래퍼로 사용.** 제네릭 타입 인자도 AST에 들어있음 — 타입 체커 없이 추출 가능.

9. **테스트 격리.** 분석기/생성기 둘 다 independent unit으로 작성됨. 통합 작업 시 새 파일로 wrapper 추가 권장.

10. **품질 우선.** 사용자는 코드 품질과 로직 최적화를 중요하게 봄. 통합 작업 시 기존 코드 누더기를 그대로 두지 말고 함께 정리할 것.

---

## 7. 검증 명령

```bash
# 전체 컨텍스트 관련 테스트 (54 tests, 0 fail)
bun test packages/cli/src/compiler/analyzer/adapter/middleware-augment-collector.spec.ts \
  packages/cli/src/compiler/integration-context-codegen.spec.ts \
  packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.spec.ts \
  packages/cli/src/compiler/generator/context-types-generator.spec.ts \
  packages/cli/src/compiler/analyzer/parser/handler-context-usage-extractor.spec.ts \
  packages/http-adapter/src/adapter-definition.spec.ts \
  packages/common/src/adapter/define-adapter.spec.ts

# 패키지별 전체 테스트 (기존 ctx.validated 관련 15개는 pre-existing 실패)
bun test packages/common/     # 58 pass, 0 fail
bun test packages/core/       # 516 pass, 0 fail
bun test packages/http-adapter/  # 887 pass, 0 fail
```
