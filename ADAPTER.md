# Adapter 구현 계획

> 6개 스펙 문서(ADAPTER, ENTRY-DECORATORS, MIDDLEWARE-PHASE, PIPELINE-SHAPE, REGISTRATION, MODULE-SYSTEM-ADAPTER-CONFIG)의 총 26+10개 규칙을 구현한다.
> 작업 범위: `@zipbul/common`, `@zipbul/http-adapter`, `@zipbul/core`, `@zipbul/cli` 4개 패키지.

---

## 현황 요약

| 항목 | 상태 |
|---|---|
| `defineAdapter()` 함수 | **미구현** — common/core 어디에도 없음 |
| `adapterSpec` export | **미구현** — http-adapter index.ts에 없음 |
| `BootstrapAdapter` 타입 | **미정의** — core에 정의 없이 http-adapter에서 phantom import |
| `ZipbulApplication.addAdapter()` | **미구현** — 26줄 스텁 |
| 데코레이터 | **no-op 스텁** — `return () => {}` |
| CLI `adapter-spec-resolver.ts` | **970줄, 동작** — 단, 현재 static class fields 기반 API를 기대 |
| `AdapterConfig` (common) | **존재** — 단, 스펙 형상과 차이 있을 수 있음 |

---

## 미결 설계 사항

Phase 진입 전 결정 필요. 각 항목은 해당 Phase에서 다시 언급한다.

| # | 사항 | 관련 규칙 | 영향 Phase |
|---|---|---|---|
| D-1 | `defineAdapter()` API 형태: 스펙은 `defineAdapter(objectLiteral)` 요구, 현재 CLI는 `defineAdapter(ClassRef)` + static fields 기대. 어느 쪽을 정본으로 할지 결정 필요 | ADAPTER-R-001, R-002 | Phase 0, 1, 5 |
| D-2 | `dependsOn` 런타임 의미론: 스펙은 빌드 타임 DAG 검증만 정의, 런타임 시작 순서/에러 전파 의미론 미정의 | ADAPTER-CONFIG-R-009 | Phase 2 |
| D-3 | Exception Filter catch target: `ContractData = unknown` — 구체 타입 미정 | ADAPTER-R-009 | Phase 4 |

---

## Phase 0 — Foundation: 타입 + `defineAdapter()` API

> `@zipbul/common`에 어댑터 정적 계약 타입과 `defineAdapter()` 함수를 정의한다.

### 선결 조건

- **D-1 결정 완료**

### 수정 대상

| 파일 | 줄 수 (현재) | 변경 |
|---|---|---|
| `packages/common/src/adapter/types.ts` | 새 파일 | 스펙 3.2 타입 전체 정의 |
| `packages/common/src/adapter/define-adapter.ts` | 새 파일 | `defineAdapter()` 함수 |
| `packages/common/src/adapter/index.ts` | 새 파일 | barrel export |
| `packages/common/src/index.ts` 또는 기존 barrel | 수정 | adapter barrel re-export 추가 |

### 추가 타입 (스펙 3.2 기준)

```typescript
// adapter/types.ts
export type AdapterContractData = unknown;
export type AdapterSpecExportName = 'adapterSpec';
export type MiddlewarePhaseId = string;
export type ClassRef = abstract new (...args: any[]) => any;
export type PipelineToken = MiddlewarePhaseId | 'Guards' | 'Pipes' | 'Handler';
export type Pipeline = PipelineToken[];
export type MiddlewarePhaseOrder = MiddlewarePhaseId[];
export type SupportedMiddlewarePhaseSet = Record<MiddlewarePhaseId, true>;

export type DecoratorRef = (...args: any[]) => any;

export type AdapterEntryDecorators = {
  controller: DecoratorRef;
  handler: DecoratorRef[];
};

export type AdapterRegistrationInput = {
  name: string;
  classRef: ClassRef;
  pipeline: Pipeline;
  middlewarePhaseOrder: MiddlewarePhaseOrder;
  supportedMiddlewarePhases: SupportedMiddlewarePhaseSet;
  decorators: AdapterEntryDecorators;
};
```

