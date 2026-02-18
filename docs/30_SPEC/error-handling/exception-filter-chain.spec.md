# Error Handling Exception Filter Chain Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                               |
| ---------------- | ------------------------------------------------------- |
| Title            | Error Handling Exception Filter Chain Specification     |
| ID               | ERROR-HANDLING-EXCEPTION-FILTER-CHAIN                   |
| Version          | v1                                                      |
| Status           | Draft                                                   |
| Owner            | repo                                                    |
| Uniqueness Scope | spec                                                    |
| Depends-On       | path:docs/30_SPEC/error-handling/error-handling.spec.md |
| Depended-By      | Generated                                               |
| Supersedes       | none                                                    |

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

| Item                            |
| ------------------------------- |
| Exception filter chain contract |

### 1.2 Out-of-Scope (REQUIRED)

| Item |
| ---- |
| none |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 새로운 용어를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                                          | 헤딩(Heading)           |
| ------------------------- | ------------------------------------------------------- | ----------------------- |
| source                    | path:docs/30_SPEC/error-handling/error-handling.spec.md | error-handling contract |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind)  | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| ---------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| exception-filter-chain | code (AOT)                | ast-form                        | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type ContractData = unknown;
```

### 3.3 Shape Rules (REQUIRED)

|                                     Rule ID | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)          | 타깃 참조(Target Ref(s))                                                                           | 조건(Condition) (boolean, declarative)           | 강제 레벨(Enforced Level) (token) |
| ------------------------------------------: | --------------------------- | --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| ERROR-HANDLING-EXCEPTION-FILTER-CHAIN-R-001 | active                      | MUST            | inputs, artifacts, shapes, outcomes | InputKind:exception-filter-chain, Artifact:ContractData, Shape:local:ContractData, Outcome:OUT-001 | exception filter chain is mechanically checkable | build                             |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference) | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------- |
| ContractData              | schema             | local:ContractData         | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In) |
| ------------------------- | --------------------- |
| none                      | none                  |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here) |
| -------------------------------------- |
| none                                   |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)                                   | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | ---------------------------------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| ContractData       | glob                            | docs/30_SPEC/error-handling/exception-filter-chain.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| none                       | Artifact:none                             | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition)      |                                     Rule ID | 타깃 참조(Target Ref(s)) | Outcome ID | 관측 결과(Observable Outcome)       |
| ------------------------------- | ------------------------------------------: | ------------------------ | ---------: | ----------------------------------- |
| exception filter chain declared | ERROR-HANDLING-EXCEPTION-FILTER-CHAIN-R-001 | Artifact:ContractData    |    OUT-001 | exception filter chain is checkable |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------: | --------------- | ------------------------------------------- |
| none     |    none | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

|                                     Rule ID | 위반 조건(Violation Condition) | Diagnostic Code                                  | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| ------------------------------------------: | ------------------------------ | ------------------------------------------------ | ------------------------ | ------------------- | --------------------------------- |
| ERROR-HANDLING-EXCEPTION-FILTER-CHAIN-R-001 | invalid exception filter chain | ZIPBUL_ERROR_HANDLING_EXCEPTION_FILTER_CHAIN_001 | error                    | symbol              | static:ast                        |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)                           |
| --------------------------------- | ----------------------------------------- |
| build                             | Static Contract violation                 |
| runtime                           | Observable Contract violation             |
| test                              | Non-deterministic or inconsistent outcome |

---

## 9. 인계(Handoff) (OPTIONAL)

| From                    | To Document                                             |
| ----------------------- | ------------------------------------------------------- |
| error-handling contract | path:docs/30_SPEC/error-handling/error-handling.spec.md |

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
| Term Reference Marker  | TERM(Term)                                                    |
| Term Key               | kebab-case (lowercase + digits + hyphen)                      |
| Boolean                | true, false                                                   |
| Yes/No                 | yes, no                                                       |
| Normalized Output      | none, string-id                                               |
