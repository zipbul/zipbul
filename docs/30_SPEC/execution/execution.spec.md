# Execution Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | Execution Specification                                                                                                                                                                                                             |
| ID               | EXECUTION                                                                                                                                                                                                                           |
| Version          | v1                                                                                                                                                                                                                                  |
| Status           | Draft                                                                                                                                                                                                                               |
| Owner            | repo                                                                                                                                                                                                                                |
| Uniqueness Scope | repo                                                                                                                                                                                                                                |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/common/diagnostics.spec.md, path:docs/30_SPEC/module-system/manifest.spec.md, path:docs/30_SPEC/app/app.spec.md, path:docs/30_SPEC/error-handling/error-handling.spec.md |
| Depended-By      | Generated                                                                                                                                                                                                                           |
| Supersedes       | none                                                                                                                                                                                                                                |

문서 참조 형식(Document Reference Format) (REQUIRED):

- `doc:<SPEC_ID>`
- `path:<relative-path>`
- `url:<https-url>`

Spec ID 형식(Spec ID Format) (REQUIRED):

- Spec ID MUST match: `^[A-Z0-9\-]+$`

필드 형식 제약(Field Format Constraints) (REQUIRED):

- Depends-On MUST contain only Document References or none.
- Supersedes MUST contain only a single Document Reference or none.

제약(Constraint) (REQUIRED): 모든 `doc:<SPEC_ID>` 형태의 Document Reference는 `doc:` 접두사를 제거한 나머지 부분이 Spec ID Regex를 만족해야 한다(MUST).

Rule ID 형식(Rule ID Format) (REQUIRED):

- Rule ID는 전역 유일해야 한다(MUST).
- Rule ID는 본 섹션의 Spec ID를 접두사로 가져야 한다(MUST).
- 형식: `<SPEC_ID>-R-<NNN>`
- Rule ID는 4~9 섹션에서 참조되기 전에 3.3 섹션에서 먼저 선언되어야 한다(MUST).

---

## 1. 범위 잠금(Scope Lock) (REQUIRED)

### 1.1 In-Scope (REQUIRED)

| Item                                  |
| ------------------------------------- |
| manifest pipeline 기반 정상 실행 순서 |
| metadata 접근 금지/throw 관측         |

### 1.2 Out-of-Scope (REQUIRED)

