# Adapter Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | Adapter Specification                                                                                                                                                                          |
| ID               | ADAPTER                                                                                                                                                                                        |
| Version          | v1                                                                                                                                                                                             |
| Status           | Draft                                                                                                                                                                                          |
| Owner            | repo                                                                                                                                                                                           |
| Uniqueness Scope | repo                                                                                                                                                                                           |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/common/diagnostics.spec.md, path:docs/30_SPEC/module-system/module-system.spec.md, path:docs/30_SPEC/module-system/manifest.spec.md |
| Depended-By      | Generated                                                                                                                                                                                      |
| Supersedes       | none                                                                                                                                                                                           |

문서 참조 형식(Document Reference Format) (REQUIRED):

- `doc:<SPEC_ID>`
- `path:<relative-path>`
- `url:<https-url>`

Spec ID 형식(Spec ID Format) (REQUIRED):

- Spec ID MUST match: `^[A-Z0-9\-]+$`

필드 형식 제약(Field Format Constraints) (REQUIRED):

- `Depends-On` MUST contain only Document References or `none`.
- `Supersedes` MUST contain only a single Document Reference or `none`.

제약(Constraint) (REQUIRED): 모든 `doc:<SPEC_ID>` 형태의 Document Reference는 `doc:` 접두사를 제거한 나머지 부분이 Spec ID Regex를 만족해야 한다(MUST).

Rule ID 형식(Rule ID Format) (REQUIRED):

- Rule ID는 전역 유일해야 한다(MUST).
- Rule ID는 본 섹션의 Spec ID를 접두사로 가져야 한다(MUST).
- 형식: `<SPEC_ID>-R-<NNN>` (예: `MY-SPEC-ID-R-001`)
- Rule ID는 4~9 섹션에서 참조되기 전에 3.3 섹션에서 먼저 선언되어야 한다(MUST).

---

## 1. 범위 잠금(Scope Lock) (REQUIRED)

### 1.1 In-Scope (REQUIRED)

| Item                                                          |
| ------------------------------------------------------------- |
| Adapter 전용 데코레이터(엔트리 선언) 입력 계약                |
| AdapterRegistrationInput(defineAdapter 입력)의 정적 수집 제약 |
| Pipeline skeleton 입력 및 정규화(PhaseId 등) 계약             |
| Adapter가 소유하는 역할 경계(HandlerId 결정 책임 등)          |

### 1.2 Out-of-Scope (REQUIRED)

| Item                                                       |
| ---------------------------------------------------------- |
| 프로토콜별 출력/응답 렌더링 세부(예: HTTP 상태 코드 등)    |
| 정상 실행(파이프라인 실행) 의미론의 상세(정적 wiring 실행) |
| throw 처리(에러 필터 체인) 의미론                          |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 새로운 용어를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                                        | 헤딩(Heading)      |
| ------------------------- | ----------------------------------------------------- | ------------------ |
| dependency                | path:docs/30_SPEC/common/common.spec.md               | Token / FactoryRef |
| dependency                | path:docs/30_SPEC/common/diagnostics.spec.md          | HandlerId          |
| dependency                | path:docs/30_SPEC/module-system/module-system.spec.md | AdapterConfig      |
| dependency                | path:docs/30_SPEC/module-system/manifest.spec.md      | AdapterStaticSpec  |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind)     | 수집 출처(Collected From)                     | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| ------------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| adapterSpec               | package facade export                         | defineAdapter-call              | yes                                   | yes                                         | none                                            |
| adapterRegistrationInput  | defineAdapter arg                             | object-literal                  | yes                                   | yes                                         | none                                            |
| classRef                  | AdapterRegistrationInput                      | token-ref                       | no                                    | yes                                         | none                                            |
| pipeline                  | AdapterRegistrationInput                      | array-literal                   | yes                                   | yes                                         | none                                            |
| decorators                | AdapterRegistrationInput                      | object-literal                  | yes                                   | yes                                         | none                                            |
| middlewarePhase           | pipeline + decorator declarations             | phase-id-token                  | no                                    | yes                                         | string-id                                       |

