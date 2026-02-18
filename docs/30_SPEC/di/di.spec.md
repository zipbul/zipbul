# Dependency Injection Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | Dependency Injection Specification                                                                                                                                                                                                                                          |
| ID               | DI                                                                                                                                                                                                                                                                          |
| Version          | v1                                                                                                                                                                                                                                                                          |
| Status           | Draft                                                                                                                                                                                                                                                                       |
| Owner            | repo                                                                                                                                                                                                                                                                        |
| Uniqueness Scope | repo                                                                                                                                                                                                                                                                        |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/common/declarations.spec.md, path:docs/30_SPEC/common/diagnostics.spec.md, path:docs/30_SPEC/module-system/module-system.spec.md, path:docs/30_SPEC/app/app.spec.md, path:docs/30_SPEC/provider/provider.spec.md |
| Depended-By      | Generated                                                                                                                                                                                                                                                                   |
| Supersedes       | none                                                                                                                                                                                                                                                                        |

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
| DI 그래프 연결 규칙 및 정적 wiring |
| visibleTo 해석 및 접근 제약        |
| app.get 성공/실패 조건             |

### 1.2 Out-of-Scope (REQUIRED)

| Item                            |
| ------------------------------- |
| provider lifecycle/scope 의미론 |
| 공통 Token/Result 정의          |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 추가적인 용어 정의를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                                | 헤딩(Heading)             |
| ------------------------- | --------------------------------------------- | ------------------------- |
| dependency                | path:docs/30_SPEC/common/common.spec.md       | InjectCall / Token /      |
| dependency                | path:docs/30_SPEC/common/declarations.spec.md | COMMON-DECLARATIONS-R-008 |
| dependency                | path:docs/30_SPEC/app/app.spec.md             | app.get surface           |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| inject-call           | code (AOT)                | call-expression                 | yes                                   | yes                                         | none                                            |
| app-get-call          | code (AOT)                | call-expression                 | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type DiContractData = unknown;
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID  | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)          | 타깃 참조(Target Ref(s))                                                                    | 조건(Condition) (boolean, declarative)                                                                                  | 강제 레벨(Enforced Level) (token) |
| -------- | --------------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| DI-R-001 | active                      | MUST            | inputs, artifacts, shapes, outcomes | InputKind:inject-call, Artifact:DiContractData, Shape:local:DiContractData, Outcome:OUT-001 | wiring is build-time only and cycles fail build                                                                         | build                             |
| DI-R-002 | active                      | MUST            | inputs, outcomes                    | InputKind:app-get-call, Outcome:OUT-002                                                     | app.get succeeds only for singleton + visibleTo=all                                                                     | build                             |
| DI-R-003 | active                      | MUST            | outcomes                            | Outcome:OUT-003                                                                             | InjectCall is replaced by static wiring and does not perform runtime token resolution                                   | build                             |
| DI-R-004 | active                      | MUST            | outcomes                            | Outcome:OUT-004                                                                             | InjectableOptions.visibleTo is deterministically interpreted as module allowlist and is not mixed                       | build                             |
| DI-R-005 | active                      | MUST            | outcomes                            | Outcome:OUT-005                                                                             | allowlist ModuleMarkerList is normalized deterministically with duplicates removed                                      | build                             |
| DI-R-006 | active                      | MUST            | outcomes                            | Outcome:OUT-006                                                                             | InjectCall.token and app.get token are statically determinable Token forms                                              | build                             |
| DI-R-007 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-007                                                                             | runtime reflection/container scanning resolves dependencies                                                             | runtime                           |
| DI-R-008 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-008                                                                             | runtime inject() is reachable from App-External Code                                                                    | runtime                           |
| DI-R-009 | active                      | MUST NOT        | outcomes                            | Outcome:OUT-009                                                                             | DI runtime behavior violates COMMON-DECLARATIONS-R-008 by executing TokenThunk or using it for runtime token resolution | runtime                           |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference) | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------- |
| DiContractData            | schema             | local:DiContractData       | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                         |
| ------------------------- | --------------------------------------------- |
| Token                     | path:docs/30_SPEC/common/declarations.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here)             |
| -------------------------------------------------- |
| Provider scope 의미론 (provider.spec)              |
| TokenThunk runtime prohibition (declarations.spec) |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)   | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | -------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| DiContractData     | glob                            | docs/30_SPEC/di/di.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| di-depends-on-token        | Artifact:Token                            | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID  | 타깃 참조(Target Ref(s)) | Outcome ID | 관측 결과(Observable Outcome)                                             |
| -------------------------- | -------- | ------------------------ | ---------- | ------------------------------------------------------------------------- |
| dependency cycle exists    | DI-R-001 | InputKind:inject-call    | OUT-001    | build failure with cycle details                                          |
| app.get called             | DI-R-002 | InputKind:app-get-call   | OUT-002    | non-singleton or not-all visibility fails                                 |
| inject-call exists         | DI-R-003 | InputKind:inject-call    | OUT-003    | build-time wiring replacement is observable and no runtime resolve exists |
| visibleTo declared         | DI-R-004 | InputKind:inject-call    | OUT-004    | interpretation is deterministic and non-mixed                             |
| allowlist declared         | DI-R-005 | InputKind:inject-call    | OUT-005    | normalized ModuleId list is deterministic                                 |
| token provided             | DI-R-006 | InputKind:inject-call    | OUT-006    | non-determinable token yields build failure                               |
| runtime starts             | DI-R-007 | Outcome:OUT-007          | OUT-007    | no reflection/scan-based resolution is observable                         |
| App-External Code executes | DI-R-008 | Outcome:OUT-008          | OUT-008    | inject() is not observable as a reachable API                             |
| runtime executes           | DI-R-009 | Outcome:OUT-009          | OUT-009    | TokenThunk is not executed for runtime resolution                         |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID  | 위반 조건(Violation Condition)                                      | Diagnostic Code | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| -------- | ------------------------------------------------------------------- | --------------- | ------------------------ | ------------------- | --------------------------------- |
| DI-R-001 | cycle resolved as success                                           | ZIPBUL_DI_001   | error                    | file                | static:ast                        |
| DI-R-002 | invalid app.get exists                                              | ZIPBUL_DI_002   | error                    | symbol              | static:ast                        |
| DI-R-003 | InjectCall performs runtime resolution                              | ZIPBUL_DI_003   | error                    | symbol              | static:ast                        |
| DI-R-004 | visibleTo mixed or non-determinable                                 | ZIPBUL_DI_004   | error                    | symbol              | static:ast                        |
| DI-R-005 | allowlist normalization non-deterministic                           | ZIPBUL_DI_005   | error                    | file                | test:assert                       |
| DI-R-006 | token not statically determinable                                   | ZIPBUL_DI_006   | error                    | symbol              | static:ast                        |
| DI-R-007 | runtime reflection/scan observed                                    | ZIPBUL_DI_007   | error                    | range               | runtime:observation               |
| DI-R-008 | App-External Code inject() reachable                                | ZIPBUL_DI_008   | error                    | symbol              | runtime:observation               |
| DI-R-009 | TokenThunk executed at runtime (violates COMMON-DECLARATIONS-R-008) | ZIPBUL_DI_009   | error                    | range               | runtime:observation               |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)               |
| --------------------------------- | ----------------------------- |
| build                             | Static Contract violation     |
| runtime                           | Observable Contract violation |

---

## 9. 인계(Handoff) (OPTIONAL)

| From               | To Document                                 |
| ------------------ | ------------------------------------------- |
| provider lifecycle | path:docs/30_SPEC/provider/provider.spec.md |

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
| Boolean                | true, false                                                   |
| Yes/No                 | yes, no                                                       |
| Normalized Output      | none, string-id                                               |

---
