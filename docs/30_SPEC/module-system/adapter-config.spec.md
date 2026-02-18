# Module System Adapter Config Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | Module System Adapter Config Specification                                                                                                      |
| ID               | MODULE-SYSTEM-ADAPTER-CONFIG                                                                                                                    |
| Version          | v1                                                                                                                                              |
| Status           | Draft                                                                                                                                           |
| Owner            | repo                                                                                                                                            |
| Uniqueness Scope | spec                                                                                                                                            |
| Depends-On       | path:docs/30_SPEC/module-system/module-system.spec.md, path:docs/30_SPEC/common/identity.spec.md, path:docs/30_SPEC/common/declarations.spec.md |
| Depended-By      | Generated                                                                                                                                       |
| Supersedes       | none                                                                                                                                            |

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

| Item                                             |
| ------------------------------------------------ |
| Adapter configuration surface exposed by modules |

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

| 참조 유형(Reference Type) | 문서(Document)                                        | 헤딩(Heading)          |
| ------------------------- | ----------------------------------------------------- | ---------------------- |
| source                    | path:docs/30_SPEC/module-system/module-system.spec.md | module-system contract |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| adapter-config        | code (AOT)                | ast-form                        | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type AdapterDependsOn = 'standalone' | string[];

export type JsonLiteralValue = string | number | boolean | null | JsonLiteralValue[] | { [key: string]: JsonLiteralValue };

export type MiddlewareRegistrationInput = Token | { token: Token; options?: JsonLiteralValue };

export type MiddlewareRegistry = {
  [key: string]: MiddlewareRegistrationInput[];
};

export type PipelineStep = FactoryRef;
export type PipelineStepList = PipelineStep[];
export type ExceptionFilterRefList = FactoryRef[];

export type AdapterInstanceConfig = {
  adapterName: string;
  dependsOn?: AdapterDependsOn;
  middlewares?: MiddlewareRegistry;
  guards?: PipelineStepList;
  pipes?: PipelineStepList;
  exceptionFilters?: ExceptionFilterRefList;
};

export type AdapterConfig = {
  [key: string]: AdapterInstanceConfig;
};

