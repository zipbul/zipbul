# HTTP Adapter + Core 전체 수정 계획

## Context

HTTP adapter 감사에서 발견된 전체 이슈를 수정한다. 싱글 프로세스 파이프라인의 빈 틈(request scope, errorFilterTokens 레거시, 옵션 구조), 클러스터 모드 전체 불능, route-level pipeline 미소비, guard AOT 와이어링 부재를 단계적으로 해결하여 HTTP 흐름이 프레임워크 계약을 정확히 따르게 만든다.

### 기존 인프라 (이미 존재하는 것)

데코레이터 (common, no-op 스텁):
- `@UseMiddlewares(...middlewares)` — class/method 레벨, phase 무관
- `@UseGuards(...guards)` — class/method 레벨
- `@UseExceptionFilters(...filters)` — class/method 레벨
- `@Catch(...exceptions)` — ExceptionFilter class 레벨
- `@Middlewares(phaseId, refs)` / `@Middlewares({ [phaseId]: refs })` — phase-aware 고급 패턴

컴파일러 (cli):
- `AdapterDefinitionResolver.validateMiddlewarePhaseInputs()` — `@Middlewares` 데코레이터의 phase ID 검증 (class/method 스캔)
- `buildHandlerIndex()` — handler 메타 수집, 하지만 `middlewareKeys`/`errorFilterKeys` 미생성
- `HandlerIndexEntry` — `middlewareKeys`/`errorFilterKeys` 필드 없음

런타임 (common/core):
- `CompiledHandlerEntry` — `middlewareKeys`/`errorFilterKeys` 필드 정의됨 (항상 빈 배열)
- `Adapter.addGuards()` + `Adapter.runGuards()` — 런타임 실행 인프라 존재
- `RequestScopeContainer` — core에 구현 완료, adapter 미통합. 단, 생성자가 구체 `Container` 클래스를 요구 (인터페이스 불일치)
- `Application.executeStart()` — adapterConfig에서 middleware/errorFilter 와이어링 (guard 미포함)

examples:
- `billing.controller.ts` — `@UseMiddlewares(auditMiddleware)`, `@UseExceptionFilters(PaymentErrorFilter)` 사용 중

---

## Phase 1: Dead Code 제거 + 옵션 구조 정리

> 의존: 없음. 안전한 리팩토링.

### 1A: `HttpServerBootOptions` 이중 구조 제거

**문제**: `HttpServerBootOptions extends HttpServerOptions` + `options?: HttpServerOptions` → `this.options = options.options ?? options` 모호.

| 파일 | 변경 |
|------|------|
| `http-adapter/src/interfaces.ts` | `HttpServerBootOptions`에서 `options?: HttpServerOptions` 필드 삭제 |
| `http-adapter/src/http-server.ts:43` | `this.options = options.options ?? options` → `this.options = options` |

### 1B: 사용자 옵션 override 순서 수정

**문제**: `name`, `logLevel`이 spread 뒤에 위치하여 사용자 설정 무시.

| 파일 | 변경 |
|------|------|
| `http-adapter/src/http-adapter.ts:57-64` | `name`, `logLevel`을 spread 앞으로 이동 |

### 1C: `as` 타입 단언 제거 (3건)

> `http-context.ts:26`의 `to()` 메서드는 `Context` 인터페이스 계약상 제네릭 `TContext` 반환이 필수이므로 `as` 불가피. 인터페이스 재설계 없이는 제거 불가하여 제외.

| 파일:행 | 변경 |
|---------|------|
| `route-handler.ts:92` | 타입 가드 `isControllerInstance()` 도입 |
| `route-handler.ts:124` | `isHttpMethod()` 가드가 이미 narrowing 완료. 불필요 `as HttpMethod` 제거 |
| `param-resolver.ts:68` | 타입 가드 `isDeserializableConstructor()` 도입 |

### 1D: `toResponse` status 보정 시 로깅

| 파일 | 변경 |
|------|------|
| `http-server.ts:136-141` | `this.logger.warn(...)` 추가 |

### 1E: Raw `Response` 패스스루 문서화

| 파일 | 변경 |
|------|------|
| `http-adapter.ts:387-401` | `writeSuccessResponse`의 `Response` 분기에 TSDoc: HttpResponse 빌드 체인을 우회하는 탈출구임을 명시 |

**검증**: `bunx oxlint --type-aware` + `bun test packages/http-adapter/`

---

## Phase 2: Request Scope 통합

> 의존: Phase 1A (boot options 정리).

### 2-pre: `ZipbulContainer` 인터페이스에 `createRequestScope()` 추가

