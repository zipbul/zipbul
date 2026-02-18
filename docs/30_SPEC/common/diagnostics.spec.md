# Diagnostics Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | Diagnostics Specification                                                                                                                                                           |
| ID               | DIAGNOSTICS                                                                                                                                                                         |
| Version          | v1                                                                                                                                                                                  |
| Status           | Draft                                                                                                                                                                               |
| Owner            | repo                                                                                                                                                                                |
| Uniqueness Scope | repo                                                                                                                                                                                |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/cli/handler-id.spec.md, path:docs/30_SPEC/module-system/module-system.spec.md, path:docs/30_SPEC/adapter/adapter.spec.md |
| Depended-By      | Generated                                                                                                                                                                           |
| Supersedes       | none                                                                                                                                                                                |

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

| Item                        |
| --------------------------- |
| Diagnostic 레코드 최소 형상 |
| Location/Range 표현 계약    |
| 결정적 정렬 규칙            |
| Cycle 표준 표현             |

### 1.2 Out-of-Scope (REQUIRED)

| Item                                          |
| --------------------------------------------- |
| 어떤 상황에서 어떤 code를 발생시키는지의 상세 |
| 메시지 다국어/브랜딩/색상 등의 표현 세부      |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 새로운 용어를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                                        | 헤딩(Heading)               |
| ------------------------- | ----------------------------------------------------- | --------------------------- |
| dependency                | path:docs/30_SPEC/common/common.spec.md               | AdapterId / Token           |
| dependency                | path:docs/30_SPEC/cli/handler-id.spec.md              | HandlerId contract          |
| dependency                | path:docs/30_SPEC/module-system/module-system.spec.md | AdapterConfig keys          |
| dependency                | path:docs/30_SPEC/adapter/adapter.spec.md             | Handler (controller.method) |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| diagnostics-output    | build process             | record-list                     | no                                    | yes                                         | none                                            |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type DiagnosticSeverity = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

export type DiagnosticSeverityOrder = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

export type DiagnosticCode = string;

export type DiagnosticMessageText = string;

export type SourceRange = {
  // 0-based line index (inclusive)
  startLine: number;
  // 0-based column index (inclusive)
  startColumn: number;
  // 0-based line index (exclusive)
  endLine: number;
  // 0-based column index (exclusive)
  endColumn: number;
};

export type Location = {
  file: string;
  symbol?: string;
  range?: SourceRange;
};

export type DiagnosticHint = {
  title: string;
  details?: string;
};

export type CycleKind = 'import' | 'di';

export type CycleNode = {
  id: string;
  location?: Location;
};

export type CycleEdge = {
  from: string;
  to: string;
  label?: string;
  location?: Location;
};

export type Cycle = {
  kind: CycleKind;
  nodes: CycleNode[];
  edges: CycleEdge[];
};

export type Diagnostic = {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  summary: string;
  why: string;
  where: Location[];
  how: DiagnosticHint[];
  cycles?: Cycle[];
};