```typescript
// adapter/define-adapter.ts
export function defineAdapter(input: AdapterRegistrationInput): AdapterRegistrationInput {
  return input;
}
```

> `defineAdapter`는 identity 함수다. AOT가 정적으로 수집하므로 런타임 로직은 불필요.
> 반환 타입을 그대로 돌려줌으로써 타입 안전성과 AOT 수집 가능성을 동시에 확보한다.

### 스펙 규칙 매핑

| 규칙 | 충족 방법 |
|---|---|
| ADAPTER-R-001 | `defineAdapter(objectLiteral)` 형태의 named export 구조 제공 |
| ADAPTER-R-002 | `AdapterRegistrationInput` 타입이 모든 필수 필드를 정적으로 강제 |

### 검증

```bash
bun test --filter "define-adapter"
```

### 커밋 단위

```
feat(common): add defineAdapter() and adapter static contract types
```

---

## Phase 1 — HTTP Adapter Spec Export

> `@zipbul/http-adapter`에서 `adapterSpec` named export를 `defineAdapter()` 호출로 선언한다.

### 선결 조건

- Phase 0 완료

### 수정 대상

| 파일 | 줄 수 (현재) | 변경 |
|---|---|---|
| `packages/http-adapter/src/adapter-spec.ts` | 새 파일 | `defineAdapter()` 호출, pipeline/phase/decorators 선언 |
| `packages/http-adapter/index.ts` | 32줄 | `adapterSpec` re-export 추가 |
| `packages/http-adapter/package.json` | 수정 | `@zipbul/common` 의존성 확인 |

### `adapter-spec.ts` 예상 형태

```typescript
import { defineAdapter } from '@zipbul/common';
import { ZipbulHttpAdapter } from './zipbul-http-adapter';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head } from './decorators/method.decorator';

export const adapterSpec = defineAdapter({
  name: 'http',
  classRef: ZipbulHttpAdapter,
  pipeline: ['BeforeRequest', 'Guards', 'Pipes', 'Handler', 'AfterRequest'],
  middlewarePhaseOrder: ['BeforeRequest', 'AfterRequest'],
  supportedMiddlewarePhases: {
    BeforeRequest: true,
    AfterRequest: true,
  },
  decorators: {
    controller: RestController,
    handler: [Get, Post, Put, Delete, Patch, Options, Head],
  },
});
```

### 스펙 규칙 매핑

| 규칙 | 충족 방법 |
|---|---|
| ADAPTER-R-001 | `adapterSpec` named export = `defineAdapter(objectLiteral)` |
| ADAPTER-R-003 | `classRef: ZipbulHttpAdapter` — 구체 클래스, `ZipbulAdapter` 구현체 |
| ADAPTER-R-004 | `pipeline` — `Handler` 정확히 1회, `Guards`/`Pipes` 최대 1회, 예약 토큰 문자열 리터럴 아님 |
| ADAPTER-R-005 | MiddlewarePhaseId는 문자열 리터럴("BeforeRequest", "AfterRequest") — 정규화 안정적 |
| ADAPTER-R-006 | `middlewarePhaseOrder` 비중복, `supportedMiddlewarePhases` key set 일치 |
| ADAPTER-R-007 | pipeline 내 phase id가 middlewarePhaseOrder 순서 보존 |

### 검증

```bash
bun test --filter "adapter-spec"
```

### 커밋 단위

```
feat(http-adapter): add adapterSpec export via defineAdapter()
```

---

## Phase 2 — Core Registration & Lifecycle

> `@zipbul/core`에서 `ZipbulApplication.addAdapter()`, `BootstrapAdapter` 타입, 어댑터 등록 및 생명주기를 구현한다.

### 선결 조건

- Phase 0 완료
- **D-2 결정** (dependsOn 런타임 의미론)