| Item                       |
| -------------------------- |
| throw 처리 상세(필터 체인) |
| 프로토콜별 입출력          |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 추가적인 용어 정의를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                                   | 헤딩(Heading)              |
| ------------------------- | ------------------------------------------------ | -------------------------- |
| dependency                | path:docs/30_SPEC/module-system/manifest.spec.md | AdapterStaticSpec.pipeline |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| pipeline              | manifest                  | json                            | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type ExecutionContractData = unknown;
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID         | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)          | 타깃 참조(Target Ref(s))                                                                               | 조건(Condition) (boolean, declarative)                                                                             | 강제 레벨(Enforced Level) (token) |
| --------------- | --------------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| EXECUTION-R-001 | active                      | MUST            | inputs, artifacts, shapes, outcomes | InputKind:pipeline, Artifact:ExecutionContractData, Shape:local:ExecutionContractData, Outcome:OUT-001 | pipeline execution order follows manifest AdapterStaticSpec.pipeline                                               | runtime                           |
| EXECUTION-R-002 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-002                                                                                        | runtime can access manifest after bootstrap                                                                        | runtime                           |
| EXECUTION-R-003 | active                      | MUST            | outcomes                            | Outcome:OUT-003                                                                                        | normal execution is expressed as Result value flow                                                                 | runtime                           |
| EXECUTION-R-004 | active                      | MUST            | outcomes                            | Outcome:OUT-004                                                                                        | Context is passed to each pipeline step following the same pipeline order                                          | runtime                           |
| EXECUTION-R-005 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-005                                                                                        | transform/validate is inserted implicitly outside declared pipeline steps                                          | runtime                           |
| EXECUTION-R-006 | active                      | MUST            | outcomes                            | Outcome:OUT-006                                                                                        | middleware/guard/pipe/handler/exception filter are treated as DI wiring nodes resolved from build-time connections | runtime                           |
| EXECUTION-R-007 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-007                                                                                        | execution flow is dynamically reconfigured or inferred at runtime                                                  | runtime                           |
| EXECUTION-R-008 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-008                                                                                        | user function bodies are rewritten to enforce semantics                                                            | build                             |
| EXECUTION-R-009 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-009                                                                                        | runtime container resolve/lookup is part of the normal execution flow                                              | runtime                           |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference)  | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | --------------------------- | ---------------------------------- |
| ExecutionContractData     | schema             | local:ExecutionContractData | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                   |
| ------------------------- | --------------------------------------- |
| Result                    | path:docs/30_SPEC/common/result.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here)       |
| -------------------------------------------- |
| exception filter chain (error-handling.spec) |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact)    | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)                 | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| --------------------- | ------------------------------- | ---------------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| ExecutionContractData | glob                            | docs/30_SPEC/execution/execution.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule)  | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| --------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| execution-depends-on-result | Artifact:Result                           | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID         | 타깃 참조(Target Ref(s)) | Outcome ID | 관측 결과(Observable Outcome)                                            |
| -------------------------- | --------------- | ------------------------ | ---------- | ------------------------------------------------------------------------ |
| request processed          | EXECUTION-R-001 | InputKind:pipeline       | OUT-001    | middleware/guard/pipe/handler runs in manifest order                     |
| bootstrap completed        | EXECUTION-R-002 | Outcome:OUT-002          | OUT-002    | manifest access throws                                                   |
| normal request processed   | EXECUTION-R-003 | Outcome:OUT-003          | OUT-003    | a Result value is observable as the normal execution output              |
| pipeline executed          | EXECUTION-R-004 | Outcome:OUT-004          | OUT-004    | Context is observable at every step and matches the same request context |
| pipe/validation present    | EXECUTION-R-005 | Outcome:OUT-005          | OUT-005    | no implicit transform/validate occurs without a declared step            |
| step resolved              | EXECUTION-R-006 | Outcome:OUT-006          | OUT-006    | dependencies are satisfied only via build-time wiring                    |
| runtime rewiring attempted | EXECUTION-R-007 | Outcome:OUT-007          | OUT-007    | rewiring/inference is not observable                                     |
| build performed            | EXECUTION-R-008 | Outcome:OUT-008          | OUT-008    | no source rewriting artifact is produced                                 |
| request processed          | EXECUTION-R-009 | Outcome:OUT-009          | OUT-009    | no runtime container lookup is observable as part of the step flow       |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID         | 위반 조건(Violation Condition)                   | Diagnostic Code | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| --------------- | ------------------------------------------------ | --------------- | ------------------------ | ------------------- | --------------------------------- |
| EXECUTION-R-001 | pipeline order violated                          | ZIPBUL_EXEC_001 | error                    | range               | runtime:observation               |
| EXECUTION-R-002 | manifest access reachable                        | ZIPBUL_EXEC_002 | error                    | symbol              | runtime:observation               |
| EXECUTION-R-003 | normal flow not expressed as Result              | ZIPBUL_EXEC_003 | error                    | range               | runtime:observation               |
| EXECUTION-R-004 | Context not passed to steps deterministically    | ZIPBUL_EXEC_004 | error                    | range               | runtime:observation               |
| EXECUTION-R-005 | implicit transform/validate observed             | ZIPBUL_EXEC_005 | error                    | range               | runtime:observation               |
| EXECUTION-R-006 | dependencies not satisfied by build-time wiring  | ZIPBUL_EXEC_006 | error                    | symbol              | runtime:observation               |
| EXECUTION-R-007 | runtime rewiring/inference observed              | ZIPBUL_EXEC_007 | error                    | range               | runtime:observation               |
| EXECUTION-R-008 | source rewriting observed                        | ZIPBUL_EXEC_008 | error                    | file                | static:artifact                   |
| EXECUTION-R-009 | runtime container resolve is part of normal flow | ZIPBUL_EXEC_009 | error                    | range               | runtime:observation               |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)               |
| --------------------------------- | ----------------------------- |
| runtime                           | Observable Contract violation |
| build                             | Static Contract violation     |

---

## 9. 인계(Handoff) (OPTIONAL)

| From       | To Document                                             |
| ---------- | ------------------------------------------------------- |
| panic 처리 | path:docs/30_SPEC/error-handling/error-handling.spec.md |

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
| Document Reference     | `doc:<SPEC_ID>, path:<relative-path>, url:<https-url>`        |
| Pattern Kind           | glob, regex                                                   |
| Rule Lifecycle         | active, retired                                               |
| Rule Targets           | inputs, artifacts, shapes, outcomes, state                    |
| Boolean                | true, false                                                   |
| Yes/No                 | yes, no                                                       |
| Normalized Output      | none, string-id                                               |

---
