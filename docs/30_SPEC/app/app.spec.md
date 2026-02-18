# App Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title            | App Specification                                                                                                                                                                                                                                                                                                                                                                          |
| ID               | APP                                                                                                                                                                                                                                                                                                                                                                                        |
| Version          | v1                                                                                                                                                                                                                                                                                                                                                                                         |
| Status           | Draft                                                                                                                                                                                                                                                                                                                                                                                      |
| Owner            | repo                                                                                                                                                                                                                                                                                                                                                                                       |
| Uniqueness Scope | repo                                                                                                                                                                                                                                                                                                                                                                                       |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/common/declarations.spec.md, path:docs/30_SPEC/di/di.spec.md, path:docs/30_SPEC/provider/provider.spec.md, path:docs/30_SPEC/execution/execution.spec.md, path:docs/30_SPEC/error-handling/error-handling.spec.md, path:docs/30_SPEC/module-system/module-system.spec.md, path:docs/30_SPEC/module-system/define-module.spec.md |
| Depended-By      | Generated                                                                                                                                                                                                                                                                                                                                                                                  |
| Supersedes       | none                                                                                                                                                                                                                                                                                                                                                                                       |

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

| Item                                     |
| ---------------------------------------- |
| createApplication 부트스트랩 및 preload  |
| app.start / app.stop / app.get 관측 의미 |
| app.attach 입력/제약                     |
| lifecycle hook 수집/호출 결정성          |

### 1.2 Out-of-Scope (REQUIRED)

| Item                             |
| -------------------------------- |
| DI 그래프 구성/순환 판정         |
| Provider scope/init/dispose 상세 |
| Protocol-specific I/O            |
| Exception filter chain 상세      |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 추가적인 용어 정의를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                              | 헤딩(Heading)      |
| ------------------------- | ------------------------------------------- | ------------------ |
| dependency                | path:docs/30_SPEC/di/di.spec.md             | app.get 성공 조건  |
| dependency                | path:docs/30_SPEC/provider/provider.spec.md | lifecycle ordering |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| app-entry             | code (AOT)                | module-ref                      | yes                                   | yes                                         | string-id                                       |

### 3.1.1 Normalization Rules (REQUIRED)

| 정규화 출력(Normalized Output) | Rule ID   | 입력(Input(s)) | 출력 제약(Output Constraints)                                                                             | 안정성 보장(Stability Guarantees) (token list) | 강제 레벨(Enforced Level) (token) |
| ------------------------------ | --------- | -------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| string-id                      | APP-R-017 | app-entry      | string-id MUST equal path:{module-file}#{export-name} and export-name MUST be default for default exports | stable                                         | build                             |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type AppLifecycleHookMethodName =
  | 'onModuleInit'
  | 'onModuleDestroy'
  | 'onApplicationBootstrap'
  | 'beforeApplicationShutdown'
  | 'onApplicationShutdown';

export type AppLifecycleHookTarget = 'injectable';

export type AppLifecycleHookDeclaration = {
  target: AppLifecycleHookTarget;
  methodName: AppLifecycleHookMethodName;
  token?: Token;
};

export type EntryModule = ModuleMarker;

export type AppConfigInput = {
  env?: string[];
  loader?: FactoryRef;
};

export type ConfigRawValue = { [k: string]: ConfigRawValue } | ConfigRawValue[] | string | number | boolean | null;

export type ConfigSectionRegistrationDeclaration = {
  token: Token;
  raw: ConfigRawValue;
};

