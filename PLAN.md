# Pipeline Type System Refactoring Plan

> Status: **Confirmed — 구현 대기**
> Created: 2025-02-24

---

## 네이밍 결정

| 이름 | 역할 | 종류 |
|------|------|------|
| `ReservedPipeline` | Guards, Pipes, Handler | enum (common) |
| `MiddlewarePhase` | 어댑터 정의 미들웨어 페이즈 식별자 | `string` type alias (common) |
| `AdapterPipelines` | `(MiddlewarePhase \| ReservedPipeline)[]` | 배열 타입 (common) |
| `HttpMiddlewarePhase` | BeforeRequest, AfterRequest | enum (http-adapter) |

기존 `PipelineStep` (router/processor/glossary) 건드리지 않음. `Pipeline`, `PipelineToken`은 삭제 후 `ReservedPipeline`, `AdapterPipelines`로 대체.

---

## 목표

`AdapterRegistrationInput`의 3개 파이프라인 필드(`pipeline`, `middlewarePhaseOrder`, `supportedMiddlewarePhases`)를
`pipeline: AdapterPipelines` 하나로 통합한다.

- `ReservedPipeline` enum (Guards, Pipes, Handler) 도입 → ADAPTER-R-004 준수
- `HttpMiddlewarePhase` enum (BeforeRequest, AfterRequest) 도입 → 어댑터별 미들웨어 페이즈 열거
- `middlewarePhaseOrder`, `supportedMiddlewarePhases` 필드 및 관련 타입 삭제
- AOT 컴파일러에서 enum member expression 해석 지원
- 스펙 문서 동기화 (ADAPTER-R-006 폐기, R-004/R-007 정리)

---

## Phase 1: Type System (common 패키지)

> 에이전트: **Sonnet**

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/common/src/adapter/types.ts` | 주요 변경 |
| `packages/common/src/adapter/index.ts` | export 변경 |
| `packages/common/src/adapter/define-adapter.ts` | JSDoc 업데이트 |
| `packages/common/src/adapter/define-adapter.spec.ts` | 테스트 수정 |

### 1.1 `ReservedPipeline` enum 추가 및 타입 정리

**파일**: `packages/common/src/adapter/types.ts`

Before:
```ts
export type MiddlewarePhaseId = string;
export type PipelineToken = MiddlewarePhaseId | 'Guards' | 'Pipes' | 'Handler';
export type Pipeline = PipelineToken[];
export type MiddlewarePhaseOrder = MiddlewarePhaseId[];
export type SupportedMiddlewarePhaseSet = Record<MiddlewarePhaseId, true>;
```

After:
```ts
/** 어댑터 정의 미들웨어 페이즈 식별자. */
export type MiddlewarePhase = string;

/** 파이프라인 예약 토큰. 프레임워크가 소유하는 실행 단위. */
export enum ReservedPipeline {
  Guards = 'Guards',
  Pipes = 'Pipes',
  Handler = 'Handler',
}

