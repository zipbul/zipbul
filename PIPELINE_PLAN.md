# 사전 파이프라인 컴파일 설계

## 왜 하는가

Zipbul의 정체성은 "모든 판단은 빌드 타임에 완료, 런타임은 결정된 경로를 따라가기만 한다."

현재 파이프라인은 이 원칙을 위반한다:
- 매 요청마다 빈 phase의 미들웨어 배열을 조회하고 async 함수를 호출한다 (빈 배열이어도 await 비용 ~113ns × phase 수)
- 글로벌 MW와 scoped MW가 분리되어 있어서 런타임에 따로 실행한다
- 가드, 예외 필터도 글로벌/scoped가 분리되어 런타임에 두 번 순회한다
- 핸들러에 등록된 게 없어도 ScopedMiddleware, ScopedGuard step을 매 요청 체크한다

프로파일링 결과:
- executePipeline 내부에서 빈 phase await + 빈 guard await + 불필요한 step 체크 = ~0.85µs/req
- 전체 파이프라인 ~1.7µs 중 50%가 "아무 일도 안 하면서 쓰는 비용"

## 현재 구조의 문제

```
executePipeline (명령형, 매 요청 동일한 분기 반복):
  OnRequest (글로벌 MW만)       ← 빈 phase도 await
  ResolveRoute
  BeforeParse (글로벌 MW만)     ← 빈 phase도 await
  ParseBody
  BeforeValidate (글로벌 MW만)  ← 빈 phase도 await
  Validation                    ← 없으면 length 체크
  Guard (글로벌만)              ← 빈 가드도 await
  BeforeHandle (글로벌 MW만)    ← 빈 phase도 await
  ScopedMiddleware              ← 글로벌과 별도 실행
  ScopedGuard                   ← 글로벌과 별도 실행
  Handler

handleResult (별도 메서드, 하드코딩):
  WriteResponse
  AfterHandle (글로벌 MW만)     ← 빈 phase도 체크
  Serialize
  BeforeResponse (글로벌 MW만)  ← 빈 phase도 체크
  AfterResponse                 ← finalize
```

문제점:
1. MW가 글로벌/scoped로 분리 → 런타임에 따로 실행
2. Guard가 글로벌/scoped로 분리 → 런타임에 따로 실행
3. ExceptionFilter가 글로벌/scoped로 분리 → 런타임에 두 단계 순회
4. 빈 phase도 매 요청 async 호출
5. executePipeline과 handleResult로 파이프라인이 분리

## 목표 구조

### 파이프라인 선언

어댑터는 미들웨어 phase만 선언한다. 고정 step은 어댑터 코드가 결정.

```typescript
// HttpAdapter
static readonly pipeline = [
  HttpPhase.OnRequest,
  HttpPhase.BeforeParse,
  HttpPhase.BeforeValidate,
  HttpPhase.BeforeHandle,
  HttpPhase.AfterHandle,
  HttpPhase.BeforeResponse,
  HttpPhase.AfterResponse,
] as const;
```

### AOT 빌드 타임 병합

컴파일러가 각 핸들러마다, 모든 레벨의 등록을 병합한 최종 리스트를 생성:

**미들웨어 (phase별):**
```
OnRequest:       [핸들러 MW, 컨트롤러 MW, 모듈 MW, 글로벌 MW]
BeforeParse:     [핸들러 MW, 컨트롤러 MW, 모듈 MW, 글로벌 MW]
BeforeValidate:  [핸들러 MW, 컨트롤러 MW, 모듈 MW, 글로벌 MW]
BeforeHandle:    [핸들러 MW, 컨트롤러 MW, 모듈 MW, 글로벌 MW]
AfterHandle:     [핸들러 MW, 컨트롤러 MW, 모듈 MW, 글로벌 MW]
BeforeResponse:  [핸들러 MW, 컨트롤러 MW, 모듈 MW, 글로벌 MW]
AfterResponse:   [핸들러 MW, 컨트롤러 MW, 모듈 MW, 글로벌 MW]
```