### 수정 대상

| 파일 | 줄 수 (현재) | 변경 |
|---|---|---|
| `packages/core/src/application/zipbul-application.ts` | 26줄 | `addAdapter()`, 어댑터 레지스트리, 생명주기 관리 구현 |
| `packages/core/src/application/interfaces.ts` | 5줄 | `BootstrapAdapter`, `AdapterEntry` 타입 정의 |
| `packages/core/src/application/application.ts` | 15줄 | `createApplication` 에서 어댑터 지원 |
| `packages/core/index.ts` | 14줄 | `BootstrapAdapter` export 추가 |

### 핵심 구현 사항

```typescript
// interfaces.ts
export type BootstrapAdapter = (app: ZipbulApplication) => Promise<void> | void;

// zipbul-application.ts
class ZipbulApplication {
  private adapters: Map<string, ZipbulAdapter> = new Map();

  addAdapter(adapter: ZipbulAdapter, config: { name: string; protocol: string }): void;
  async start(): Promise<void>;  // dependsOn DAG 순서대로 adapter.start()
  async stop(): Promise<void>;   // 역순 stop
}
```

### 스펙 규칙 매핑

| 규칙 | 충족 방법 |
|---|---|
| ADAPTER-REGISTRATION-R-001 | `addAdapter()` 를 통한 런타임 등록 메커니즘 |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-003 | `dependsOn` 미지정 시 `'standalone'`으로 정규화 |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-004 | `dependsOn` 배열이 빈 배열이면 빌드 에러 |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-005 | `dependsOn` 참조가 같은 AdapterConfig 내 존재하는 adapterId인지 검증 |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-009 | dependsOn DAG 순환 감지 (topological sort) |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-010 | `adapterName`과 `AdapterRegistrationInput.name` 일치 검증 |

### 검증

```bash
bun test --filter "zipbul-application"
```

### 커밋 단위

```
feat(core): implement adapter registration and lifecycle management
```

---

## Phase 3 — Entry Decorators AOT 수집

> 데코레이터가 AOT에서 기계적으로 수집 가능하도록 규칙을 충족시킨다.
> 데코레이터 자체는 no-op 스텁을 유지한다(AOT-first 원칙).

### 선결 조건

- Phase 1 완료 (`adapterSpec.decorators` 선언 존재)

### 수정 대상

| 파일 | 줄 수 (현재) | 변경 |
|---|---|---|
| `packages/http-adapter/src/decorators/class.decorator.ts` | 9줄 | owner decorator 시그니처 정비 (0 args 또는 1 object literal arg) |
| `packages/http-adapter/src/decorators/method.decorator.ts` | 23줄 | handler decorator 시그니처 정비 |
| `packages/http-adapter/src/decorators/interfaces.ts` | 32줄 | `adapterIds` 필드 추가 (선택적) |

### ADAPTER-R-010 세부 규칙 체크리스트

- [ ] controller decorator: call expression, 0 args 또는 1 object literal arg
- [ ] `adapterIds` 존재 시: 비어있지 않은 AdapterId 문자열 리터럴 배열
- [ ] handler decorator: controller 클래스 메서드에만 적용
- [ ] handler 메서드 제약: 인스턴스 메서드, identifier name, `#private` 불가
- [ ] adapter member decorator는 owner-decorated 클래스 내부에서만 유효
- [ ] 위반 시 빌드 실패

### 스펙 규칙 매핑

| 규칙 | 충족 방법 |
|---|---|
| ADAPTER-R-010 | 데코레이터 시그니처가 AOT 수집 가능한 형태로 정비됨 |
| ADAPTER-ENTRY-DECORATORS-R-001 | entry decorators가 기계적으로 검사 가능 |

### 검증

```bash
bun test --filter "decorator"
```

### 커밋 단위

```
feat(http-adapter): align entry decorators with AOT collection contract
```

---

## Phase 4 — Pipeline Runtime

