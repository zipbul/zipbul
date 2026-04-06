# Pipeline Plan

## Goal

AOT 컴파일러가 핸들러별 최적화된 실행 계획을 생성한다. 런타임은 그 계획을 실행만 한다.

## Adapter Declaration

어댑터는 두 가지를 선언한다.

### 1. Pipeline

phase, core step, adapter step을 순서대로 나열한다.

```ts
static readonly pipeline = [
  PhaseA,              // phase — 미들웨어 확장 지점
  AdapterStep1,        // adapter step — 어댑터가 구현
  PhaseB,              // phase
  CoreStep.Validation, // core step — 코어가 실행
  CoreStep.Guard,      // core step
  PhaseC,              // phase
  CoreStep.Handler,    // core step — 항상 유지, pre/post 분할 기준
  PhaseD,              // phase
  AdapterStep2,        // adapter step
  PhaseE,              // phase
] as const;
```

### 2. Step -> 실행 함수 매핑

어댑터는 자신의 phase와 adapter step에 대해 실행 함수를 제공한다.

core step(Validation, Guard, Handler)은 코어가 이미 구현을 가지고 있으므로 어댑터가 매핑하지 않는다.

## Compiler Algorithm

### 1. 수집

핸들러별로 모든 scope(handler, controller, module, global)에서 수집:

- phase 미들웨어: 키 + scope + phase + order
- 가드: 키 + scope + order
- 예외필터: 키 + scope + order
- 밸리데이션: kind + metatypeKey
- 옵션: name + arguments
- 파라미터: name + decorator + metatype

### 2. 병합

미들웨어/가드: global -> module -> controller -> handler
예외필터: handler -> controller -> module -> global

결과: phase별 미들웨어 키 배열, 가드 키 배열, 예외필터 키 배열. 전부 flat.

### 3. Dead-Step Elimination

어댑터 선언 pipeline에서:

- phase: 해당 phase에 merged MW가 0이면 제거
- Validation: validations가 0이면 제거
- Guard: merged 가드가 0이면 제거
- adapter step: 프로토콜 의미론에 따라 유지/제거
- Handler: 항상 유지

### 4. Pre/Post 분할

Handler 기준으로 pipeline을 pre segment와 post segment로 나눈다. compiledPre와 compiledPost에는 phase, core step, adapter step이 전부 포함된다. dead-step elimination 이후 남은 항목만 들어간다.

현재 컴파일러는 `compiledPipeline` 하나만 출력하고 Handler에서 멈춘다. **변경**: `compiledPipeline`을 `compiledPre`와 `compiledPost`로 분리하고, post-handler step도 포함한다.

예시 (밸리데이션 있고 가드 없는 핸들러):

```
dead-step elimination:
  PhaseA(MW 있음)유지, AdapterStep1 유지, PhaseB(MW 없음)제거, Validation 유지,
  Guard(가드 0개)제거, PhaseC(MW 있음)유지, Handler, PhaseD(MW 있음)유지,
  AdapterStep2 유지, PhaseE(MW 없음)제거

compiledPre:  [PhaseA, AdapterStep1, Validation, PhaseC]
compiledPost: [PhaseD, AdapterStep2]
```

Handler는 pre/post 어디에도 포함되지 않는다. 코어가 pre 실행 후 handler를 직접 호출하고, handler 결과를 context에 저장한 뒤 post를 실행한다.

### 5. Interning

같은 산출물을 가진 핸들러는 같은 참조를 공유한다.

| 대상 | 동일성 기준 |
|------|-----------|
| compiledPre | step 순서 동일 |
| compiledPost | step 순서 동일 |
| mergedPhaseMiddlewareKeys | phase별 키 배열 동일 |
| mergedGuardKeys | 키 배열 동일 |
| mergedExceptionFilterKeys | 키 배열 동일 |
| validations | kind + metatypeKey 세트 동일 |
| options | name + arguments 세트 동일 |