**가드:**
```
[핸들러 Guard, 컨트롤러 Guard, 모듈 Guard, 글로벌 Guard]
```

**예외 필터:**
```
[핸들러 Filter, 컨트롤러 Filter, 모듈 Filter, 글로벌 Filter]
```

**밸리데이션:**
```
핸들러별 Validated<T> 접근 목록 (현재와 동일)
```

빈 phase는 병합 결과가 빈 배열 → 런타임에서 await 없이 스킵.

### 런타임 실행

```typescript
// HttpAdapter.executePipeline
await this.runPhase(HttpPhase.OnRequest, http);     // 병합된 MW 리스트. 비어있으면 즉시 return
this.resolveRoute(http);
await this.runPhase(HttpPhase.BeforeParse, http);
await this.parseBody(http);
await this.runPhase(HttpPhase.BeforeValidate, http);
await this.runValidations(http);                     // 핸들러별 validation
await this.runGuards(http);                           // 병합된 Guard 리스트
await this.runPhase(HttpPhase.BeforeHandle, http);
const result = route.handler(http);

// handleResult
this.writeResponse(result, http);
await this.runPhase(HttpPhase.AfterHandle, http);
res.serialize();
await this.runPhase(HttpPhase.BeforeResponse, http);

// finalize
await this.runPhase(HttpPhase.AfterResponse, http);
```

- `runPhase`는 해당 핸들러의 해당 phase 병합 리스트를 조회. 비어있으면 await 없이 즉시 return
- 글로벌/scoped 구분 없음. 이미 병합되어 있음
- ScopedMiddleware, ScopedGuard step 없음. phase와 guard에 통합
- `runExceptionFilters`도 병합된 단일 리스트 순회. 2단계 dispatch 없음

### CoreStep / HttpStep enum

삭제. 고정 step은 어댑터 코드에서 직접 호출. phase만 선언형.

## 변경 범위

### CLI (packages/cli)
- `adapter-definition-resolver.ts`: 핸들러별 phase별 MW/Guard/ExceptionFilter를 핸들러→컨트롤러→모듈→글로벌 순서로 수집하여 병합
- `manifest-generator.ts`: 병합 결과를 handlerIndex에 포함하여 runtime.ts에 출력

### Common (packages/common)
- `compiled-handler.ts`: 핸들러별 병합 데이터 구조 추가 (phase별 MW 키, 병합 Guard 키, 병합 ExceptionFilter 키)
- `CoreStep` enum 관련 필드 제거

### Core (packages/core)
- `adapter.ts`: `buildCompiledPipeline` 삭제. `handlerPipelineMap` 삭제. `compiledPostRoutePipeline` 삭제. `getHandlerPipeline`/`registerHandlerPipeline` 삭제. `runExceptionFilters` 2단계 dispatch → 단일 리스트 순회로 변경
- `enums.ts`: `CoreStep` enum 삭제

### HTTP Adapter (packages/http-adapter)
- `enums.ts`: `HttpStep` enum 삭제
- `http-adapter.ts`: `executePipeline` 단순화 — phase 실행 시 핸들러별 병합 리스트 사용. `executeStep` switch 삭제. `static pipeline`을 phase만으로 변경
- `route-handler.ts`: 핸들러 등록 시 병합된 MW/Guard/ExceptionFilter를 MatchedRouteMetadata에 phase별로 저장
- `types.ts`: MatchedRouteMetadata 구조 변경 — phase별 병합 MW 리스트, 병합 Guard 리스트, 병합 ExceptionFilter 리스트

## 검증

1. `bun test packages/core/ packages/http-adapter/ packages/cli/` — 전체 통과
2. `cd benchmark && bunx zb build` — AOT 빌드 성공, 병합 데이터 포함 확인
3. `cd examples && bunx zb build` — MW/Guard/Filter 있는 앱 빌드 성공
4. 벤치마크 서버 정상 기동 + 응답 확인
5. 계측 코드로 executePipeline 재측정
6. bombardier 벤치마크 재측정