export type DiagnosticsContractData = {
  diagnostics: Diagnostic[];
};
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID           | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list) | 타깃 참조(Target Ref(s))                                    | 조건(Condition) (boolean, declarative)                                                                                                                                                                                                                  | 강제 레벨(Enforced Level) (token) |
| ----------------- | --------------------------- | --------------- | -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| DIAGNOSTICS-R-001 | active                      | MUST            | inputs                     | InputKind:diagnostics-output                                | diagnostics output is deterministic for the same input                                                                                                                                                                                                  | test                              |
| DIAGNOSTICS-R-002 | active                      | MUST            | shapes                     | Shape:local:DiagnosticsContractData; Shape:local:Diagnostic | Diagnostic shape matches required fields and where is non-empty                                                                                                                                                                                         | build                             |
| DIAGNOSTICS-R-003 | active                      | MUST            | outcomes                   | Outcome:OUT-003                                             | diagnostics list is sorted deterministically by severity-order, code, summary, representativeLocation.file, representativeLocation.symbol, representativeLocation.range.startLine, representativeLocation.range.startColumn                             | test                              |
| DIAGNOSTICS-R-004 | active                      | MUST            | outcomes                   | Outcome:OUT-004                                             | Location.file is a normalized project-root-relative path                                                                                                                                                                                                | build                             |
| DIAGNOSTICS-R-005 | active                      | MUST            | shapes                     | Shape:local:SourceRange                                     | SourceRange is 0-based with start inclusive and end exclusive                                                                                                                                                                                           | build                             |
| DIAGNOSTICS-R-006 | active                      | MUST            | artifacts, shapes          | Artifact:HandlerId; Shape:local:Location                    | Let adapterId/file/symbol be the parsed components of HandlerId per CLI Handler ID contract; adapterId is present in module root AdapterConfig keys and file equals Location.file and symbol equals Location.symbol when Location.symbol exists         | build                             |
| DIAGNOSTICS-R-007 | active                      | MUST            | shapes                     | Shape:local:DiagnosticMessageText                           | DiagnosticMessageText length is >= 1 and includes at least one whitespace character and includes at least one letter or digit (English/Korean/digit)                                                                                                    | build                             |
| DIAGNOSTICS-R-008 | active                      | MUST NOT        | outcomes                   | Outcome:OUT-008                                             | diagnostics include non-deterministic host/time/random data                                                                                                                                                                                             | test                              |
| DIAGNOSTICS-R-009 | active                      | MUST            | outcomes                   | Outcome:OUT-009                                             | each Diagnostic.where list is sorted deterministically by file, symbol, range.startLine, range.startColumn, range.endLine, range.endColumn (ascending), where missing symbol compares as empty string and missing range compares as all range numbers 0 | test                              |
| DIAGNOSTICS-R-010 | active                      | MUST            | outcomes                   | Outcome:OUT-010                                             | representativeLocation is defined as the first element of the sorted where list (whereSorted[0])                                                                                                                                                        | test                              |
| DIAGNOSTICS-R-011 | active                      | MUST            | outcomes                   | Outcome:OUT-011                                             | DiagnosticSeverity is compared using fixed order: trace < debug < info < warning < error < fatal                                                                                                                                                        | test                              |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference)    | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | ----------------------------- | ---------------------------------- |
| DiagnosticsContract       | schema             | local:DiagnosticsContractData | this-spec-only                     |
| Diagnostic                | schema             | local:Diagnostic              | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                    |
| ------------------------- | ---------------------------------------- |
| HandlerId                 | path:docs/30_SPEC/cli/handler-id.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here) |
| -------------------------------------- |
| none                                   |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact)  | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)                | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------- | ------------------------------- | --------------------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| DiagnosticsContract | glob                            | docs/30_SPEC/common/diagnostics.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |
| Diagnostic          | glob                            | docs/30_SPEC/common/diagnostics.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule)       | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| diagnostics-depends-on-handlerid | Artifact:HandlerId                        | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition) | Rule ID           | 타깃 참조(Target Ref(s))          | Outcome ID | 관측 결과(Observable Outcome)                                             |
| -------------------------- | ----------------- | --------------------------------- | ---------- | ------------------------------------------------------------------------- |
| deterministic ordering     | DIAGNOSTICS-R-001 | Artifact:DiagnosticsContract      | OUT-001    | 동일 입력에서 진단 출력 정렬이 결정적으로 동일하다                        |
| diagnostics emitted        | DIAGNOSTICS-R-002 | Shape:local:Diagnostic            | OUT-002    | Diagnostic records match required shape and have at least one where entry |
| sort performed             | DIAGNOSTICS-R-003 | Outcome:OUT-003                   | OUT-003    | diagnostics list stable sort order is observable                          |
| location emitted           | DIAGNOSTICS-R-004 | Outcome:OUT-004                   | OUT-004    | file path normalization is observable                                     |
| range emitted              | DIAGNOSTICS-R-005 | Shape:local:SourceRange           | OUT-005    | SourceRange indices are 0-based and end-exclusive                         |
| handler id emitted         | DIAGNOSTICS-R-006 | Artifact:HandlerId                | OUT-006    | HandlerId uses stable format                                              |
| message text emitted       | DIAGNOSTICS-R-007 | Shape:local:DiagnosticMessageText | OUT-007    | message text fields satisfy text constraints                              |
| determinism violated       | DIAGNOSTICS-R-008 | Outcome:OUT-008                   | OUT-008    | non-deterministic fields are not present                                  |
| where sorted               | DIAGNOSTICS-R-009 | Outcome:OUT-009                   | OUT-009    | each where list has deterministic ordering                                |
| representative location    | DIAGNOSTICS-R-010 | Outcome:OUT-010                   | OUT-010    | representativeLocation is mechanically derived                            |
| severity ordering          | DIAGNOSTICS-R-011 | Outcome:OUT-011                   | OUT-011    | severity ordering is fixed and observable                                 |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------: | --------------- | ------------------------------------------- |
| none     |    none | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

|           Rule ID | 위반 조건(Violation Condition)             | Diagnostic Code        | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| ----------------: | ------------------------------------------ | ---------------------- | ------------------------ | ------------------- | --------------------------------- |
| DIAGNOSTICS-R-001 | 진단 출력이 비결정적으로 달라짐            | ZIPBUL_DIAGNOSTICS_001 | error                    | file                | test:assert                       |
| DIAGNOSTICS-R-002 | Diagnostic 형상 불일치 또는 where 비어있음 | ZIPBUL_DIAGNOSTICS_002 | error                    | file                | static:artifact                   |
| DIAGNOSTICS-R-003 | 정렬 규칙 위반                             | ZIPBUL_DIAGNOSTICS_003 | error                    | file                | test:assert                       |
| DIAGNOSTICS-R-004 | Location.file 정규화 위반                  | ZIPBUL_DIAGNOSTICS_004 | error                    | file                | static:artifact                   |
| DIAGNOSTICS-R-005 | SourceRange 인덱스 규칙 위반               | ZIPBUL_DIAGNOSTICS_005 | error                    | file                | static:artifact                   |
| DIAGNOSTICS-R-006 | HandlerId 형식 규칙 위반                   | ZIPBUL_DIAGNOSTICS_006 | error                    | symbol              | static:artifact                   |
| DIAGNOSTICS-R-007 | DiagnosticMessageText 규칙 위반            | ZIPBUL_DIAGNOSTICS_007 | error                    | file                | static:artifact                   |
| DIAGNOSTICS-R-008 | 비결정적 필드 포함                         | ZIPBUL_DIAGNOSTICS_008 | error                    | file                | test:assert                       |
| DIAGNOSTICS-R-009 | where 정렬 규칙 위반                       | ZIPBUL_DIAGNOSTICS_009 | error                    | file                | test:assert                       |
| DIAGNOSTICS-R-010 | representativeLocation 정의 위반           | ZIPBUL_DIAGNOSTICS_010 | error                    | file                | test:assert                       |
| DIAGNOSTICS-R-011 | severity ordering 위반                     | ZIPBUL_DIAGNOSTICS_011 | error                    | file                | test:assert                       |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)                           |
| --------------------------------- | ----------------------------------------- |
| build                             | Static Contract violation                 |
| runtime                           | Observable Contract violation             |
| test                              | Non-deterministic or inconsistent outcome |

---

## 9. 인계(Handoff) (OPTIONAL)

| From               | To Document                             |
| ------------------ | --------------------------------------- |
| diagnostics output | path:docs/30_SPEC/common/common.spec.md |

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