/** 파이프라인 선언 배열. 미들웨어 페이즈와 예약 토큰의 순서 있는 시퀀스. */
export type AdapterPipelines = (MiddlewarePhase | ReservedPipeline)[];
```

삭제 대상:
- `PipelineToken` type alias
- `Pipeline` type alias
- `MiddlewarePhaseId` type alias (→ `MiddlewarePhase`로 대체)
- `MiddlewarePhaseOrder` type alias
- `SupportedMiddlewarePhaseSet` type alias

### 1.2 `AdapterRegistrationInput` 단순화

Before:
```ts
export type AdapterRegistrationInput = {
  name: string;
  classRef: ClassRef;
  pipeline: Pipeline;
  middlewarePhaseOrder: MiddlewarePhaseOrder;
  supportedMiddlewarePhases: SupportedMiddlewarePhaseSet;
  decorators: AdapterEntryDecorators;
  dependsOn?: AdapterDependsOn;
};
```

After:
```ts
export type AdapterRegistrationInput = {
  name: string;
  classRef: ClassRef;
  pipeline: AdapterPipelines;
  decorators: AdapterEntryDecorators;
  dependsOn?: AdapterDependsOn;
};
```

### 1.3 Index re-export 정리

**파일**: `packages/common/src/adapter/index.ts`

- 추가: `ReservedPipeline` (enum — value + type export)
- 변경: `MiddlewarePhaseId` → `MiddlewarePhase`
- 추가: `AdapterPipelines` (type)
- 삭제: `PipelineToken`, `Pipeline`, `MiddlewarePhaseOrder`, `SupportedMiddlewarePhaseSet`

### 1.4 JSDoc 업데이트

**파일**: `packages/common/src/adapter/define-adapter.ts`

`@example` 블록에서 `middlewarePhaseOrder`, `supportedMiddlewarePhases` 제거.
`ReservedPipeline` enum 사용 예시로 교체.

### 1.5 테스트 수정

**파일**: `packages/common/src/adapter/define-adapter.spec.ts`

- `middlewarePhaseOrder`, `supportedMiddlewarePhases` 필드 참조하는 모든 `it` 블록 수정/삭제
- `ReservedPipeline` enum 값 assertion 추가

**영향 받는 it 블록:**
- `should return the input unchanged when middlewarePhaseOrder and handler array are empty` (L73)
- `middlewarePhaseOrder` / `supportedMiddlewarePhases` assertion 라인

---

## Phase 2: HTTP Adapter

> 에이전트: **Sonnet**
> 의존: Phase 1

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/http-adapter/src/enums.ts` | enum 추가 |
| `packages/http-adapter/src/adapter-definition.ts` | enum 사용으로 교체 |
| `packages/http-adapter/src/adapter-definition.spec.ts` | 테스트 수정 |

### 2.1 `HttpMiddlewarePhase` enum 추가

**파일**: `packages/http-adapter/src/enums.ts`

```ts
export enum HttpMiddlewarePhase {
  BeforeRequest = 'BeforeRequest',
  AfterRequest = 'AfterRequest',
}
```

### 2.2 `adapter-definition.ts` enum 전환

After:
```ts
import { defineAdapter, ReservedPipeline } from '@zipbul/common';
import { HttpMiddlewarePhase } from './enums';

export const adapterSpec = defineAdapter({
  name: 'http',
  classRef: ZipbulHttpAdapter,
  pipeline: [
    HttpMiddlewarePhase.BeforeRequest,
    ReservedPipeline.Guards,
    ReservedPipeline.Pipes,
    ReservedPipeline.Handler,
    HttpMiddlewarePhase.AfterRequest,
  ],
  decorators: {
    controller: RestController,
    handler: [Get, Post, Put, Delete, Patch, Options, Head],
  },
});
```

### 2.3 테스트 수정

**파일**: `packages/http-adapter/src/adapter-definition.spec.ts`

수정 대상 `it` 블록:
- `should define pipeline with Handler exactly once...` → `ReservedPipeline.Handler` 등 확인
- `should preserve middlewarePhaseOrder relative order...` → 삭제
- `should have supportedMiddlewarePhases keys equal to...` → 삭제

---

## Phase 3: AOT Compiler (cli 패키지)

> 에이전트: **Opus**
> 의존: Phase 1
> 복잡도: **높음** — enum member expression 해석, 검증 로직 전면 리팩토링

### 영향 파일

| 파일 | 변경 종류 | 복잡도 |
|------|-----------|--------|
| `packages/cli/src/compiler/analyzer/interfaces.ts` | interface 수정 | 낮음 |
| `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts` | 주요 리팩토링 | **높음** |
| `packages/cli/src/compiler/analyzer/adapter-spec-resolver.spec.ts` | 주요 테스트 수정 | **높음** |
| `packages/cli/src/compiler/diagnostics/adapter-codes.ts` | diagnostic 수정 | 낮음 |
| `packages/cli/src/compiler/diagnostics/adapter-codes.spec.ts` | 테스트 수정 | 낮음 |
| `packages/cli/src/compiler/generator/manifest-generator.spec.ts` | 테스트 수정 | 중간 |