> 파이프라인 실행 순서, 미들웨어 배치, 에러 시 조기 종료를 구현한다.

### 선결 조건

- Phase 1 완료 (pipeline 선언)
- Phase 2 완료 (어댑터 등록)
- **D-3 결정** (Exception Filter catch target)

### 수정 대상

| 파일 | 줄 수 (현재) | 변경 |
|---|---|---|
| `packages/http-adapter/src/request-handler.ts` | 626줄 | 파이프라인 실행 순서를 `adapterSpec.pipeline` 기반으로 리팩터링 |
| `packages/http-adapter/src/zipbul-http-server.ts` | 448줄 | 미들웨어 배치를 `middlewarePhaseOrder` 기반으로 변경 |
| `packages/core/src/pipeline/` | 새 디렉토리 | 프로토콜-무관(protocol-agnostic) 파이프라인 실행기 (선택) |

### 핵심 구현 사항

1. **미들웨어 배치** (R-008): `middlewarePhaseOrder` 순서 기준, 같은 phase 내 선언 순서 보존, 미지원 phase id → 빌드 실패
2. **Exception filter chain** (R-009): 결정적 구성 순서, 중복 제거 없음
3. **HandlerId 결정** (R-011): adapter가 프로토콜 입력마다 정확히 하나의 handler를 빌드 타임에 결정, core에는 HandlerId만 노출
4. **미들웨어 Error 시 조기 종료** (R-012): middleware phase가 Error 반환 시 Guards/Pipes/Handler 실행하지 않음

### 스펙 규칙 매핑

| 규칙 | 충족 방법 |
|---|---|
| ADAPTER-R-008 | 미들웨어 배치 순서 구현 |
| ADAPTER-R-009 | exception filter chain 결정적 구성 |
| ADAPTER-R-011 | HandlerId 단일 선택, core에 HandlerId만 전달 |
| ADAPTER-R-012 | middleware Error → pipeline 조기 종료 |
| ADAPTER-MIDDLEWARE-PHASE-R-001 | middleware phase가 기계적으로 검증 가능 |
| ADAPTER-PIPELINE-SHAPE-R-001 | pipeline shape이 기계적으로 검증 가능 |

### 검증

```bash
bun test --filter "request-handler|pipeline"
```

### 커밋 단위

```
feat(http-adapter): implement spec-compliant pipeline execution order
feat(http-adapter): add middleware Error early-exit (ADAPTER-R-012)
```

---

## Phase 5 — AOT Diagnostics 정비

> CLI `adapter-spec-resolver.ts`를 새 `defineAdapter(objectLiteral)` API에 맞추고, 스펙 진단 코드를 구조화한다.

### 선결 조건

- Phase 0~4 전체 완료
- **D-1 결정** 반영 완료

### 수정 대상

| 파일 | 줄 수 (현재) | 변경 |
|---|---|---|
| `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts` | 970줄 | `defineAdapter(objectLiteral)` 파싱으로 전환, 진단 코드 구조화 |
| `packages/cli/src/compiler/analyzer/interfaces.ts` | 138줄 | `AdapterStaticSpec` 형상을 `AdapterRegistrationInput` 기반으로 정렬 |
| `packages/cli/src/compiler/diagnostics/` | 새 파일(들) | 구조화된 진단 코드 상수 |

### 진단 코드 매핑 (스펙 섹션 7 기준)