export type AppContractData = {
  lifecycleHooks?: AppLifecycleHookDeclaration[];
  config?: AppConfigInput;
  configSections?: ConfigSectionRegistrationDeclaration[];
};
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID   | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list)  | 타깃 참조(Target Ref(s))                                           | 조건(Condition) (boolean, declarative)                                                                                       | 강제 레벨(Enforced Level) (token) |
| --------- | --------------------------- | --------------- | --------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| APP-R-001 | active                      | MUST            | artifacts, shapes, outcomes | Artifact:AppContract, Shape:local:AppContractData, Outcome:OUT-001 | createApplication is async and completes only after preload                                                                  | runtime                           |
| APP-R-002 | active                      | MUST            | inputs, outcomes            | InputKind:app-entry, Outcome:OUT-002                               | createApplication takes exactly one entry module and it is statically resolvable                                             | build                             |
| APP-R-003 | active                      | MUST            | outcomes                    | Outcome:OUT-003                                                    | env/config preload results are stable for runtime lifetime                                                                   | runtime                           |
| APP-R-004 | active                      | MUST            | outcomes                    | Outcome:OUT-004                                                    | env preload uses AppConfigInput.env when provided                                                                            | runtime                           |
| APP-R-005 | active                      | MUST            | outcomes                    | Outcome:OUT-005                                                    | config preload runs only when AppConfigInput.loader exists                                                                   | runtime                           |
| APP-R-006 | active                      | MUST            | outcomes                    | Outcome:OUT-006                                                    | loader failures are observable as throw from createApplication                                                               | runtime                           |
| APP-R-007 | active                      | MUST NOT        | outcomes                    | Outcome:OUT-007                                                    | framework applies timeout or retry to loader execution                                                                       | runtime                           |
| APP-R-008 | active                      | MUST            | outcomes                    | Outcome:OUT-008                                                    | attach is called only before start and adapterId exists in module adapter config keys                                        | runtime                           |
| APP-R-009 | active                      | MUST NOT        | outcomes                    | Outcome:OUT-009                                                    | attach changes static graph/manifest-derived wiring                                                                          | runtime                           |
| APP-R-010 | active                      | MUST            | outcomes                    | Outcome:OUT-010                                                    | app.get is the only external access path to DI results and follows DI success conditions                                     | runtime                           |
| APP-R-011 | active                      | MUST            | outcomes                    | Outcome:OUT-011                                                    | lifecycle hooks are determined by AST collection and called in deterministic order                                           | runtime                           |
| APP-R-012 | active                      | MUST            | outcomes                    | Outcome:OUT-012                                                    | app.stop disposes owned resources and aggregates shutdown errors deterministically                                           | runtime                           |
| APP-R-014 | active                      | MUST            | outcomes                    | Outcome:OUT-014                                                    | if any shutdown throw is observed, app.stop throws an AggregateError instance after cleanup completes                        | runtime                           |
| APP-R-015 | active                      | MUST            | outcomes                    | Outcome:OUT-015                                                    | AggregateError.errors preserves the observation order of shutdown throws                                                     | runtime                           |
| APP-R-016 | active                      | MUST NOT        | outcomes                    | Outcome:OUT-016                                                    | shutdown throw values in AggregateError.errors are wrapped/normalized/converted instead of being included by strict equality | runtime                           |
| APP-R-013 | active                      | MUST NOT        | outcomes                    | Outcome:OUT-013                                                    | createApplication/app.start/app.stop/app.get/app.attach returns Result                                                       | runtime                           |
| APP-R-017 | active                      | MUST            | inputs, outcomes            | InputKind:app-entry, Outcome:OUT-017                               | app-entry normalization produces string-id with required format                                                              | build                             |
| APP-R-018 | active                      | MUST            | outcomes                    | Outcome:OUT-018                                                    | ZipbulApplication is unique per process/worker; multiple createApplication calls are rejected by CLI as error                | build                             |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference) | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------- |
| AppContract               | schema             | local:AppContractData      | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                         |
| ------------------------- | --------------------------------------------- |
| Token                     | path:docs/30_SPEC/common/declarations.spec.md |
| FactoryRef                | path:docs/30_SPEC/common/declarations.spec.md |
| ModuleMarker              | path:docs/30_SPEC/common/declarations.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here) |
| -------------------------------------- |
| none                                   |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)     | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | ---------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| AppContract        | glob                            | docs/30_SPEC/app/app.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| --- | --- | --- | --- | --- | --- |
| app-depends-on-common-declarations | Artifact:Token; Artifact:FactoryRef; Artifact:ModuleMarker | allowed | forbidden | lint | n/a |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition)                                                | Rule ID   | 타깃 참조(Target Ref(s)) | Outcome ID | 관측 결과(Observable Outcome)                                                                                       |
| ------------------------------------------------------------------------- | --------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| createApplication called                                                  | APP-R-001 | Artifact:AppContract     | OUT-001    | preload completes before createApplication resolves                                                                 |
| invalid entry module count                                                | APP-R-002 | InputKind:app-entry      | OUT-002    | build failure is observable                                                                                         |
| preload completed                                                         | APP-R-003 | Outcome:OUT-003          | OUT-003    | config/env values do not change after bootstrap                                                                     |
| env input provided                                                        | APP-R-004 | Outcome:OUT-004          | OUT-004    | env preload consumes provided env list                                                                              |
| loader missing                                                            | APP-R-005 | Outcome:OUT-005          | OUT-005    | no config loader execution is observed                                                                              |
| loader throws                                                             | APP-R-006 | Outcome:OUT-006          | OUT-006    | createApplication throws the same failure value                                                                     |
| loader executed                                                           | APP-R-007 | Outcome:OUT-007          | OUT-007    | no timeout or retry behavior is observed                                                                            |
| attach invoked                                                            | APP-R-008 | Outcome:OUT-008          | OUT-008    | invalid adapterId is rejected; post-start attach is rejected                                                        |
| attach invoked                                                            | APP-R-009 | Outcome:OUT-009          | OUT-009    | manifest/wiring remains unchanged                                                                                   |
| app.get invoked                                                           | APP-R-010 | Outcome:OUT-010          | OUT-010    | DI access occurs only via app.get and matches DI success conditions                                                 |
| lifecycle hooks present                                                   | APP-R-011 | Outcome:OUT-011          | OUT-011    | hooks are called in deterministic order consistent with provider ordering                                           |
| app.stop invoked                                                          | APP-R-012 | Outcome:OUT-012          | OUT-012    | shutdown errors are aggregated and thrown after cleanup                                                             |
| app.stop invoked                                                          | APP-R-014 | Outcome:OUT-014          | OUT-014    | shutdown errors are thrown as AggregateError after cleanup                                                          |
| app.stop invoked                                                          | APP-R-015 | Outcome:OUT-015          | OUT-015    | AggregateError.errors preserves observation order                                                                   |
| app.stop invoked                                                          | APP-R-016 | Outcome:OUT-016          | OUT-016    | AggregateError.errors includes original shutdown throw values by strict equality and without wrapping/normalization |
| app surface returns Result                                                | APP-R-013 | Outcome:OUT-013          | OUT-013    | build/runtime violation is observable                                                                               |
| app-entry collected                                                       | APP-R-017 | InputKind:app-entry      | OUT-017    | app-entry string-id normalization is deterministic and matches required format                                      |
| createApplication call observed more than once in the same process/worker | APP-R-018 | Outcome:OUT-018          | OUT-018    | build failure is observable (CLI emits error)                                                                       |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID   | 위반 조건(Violation Condition)                                | Diagnostic Code | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| --------- | ------------------------------------------------------------- | --------------- | ------------------------ | ------------------- | --------------------------------- |
| APP-R-001 | preload semantics violated                                    | ZIPBUL_APP_001  | error                    | symbol              | runtime:observation               |
| APP-R-002 | entry module not determinable or not exactly one              | ZIPBUL_APP_002  | error                    | symbol              | static:ast                        |
| APP-R-003 | preload results change after bootstrap                        | ZIPBUL_APP_003  | error                    | symbol              | runtime:observation               |
| APP-R-004 | env preload does not use provided env list                    | ZIPBUL_APP_004  | error                    | symbol              | runtime:observation               |
| APP-R-005 | loader execution observed without loader input                | ZIPBUL_APP_005  | error                    | symbol              | runtime:observation               |
| APP-R-006 | loader failure not observable as throw                        | ZIPBUL_APP_006  | error                    | symbol              | runtime:observation               |
| APP-R-007 | loader execution uses timeout/retry                           | ZIPBUL_APP_007  | error                    | symbol              | runtime:observation               |
| APP-R-008 | attach after start or adapterId not declared                  | ZIPBUL_APP_008  | error                    | symbol              | runtime:observation               |
| APP-R-009 | attach mutates static graph                                   | ZIPBUL_APP_009  | error                    | symbol              | runtime:observation               |
| APP-R-010 | DI access bypasses app.get or violates DI rules               | ZIPBUL_APP_010  | error                    | symbol              | runtime:observation               |
| APP-R-011 | lifecycle hooks not AST-collected or order not deterministic  | ZIPBUL_APP_011  | error                    | symbol              | runtime:observation               |
| APP-R-012 | app.stop aggregation/ordering contract violated               | ZIPBUL_APP_012  | error                    | symbol              | runtime:observation               |
| APP-R-014 | app.stop did not throw AggregateError after shutdown throws   | ZIPBUL_APP_014  | error                    | symbol              | runtime:observation               |
| APP-R-015 | AggregateError.errors order does not match observation order  | ZIPBUL_APP_015  | error                    | symbol              | runtime:observation               |
| APP-R-016 | AggregateError.errors values are wrapped/normalized/converted | ZIPBUL_APP_016  | error                    | symbol              | runtime:observation               |
| APP-R-013 | Result returned from app surface                              | ZIPBUL_APP_013  | error                    | symbol              | runtime:observation               |
| APP-R-017 | app-entry normalization output violates format                | ZIPBUL_APP_017  | error                    | symbol              | static:artifact                   |
| APP-R-018 | multiple createApplication calls observed                     | ZIPBUL_APP_018  | error                    | file                | static:ast                        |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)               |
| --------------------------------- | ----------------------------- |
| runtime                           | Observable Contract violation |
| build                             | Static Contract violation     |

---

## 9. 인계(Handoff) (OPTIONAL)

| From                       | To Document                     |
| -------------------------- | ------------------------------- |
| app.get success conditions | path:docs/30_SPEC/di/di.spec.md |

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