### 3.1.1 Normalization Rules (REQUIRED if any Normalized Output != none)

| 정규화 출력(Normalized Output) | Rule ID       | 입력(Input(s))          | 출력 제약(Output Constraints)                                             | 안정성 보장(Stability Guarantees) (token list) | 강제 레벨(Enforced Level) (token) |
| ------------------------------ | ------------- | ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| string-id                      | ADAPTER-R-005 | InputKind:middlewarePhase | normalized MiddlewarePhase is a non-empty string and MUST NOT contain ":" | deterministic, stable                          | build                             |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type AdapterContractData = unknown;

export type AdapterSpecExportName = 'adapterSpec';

export type MiddlewarePhase = string;

export enum ReservedPipeline {
  Guards = 'Guards',
  Pipes = 'Pipes',
  Handler = 'Handler',
}

export type AdapterPipelines = (MiddlewarePhase | ReservedPipeline)[];

export type ClassRef = abstract new (...args: any[]) => any;

export type AdapterEntryDecorators = {
  controller: DecoratorRef;
  handler: DecoratorRef[];
};

export type AdapterRegistrationInput = {
  name: string;
  classRef: ClassRef;
  pipeline: AdapterPipelines;
  decorators: AdapterEntryDecorators;
  dependsOn?: Token[];
};
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID       | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)  | 타깃 참조(Target Ref(s))                                                                                         | 조건(Condition) (boolean, declarative)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 강제 레벨(Enforced Level) (token) |
| ------------- | --------------------------- | --------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| ADAPTER-R-001 | active                      | MUST            | inputs                      | InputKind:adapterSpec; InputKind:adapterRegistrationInput                                                        | adapterSpec is a named export "adapterSpec" and is a defineAdapter call with exactly one object literal argument                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | build                             |
| ADAPTER-R-002 | active                      | MUST            | artifacts, shapes, outcomes | Artifact:AdapterContract; Shape:local:AdapterContractData; Shape:local:AdapterRegistrationInput; Outcome:OUT-002 | AdapterRegistrationInput has statically decidable fields classRef/pipeline/decorators                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | build                             |
| ADAPTER-R-003 | active                      | MUST            | inputs, outcomes            | InputKind:classRef; Outcome:OUT-003                                                                              | classRef resolves to a concrete (non-abstract) class that extends ZipbulAdapter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | build                             |
| ADAPTER-R-004 | active                      | MUST            | inputs, outcomes            | InputKind:pipeline; Outcome:OUT-004                                                                              | pipeline is an array literal of AdapterPipelines and contains exactly one of each ReservedPipeline token (Guards, Pipes, Handler); custom middleware phases (MiddlewarePhase) must not be duplicated                                                                                                                                                                                                                                                                                                                                                                                                                                           | build                             |
| ADAPTER-R-005 | active                      | MUST            | inputs, outcomes            | InputKind:middlewarePhase; Outcome:OUT-005                                                                       | MiddlewarePhase normalization is deterministic: string literal stays identical; value never contains ":"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | build                             |
| ADAPTER-R-007 | active                      | MUST            | inputs, outcomes            | InputKind:pipeline; Outcome:OUT-007                                                                              | pipeline custom phases (MiddlewarePhase) must not contain duplicates; supported phases are derived from pipeline by excluding ReservedPipeline tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | build                             |
| ADAPTER-R-008 | active                      | MUST            | outcomes                    | Outcome:OUT-008                                                                                                  | middleware placement uses pipeline-derived phase order and preserves declaration order within the same phase; unknown phase id yields build failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | build                             |
| ADAPTER-R-009 | active                      | MUST            | outcomes                    | Outcome:OUT-009                                                                                                  | exception filter chain composition order is deterministic and duplicates are not removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | build                             |
| ADAPTER-R-010 | active                      | MUST            | inputs, outcomes            | InputKind:decorators; Outcome:OUT-010                                                                            | entry decorators are mechanically collectable and enforce: controller owner decorator usage (call expression with 0 args or 1 object literal arg); adapterIds constraint (if present then non-empty array literal of AdapterId string literals, each adapterId exists in module adapter config key set and its adapterName matches AdapterRegistrationInput.name); handler placement (handler decorators only on methods of controller classes); handler method constraints (instance method, identifier name, not private #); adapter member decorators are valid only inside owner-decorated classes; any invalid usage yields build failure | build                             |
| ADAPTER-R-011 | active                      | MUST            | outcomes                    | Outcome:OUT-011                                                                                                  | for each protocol input, adapter selects exactly one build-time-decided handler and exposes only HandlerId to core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | runtime                           |
| ADAPTER-R-012 | active                      | MUST NOT        | outcomes                    | Outcome:OUT-012                                                                                                  | when a middleware phase returns Error, subsequent Guards/Pipes/Handler execution is observable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | runtime                           |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference) | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------- |
| AdapterContract           | schema             | local:AdapterContractData  | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                            |
| ------------------------- | ------------------------------------------------ |
| AdapterStaticSpec         | path:docs/30_SPEC/module-system/manifest.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here) |
| -------------------------------------- |
| AdapterStaticSpec (Manifest schema)    |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)             | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | ------------------------------------ | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| AdapterContract    | glob                            | docs/30_SPEC/adapter/adapter.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| adapter-spec-depends       | Artifact:AdapterStaticSpec                | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition)   | Rule ID       | 타깃 참조(Target Ref(s))           | Outcome ID | 관측 결과(Observable Outcome)                                       |
| ---------------------------- | ------------- | ---------------------------------- | ---------- | ------------------------------------------------------------------- |
| adapterSpec exported         | ADAPTER-R-001 | InputKind:adapterSpec              | OUT-001    | adapterSpec is collected as defineAdapter input                     |
| registration shape collected | ADAPTER-R-002 | InputKind:adapterRegistrationInput | OUT-002    | AdapterRegistrationInput required fields are decidable              |
| classRef resolved            | ADAPTER-R-003 | InputKind:classRef                 | OUT-003    | classRef is a concrete ZipbulAdapter subclass                       |
| pipeline collected           | ADAPTER-R-004 | InputKind:pipeline                 | OUT-004    | pipeline tokens and reserved token constraints are satisfied        |
| phase normalized             | ADAPTER-R-005 | InputKind:middlewarePhase          | OUT-005    | MiddlewarePhase normalization is stable                             |
| pipeline validated           | ADAPTER-R-007 | InputKind:pipeline                 | OUT-007    | pipeline has no duplicate custom phases; supported phases derived   |
| middleware placed            | ADAPTER-R-008 | Outcome:OUT-008                    | OUT-008    | middleware placement is deterministic and unknown phases fail build |
| exception filters composed   | ADAPTER-R-009 | Outcome:OUT-009                    | OUT-009    | exception filter chain is deterministically composed without dedupe |
| decorators collected         | ADAPTER-R-010 | InputKind:decorators               | OUT-010    | invalid decorator placement yields build failure                    |
| handler selected             | ADAPTER-R-011 | Outcome:OUT-011                    | OUT-011    | core observes only HandlerId for the selected handler               |
| middleware error observed    | ADAPTER-R-012 | Outcome:OUT-012                    | OUT-012    | Guards/Pipes/Handler are not executed after middleware Error        |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID       | 위반 조건(Violation Condition)                                 | Diagnostic Code    | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| ------------- | -------------------------------------------------------------- | ------------------ | ------------------------ | ------------------- | --------------------------------- |
| ADAPTER-R-001 | adapterSpec 수집 실패 또는 defineAdapter 입력 위반             | ZIPBUL_ADAPTER_001 | error                    | file                | static:ast                        |
| ADAPTER-R-002 | AdapterRegistrationInput 필드 수집/판정 불가                   | ZIPBUL_ADAPTER_002 | error                    | file                | static:ast                        |
| ADAPTER-R-003 | classRef가 ZipbulAdapter를 상속하지 않거나 abstract class      | ZIPBUL_ADAPTER_003 | error                    | symbol              | static:ast                        |
| ADAPTER-R-004 | pipeline 토큰 형상/예약 토큰 규칙 위반                         | ZIPBUL_ADAPTER_004 | error                    | file                | static:ast                        |
| ADAPTER-R-005 | MiddlewarePhase 정규화 규칙 위반                               | ZIPBUL_ADAPTER_005 | error                    | symbol              | static:ast                        |
| ADAPTER-R-007 | pipeline 내 커스텀 미들웨어 페이즈 중복                        | ZIPBUL_ADAPTER_007 | error                    | file                | static:ast                        |
| ADAPTER-R-008 | middleware 배치 결정 불가 또는 지원하지 않는 phase id 사용     | ZIPBUL_ADAPTER_008 | error                    | file                | static:artifact                   |
| ADAPTER-R-009 | exception filter chain 구성 결정 불가 또는 dedupe 발생         | ZIPBUL_ADAPTER_009 | error                    | file                | static:artifact                   |
| ADAPTER-R-010 | entry decorator 사용/수집 규칙 위반                            | ZIPBUL_ADAPTER_010 | error                    | file                | static:ast                        |
| ADAPTER-R-011 | handler 선택이 HandlerId로 결정 불가 또는 core로 라우팅을 위임 | ZIPBUL_ADAPTER_011 | error                    | range               | runtime:observation               |
| ADAPTER-R-012 | middleware Error 이후 Guards/Pipes/Handler 실행이 관측됨       | ZIPBUL_ADAPTER_012 | error                    | range               | runtime:observation               |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)                           |
| --------------------------------- | ----------------------------------------- |
| build                             | Static Contract violation                 |
| runtime                           | Observable Contract violation             |
| test                              | Non-deterministic or inconsistent outcome |