| Diagnostic Code | 규칙 | 위반 조건 |
|---|---|---|
| `ZIPBUL_ADAPTER_001` | R-001 | adapterSpec 수집 실패 또는 defineAdapter 입력 위반 |
| `ZIPBUL_ADAPTER_002` | R-002 | AdapterRegistrationInput 필드 수집/판정 불가 |
| `ZIPBUL_ADAPTER_003` | R-003 | classRef가 ZipbulAdapter 미상속 또는 abstract |
| `ZIPBUL_ADAPTER_004` | R-004 | pipeline 토큰 형상/예약 토큰 규칙 위반 |
| `ZIPBUL_ADAPTER_005` | R-005 | MiddlewarePhaseId 정규화 규칙 위반 |
| `ZIPBUL_ADAPTER_006` | R-006 | middlewarePhaseOrder/supportedMiddlewarePhases 불일치 |
| `ZIPBUL_ADAPTER_007` | R-007 | pipeline phase id 순서/대응 불일치 |
| `ZIPBUL_ADAPTER_008` | R-008 | middleware 배치 결정 불가 또는 미지원 phase id |
| `ZIPBUL_ADAPTER_009` | R-009 | exception filter chain 구성 결정 불가 또는 dedupe 발생 |
| `ZIPBUL_ADAPTER_010` | R-010 | entry decorator 사용/수집 규칙 위반 |
| `ZIPBUL_ADAPTER_011` | R-011 | handler 선택이 HandlerId로 결정 불가 |
| `ZIPBUL_ADAPTER_012` | R-012 | middleware Error 이후 실행 관측됨 |
| `ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_001~010` | CONFIG-R-001~010 | adapter-config.spec.md 섹션 7 참조 |

### 현재 CLI 상태와의 차이

현재 `adapter-spec-resolver.ts`는 `defineAdapter(ClassRef)` + static class fields 패턴을 기대한다:

```typescript
// 현재 CLI가 기대하는 형태
export const adapterSpec = defineAdapter(ZipbulHttpAdapter);
// → ZipbulHttpAdapter.adapterId, .middlewarePhaseOrder 등 static fields 파싱
```

스펙은 object literal 형태를 요구한다:

```typescript
// 스펙이 요구하는 형태
export const adapterSpec = defineAdapter({ name, classRef, pipeline, ... });
```

→ **D-1 결정에 따라** resolver 파싱 로직을 수정하거나 스펙을 조정.

### 검증

```bash
bun test --filter "adapter-spec-resolver"
```

### 커밋 단위

```
refactor(cli/analyzer): align adapter-spec-resolver with defineAdapter(objectLiteral)
feat(cli/diagnostics): add structured adapter diagnostic codes (ZIPBUL_ADAPTER_001~012)
```

---

## 실행 순서 요약

```
D-1 결정 (defineAdapter API 형태)
  │
  ▼
Phase 0  Foundation — 타입 + defineAdapter()  [@zipbul/common]
  │
  ▼
Phase 1  HTTP Adapter Spec Export  [@zipbul/http-adapter]
  │
  ├──────────────────┐
  ▼                  ▼
Phase 2            Phase 3
Core Registration  Entry Decorators
  │                  │
  ├──────────────────┘
  ▼
Phase 4  Pipeline Runtime  [@zipbul/http-adapter, @zipbul/core]
  │
  ▼
Phase 5  AOT Diagnostics 정비  [@zipbul/cli]
```

- Phase 2와 Phase 3은 병렬 진행 가능
- Phase 4는 Phase 2 + 3 모두 완료 후 진행
- Phase 5는 전체 구현 후 마지막

## 총 영향 범위

| 구분 | 파일 수 | 줄 수 (approx) |
|---|---|---|
| 새 파일 생성 | 5~7 | ~200 (타입, defineAdapter, adapter-spec, diagnostics) |
| 기존 파일 수정 | 8~10 | ~500 (application, resolver, request-handler, decorators 등) |
| 새 디렉토리 | 2 | `common/src/adapter/`, `cli/src/compiler/diagnostics/` |

## 미결 사항 결정 시점

| 미결 | 결정 시점 | 차단 대상 |
|---|---|---|
| D-1: defineAdapter API 형태 | **Phase 0 시작 전** | Phase 0, 1, 5 전체 |
| D-2: dependsOn 런타임 의미론 | Phase 2 시작 전 | Phase 2 lifecycle 부분 |
| D-3: Exception Filter catch target | Phase 4 시작 전 | Phase 4 exception filter 부분 |
