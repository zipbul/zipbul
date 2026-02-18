# AOT / AST Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | AOT / AST Specification                                                                                                                                                       |
| ID               | AOT-AST                                                                                                                                                                       |
| Version          | v1                                                                                                                                                                            |
| Status           | Draft                                                                                                                                                                         |
| Owner            | repo                                                                                                                                                                          |
| Uniqueness Scope | repo                                                                                                                                                                          |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/common/diagnostics.spec.md, path:docs/30_SPEC/compiler/config.spec.md, path:docs/30_SPEC/compiler/manifest.spec.md |
| Depended-By      | Generated                                                                                                                                                                     |
| Supersedes       | none                                                                                                                                                                          |

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

| Item                         |
| ---------------------------- |
| zipbul config 로딩 경계      |
| 프로젝트 루트 판정 최소 조건 |
| AOT 입력 결정성 정의         |
| 산출물 루트 디렉토리 위치    |

### 1.2 Out-of-Scope (REQUIRED)

| Item                       |
| -------------------------- |
| 모듈 판정 상세 규칙        |
| Manifest 상세 스키마       |
| 산출물 파일 경로/분할 상세 |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 추가적인 용어 정의를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document) | 헤딩(Heading) |
| --- | --- | --- |
| dependency | path:docs/30_SPEC/common/common.spec.md | FactoryRef / ModuleMarker |
| dependency | path:docs/30_SPEC/common/diagnostics.spec.md | Diagnostic |
| dependency | path:docs/30_SPEC/compiler/config.spec.md | config loading |
| dependency | path:docs/30_SPEC/compiler/manifest.spec.md | build artifacts |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| zipbul-config         | project root              | path-string                     | yes                                   | yes                                         | none                                            |
| build-profile         | build invocation          | string-literal                  | yes                                   | yes                                         | none                                            |
| project-fs-state      | filesystem snapshot       | digest-string                   | yes                                   | yes                                         | none                                            |
| project-root          | filesystem                | path-string                     | yes                                   | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type BuildProfile = 'minimal' | 'standard' | 'full';

export type ResolvedZipbulConfigModule = {
  fileName: string;
};

export type ResolvedZipbulConfig = {
  module: ResolvedZipbulConfigModule;
  sourceDir: string;
  entry: string;
};

export type ZipbulConfigSourceFormat = 'json' | 'jsonc';

export type ZipbulConfigSource = {
  path: string;
  format: ZipbulConfigSourceFormat;
};

