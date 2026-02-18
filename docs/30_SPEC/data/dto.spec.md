# DTO & Schema Specification

## 0. 정체성(Identity) (REQUIRED)

| 필드(Field)      | 값(Value)                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Title            | DTO & Schema Specification                                                                                                      |
| ID               | DTO                                                                                                                             |
| Version          | v1                                                                                                                              |
| Status           | Draft                                                                                                                           |
| Owner            | repo                                                                                                                            |
| Uniqueness Scope | repo                                                                                                                            |
| Depends-On       | path:docs/30_SPEC/common/common.spec.md, path:docs/30_SPEC/pipeline/pipes.spec.md, path:docs/30_SPEC/common/diagnostics.spec.md |
| Depended-By      | Generated                                                                                                                       |
| Supersedes       | none                                                                                                                            |

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

| Item                                 |
| ------------------------------------ |
| DTO class 기반 스키마 생성 최소 계약 |
| SchemaGeneratableFieldType 제약      |
| 변환/검증은 Pipe 등록시에만 실행     |

### 1.2 Out-of-Scope (REQUIRED)

| Item                    |
| ----------------------- |
| OpenAPI/AsyncAPI 산출물 |
| 프로토콜별 직렬화 표현  |

### 1.3 용어 정의(Definitions) (REQUIRED)

Normative: 본 SPEC은 추가적인 용어 정의를 도입하지 않는다.

### 1.4 외부 용어 사용(External Terms Used) (REQUIRED)

| 용어(Term) | 용어 키(Term Key) | 정의 위치(Defined In) | 비고(Notes) |
| ---------- | ----------------- | --------------------- | ----------- |
| none       | none              | none                  |             |

---

## 2. 참고(References) (OPTIONAL)

| 참조 유형(Reference Type) | 문서(Document)                               | 헤딩(Heading)        |
| ------------------------- | -------------------------------------------- | -------------------- |
| dependency                | path:docs/30_SPEC/pipeline/pipes.spec.md     | pipes stage contract |
| dependency                | path:docs/30_SPEC/common/diagnostics.spec.md | diagnostics contract |

---

## 3. 정적 계약(Static Contract) (REQUIRED)

### 3.1 Static Inputs (Collectable Forms) (REQUIRED)

| 입력 종류(Input Kind) | 수집 출처(Collected From) | 허용 형식(Allowed Form) (token) | 리터럴 요구(Must Be Literal) (yes/no) | 해결 가능 요구(Must Be Resolvable) (yes/no) | 정규화 출력(Normalized Output) (none/string-id) |
| --------------------- | ------------------------- | ------------------------------- | ------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| dto-class             | code (AOT)                | class-declaration               | yes                                   | yes                                         | string-id                                       |

### 3.2 정적 데이터 형상(Static Data Shapes) (REQUIRED)

```ts
export type DtoFieldName = string;

export type DtoFieldSchemaType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export type DtoFieldSchema = {
  type: DtoFieldSchemaType;
  items?: DtoFieldSchema;
  ref?: string;
};

export type DtoSchema = {
  type: 'object';
  properties: Record<DtoFieldName, DtoFieldSchema>;
  required?: DtoFieldName[];
};

export type SchemaGeneratableFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | { arrayOf: SchemaGeneratableFieldType }
  | { dtoRef: string };

export type DtoRefFormat = '<file>#<symbol>';
```

### 3.3 Shape Rules (REQUIRED)