**근본 문제**: `RequestScopeContainer` 생성자가 구체 `Container` 클래스를 요구. `HttpServer`는 `ZipbulContainer` 인터페이스만 알고 있어 `RequestScopeContainer`를 직접 생성할 수 없음.

**우회가 아닌 이유**: `HttpServer`에서 core의 `Container`를 직접 import하면 인터페이스 경계를 무너뜨린다. 대신 인터페이스 계약을 확장하여 구현체가 scope 생성 책임을 갖게 한다.

| 파일 | 변경 |
|------|------|
| `common/src/interfaces.ts` `ZipbulContainer` | `createRequestScope(contextId: string): ZipbulContainer` 메서드 추가 |
| `core/src/injector/container.ts` `Container` | `createRequestScope()` 구현: `return new RequestScopeContainer(this, contextId)` |

`RequestScopeContainer`도 `ZipbulContainer`를 구현하므로, 반환 타입이 일관됨.

### 2A: HttpServer에 container 보존

| 파일 | 변경 |
|------|------|
| `http-server.ts:41` | `_container` → `container`, `this.container`에 저장 |

### 2B: 요청별 RequestScopeContainer 생성 + 정리

| 파일 | 변경 |
|------|------|
| `http-server.ts` fetch() | `container.createRequestScope()` 호출 → `HttpContext`에 전달 → `finally`에서 `dispose()` |

```typescript
const requestId = crypto.randomUUID();
const requestContainer = this.container.createRequestScope(requestId);
const context = new HttpContext(zipbulReq, zipbulRes, req, requestContainer);
try {
  await this.adapter.dispatchRequest(context);
  return this.toResponse(zipbulRes.end());
} catch (error) { ... }
finally { await requestContainer.dispose(); }
```

> `HttpServer`는 `ZipbulContainer.createRequestScope()`만 호출. `RequestScopeContainer` 클래스를 직접 알 필요 없음.

`dispose()` 호출을 위해 `ZipbulContainer` 인터페이스에 `dispose?(): Promise<void>` 옵셔널 메서드도 추가. `Container`는 no-op, `RequestScopeContainer`는 기존 dispose 로직 실행.

### 2C: HttpContext에 container 전달

| 파일 | 변경 |
|------|------|
| `http-context.ts` | 4번째 생성자 파라미터 `container?: ZipbulContainer`, getter 추가 |

**검증**: request-scoped provider → 핸들러에서 resolve → 요청 간 격리 확인

---

## Phase 3: errorFilterTokens 레거시 경로 제거

> 의존: 없음. 안전한 삭제.

### 근본 원인

`errorFilterTokens`(`ExceptionFilterToken[]`)는 AOT 이전에 설계된 API다. 토큰만 전달하므로 `@Catch` 데코레이터의 catchTypes를 알 수 없다. 런타임 리플렉션 없이는 catchTypes 판별이 **구조적으로 불가능**하다.

- catch-all로 패치하면 `@Catch(PaymentError)` 계약을 위반 (명시성 원칙 위반)
- 런타임에 catchTypes를 알아내려면 reflect-metadata 필요 (정책 위반)

미배포 상태이므로 하위 호환 고려 불필요. 잘못된 추상화는 패치가 아닌 제거가 정답이다.

### 3A: `errorFilterTokens` 레거시 경로 제거

| 파일 | 변경 |
|------|------|
| `common/src/adapter/adapter.ts` | `errorFilterTokens` 필드 삭제, `addErrorFilters()` 메서드 삭제 |
| `http-adapter/src/interfaces.ts` | `HttpServerOptions.errorFilters` 필드 삭제, `HttpServerBootOptions.errorFilters` 필드 삭제 |
| `http-adapter/src/http-adapter.ts` | `startInternal()`에서 `errorFilters: this.errorFilterTokens` 제거 |
| `http-adapter/src/http-adapter.ts` | 클러스터 경로에서 `errorFilters: this.errorFilterTokens` 제거 |

사용자에게 남는 경로:
1. **AOT**: `@UseExceptionFilters(Filter)` + `@Catch(ErrorType)` → 컴파일러가 완전한 `ExceptionFilterEntry` 생성 (Phase 6)
2. **수동**: `adapter.addExceptionFilterEntries([{ filter, catchTypes: [ErrorType] }])` — 명시적 API

**검증**: 기존 `errorFilterTokens` 참조가 모두 제거됐는지 확인. `addExceptionFilterEntries()` 경로는 영향 없음.

---

## Phase 4: Core 클러스터 `wrap()` 수정

> 의존: 없음.

### 4A: RPC 프록시 메서드 범위 확장

