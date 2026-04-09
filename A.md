# Pipeline 재설계 + ctx 통합 + gildash 활용 계획

## 1. 조건부 Await 최적화

현재 core pipeline의 모든 step/handler/middleware/guard/filter/deserialize 호출이 무조건 `await`를 사용한다. sync 함수에 `await`를 붙이면 ~100ns microtick 오버헤드가 발생하며, 요청당 8~15회 누적된다.

### 변경 패턴

```ts
// before
const result = await step(context);

// after
const raw = step(context);
const result = raw instanceof Promise ? await raw : raw;
```

### 변경 대상 (8곳)

#### core `packages/core/src/adapter/adapter.ts`

| 라인 | 현재 코드 | 대상 |
|------|----------|------|
| 296 | `const stepResult = await step(context)` | pre step |
| 305 | `result = await handler(context) ?? undefined` | handler |
| 315 | `await step(context)` | post step |
| 350 | `const result = await deserialize(validation.metatype, input)` | baker deserialize |
| 385 | `const result = await mw.handler(context)` | middleware handler |
| 407 | `const result = await guard.handler(context)` | guard handler |
| 437 | `const filterResult = await entry.handler(error, context)` | exception filter handler |

#### http-adapter `packages/http-adapter/src/http-adapter.ts`

| 라인 | 현재 코드 | 대상 |
|------|----------|------|
| 567 | `const result = await mw.handler(http)` | HTTP middleware handler |

### 변경 불필요

| 라인 | 파일 | 코드 | 이유 |
|------|------|------|------|
| 268 | core/adapter.ts | `await this.runMiddlewares(...)` | 메서드 호출, 내부에서 처리됨 |
| 196 | http-adapter.ts | `await this.runHttpMiddlewares(...)` | 메서드 호출, 내부에서 처리됨 |
| 234 | http-adapter.ts | `await this.runPipeline(...)` | 메서드 호출, 내부에서 처리됨 |
| 308 | core/adapter.ts | `await this.executeExceptionFilterChain(...)` | 메서드 호출, 내부에서 처리됨 |
| 723, 751 | http-adapter.ts | `await iterator.next()` / `await iterator.return()` | AsyncIterator는 반드시 await |

---

## 2. ctx 통합 설계

### 사용자 경험 (최종안)

```ts
@Post()
create(ctx: HttpContext) {
  const body = ctx.request.getBody(CreateUserDto);  // validated protocol input
  const user = ctx.currentUser;                      // 미들웨어 제공 값
  ctx.translate('welcome');                          // 미들웨어 제공 함수
}
```

하나의 `ctx` 객체. import 없음, key 없음, store 없음.

### 두 가지 접근 패턴

| 접근 | 문법 | 제공자 | 타입 출처 |
|------|------|--------|-----------|
| 프로토콜 입력 | `ctx.request.getBody(Dto)`, `getParams(Dto)`, `getQuery(Dto)` | adapter step / 미들웨어 | DTO 클래스에서 추론 |
| 횡단 관심사 | `ctx.currentUser`, `ctx.translate(...)` | 미들웨어 | AOT가 `.d.ts` 생성 |

### 미들웨어 provides 분석

미들웨어가 `ctx.X = value` 할당 → gildash semantic layer가 `value`의 타입을 tsc TypeChecker로 resolve → `provides` 명시 선언 불필요.

```ts
export const authMiddleware = defineMiddleware(() => (ctx) => {
  ctx.currentUser = verifyToken(http.request.headers.get('authorization'));
  // gildash getResolvedTypeAtPosition → User 타입 자동 추출
});
```

### AOT 컴파일러가 하는 일

1. **분석**: 미들웨어 AST에서 `ctx.X = expr` 감지 → gildash로 expr 타입 resolve
2. **타입 생성**: `.zipbul/context.d.ts` 생성 (module augmentation)
3. **검증**: handler에서 `ctx.X` 접근 시 해당 handler pipeline에 provider 있는지 매칭 → 없으면 빌드 에러
4. **런타임 코드 생성**: 핸들러별 pipeline step 함수 codegen

### getBody/getParams/getQuery 구현

validation은 항상 pipeline에서 처리. getBody는 항상 캐시 읽기.

```ts
getBody<T>(dto: new (...args: readonly unknown[]) => T): T {
  return this._validatedBody as T;
}
```

항상 sync. dto 인자는 TypeScript 타입 추론용.

### validation 흐름

1. AOT가 handler에서 `getBody(ChargeDto)` 감지
2. `ChargeDto` 분석 → sync/async 판별 (gildash `isTypeAssignableToType` 활용)
3. 핸들러별 validation step codegen (injector generator)
4. 런타임: pipeline step이 deserialize → `request._validatedBody` 캐싱
5. handler: `getBody(Dto)` → 캐시 반환

### sync/async DTO 판별

baker DTO의 async 소스 3가지:
1. async rule — `createRule('x', async (v) => ...)` 두 번째 인자
2. async transform — `@Field({ transform: { deserialize: async (...) => ... } })`
3. nested DTO 전파 — `@Field({ type: () => Inner })` Inner가 async이면 부모도 async