### 3.1 `AdapterStaticSpec` interface 수정

**파일**: `packages/cli/src/compiler/analyzer/interfaces.ts`

Before:
```ts
export interface AdapterStaticSpec {
  pipeline: string[];
  middlewarePhaseOrder: string[];
  supportedMiddlewarePhases: Record<string, true>;
  entryDecorators: AdapterEntryDecoratorsSpec;
}
```

After:
```ts
export interface AdapterStaticSpec {
  pipeline: string[];
  entryDecorators: AdapterEntryDecoratorsSpec;
}
```

### 3.2 Enum member expression 해석 지원

**파일**: `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts`

현재 pipeline 파싱은 **string literal만** 허용.
`ReservedPipeline.Guards`나 `HttpMiddlewarePhase.BeforeRequest` 같은 enum member expression 해석 필요.

**확인 필요 사항** (구현 전 — Phase 3 첫 번째 조사 항목):
1. `AstParser.parseExpression()`이 enum member expression을 어떻게 평가하는지 확인
2. `ast-type-resolver.ts`의 enum resolution 경로 확인
3. 결과에 따라 아래 시나리오 중 해당하는 분기 선택

**시나리오 분기:**

| 시나리오 | AstParser 동작 | 대응 |
|---------|---------------|------|
| A | enum member를 string value로 resolve (`'Guards'`) | 기존 string 분기 그대로 사용 — pipeline 파싱 변경 불요 |
| B | ref 객체 반환 (`{ __zipbul_ref: 'ReservedPipeline.Guards' }`) | 아래 RESERVED_MAP 분기 추가 |
| C | 미지원/에러 | ast-type-resolver.ts에 enum resolve 로직 추가 필요 (Phase 3 블로커) |

**구현 방향 — 시나리오 B** (AstParser가 ref 반환하는 경우):
```ts
const RESERVED_MAP: Record<string, string> = {
  'ReservedPipeline.Guards': 'Guards',
  'ReservedPipeline.Pipes': 'Pipes',
  'ReservedPipeline.Handler': 'Handler',
};

for (const token of pipelineRaw) {
  if (typeof token === 'string') {
    pipeline.push(token);
  } else if (isRecordValue(token) && typeof token.__zipbul_ref === 'string') {
    const resolved = RESERVED_MAP[token.__zipbul_ref] ?? token.__zipbul_ref;
    pipeline.push(resolved);
  } else {
    throw new Error(`... pipeline elements must be strings or enum references ...`);
  }
}
```

### 3.3 `middlewarePhaseOrder` / `supportedMiddlewarePhases` 파싱 삭제

삭제 대상 코드 블록:
- L238~L269: `mpoRaw` 파싱 + `smpRaw` 파싱
- L305: `validatePhaseConsistency()` 호출
- L312~L313: `middlewarePhaseOrder`, `supportedMiddlewarePhases` 반환값
- L684~L714: `validatePhaseConsistency()` private 메서드 전체

### 3.4 `validatePipelineConsistency` 리팩토링

`middlewarePhaseOrder` 파라미터 제거. pipeline에서 `ReservedPipeline` enum 값을 필터링하여 미들웨어 페이즈 도출:

```ts
private validatePipelineConsistency(pipeline: string[], context: string): void {
  const RESERVED = new Set(['Guards', 'Pipes', 'Handler']);

  for (const reserved of RESERVED) {
    const count = pipeline.filter(t => t === reserved).length;
    if (count !== 1) {
      throw new Error(`[Zipbul AOT] pipeline must contain '${reserved}' exactly once (${context}).`);
    }
  }

  const customPhases = pipeline.filter(t => !RESERVED.has(t));
  const seen = new Set<string>();
  for (const phase of customPhases) {
    if (seen.has(phase)) {
      throw new Error(`[Zipbul AOT] pipeline must not contain duplicate middleware phase '${phase}' (${context}).`);
    }
    this.assertValidPhaseId(phase, context, 'defineAdapter.pipeline');
    seen.add(phase);
  }
}
```

### 3.5 미들웨어 페이즈 도출 유틸리티

`validateMiddlewarePhaseInputs` (L498~L521)에서 `extraction.staticSpec.supportedMiddlewarePhases` 접근을
`extraction.staticSpec.pipeline`으로부터 도출하는 방식으로 교체:

```ts
private deriveSupportedPhases(pipeline: string[]): Set<string> {
  const RESERVED = new Set(['Guards', 'Pipes', 'Handler']);
  return new Set(pipeline.filter(t => !RESERVED.has(t)));
}
```

**변경 전** (L504~L505):
```ts
const supported = extraction.staticSpec.supportedMiddlewarePhases;
const supportedKeys = Object.keys(supported);
```

**변경 후:**
```ts
const supportedKeys = [...this.deriveSupportedPhases(extraction.staticSpec.pipeline)];
```

### 3.6 Diagnostic 코드 정리

**파일**: `packages/cli/src/compiler/diagnostics/adapter-codes.ts`

- `ADAPTER_PHASE_ID_INVALID` (R-005): JSDoc `"MiddlewarePhaseId"` → `"MiddlewarePhase"` 변경
- `ADAPTER_PHASE_SET_MISMATCH` (R-006): **삭제** (`supportedMiddlewarePhases` 필드 없으므로 존재 의미 없음)
- `ADAPTER_PIPELINE_PHASE_ORDER_MISMATCH` (R-007): "pipeline 내 미들웨어 페이즈 중복"으로 의미 변경

### 3.7 테스트 수정

**파일**: `packages/cli/src/compiler/analyzer/adapter-spec-resolver.spec.ts` (1740줄)

- `createAdapterValue()` 헬퍼 — `middlewarePhaseOrder`, `supportedMiddlewarePhases` 필드 삭제
- 모든 테스트 fixture에서 두 필드 제거
- `validatePhaseConsistency` 관련 테스트 삭제/수정
- `validatePipelineConsistency` 테스트를 새 시그니처에 맞게 수정
- enum member expression 파싱 테스트 추가

**파일**: `packages/cli/src/compiler/diagnostics/adapter-codes.spec.ts`

- `ADAPTER_PHASE_SET_MISMATCH` import 및 assertion 삭제 (R-006 삭제에 따름)
- `ADAPTER_PIPELINE_PHASE_ORDER_MISMATCH` JSDoc 의미 변경 확인

**파일**: `packages/cli/src/compiler/generator/manifest-generator.spec.ts`

- `middlewarePhaseOrder`, `supportedMiddlewarePhases` 필드 삭제

---

## Phase 4: Spec 문서 동기화

> 에이전트: **Sonnet**
> 의존: Phase 1~3 완료 후

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `docs/30_SPEC/adapter/adapter.spec.md` | 주요 변경 |
| `docs/30_SPEC/common/declarations.spec.md` | 타입 리네임 |
| `docs/30_SPEC/module-system/manifest.spec.md` | 형상 수정 |
| `docs/10_FOUNDATION/GLOSSARY.md` | 용어 추가/수정 |

### 4.1 `adapter.spec.md` 업데이트

**`MiddlewarePhaseId` → `MiddlewarePhase` 일괄 치환** (14곳): Section 3.1 Input 테이블, Section 3.2 Data Shapes, R-005 설명, Section 7 Diagnostics 테이블 등.