| 파일 | 변경 |
|------|------|
| `core/src/cluster/cluster-manager.ts:83` | `['init', 'bootstrap']` → `['init', 'bootstrap', 'destroy', 'getStats']` |

**검증**: Worker destroy → worker 측 handler 실행 확인, getStats() 반환 확인

---

## Phase 5: 클러스터 Worker 재설계

> 의존: Phase 2, 3, 4 완료.

### 핵심 제약

Worker는 별도 V8 isolate. 함수 참조는 IPC 직렬화 불가. Worker는 **AOT manifest 모듈을 직접 import**하여 RuntimeContext를 재구성해야 한다.

**현재 구현의 근본 결함**: `HttpWorkerManifest` 인터페이스(`createContainer()` 등 함수 멤버)를 IPC 객체로 전달하려는 설계. 함수는 IPC 직렬화 불가이므로 worker에서 `manifest`는 항상 `undefined` → JIT 폴백 → **현재 worker는 AOT를 한 번도 사용하지 않는다**.

**해결**: manifest는 IPC 객체가 아니라 **import 가능한 모듈 경로(문자열)**로 전달한다. Worker가 `await import(manifestPath)` → 모듈 로드 시 `registerRuntimeContext()` 부수효과 실행 → RuntimeContext 완성.

### 5A: manifest 경로 전달 수정

| 파일 | 변경 |
|------|------|
| `http-adapter.ts` startInternal() 클러스터 경로 | `entryModule.path = 'unknown'` → AOT manifest 모듈 경로(문자열) resolve |
| `interfaces.ts` `HttpWorkerInitParams` | `manifestPath: string` 필드 명확화. `HttpWorkerManifest` 인터페이스 제거 (IPC 불가 설계) |

### 5B: Worker에서 manifest import + HttpAdapter 생성 + 파이프라인 와이어링

| 파일 | 변경 |
|------|------|
| `http-worker.ts` initInternal() | 전면 재작성: |

```
1. manifestPath가 존재하면 `await import(manifestPath)` 실행 (NEW — 기존 IPC 객체 패턴 폐기)
   → 모듈 import 부수효과로 registerRuntimeContext() 실행
   → getRuntimeContext()에서 container, adapterConfig, handlerIndex, controllerInstances 사용 가능
   → manifestPath가 없으면 JIT 폴백 (Container 직접 생성)
2. HttpAdapter 인스턴스 생성 (NEW)
3. getRuntimeContext().adapterConfig 읽기 → 파이프라인 와이어링 (NEW)
   - config.middlewares → adapter.addMiddlewares(hook, middlewares)
   - config.errorFilters → adapter.addExceptionFilterEntries(entries)
   - config.guards → adapter.addGuards(guards) (Phase 7 이후)
4. handlerIndex에서 controllerInstances 생성 (NEW)
   - RuntimeContext에 controllerInstances가 있으면 사용
   - 없으면 handlerIndex의 고유 controllerKey를 수집, 각 key에 대해 container.get(key)로 로컬 생성
   - controllerInstances는 IPC 직렬화 불가(클래스 인스턴스)이므로 반드시 worker 로컬에서 생성
5. httpServer.boot(container, bootOptions, adapter) (FIX — 3번째 인자 추가)
   - bootOptions에 controllerInstances + handlerIndex 포함
```

```typescript
// Step 1: AOT manifest 모듈 로드
if (typeof manifestPath === 'string' && manifestPath.length > 0) {
  await import(manifestPath);
  // registerRuntimeContext() 부수효과로 RuntimeContext 완성
}

// Step 4: controllerInstances 확보
const runtimeCtx = getRuntimeContext();
const handlerIndex = runtimeCtx.handlerIndex ?? [];
let controllerInstances = runtimeCtx.controllerInstances;

if (controllerInstances === undefined) {
  controllerInstances = new Map<string, unknown>();
  for (const entry of handlerIndex) {
    if (!controllerInstances.has(entry.controllerKey)) {
      controllerInstances.set(entry.controllerKey, container.get(entry.controllerKey));
    }
  }
}
```

### 5C: JIT 폴백 경로 동일 패턴 적용

빈 파이프라인이지만 adapter 생성 + boot 인자 수정은 동일.

### 5D: initParams에 handlerIndex 포함

`handlerIndex`는 순수 JSON → IPC 직렬화 가능. (`middlewareKeys`/`errorFilterKeys`/`guardKeys`는 모두 문자열 배열)

| 파일 | 변경 |
|------|------|
| `http-adapter.ts` 클러스터 경로 | `initParams.handlerIndex = runtimeCtx.handlerIndex` |
| `http-worker.ts` | bootOptions에 handlerIndex 전달 |