gildash 활용:
- `getResolvedTypeAtPosition`으로 transform 인자 타입 resolve
- `isTypeAssignableToType(file, pos, 'PromiseLike<any>')` → async 판별
- `isTypeAssignableToTypeAtPositions`로 배치 판별

AOT 분석 실패 시: baker 런타임 seal이 처리 (`analyzeAsync`). codegen 대상에서 제외, `instanceof Promise` 조건부 await로 fallback.

### validation 실패 시

pipeline step에서 `wrapValidationError()` → `Err` 반환 → pipeline 중단 → handler 미실행. Result 패턴 준수.

### query 미들웨어

- `getQuery` 메서드는 HttpRequest에 항상 선언
- 미들웨어가 `request.query`에 파싱 데이터 채움
- AOT가 `getQuery()` 사용 감지 + query 미들웨어 미등록 → 빌드 에러

### 다른 프로토콜

| 프로토콜 | request 메서드 (유한) | ctx 프로퍼티 (무한) |
|----------|----------------------|---------------------|
| HTTP | `request.getBody(Dto)`, `getParams(Dto)`, `getQuery(Dto)` | `ctx.currentUser`, `ctx.translate(...)` |
| WebSocket | `message.getData(Dto)` | `ctx.connectionAuth` |
| gRPC | `request.getData(Dto)`, `request.getMetadata(Dto)` | `ctx.traceSpan` |
| Queue | `job.getData(Dto)` | `ctx.retryCount` |

---

## 3. 의존성 업그레이드

### baker 2.1.0 → 2.2.0

- `deserialize` 오버로드 분리: sync DTO → `T | BakerErrors`, async DTO → `Promise<T | BakerErrors>`
- baker 런타임 `analyzeAsync`가 seal 시점에 `rule.isAsync` + `isAsyncFunction(transform.fn)` 검사
- 외부 패키지 rule도 런타임에 정확히 판별

### gildash 0.10.0 → 0.19.1

**0.10.0에 없고 0.19.1에 추가된 핵심 API:**

| API | 기능 | 활용 |
|-----|------|------|
| `getResolvedTypeAtPosition(file, pos)` | 위치 기반 타입 resolve | 미들웨어 ctx 할당 값 타입 추론 |
| `getResolvedTypesAtPositions(file, pos[])` | 배치 타입 resolve | 한 파일의 모든 ctx 할당 일괄 분석 |
| `isTypeAssignableToType(file, pos, typeExpr)` | 타입 호환성 체크 | async 판별, 타입 검증 |
| `isTypeAssignableToTypeAtPositions(file, pos[], typeExpr)` | 배치 호환성 체크 | 배치 async 판별 |
| `getSymbolNode(file, pos)` | tsc symbol 노드 | 심볼 구조 분석 |
| `getBaseTypes(file, pos)` | 상속 base 타입 | DTO 상속 분석 |
| `getSemanticDiagnostics(file)` | tsc 진단 | 생성 코드 검증 |
| `getSemanticReferencesAtPosition(file, pos)` | 위치 기반 참조 검색 | ctx 접근 추적 |
| `findNamePosition(file, declPos, name)` | 선언 내 이름 위치 | ctx 파라미터 위치 특정 |
| `batchParse(filePaths[])` | 여러 파일 동시 파싱 | 프로젝트 일괄 분석 |
| `SymbolNode` | 심볼 그래프 노드 | 의존성 추적 |
| `getImplementationsAtPosition(file, pos)` | 구현체 검색 | 인터페이스→구현 매핑 |

---

## 4. 작업 순서

### Phase 1: gildash 0.19.1 업그레이드 + CLI 최적화

기존 CLI 컴파일러 로직 중 gildash 신규 API로 대체 가능한 부분을 전수 조사하고 최적화.

- 현재 AST 직접 파싱으로 수행하는 작업 중 gildash `extractSymbols`, `extractRelations`, `batchParse` 등으로 대체 가능한 부분 식별
- 현재 수동 타입 추론 로직을 gildash semantic layer (`getResolvedType`, `isTypeAssignableToType` 등)로 대체
- 현재 import 추적 로직을 gildash `searchRelations`, `getDependencies`로 대체
- 현재 심볼 검색 로직을 gildash `searchSymbols`, `getFullSymbol`로 대체

### Phase 2: 조건부 await 최적화

core adapter.ts + http-adapter.ts의 8곳 무조건 await → instanceof Promise 조건부 await.

### Phase 3: ctx 통합 구현

- `ctx.request.getBody(Dto)` / `getParams(Dto)` / `getQuery(Dto)` 구현
- validation codegen (sync/async 판별 포함)
- 미들웨어 provides 자동 분석 (gildash semantic layer)
- `.zipbul/context.d.ts` 생성
- provider-consumer 매칭 검증
- 기존 `validated()`, `setValidated()`, `getValidated()`, `runValidations`, `ResolvedValidationEntry`, `CompiledValidationEntry` 제거

### Phase 4: examples 업데이트

examples를 새 API로 전환. 빌드 → 실행 → 동작 확인.

### Phase 5: baker 2.2.0 업그레이드

sync/async 오버로드 활용. codegen에서 sync DTO는 await 없이 생성.