**Section 3.1 Static Inputs:**
- `middlewarePhaseOrder` 행 삭제
- `supportedMiddlewarePhases` 행 삭제

**Section 3.2 Static Data Shapes:**
```ts
export type MiddlewarePhase = string;

export enum ReservedPipeline {
  Guards = 'Guards',
  Pipes = 'Pipes',
  Handler = 'Handler',
}

export type AdapterPipelines = (MiddlewarePhase | ReservedPipeline)[];

export type AdapterRegistrationInput = {
  name: string;
  classRef: ClassRef;
  pipeline: AdapterPipelines;
  decorators: AdapterEntryDecorators;
};
```

**Section 3.3 Shape Rules:**
- **ADAPTER-R-004**: "reserved tokens are expressed as ReservedPipeline enum members"
- **ADAPTER-R-006**: 삭제 (검증 대상 필드 없음)
- **ADAPTER-R-007**: "pipeline middleware phases have no duplicates and are valid phase ids"

### 4.2 `declarations.spec.md` 업데이트

**파일**: `docs/30_SPEC/common/declarations.spec.md`

- L103: `export type MiddlewarePhaseId = string;` → `export type MiddlewarePhase = string;`
- L116: `phaseId: MiddlewarePhaseId;` → `phaseId: MiddlewarePhase;`

### 4.3 `manifest.spec.md` 업데이트

`AdapterStaticSpec`에서 `middlewarePhaseOrder`, `supportedMiddlewarePhases` 삭제.

### 4.4 GLOSSARY 업데이트

- `MiddlewarePhaseId` → `MiddlewarePhase` 용어 변경
- `ReservedPipeline` 용어 추가
- `AdapterPipelines` 용어 추가

---

## 실행 순서 및 에이전트 할당 요약

```
Phase 1 ─── Sonnet ─── common 타입 + 테스트
  │
  ├─── Phase 2 ─── Sonnet ─── http-adapter enum + 테스트
  │
  └─── Phase 3 ─── Opus ─── AOT 컴파일러 리팩토링 + 테스트
         │
         ▼
       Phase 4 ─── Sonnet ─── 스펙 문서 동기화
```

| Phase | 에이전트 | 파일 수 | 복잡도 | 배정 이유 |
|-------|---------|---------|--------|-----------|
| 1 | Sonnet | 4 | 낮음 | 타입/export 기계적 변경 |
| 2 | Sonnet | 3 | 낮음 | enum 추가 + 문자열→enum 치환 |
| 3 | Opus | 6 | **높음** | AstParser enum 해석 조사, 검증 로직 재설계, 대규모 테스트 수정 |
| 4 | Sonnet | 4 | 중간 | 스펙 문서 형식 맞춤 |

---

## 커밋 단위

| 순서 | 범위 | 메시지 |
|------|------|--------|
| 1 | Phase 1 | `refactor(common): replace pipeline types with ReservedPipeline enum and AdapterPipelines` |
| 2 | Phase 2 | `refactor(http-adapter): use ReservedPipeline and HttpMiddlewarePhase enums in adapterSpec` |
| 3 | Phase 3 | `refactor(cli): remove middlewarePhaseOrder/supportedMiddlewarePhases from AOT resolver` |
| 4 | Phase 4 | `docs: sync adapter and manifest specs with pipeline type refactoring` |

---

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| AstParser가 enum member expression을 미지원 | Phase 3 블로커 | ast-type-resolver.ts 확인 후 해석 로직 추가 |
| `MiddlewarePhaseId` → `MiddlewarePhase` 리네임 파급 | 광범위한 import 변경 | grep으로 전체 사용처 확인 후 일괄 치환 |
| adapter-spec-resolver.spec.ts 1740줄 대량 수정 | 테스트 누락 | Phase 3 구현 후 전체 테스트 실행으로 검증 |
| 외부 어댑터 작성자 (미래) 호환성 | Breaking change | pre-1.0이므로 허용 |
