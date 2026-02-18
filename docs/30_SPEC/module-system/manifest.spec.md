# Manifest Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | Manifest Specification                                                                                                                                                                                                            |
| ID               | MANIFEST                                                                                                                                                                                                                          |
| Version          | v1                                                                                                                                                                                                                                |
| Status           | Draft                                                                                                                                                                                                                             |
| Owner            | repo                                                                                                                                                                                                                              |
| Uniqueness Scope | repo                                                                                                                                                                                                                              |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/cli/handler-id.spec.md, path:docs/30_SPEC/common/diagnostics.spec.md, path:docs/30_SPEC/module-system/module-system.spec.md, path:docs/30_SPEC/adapter/adapter.spec.md |
| Depended-By      | Generated                                                                                                                                                                                                                         |
| Supersedes       | none                                                                                                                                                                                                                              |

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

| Item                                        |
| ------------------------------------------- |
| Manifest 최소 형상 및 결정성                |
| Module 판정 결과 직렬화 필드                |
| Adapter Static Spec 및 handler index 직렬화 |

### 1.2 Out-of-Scope (REQUIRED)

| Item                                |
| ----------------------------------- |
| 파일 경로/파일명 규칙               |
| Runtime Report / DevTools artifacts |
| 프로토콜별 표현                     |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 추가적인 용어 정의를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                                        | 헤딩(Heading)          |
| ------------------------- | ----------------------------------------------------- | ---------------------- |
| dependency                | path:docs/30_SPEC/module-system/module-system.spec.md | modules serialization  |
| dependency                | path:docs/30_SPEC/common/diagnostics.spec.md          | handler index ordering |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| manifest-json         | build output              | json                            | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type ManifestSchemaVersion = '3';

export type ManifestConfig = {
  sourcePath: string;
  sourceFormat: 'json' | 'jsonc';
  resolvedModuleConfig: { fileName: string };
};

export type ManifestModule = {
  id: string;
  name: string;
  rootDir: string;
  file: string;
};

export type ProviderScope = 'singleton' | 'request' | 'transient';

export type ManifestDiNode = {
  id: string;
  token: Token;
  deps: Token[];
  scope: ProviderScope;
  provider: ProviderDeclaration;
};

export type ManifestDiGraph = {
  nodes: ManifestDiNode[];
};

export type AdapterEntryDecoratorsSpec = {
  controller: DecoratorRef;
  handler: DecoratorRef[];
};

export type AdapterRuntimeSpec = {
  start: FactoryRef;
  stop: FactoryRef;
};

export type PipelineStep = FactoryRef;

export type Pipeline = PipelineStep[];

export type AdapterStaticSpec = {
  pipeline: Pipeline;
  middlewarePhaseOrder: string[];
  supportedMiddlewarePhases: Record<string, true>;
  entryDecorators: AdapterEntryDecoratorsSpec;
  runtime: AdapterRuntimeSpec;
};

export type ManifestAdapterStaticSpecSet = {
  [key: AdapterId]: AdapterStaticSpec;
};

export type ManifestHandlerEntry = {
  id: HandlerId;
};

export type ManifestHandlerIndex = ManifestHandlerEntry[];