export type ContractData = {
  adapters: AdapterConfig;
};
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID                            | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)          | 타깃 참조(Target Ref(s))                                                                   | 조건(Condition) (boolean, declarative)                                                                                                                                | 강제 레벨(Enforced Level) (token) |
| ---------------------------------- | --------------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-001 | active                      | MUST            | inputs, artifacts, shapes, outcomes | InputKind:adapter-config, Artifact:ContractData, Shape:local:ContractData, Outcome:OUT-001 | adapter config is mechanically checkable                                                                                                                              | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-002 | active                      | MUST            | shapes, outcomes                    | Shape:local:AdapterConfig, Outcome:OUT-002                                                 | AdapterConfig keys are deterministically normalized by code point ascending                                                                                           | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-003 | active                      | MUST            | shapes, outcomes                    | Shape:local:AdapterInstanceConfig, Outcome:OUT-003                                         | dependsOn omitted is normalized to "standalone"                                                                                                                       | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-004 | active                      | MUST            | shapes, outcomes                    | Shape:local:AdapterDependsOn, Outcome:OUT-004                                              | dependsOn list MUST NOT be empty                                                                                                                                      | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-005 | active                      | MUST            | outcomes                            | Outcome:OUT-005                                                                            | dependsOn list references only AdapterIds present in the same AdapterConfig key set                                                                                   | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-006 | active                      | MUST            | shapes, outcomes                    | Shape:local:MiddlewareRegistry, Outcome:OUT-006                                            | middlewares keys and values are mechanically checkable registry entries                                                                                               | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-007 | active                      | MUST            | shapes, outcomes                    | Shape:local:PipelineStepList, Outcome:OUT-007                                              | guards and pipes are PipelineStepList when present                                                                                                                    | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-008 | active                      | MUST            | shapes, outcomes                    | Shape:local:ExceptionFilterRefList, Outcome:OUT-008                                        | exceptionFilters is an array of references when present                                                                                                               | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-009 | active                      | MUST            | outcomes                            | Outcome:OUT-009                                                                            | dependsOn dependency graph is acyclic and cyclic dependsOn yields build failure with cycle details                                                                    | build                             |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-010 | active                      | MUST            | outcomes                            | Outcome:OUT-010                                                                            | AdapterInstanceConfig.adapterName is build-time resolvable and MUST match the referenced adapter package AdapterRegistrationInput.name; mismatch yields build failure | build                             |

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

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)                          | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | ------------------------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| ContractData       | glob                            | docs/30_SPEC/module-system/adapter-config.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| none                       | Artifact:none                             | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID                            | 타깃 참조(Target Ref(s))           | Outcome ID | 관측 결과(Observable Outcome)                 |
| -------------------------- | ---------------------------------- | ---------------------------------- | ---------- | --------------------------------------------- |
| adapter config declared    | MODULE-SYSTEM-ADAPTER-CONFIG-R-001 | Artifact:ContractData              | OUT-001    | adapter config is checkable                   |
| adapter config normalized  | MODULE-SYSTEM-ADAPTER-CONFIG-R-002 | Shape:local:AdapterConfig          | OUT-002    | adapter keys are normalized deterministically |
| dependsOn omitted          | MODULE-SYSTEM-ADAPTER-CONFIG-R-003 | Shape:local:AdapterInstanceConfig  | OUT-003    | dependsOn defaults to standalone              |
| dependsOn list declared    | MODULE-SYSTEM-ADAPTER-CONFIG-R-004 | Shape:local:AdapterDependsOn       | OUT-004    | empty dependsOn list is rejected              |
| dependsOn references       | MODULE-SYSTEM-ADAPTER-CONFIG-R-005 | Outcome:OUT-005                    | OUT-005    | invalid adapterId reference is rejected       |
| middlewares declared       | MODULE-SYSTEM-ADAPTER-CONFIG-R-006 | Shape:local:MiddlewareRegistry     | OUT-006    | middleware registry is validated              |
| guards/pipes declared      | MODULE-SYSTEM-ADAPTER-CONFIG-R-007 | Shape:local:PipelineStepList       | OUT-007    | pipeline step lists are validated             |
| exception filters declared | MODULE-SYSTEM-ADAPTER-CONFIG-R-008 | Shape:local:ExceptionFilterRefList | OUT-008    | exception filter refs list is validated       |
| dependsOn graph built      | MODULE-SYSTEM-ADAPTER-CONFIG-R-009 | Outcome:OUT-009                    | OUT-009    | cyclic dependsOn is rejected                  |
| adapterName resolved       | MODULE-SYSTEM-ADAPTER-CONFIG-R-010 | Outcome:OUT-010                    | OUT-010    | adapterName mismatch is rejected              |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID                            | 위반 조건(Violation Condition)                            | Diagnostic Code                         | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------- | ------------------------ | ------------------- | --------------------------------- |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-001 | invalid adapter config                                    | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_001 | error                    | symbol              | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-002 | non-deterministic adapter key order                       | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_002 | error                    | file                | test:assert                       |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-003 | dependsOn defaulting violated                             | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_003 | error                    | symbol              | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-004 | empty dependsOn list                                      | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_004 | error                    | symbol              | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-005 | dependsOn references missing adapterId                    | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_005 | error                    | symbol              | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-006 | invalid middlewares registry                              | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_006 | error                    | symbol              | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-007 | invalid guards/pipes list                                 | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_007 | error                    | symbol              | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-008 | invalid exceptionFilters list                             | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_008 | error                    | symbol              | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-009 | dependsOn cycle detected                                  | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_009 | error                    | file                | static:ast                        |
| MODULE-SYSTEM-ADAPTER-CONFIG-R-010 | adapterName mismatch or unresolvable adapter package name | ZIPBUL_MODULE_SYSTEM_ADAPTER_CONFIG_010 | error                    | symbol              | static:ast                        |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)                           |
| --------------------------------- | ----------------------------------------- |
| build                             | Static Contract violation                 |
| runtime                           | Observable Contract violation             |
| test                              | Non-deterministic or inconsistent outcome |

---

## 9. 인계(Handoff) (OPTIONAL)

| From                   | To Document                                           |
| ---------------------- | ----------------------------------------------------- |
| module-system contract | path:docs/30_SPEC/module-system/module-system.spec.md |

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