export type AotAstContractData = {
  configSource: ZipbulConfigSource;
  resolvedConfig: ResolvedZipbulConfig;
  effectiveBuildProfile: BuildProfile;
  projectFsStateDigest: string;
  projectRootDir: string;
  outputRootDir: string;
  manifestArtifact: unknown;
  interfaceCatalogArtifact?: unknown;
  runtimeObservationArtifact?: unknown;
};
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list) | 타깃 참조(Target Ref(s)) | 조건(Condition) (boolean, declarative) | 강제 레벨(Enforced Level) (token) |
| --- | --- | --- | --- | --- | --- | --- |
| AOT-AST-R-001 | active | MUST | inputs | InputKind:zipbul-config | zipbul config is loaded at build time | build |
| AOT-AST-R-002 | active | MUST | shapes, outcomes | Shape:local:AotAstContractData, Shape:local:ResolvedZipbulConfig, Shape:local:ResolvedZipbulConfigModule, Outcome:OUT-002 | resolved zipbul config contains module.fileName, sourceDir, entry; no default is assumed when missing; entry is within sourceDir | build |
| AOT-AST-R-003 | active | MUST | inputs, shapes, outcomes | InputKind:build-profile, Shape:local:BuildProfile, Outcome:OUT-003 | effective build profile is decidable and equals build invocation override when present | build |
| AOT-AST-R-004 | active | MUST | outcomes | Outcome:OUT-004 | build profile selects the produced artifact set: minimal=manifest; standard=manifest+interface catalog; full=manifest+interface catalog+runtime observation | build |
| AOT-AST-R-005 | active | MUST | outcomes | Outcome:OUT-005 | outputRootDir is exactly `<PROJECT_ROOT>`/.zipbul | build |
| AOT-AST-R-006 | active | MUST | inputs, outcomes | InputKind:project-fs-state, Outcome:OUT-006 | identical (projectFsStateDigest, resolvedConfig, effectiveBuildProfile) yields identical AOT results and produced artifact bytes | test |
| AOT-AST-R-007 | active | MUST | outcomes | Outcome:OUT-007 | when ambiguity is detected, build stops and emits at least one Diagnostic | build |
| AOT-AST-R-008 | active | MUST NOT | outcomes | Outcome:OUT-008 | runtime infers or decides structural facts (module boundary, dependency relation, role) | runtime |
| AOT-AST-R-009 | active | MUST NOT | outcomes | Outcome:OUT-009 | CLI rewrites user function bodies as part of AOT | build |
| AOT-AST-R-010 | active | MUST NOT | outcomes | Outcome:OUT-010 | static interpretation reads files under node_modules that are not reachable from the project reference graph | build |
| AOT-AST-R-011 | active | MUST | inputs, outcomes | InputKind:project-root, Outcome:OUT-011 | zipbul config source path is exactly `<PROJECT_ROOT>`/zipbul.json or `<PROJECT_ROOT>`/zipbul.jsonc; if both exist or neither exists, build fails | build |
| AOT-AST-R-012 | active | MUST | outcomes | Outcome:OUT-012 | config source format is json or jsonc; build parses the config file to produce resolvedConfig and does not execute config as code | build |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference) | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------- |
| AotAstContract            | schema             | local:AotAstContractData   | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                        |
| ------------------------- | -------------------------------------------- |
| Diagnostic                | path:docs/30_SPEC/common/diagnostics.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here) |
| -------------------------------------- |
| module boundary decision rules         |
| manifest detailed schema               |
| diagnostic shape                       |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)              | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | ------------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| AotAstContract     | glob                            | docs/30_SPEC/compiler/aot-ast.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| diagnostic format          | Artifact:Diagnostic                       | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID | 타깃 참조(Target Ref(s)) | Outcome ID | 관측 결과(Observable Outcome) |
| --- | --- | --- | --- | --- |
| zipbul config required | AOT-AST-R-001 | Artifact:AotAstContract | OUT-001 | zipbul config absence causes build failure |
| resolved config evaluated | AOT-AST-R-002 | Artifact:AotAstContract | OUT-002 | resolved zipbul config includes module.fileName, sourceDir, entry and entry is within sourceDir |
| build profile resolved | AOT-AST-R-003 | Artifact:AotAstContract | OUT-003 | effective build profile is one of minimal/standard/full and respects invocation override |
| build executed | AOT-AST-R-004 | Artifact:AotAstContract | OUT-004 | artifact set matches effective build profile |
| artifacts written | AOT-AST-R-005 | Artifact:AotAstContract | OUT-005 | output root directory equals `<PROJECT_ROOT>`/.zipbul |
| two identical builds | AOT-AST-R-006 | Artifact:AotAstContract | OUT-006 | produced artifacts are byte-identical for identical determinism inputs |
| ambiguity detected | AOT-AST-R-007 | Artifact:Diagnostic | OUT-007 | build stops and emits at least one diagnostic |
| runtime executes | AOT-AST-R-008 | Outcome:OUT-008 | OUT-008 | structural inference is not observed at runtime |
| build executed | AOT-AST-R-009 | Outcome:OUT-009 | OUT-009 | no source rewriting artifact is produced |
| build executed | AOT-AST-R-010 | Outcome:OUT-010 | OUT-010 | file reads under node_modules are limited to reachable reference graph |
| config source selected | AOT-AST-R-011 | Artifact:AotAstContract | OUT-011 | config source path is zipbul.json or zipbul.jsonc under project root |
| config parsed | AOT-AST-R-012 | Artifact:AotAstContract | OUT-012 | resolvedConfig is produced by parsing json/jsonc and no config code execution is observed |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID | 위반 조건(Violation Condition) | Diagnostic Code | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| --- | --- | --- | --- | --- | --- |
| AOT-AST-R-001 | zipbul config missing but build succeeds | ZIPBUL_AOT_AST_001 | error | file | static:artifact |
| AOT-AST-R-002 | resolved config missing module.fileName/sourceDir/entry or entry is not within sourceDir or default applied | ZIPBUL_AOT_AST_002 | error | file | static:artifact |
| AOT-AST-R-003 | effective build profile not decidable or invalid | ZIPBUL_AOT_AST_003 | error | file | static:artifact |
| AOT-AST-R-004 | artifact set does not match effective build profile | ZIPBUL_AOT_AST_004 | error | file | static:artifact |
| AOT-AST-R-005 | outputRootDir not equal to `<PROJECT_ROOT>`/.zipbul | ZIPBUL_AOT_AST_005 | error | file | static:artifact |
| AOT-AST-R-006 | non-deterministic output observed for identical determinism input | ZIPBUL_AOT_AST_006 | error | file | test:assert |
| AOT-AST-R-007 | ambiguity detected but build continues or emits no diagnostics | ZIPBUL_AOT_AST_007 | error | file | static:artifact |
| AOT-AST-R-008 | runtime structural inference observed | ZIPBUL_AOT_AST_008 | error | range | runtime:observation |
| AOT-AST-R-009 | source rewriting observed | ZIPBUL_AOT_AST_009 | error | file | static:artifact |
| AOT-AST-R-010 | unreachable node_modules file read observed | ZIPBUL_AOT_AST_010 | error | file | static:artifact |
| AOT-AST-R-011 | zipbul config source path is invalid or missing | ZIPBUL_AOT_AST_011 | error | file | static:artifact |
| AOT-AST-R-012 | config parsing/no-execution contract violated | ZIPBUL_AOT_AST_012 | error | file | static:artifact |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)           |
| --------------------------------- | ------------------------- |
| build                             | Static Contract violation |
| test                              | Non-deterministic output  |

---

## 9. 인계(Handoff) (OPTIONAL)

| From                   | To Document                                           |
| ---------------------- | ----------------------------------------------------- |
| resolved zipbul config | path:docs/30_SPEC/module-system/module-system.spec.md |

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