---

## 9. 인계(Handoff) (OPTIONAL)

| From                  | To Document                                             |
| --------------------- | ------------------------------------------------------- |
| Adapter static inputs | path:docs/30_SPEC/module-system/manifest.spec.md        |
| HandlerId format      | path:docs/30_SPEC/cli/handler-id.spec.md                |
| Execution semantics   | path:docs/30_SPEC/execution/execution.spec.md           |
| Error handling        | path:docs/30_SPEC/error-handling/error-handling.spec.md |

---

## 10. 토큰 세트(Token Sets) (REQUIRED)

| 토큰 필드(Token Field) | 허용 값(Allowed Values)                                       |
| ---------------------- | ------------------------------------------------------------- |
| Enforced By            | build, lint, test, manual                                     |
| Enforced Level         | build, runtime, test                                          |
| Severity               | trace, debug, info, warning, error, fatal                     |
| Where                  | file, symbol, range                                           |
| How Detectable         | static:ast, static:artifact, runtime:observation, test:assert |
| Write Authority        | this-spec-only, shared                                        |
| Uniqueness Scope       | repo, package, spec                                           |
| Document Reference     | `doc:<SPEC_ID>`, `path:<relative-path>`, `url:<https-url>`    |
| Pattern Kind           | glob, regex                                                   |
| Rule Lifecycle         | active, retired                                               |
| Rule Targets           | inputs, artifacts, shapes, outcomes, state                    |
| Term Reference Marker  | TERM(Term)                                                    |
| Term Key               | kebab-case (lowercase + digits + hyphen)                      |
| Boolean                | true, false                                                   |
| Yes/No                 | yes, no                                                       |
| Normalized Output      | none, string-id                                               |

---

- allowed forms (AST-level):
  - string literal (e.g., `"BeforeRequest"`)
  - enum member reference (e.g., `ReservedPipeline.Guards`, `HttpMiddlewarePhase.BeforeRequest`)