> `controllerInstances`는 IPC 불가. handlerIndex만 IPC로 전달하고, worker가 로컬에서 controllerInstances를 생성한다 (5B Step 4).

**검증**: `workers: 2` → 요청 → worker 파이프라인 전체 실행 확인

---

## Phase 6: Route-Level Pipeline 완성

> 의존: 6A/6B는 독립. 6C만 Phase 2 (container 통합) 의존.

### 현재 상태

- 데코레이터 존재: `@UseMiddlewares`, `@UseExceptionFilters`, `@Middlewares(phaseId, refs)`
- 컴파일러: `@Middlewares` phase ID 검증만 수행, `handlerIndex`에 키 미생성
- `CompiledHandlerEntry`: `middlewareKeys`/`errorFilterKeys` 필드 정의됨 (항상 빈 배열)
- `RouteHandler`: 항상 `middlewares: []`, `errorFilters: []` 하드코딩
- **gap**: 컴파일러가 데코레이터 인자를 container에 등록 → 키를 handlerIndex에 채움 → adapter가 소비하는 전체 경로 미구현

### 6A: CLI HandlerIndexEntry에 필드 추가

| 파일 | 변경 |
|------|------|
| `cli/src/compiler/analyzer/interfaces.ts` | `HandlerIndexEntry`에 `middlewareKeys?: readonly string[]`, `errorFilterKeys?: readonly string[]` 추가 |

### 6B: 컴파일러 buildHandlerIndex()에서 데코레이터 키 추출 + 컨테이너 등록

**핵심**: `@UseMiddlewares(auditMiddleware)`의 인자는 `MiddlewareDefinition` 런타임 객체이지, container 키가 아니다. `defineMiddleware()`로 생성된 모듈 상수이므로 DI 컨테이너에 등록된 적 없다.

**해결**: 컴파일러가 route-level 미들웨어/필터를 감지하면, **생성 코드에서 해당 정의를 컨테이너에 등록**한다. 결정적(deterministic) 키를 생성한다.

| 파일 | 변경 |
|------|------|
| `cli/src/compiler/analyzer/adapter-definition-resolver.ts` buildHandlerIndex() | 각 method/class의 decorators에서 `UseMiddlewares`/`Middlewares`/`UseExceptionFilters` 감지 → AST 식별자 참조 수집 → 결정적 키 생성 → `HandlerIndexEntry.middlewareKeys`/`errorFilterKeys`에 채움 |
| `cli/src/compiler/generator/injector-generator.ts` | 수집된 참조를 컨테이너에 등록하는 코드 생성 |

**미들웨어 등록 코드 생성 예시:**

```typescript
// 컴파일러가 생성하는 코드 (manifest 내)
import { auditMiddleware } from './middlewares';

// 컨테이너 등록
container.set('__route_mw__:BillingController:0', () => auditMiddleware);

// handlerIndex
{ middlewareKeys: ['__route_mw__:BillingController:0'], ... }
```

**에러 필터 등록 — `@Catch` catchTypes 추출:**

`@UseExceptionFilters(PaymentErrorFilter)` 처리 시, 컴파일러가 `PaymentErrorFilter` 클래스의 `@Catch(PaymentError)` 데코레이터 인자를 AST에서 추출하여 완전한 `ExceptionFilterEntry`를 구성한다.

```typescript
// 컴파일러가 생성하는 코드
import { PaymentError } from './errors';

container.set('__route_ef__:BillingController:0', (c) => ({
  filter: c.get('AppModule::PaymentErrorFilter'),
  catchTypes: [PaymentError],
}));

// handlerIndex
{ errorFilterKeys: ['__route_ef__:BillingController:0'], ... }
```

class-level 데코레이터는 해당 controller의 모든 handler entry에 병합. 병합 순서: class-level 먼저, method-level 나중 (파이프라인 실행 순서와 일치).

### 6C: RouteHandler에서 container 키 resolve

| 파일 | 변경 |
|------|------|
| `route-handler.ts` 생성자 | container 참조 추가 |
| `route-handler.ts` registerFromHandlerIndex() | `entry.middlewareKeys` → `container.get(key)` → `MiddlewareDefinition` resolve |
| `route-handler.ts` registerFromHandlerIndex() | `entry.errorFilterKeys` → `container.get(key)` → `ExceptionFilterEntry` resolve |
| `route-handler.ts:119-120` | 하드코딩 `[]` → resolved 인스턴스로 교체 |