컴파일러가 해싱으로 동일 산출물을 감지하고, 동일하면 같은 객체를 참조하도록 코드를 생성한다. 현재 컴파일러에는 interning 구현이 없다.

### 6. 산출물 (핸들러별)

```
{
  // 핸들러 식별
  id
  adapterId
  controllerKey
  methodName
  ownerModuleName

  // 사전 컴파일된 파이프라인
  compiledPre                   // [step, ...] — interned
  compiledPost                  // [step, ...] — interned

  // 병합된 키
  mergedPhaseMiddlewareKeys     // { phase: [key, ...] } — interned
  mergedGuardKeys               // [key, ...] — interned
  mergedExceptionFilterKeys     // [key, ...] — interned

  // route-level 키 (컨테이너 등록용)
  middlewareKeys                // [key, ...]
  guardKeys                     // [key, ...]
  exceptionFilterKeys           // [key, ...]

  // 핸들러 메타데이터
  validations                   // [{ kind, metatypeKey }, ...] — interned
  options                       // [{ name, arguments }, ...] — interned
  params                        // 핸들러 고유
  handlerDecorator              // 핸들러 고유
  handlerDecoratorArgs          // 핸들러 고유
}
```

lossless 바인딩(`middlewareBindings`, `guardBindings`, `exceptionFilterBindings`)은 빌드 타임에 병합이 완료되므로 런타임에 불필요하다. introspection/디버깅 용도로만 유지하고 런타임 실행에는 사용하지 않는다.

## Core

코어(`Adapter` 클래스)는 `runPipeline` 메서드를 제공한다. 순차 실행이다.

```ts
protected async runPipeline(
  context: AdapterContext,
  pre: readonly PipelineStepFn[],
  handler: PipelineStepFn,
  post: readonly PipelineStepFn[],
  filters: readonly ResolvedExceptionFilter[],
): Promise<void>
```

```
try:
  for fn of pre:
    result = await fn(context)
    if isErr(result): break
  if not isErr(result):
    result = await handler(context)
catch:
  result = await filterChain(filters, error, context)
context.set(handlerResultKey, result)
try:
  for fn of post: await fn(context)
catch:
  await emergencyTeardown(context, error)
```

`dispatchRequest`는 `executePipeline` + finalize 보장만 한다.

```
dispatchRequest(context):
  try:
    await this.executePipeline(context)
  catch:
    await emergencyTeardown(context, error)
  finally:
    await finalize(context)
```

`handleResult`는 삭제.

## Boot (어댑터)

어댑터는 pipeline 순서를 선언하고 step -> 실행 함수 매핑을 제공한다.

부트 시:
1. 컴파일러 산출물의 compiledPre/compiledPost step 이름으로 매핑에서 함수를 꺼내 배열을 만든다
2. merged 키를 resolve하여 미들웨어/가드/필터 함수 배열을 만든다
3. route에 pre/handler/post/filters를 캐시한다

## Runtime

```
route match -> this.runPipeline(context, pre, handler, post, filters) -> finalize
```

요청당 비용: route match + 함수 배열 순차 호출. resolution/분기 없음.

## Merge Order Correction

현재 컴파일러 `getScopeRank()`는 handler=0, global=3으로 전부 handler-first.

수정: 미들웨어/가드는 global-first(global=0, handler=3), 예외필터는 handler-first(handler=0, global=3).

## Changes Required

### 컴파일러 변경

1. `compiledPipeline` -> `compiledPre` + `compiledPost` 분리
2. post-handler step도 dead-step elimination 적용
3. `getScopeRank()` 분리: MW/가드는 global-first, 예외필터는 handler-first
4. interning 구현 (해싱 + 동일 참조 공유)

### 코어 변경

1. `runPipeline()` 메서드 추가
2. `dispatchRequest()` 단순화
3. `handleResult()` abstract 메서드 삭제
4. handler result 저장용 `contextKey` 추가