| Rule ID   | 생명주기(Lifecycle) (token) | 키워드(Keyword) | 타깃(Targets) (token list) | 타깃 참조(Target Ref(s))                  | 조건(Condition) (boolean, declarative)                                                                                                                                                                         | 강제 레벨(Enforced Level) (token) |
| --------- | --------------------------- | --------------- | -------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| DTO-R-001 | active                      | MUST            | inputs, outcomes           | InputKind:dto-class, Outcome:OUT-001      | DTO schema generation input is instance field declarations only (static fields excluded)                                                                                                                       | build                             |
| DTO-R-002 | active                      | MUST NOT        | outcomes                   | Outcome:OUT-002                           | run validation/transform without pipe registration                                                                                                                                                             | runtime                           |
| DTO-R-003 | active                      | MUST            | artifacts, shapes          | Artifact:DtoSchema, Shape:local:DtoSchema | DtoSchema.type is literal "object" and properties is a record keyed by field names                                                                                                                             | build                             |
| DTO-R-004 | active                      | MUST            | outcomes                   | Outcome:OUT-004                           | optional field detection uses only the "?" marker in field declarations                                                                                                                                        | build                             |
| DTO-R-005 | active                      | MUST            | outcomes                   | Outcome:OUT-005                           | field type mapping is: string -> {type:"string"}, number -> {type:"number"}, boolean -> {type:"boolean"}, T[] -> {type:"array", items:`<T schema>`}, DTO reference -> {type:"object", ref:`"<file>#<symbol>"`} | build                             |
| DTO-R-006 | active                      | MUST            | outcomes                   | Outcome:OUT-006                           | DtoFieldSchema.ref format is `"<file>#<symbol>"` where file is normalized project-root-relative path and symbol is non-empty identifier                                                                        | build                             |
| DTO-R-007 | active                      | MUST            | outcomes                   | Outcome:OUT-007                           | DtoSchema.required contains exactly non-optional field names and is sorted ascending by field name (lexicographic)                                                                                             | build                             |
| DTO-R-008 | active                      | MUST            | outcomes                   | Outcome:OUT-008                           | schema generation succeeds only if every field type is SchemaGeneratableFieldType; otherwise build fails                                                                                                       | build                             |
| DTO-R-009 | active                      | MUST            | outcomes                   | Outcome:OUT-009                           | DTO transformer and validator operate based on DTO schema                                                                                                                                                      | runtime                           |
| DTO-R-010 | active                      | MUST NOT        | outcomes                   | Outcome:OUT-010                           | schema/transform/validate require runtime reflection or runtime type inference                                                                                                                                 | build                             |
| DTO-R-011 | active                      | MUST NOT        | outcomes                   | Outcome:OUT-011                           | DTO includes protocol-dependent metadata (e.g. status code)                                                                                                                                                    | build                             |

---

## 4. 아티팩트 소유(Artifact Ownership) (REQUIRED)

### 4.1 Owned Artifacts

| 아티팩트명(Artifact Name) | 종류(Kind) (token) | 형상 참조(Shape Reference) | 쓰기 권한(Write Authority) (token) |
| ------------------------- | ------------------ | -------------------------- | ---------------------------------- |
| DtoSchema                 | schema             | local:DtoSchema            | this-spec-only                     |

### 4.2 Referenced Artifacts

| 아티팩트명(Artifact Name) | 정의 위치(Defined In)                    |
| ------------------------- | ---------------------------------------- |
| Pipe                      | path:docs/30_SPEC/pipeline/pipes.spec.md |

### 4.3 No-Duplication Claim (REQUIRED)

| 여기서 정의하지 않음(Not Defined Here)     |
| ------------------------------------------ |
| adapter-level serialization (adapter.spec) |

---

## 5. 배치 및 의존 계약(Placement & Dependency Contract) (REQUIRED)

### 5.1 Placement

| 아티팩트(Artifact) | 패턴 종류(Pattern Kind) (token) | 위치(Location) (pattern)      | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) | 자동화 계획(Automation Plan) (required if manual) | 만료(Expiry) (required if manual) |
| ------------------ | ------------------------------- | ----------------------------- | ------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| DtoSchema          | glob                            | docs/30_SPEC/data/dto.spec.md | build                     | n/a                                           | n/a                                               | n/a                               |

### 5.2 Dependency

| 의존 규칙(Dependency Rule) | 참조 아티팩트(Referenced Artifact Ref(s)) | 허용(Allowed) | 금지(Forbidden) | 집행(Enforced By) (token) | 수동 사유(Manual Reason) (required if manual) |
| -------------------------- | ----------------------------------------- | ------------- | --------------- | ------------------------- | --------------------------------------------- |
| dto-depends-on-pipe        | Artifact:Pipe                             | allowed       | forbidden       | lint                      | n/a                                           |

---

## 6. 관측 계약(Observable Contract) (REQUIRED)

### 6.1 Inputs → Observable Outcomes