**검증**: `@UseMiddlewares(auditMiddleware)` → AOT 빌드 → handlerIndex에 middlewareKeys 포함 → 요청 시 route-level 미들웨어 실행 → examples/billing 동작 확인

---

## Phase 7: Guard AOT 와이어링

> 의존: 7A/7-pre는 독립. 7B/7C는 7A 이후. 7E는 Phase 6C + 7B 이후.

### 7-pre: `AdapterModuleConfig`에 guards 필드 추가

**근본 문제**: 사용자가 모듈 정의에서 guard를 선언하는 입력 인터페이스에 `guards` 필드가 없다. 컴파일러가 모듈의 guard 설정을 읽을 수 없다.

| 파일 | 변경 |
|------|------|
| `common/src/interfaces.ts` `AdapterModuleConfig` | `guards?: readonly GuardDefinition[]` 필드 추가 |

### 7A: AdapterMiddlewareConfig에 guards 필드

| 파일 | 변경 |
|------|------|
| `core/src/runtime/interfaces.ts` | `guards?: readonly GuardDefinition[]` 추가 |

### 7B: Application에서 guard 와이어링

| 파일 | 변경 |
|------|------|
| `core/src/application/application.ts:195` | errorFilters 와이어링 다음에 guard 와이어링 추가 |

```typescript
if (config?.guards !== undefined && config.guards.length > 0) {
  entry.adapter.addGuards(config.guards);
}
```

### 7C: 컴파일러에서 guard 직렬화

| 파일 | 변경 |
|------|------|
| `cli/src/compiler/generator/injector-generator.ts:456` | `itemRecord.guards` 존재 시 guards 직렬화 추가 |

### 7D: Worker에서 guard 와이어링 (Phase 5 확장)

| 파일 | 변경 |
|------|------|
| `http-worker.ts` | Phase 5B 와이어링 로직에 guard 추가 |

### 7E: Route-level guard (Phase 6 확장)

`@UseGuards` 데코레이터 이미 존재. Phase 6과 동일 패턴 (컨테이너 등록 + 결정적 키):
- `HandlerIndexEntry`에 `guardKeys?: readonly string[]` 추가
- `CompiledHandlerEntry`에도 `guardKeys` 추가
- `buildHandlerIndex()`에서 `@UseGuards` 인자 추출 → 컨테이너 등록 코드 생성
- `RouteHandlerEntry`에 guards 필드 추가
- `RouteHandler`에서 resolve → `resolveHandler()`에서 route-level guard 실행

**실행 지점**: `resolveHandler()` 내부, route middlewares 실행 후 / paramFactory 호출 전.

```
route match → setRouteErrorFilters → run route middlewares → [run route guards] → param resolution → handler call
```

글로벌 guard(`executePipeline`에서 `PostParseData` 후)보다 나중에 실행된다. 글로벌이 먼저 거부하면 route-level까지 도달하지 않는다. 이는 올바른 동작이다 — 글로벌(인증) → route-level(인가) 순서.

**검증**: `@UseGuards(authGuard)` → AOT → Application → adapter.addGuards() → 요청 파이프라인에서 글로벌 guard → route guard 순서 실행

---

## 실행 순서

```
Phase 1 ─── Dead code/옵션 정리 (http-adapter only)
Phase 2 ─── Request scope 통합 (common + core + http-adapter)
             └── 2-pre: ZipbulContainer.createRequestScope() 인터페이스 확장
Phase 3 ─── errorFilterTokens 레거시 제거 (common + http-adapter)
Phase 4 ─── Core wrap() 수정 (core only)
Phase 5 ─── 클러스터 worker 재설계 (http-adapter, depends: 2+3+4)
Phase 6 ─── Route-level pipeline 완성 (cli + http-adapter)
             └── 6A/6B: 독립 (CLI only)
             └── 6C: depends: 2 + 6B
Phase 7 ─── Guard AOT 와이어링 (common + cli + core + http-adapter)
             └── 7-pre/7A: 독립 (인터페이스 확장)
             └── 7B/7C: depends: 7A
             └── 7D: depends: 5B + 7A
             └── 7E: depends: 6C + 7B
```

Phase 1, 3, 4, 6A/6B, 7-pre/7A 병렬 가능.
Phase 2는 Phase 1A 이후.
Phase 5는 Phase 2+3+4 완료 후.
Phase 6C는 Phase 2 + 6B 이후.
Phase 7E는 Phase 6C + 7B 이후.

## 커밋 전략

Phase별 1~2개 커밋. scope: `fix(core)`, `fix(http-adapter)`, `fix(common)`, `feat(http-adapter)`, `feat(core)`, `feat(cli)`.
