# Error Handling Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                             |
| ---------------- | ------------------------------------------------------------------------------------- |
| Title            | Error Handling Specification                                                          |
| ID               | ERROR-HANDLING                                                                        |
| Version          | v1                                                                                    |
| Status           | Draft                                                                                 |
| Owner            | repo                                                                                  |
| Uniqueness Scope | repo                                                                                  |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/common/diagnostics.spec.md |
| Depended-By      | Generated                                                                             |
| Supersedes       | none                                                                                  |

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

| Item                               |
| ---------------------------------- |
| Error(Result) vs Panic(throw) 분리 |
| Exception Filter Chain 계약        |

### 1.2 Out-of-Scope (REQUIRED)

| Item                      |
| ------------------------- |
| 프로토콜별 상태코드/표현  |
| 정상 실행 파이프라인 구성 |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 추가적인 용어 정의를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document) | 헤딩(Heading) |
| ------------------------- | -------------- | ------------- |
| none                      | none           | none          |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| exception-filter      | code (AOT)                | decorator-annotated class       | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type ErrorHandlingContractData = unknown;
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID              | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)          | 타깃 참조(Target Ref(s))                                                                                               | 조건(Condition) (boolean, declarative)                                              | 강제 레벨(Enforced Level) (token) |
| -------------------- | --------------------------- | --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
| ERROR-HANDLING-R-001 | active                      | MUST            | inputs, artifacts, shapes, outcomes | InputKind:exception-filter, Artifact:ErrorHandlingContractData, Shape:local:ErrorHandlingContractData, Outcome:OUT-001 | thrown exception is converted to Result via exception filter chain                  | runtime                           |
| ERROR-HANDLING-R-002 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-002                                                                                                        | classify errors via message parsing                                                 | runtime                           |
| ERROR-HANDLING-R-003 | active                      | MUST            | outcomes                            | Outcome:OUT-003                                                                                                        | Error is represented as Result value flow and Panic is represented as throw         | runtime                           |
| ERROR-HANDLING-R-004 | active                      | MUST            | outcomes                            | Outcome:OUT-004                                                                                                        | exception filter chain application order is deterministic                           | runtime                           |
| ERROR-HANDLING-R-005 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-005                                                                                                        | protocol-specific information is embedded into domain error definitions             | build                             |
| ERROR-HANDLING-R-006 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-006                                                                                                        | exceptions bypass, are swallowed, or are lost without producing a Result error case | runtime                           |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference)      | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | ------------------------------- | ---------------------------------- |
| ErrorHandlingContractData | schema             | local:ErrorHandlingContractData | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                   |
| ------------------------- | --------------------------------------- |
| Result                    | path:docs/30_SPEC/common/result.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here)     |
| ------------------------------------------ |
| adapter status code mapping (adapter.spec) |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact)        | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)                           | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------------- | ------------------------------- | -------------------------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| ErrorHandlingContractData | glob                            | docs/30_SPEC/error-handling/error-handling.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule)       | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| error-handling-depends-on-result | Artifact:Result                           | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID              | 타깃 참조(Target Ref(s))   | Outcome ID | 관측 결과(Observable Outcome)                                  |
| -------------------------- | -------------------- | -------------------------- | ---------- | -------------------------------------------------------------- |
| panic occurs               | ERROR-HANDLING-R-001 | InputKind:exception-filter | OUT-001    | converted to Result error case                                 |
| classify by parsing        | ERROR-HANDLING-R-002 | Outcome:OUT-002            | OUT-002    | not allowed; must be violation                                 |
| normal error produced      | ERROR-HANDLING-R-003 | Outcome:OUT-003            | OUT-003    | Result error case is observable without throw                  |
| chain applied              | ERROR-HANDLING-R-004 | Outcome:OUT-004            | OUT-004    | filter evaluation order is stable for identical inputs         |
| domain error declared      | ERROR-HANDLING-R-005 | Outcome:OUT-005            | OUT-005    | protocol mapping is not present in domain error definition     |
| panic occurs               | ERROR-HANDLING-R-006 | Outcome:OUT-006            | OUT-006    | no swallowed exception is observable; Result error is produced |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID              | 위반 조건(Violation Condition)         | Diagnostic Code | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| -------------------- | -------------------------------------- | --------------- | ------------------------ | ------------------- | --------------------------------- |
| ERROR-HANDLING-R-001 | exception bypasses chain               | ZIPBUL_ERR_001  | error                    | range               | runtime:observation               |
| ERROR-HANDLING-R-002 | parsing-based classification           | ZIPBUL_ERR_002  | error                    | symbol              | static:ast                        |
| ERROR-HANDLING-R-003 | Error/Panic split violated             | ZIPBUL_ERR_003  | error                    | range               | runtime:observation               |
| ERROR-HANDLING-R-004 | non-deterministic filter order         | ZIPBUL_ERR_004  | error                    | range               | runtime:observation               |
| ERROR-HANDLING-R-005 | protocol info embedded in domain error | ZIPBUL_ERR_005  | error                    | symbol              | static:ast                        |
| ERROR-HANDLING-R-006 | exception swallowed/lost               | ZIPBUL_ERR_006  | error                    | range               | runtime:observation               |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)               |
| --------------------------------- | ----------------------------- |
| runtime                           | Observable Contract violation |
| build                             | Static Contract violation     |

---

## 9. 인계(Handoff) (OPTIONAL)

| From             | To Document                               |
| ---------------- | ----------------------------------------- |
| protocol mapping | path:docs/30_SPEC/adapter/adapter.spec.md |

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