| 입력 조건(Input Condition)                 | Rule ID   | 타깃 참조(Target Ref(s)) | Outcome ID | 관측 결과(Observable Outcome)                          |
| ------------------------------------------ | --------- | ------------------------ | ---------- | ------------------------------------------------------ |
| dto schema generation attempted            | DTO-R-001 | InputKind:dto-class      | OUT-001    | schema generator uses instance field declarations only |
| dto validation/transform runs without pipe | DTO-R-002 | Outcome:OUT-002          | OUT-002    | violation observable                                   |
| dto schema shape evaluated                 | DTO-R-003 | Artifact:DtoSchema       | OUT-003    | invalid schema shape yields build failure              |
| dto optional detected                      | DTO-R-004 | Outcome:OUT-004          | OUT-004    | optional detection follows declaration marker only     |
| dto field type mapped                      | DTO-R-005 | Outcome:OUT-005          | OUT-005    | schema mapping follows fixed mapping rules             |
| dto ref emitted                            | DTO-R-006 | Outcome:OUT-006          | OUT-006    | ref format is deterministic and checkable              |
| required list emitted                      | DTO-R-007 | Outcome:OUT-007          | OUT-007    | required list is deterministic and sorted              |
| unsupported field type present             | DTO-R-008 | Outcome:OUT-008          | OUT-008    | build fails                                            |
| transform/validate executed                | DTO-R-009 | Outcome:OUT-009          | OUT-009    | transform/validate behavior is schema-based            |
| runtime reflection needed                  | DTO-R-010 | Outcome:OUT-010          | OUT-010    | build failure is observable                            |
| protocol metadata present                  | DTO-R-011 | Outcome:OUT-011          | OUT-011    | build failure is observable                            |

### 6.2 State Conditions

| State ID | Rule ID | 조건(Condition) | 기대 관측(Expected Observable) (Outcome ID) |
| -------- | ------- | --------------- | ------------------------------------------- |
| none     | none    | none            | none                                        |

---

## 7. 진단 매핑(Diagnostics Mapping) (REQUIRED)

| Rule ID   | 위반 조건(Violation Condition)                      | Diagnostic Code | 심각도(Severity) (token) | 위치(Where) (token) | 탐지 방법(How Detectable) (token) |
| --------- | --------------------------------------------------- | --------------- | ------------------------ | ------------------- | --------------------------------- |
| DTO-R-001 | schema generator input includes non-instance fields | ZIPBUL_DTO_012  | error                    | symbol              | static:ast                        |
| DTO-R-002 | implicit validation/transform                       | ZIPBUL_DTO_002  | error                    | range               | runtime:observation               |
| DTO-R-003 | invalid schema shape                                | ZIPBUL_DTO_003  | error                    | symbol              | static:artifact                   |
| DTO-R-004 | optional detection violates marker-only rule        | ZIPBUL_DTO_004  | error                    | symbol              | static:ast                        |
| DTO-R-005 | field type mapping violated                         | ZIPBUL_DTO_005  | error                    | symbol              | static:ast                        |
| DTO-R-006 | invalid dto ref format                              | ZIPBUL_DTO_006  | error                    | symbol              | static:ast                        |
| DTO-R-007 | required list not sorted or incorrect               | ZIPBUL_DTO_007  | error                    | symbol              | static:ast                        |
| DTO-R-008 | unsupported field type found                        | ZIPBUL_DTO_001  | error                    | symbol              | static:ast                        |
| DTO-R-009 | transform/validate not schema-based                 | ZIPBUL_DTO_009  | error                    | range               | runtime:observation               |
| DTO-R-010 | runtime reflection required                         | ZIPBUL_DTO_010  | error                    | symbol              | static:ast                        |
| DTO-R-011 | protocol metadata present                           | ZIPBUL_DTO_011  | error                    | symbol              | static:ast                        |

---

## 8. 위반 매트릭스(Violation Matrix) (REQUIRED)

| 위반 유형(Violation Type) (token) | 조건(Condition)               |
| --------------------------------- | ----------------------------- |
| build                             | Static Contract violation     |
| runtime                           | Observable Contract violation |

---

## 9. 인계(Handoff) (OPTIONAL)

| From           | To Document                       |
| -------------- | --------------------------------- |
| docs artifacts | path:docs/30_SPEC/app/app.spec.md |

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
