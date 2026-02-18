# Common Result Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                               |
| ---------------- | --------------------------------------- |
| Title            | Common Result Specification             |
| ID               | COMMON-RESULT                           |
| Version          | v1                                      |
| Status           | Draft                                   |
| Owner            | repo                                    |
| Uniqueness Scope | spec                                    |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md |
| Depended-By      | Generated                               |
| Supersedes       | none                                    |

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

| Item                       |
| -------------------------- |
| Result/value-flow contract |

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

| 참조 유형(Reference Type) | 문서(Document)                          | 헤딩(Heading)   |
| ------------------------- | --------------------------------------- | --------------- |
| source                    | path:docs/30_SPEC/common/common.spec.md | common contract |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| result-flow           | code (AOT)                | type-level                      | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type ZipbulError<E extends object = Record<string, never>> = {
  __zipbul_error__: true;
  stack: string;
  cause: unknown;
  data: E;
};

export type Result<T, E extends object = ZipbulError<Record<string, never>>> = T | E;

export type CommonResultContractData = {
  result: unknown;
};
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID             | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)          | 타깃 참조(Target Ref(s))                                                                                                     | 조건(Condition) (boolean, declarative)                                                                                                                                                                                                                                                                     | 강제 레벨(Enforced Level) (token) |
| ------------------- | --------------------------- | --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| COMMON-RESULT-R-001 | active                      | MUST            | inputs, artifacts, shapes, outcomes | InputKind:result-flow, Artifact:CommonResultContract, Artifact:Result, Shape:local:CommonResultContractData, Outcome:OUT-001 | Result and ZipbulError contract is mechanically checkable                                                                                                                                                                                                                                                  | build                             |
| COMMON-RESULT-R-002 | active                      | MUST            | outcomes                            | Outcome:OUT-002                                                                                                              | isError(X) is true iff X.**zipbul_error** === true                                                                                                                                                                                                                                                         | runtime                           |
| COMMON-RESULT-R-003 | active                      | MUST            | outcomes                            | Outcome:OUT-003                                                                                                              | error helper returns ZipbulError and never throws                                                                                                                                                                                                                                                          | runtime                           |
| COMMON-RESULT-R-004 | active                      | MUST            | outcomes                            | Outcome:OUT-004                                                                                                              | when constructing ZipbulError from a single input value X: cause is exactly X; if X is an ECMAScript Error and X.stack is a non-empty string then stack equals X.stack else stack equals the captured stack at construction time; the created ZipbulError is frozen via Object.freeze before being exposed | runtime                           |
| COMMON-RESULT-R-005 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-005                                                                                                              | error helper throws                                                                                                                                                                                                                                                                                        | runtime                           |
| COMMON-RESULT-R-006 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-006                                                                                                              | isError helper throws                                                                                                                                                                                                                                                                                      | runtime                           |
| COMMON-RESULT-R-007 | active                      | MUST            | outcomes                            | Outcome:OUT-007                                                                                                              | statically observable Success object literal MUST NOT include **zipbul_error** === true without diagnostic                                                                                                                                                                                                 | build                             |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference)     | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | ------------------------------ | ---------------------------------- |
| CommonResultContract      | schema             | local:CommonResultContractData | this-spec-only                     |
| Result                    | schema             | local:Result                   | this-spec-only                     |

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

| 아티팩트(Artifact)   | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)           | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| -------------------- | ------------------------------- | ---------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| CommonResultContract | glob                            | docs/30_SPEC/common/result.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |
| Result               | glob                            | docs/30_SPEC/common/result.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| none                       | Artifact:none                             | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID             | 타깃 참조(Target Ref(s))      | Outcome ID | 관측 결과(Observable Outcome)                                             |
| -------------------------- | ------------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------- |
| result flow exists         | COMMON-RESULT-R-001 | Artifact:CommonResultContract | OUT-001    | result usage is checkable                                                 |
| runtime evaluates isError  | COMMON-RESULT-R-002 | Outcome:OUT-002               | OUT-002    | isError follows **zipbul_error** marker                                   |
| runtime calls error helper | COMMON-RESULT-R-003 | Outcome:OUT-003               | OUT-003    | error helper returns ZipbulError                                          |
| runtime constructs error   | COMMON-RESULT-R-004 | Outcome:OUT-004               | OUT-004    | ZipbulError cause/stack selection and freeze-before-expose are observable |
| runtime calls error helper | COMMON-RESULT-R-005 | Outcome:OUT-005               | OUT-005    | error helper does not throw                                               |
| runtime calls isError      | COMMON-RESULT-R-006 | Outcome:OUT-006               | OUT-006    | isError does not throw                                                    |
| build sees reserved field  | COMMON-RESULT-R-007 | Outcome:OUT-007               | OUT-007    | reserved field misuse yields diagnostic                                   |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID             | 위반 조건(Violation Condition)          | Diagnostic Code          | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| ------------------- | --------------------------------------- | ------------------------ | ------------------------ | ------------------- | --------------------------------- |
| COMMON-RESULT-R-001 | result contract violated                | ZIPBUL_COMMON_RESULT_001 | error                    | symbol              | static:ast                        |
| COMMON-RESULT-R-002 | isError marker violated                 | ZIPBUL_COMMON_RESULT_002 | error                    | range               | runtime:observation               |
| COMMON-RESULT-R-003 | error helper did not return ZipbulError | ZIPBUL_COMMON_RESULT_003 | error                    | range               | runtime:observation               |
| COMMON-RESULT-R-004 | ZipbulError construction violated       | ZIPBUL_COMMON_RESULT_004 | error                    | range               | runtime:observation               |
| COMMON-RESULT-R-005 | error helper threw                      | ZIPBUL_COMMON_RESULT_005 | error                    | range               | runtime:observation               |
| COMMON-RESULT-R-006 | isError helper threw                    | ZIPBUL_COMMON_RESULT_006 | error                    | range               | runtime:observation               |
| COMMON-RESULT-R-007 | reserved field misuse in Success        | ZIPBUL_COMMON_RESULT_007 | error                    | symbol              | static:ast                        |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)                           |
| --------------------------------- | ----------------------------------------- |
| build                             | Static Contract violation                 |
| runtime                           | Observable Contract violation             |
| test                              | Non-deterministic or inconsistent outcome |

---

## 9. 인계(Handoff) (OPTIONAL)

| From            | To Document                             |
| --------------- | --------------------------------------- |
| common contract | path:docs/30_SPEC/common/common.spec.md |

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