export type ZipbulManifest = {
  schemaVersion: ManifestSchemaVersion;
  config: ManifestConfig;
  modules: ManifestModule[];
  adapterStaticSpecs: ManifestAdapterStaticSpecSet;
  diGraph: ManifestDiGraph;
  handlerIndex: ManifestHandlerIndex;
};
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID        | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list) | 타깃 참조(Target Ref(s))                                                     | 조건(Condition) (boolean, declarative)                                                                  | 강제 레벨(Enforced Level) (token) |
| -------------- | --------------------------- | --------------- | -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| MANIFEST-R-001 | active                      | MUST            | inputs, artifacts, shapes  | InputKind:manifest-json, Artifact:ZipbulManifest, Shape:local:ZipbulManifest | Manifest is deterministically generated for identical inputs                                            | build                             |
| MANIFEST-R-002 | active                      | MUST            | shapes                     | Shape:local:ZipbulManifest                                                   | modules, diGraph.nodes, handlerIndex are sorted deterministically by id                                 | build                             |
| MANIFEST-R-003 | active                      | MUST            | shapes                     | Shape:local:ZipbulManifest                                                   | schemaVersion equals ManifestSchemaVersion                                                              | build                             |
| MANIFEST-R-004 | active                      | MUST            | outcomes                   | Outcome:OUT-004                                                              | manifest is immutable at runtime                                                                        | runtime                           |
| MANIFEST-R-005 | active                      | MUST            | shapes                     | Shape:local:ZipbulManifest                                                   | manifest includes modules, adapterStaticSpecs, diGraph, handlerIndex                                    | build                             |
| MANIFEST-R-006 | active                      | MUST            | outcomes                   | Outcome:OUT-006                                                              | adapterStaticSpecs key set matches module adapter configuration key set                                 | build                             |
| MANIFEST-R-007 | active                      | MUST            | outcomes                   | Outcome:OUT-007                                                              | access to manifest after bootstrap throws                                                               | runtime                           |
| MANIFEST-R-008 | active                      | MUST NOT        | outcomes                   | Outcome:OUT-008                                                              | manifest includes runtime state (listening/host/port/activation)                                        | build                             |
| MANIFEST-R-009 | active                      | MUST            | outcomes                   | Outcome:OUT-009                                                              | adapterStaticSpecs values are constructed from adapter package static results matching adapterName      | build                             |
| MANIFEST-R-010 | active                      | MUST            | outcomes                   | Outcome:OUT-010                                                              | if multiple adapterIds reference the same adapterName then their AdapterStaticSpec values are identical | build                             |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference) | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------- |
| ZipbulManifest            | schema             | local:ZipbulManifest       | this-spec-only                     |
| AdapterStaticSpec         | schema             | local:AdapterStaticSpec    | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                         |
| ------------------------- | --------------------------------------------- |
| HandlerId                 | path:docs/30_SPEC/cli/handler-id.spec.md      |
| AdapterId                 | path:docs/30_SPEC/common/identity.spec.md     |
| Token                     | path:docs/30_SPEC/common/declarations.spec.md |
| ProviderDeclaration       | path:docs/30_SPEC/common/declarations.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here)  |
| --------------------------------------- |
| ModuleId 판정 규칙 (module-system.spec) |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)                    | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | ------------------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| ZipbulManifest     | glob                            | docs/30_SPEC/module-system/manifest.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |
| AdapterStaticSpec  | glob                            | docs/30_SPEC/module-system/manifest.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule)           | 참조 아티팩트(Referenced Artifact Ref(s))                                            | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| manifest-depends-on-common-artifacts | Artifact:HandlerId; Artifact:AdapterId; Artifact:Token; Artifact:ProviderDeclaration | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID        | 타깃 참조(Target Ref(s))   | Outcome ID | 관측 결과(Observable Outcome)                                      |
| -------------------------- | -------------- | -------------------------- | ---------- | ------------------------------------------------------------------ |
| same inputs twice          | MANIFEST-R-001 | Shape:local:ZipbulManifest | OUT-001    | generated manifest bytes are identical                             |
| manifest generated         | MANIFEST-R-002 | Shape:local:ZipbulManifest | OUT-002    | sorted arrays by id are observable in JSON                         |
| manifest generated         | MANIFEST-R-003 | Shape:local:ZipbulManifest | OUT-003    | schemaVersion is observable as the expected const                  |
| runtime attempts mutation  | MANIFEST-R-004 | Outcome:OUT-004            | OUT-004    | mutation attempt throws                                            |
| manifest generated         | MANIFEST-R-005 | Shape:local:ZipbulManifest | OUT-005    | required top-level fields are present                              |
| manifest generated         | MANIFEST-R-006 | Outcome:OUT-006            | OUT-006    | adapterStaticSpecs keys match adapter config keys                  |
| app bootstrap completed    | MANIFEST-R-007 | Outcome:OUT-007            | OUT-007    | manifest access throws after bootstrap                             |
| manifest generated         | MANIFEST-R-008 | Outcome:OUT-008            | OUT-008    | runtime state is not present in manifest                           |
| manifest generated         | MANIFEST-R-009 | Outcome:OUT-009            | OUT-009    | adapterStaticSpecs are derived from adapter package static results |
| manifest generated         | MANIFEST-R-010 | Outcome:OUT-010            | OUT-010    | duplicate adapterName references yield identical specs             |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID        | 위반 조건(Violation Condition)                      | Diagnostic Code     | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| -------------- | --------------------------------------------------- | ------------------- | ------------------------ | ------------------- | --------------------------------- |
| MANIFEST-R-001 | non-deterministic manifest                          | ZIPBUL_MANIFEST_001 | error                    | file                | test:assert                       |
| MANIFEST-R-002 | unsorted arrays                                     | ZIPBUL_MANIFEST_002 | error                    | file                | static:artifact                   |
| MANIFEST-R-003 | schemaVersion mismatch                              | ZIPBUL_MANIFEST_003 | error                    | file                | static:artifact                   |
| MANIFEST-R-004 | runtime mutation succeeded                          | ZIPBUL_MANIFEST_004 | error                    | symbol              | runtime:observation               |
| MANIFEST-R-005 | required fields missing                             | ZIPBUL_MANIFEST_005 | error                    | file                | static:artifact                   |
| MANIFEST-R-006 | adapterStaticSpecs mismatch                         | ZIPBUL_MANIFEST_006 | error                    | file                | static:artifact                   |
| MANIFEST-R-007 | post-bootstrap manifest access                      | ZIPBUL_MANIFEST_007 | error                    | range               | runtime:observation               |
| MANIFEST-R-008 | runtime state included                              | ZIPBUL_MANIFEST_008 | error                    | file                | static:artifact                   |
| MANIFEST-R-009 | adapterStaticSpecs not derived from adapter package | ZIPBUL_MANIFEST_009 | error                    | file                | static:artifact                   |
| MANIFEST-R-010 | adapterStaticSpecs mismatch for same adapterName    | ZIPBUL_MANIFEST_010 | error                    | file                | static:artifact                   |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)           |
| --------------------------------- | ------------------------- |
| build                             | Static Contract violation |
| test                              | Determinism regression    |

---

## 9. 인계(Handoff) (OPTIONAL)

| From                    | To Document                                           |
| ----------------------- | ----------------------------------------------------- |
| module 판정 결과 직렬화 | path:docs/30_SPEC/module-system/module-system.spec.md |

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
