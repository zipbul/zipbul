# Adapter Compiler — 책임 명세

> 어댑터 패키지 (`zb build adapter`) 가 컴파일러로서 수행해야 할 모든 일.
> 근거: zipbul 본체 (`packages/core`, `packages/common`, `packages/cli`) 가 어댑터에게 요구하는 contract.
> 외부 프레임워크 비교 0. 개발 단계 무관 항목 (마이그레이션·스키마 버전·생태계 거버넌스) 제외.

---

## A. Front-end — 소스 수집·파싱

1. 어댑터 패키지의 모든 `.ts` 소스 파일 수집 (test/spec/fixtures 제외 룰 명시)
2. 심볼릭 링크 (workspace) 해상 후 정규화된 절대 경로 사용
3. `tsconfig.json` 발견·로드·`extends` 체인 전체 평탄화
4. `package.json` 로드 + `zipbul.kind === "adapter"` 확인
5. 모듈 의존 그래프 구성 (import / export 추적)
6. peer dependency (`@zipbul/core`, `@zipbul/common`) 해상도
7. node_modules 의 ambient declaration / type-only import 처리
8. UTF-8 인코딩 강제 (BOM 허용, locale-independent 파싱)
9. AST 파싱은 `@zipbul/gildash` 의 `parseSource(filePath, sourceText)` 단일 진입점을 통해서만 수행 — `oxc-parser` 직접 import 전면 금지 (Section N 의 정책 참조)

## B. 정적 분석 — 추출

> 본 섹션의 모든 추출은 `@zipbul/gildash` 의 공개 API (`extractSymbols`, `extractRelations`, `patternSearch`, `Visitor`, `visitorKeys`) 위에서 수행한다. 자체 AST 노드 매칭 코드를 새로 추가하지 않는다 — 길대시 API 가 부족하면 길대시 측 패치 요청을 우선 (Section N).

10. `defineAdapter()` 호출 위치 + 인자 객체 추출 — `extractSymbols` 의 variable initializer (`ExpressionValue`) 또는 호출 패턴 매칭으로 획득
11. `adapter` 필드 → 어댑터 클래스 식별
12. `context` 필드 → Context 클래스 식별
13. `pipeline` 배열 → phase/step 순서 추출
14. `phase` enum → 멤버명·값 추출
15. `step` enum → 멤버명·값 추출
16. Context 클래스 속성/getter → namespace map 자동 도출
17. Adapter 클래스 메서드 시그니처 수집
18. Context 클래스 메서드 시그니처 수집
19. 어댑터 export 데코레이터 함수 enumerate
20. Decorator 분류: controller / method / option / param
21. Decorator 인자 schema (리터럴 / 식별자 참조 한정)
22. 어댑터 패키지 내 `defineMiddleware` 호출 추출 (built-in 미들웨어)
23. 내장 미들웨어의 augments + contextOps 추출 (기존 미들웨어 컴파일러 인프라 재사용)
24. 어댑터 내장 `defineGuard` / `defineExceptionFilter` 추출
25. Public export 전수 (index.ts barrel 분석)
26. 어댑터 ID (어댑터 클래스 이름) 추출
27. `defineAdapter` named export 단 1개 (default export 금지)
28. Re-export 체인 분석 — barrel 파일이 다른 모듈의 `defineAdapter` 를 re-export 하는 케이스 추적

## C. 검증 — Contract Conformance

29. Adapter 클래스가 `core/Adapter` interface 구현 (tsc 위임)
30. Context 클래스가 `common/AdapterContext` interface 구현 (tsc 위임)
31. `defineAdapter.pipeline` 의 모든 항목이 phase enum / step enum 의 멤버여야 함
32. pipeline 에 핸들러 step (consumer rank) 정확히 1개 존재
33. pipeline 비어있지 않음
34. phase enum 멤버명 ↔ pipeline 사용 일치
35. step enum 멤버명 ↔ pipeline 사용 일치
36. Decorator 함수 시그니처가 zipbul 의 `MethodDecorator` / `ClassDecorator` / `PropertyDecorator` 와 호환
37. 어댑터 클래스가 패키지에서 export 되는지
38. Context 클래스가 패키지에서 export 되는지
39. 한 패키지에 어댑터 클래스 정확히 1개
40. Decorator 이름 중복 없음 (controller / method / option 그룹 내)
41. Decorator 카테고리별 최소 1개 — controller 1+, method 1+ (option/param 0 허용)
42. Phase 이름 중복 없음
43. Step 이름 중복 없음
44. Adapter 생성자 시그니처: 옵션 객체 1개 인자 (또는 무인자) 만 허용
45. `package.json` 의 `main` / `module` / `types` / `exports` 정합성
46. peer dependency 버전 범위 명시 여부
47. `package.json.zipbul.kind === "adapter"` 가 누락되면 hard error
48. Manifest 출력 경로가 `files` 필드에 포함되는지

## D. Type 처리

49. Context interface 의 namespace property 타입 → JSON-friendly schema 변환
50. 제네릭 타입 파라미터 보존
51. 메서드 overload 시그니처 모두 보존
52. Built-in 미들웨어의 `PropAugment` 추출 (path + RHS class/method)
53. Type-only import 추적 (declaration merging 의 import source 해상)
54. tsconfig 의 `paths` alias 정규화 후 모듈 식별

## E. Code Generation

55. TS → JS 컴파일 (bun build 또는 tsc)
56. `dist/index.js` 생성 (런타임 barrel)
57. `dist/index.d.ts` 생성 (타입 barrel)
58. `dist/context-augments.d.ts` 생성 (declaration merging 용 module augmentation 코드)
59. Source map 생성 (`.js.map`, external 파일, sourcesContent 포함)
60. JS 산출물 내 `__augments` / `__contextOps` IR injection (built-in 미들웨어용 — 기존 미들웨어 컴파일러 패턴)
61. **런타임 보존** — 어댑터 클래스 / Context 클래스 / 데코레이터 함수 / phase·step enum 모두 dist/index.js 에서 *값으로* import 가능 (tree-shaking 시 dead code 제외, 사용된 export 무손상)
62. ESM `export *` 의 named binding 안정성 (re-export 명시 권장, barrel 흡수 시 export name 보존)
63. `sideEffects: false` 호환성 — 데코레이터 등록·전역 metadata mutation 의 side-effect 식별 후 `sideEffects` 필드 자동 산출

## F. Manifest Emission

각 manifest 는 결정적 JSON (canonical key 정렬, UTF-8, LF). 모든 path 는 `dist/` 기준 상대.

64. `dist/adapter.manifest.json` — 루트 manifest. 다른 manifest paths 인덱스 + 어댑터 식별자 + 빌드 도구 버전 (`producedBy: "zb@x.y.z"`).
65. `dist/pipeline-schema.json` — pipeline 배열 + consumer rank step + phase enum 값 + step enum 값.
66. `dist/context-namespaces.json` — Context type 이름 + namespace map → property/method schema.
67. `dist/decorator-schema.json` — controller / method / option / param 분류 별 데코레이터 이름 + 인자 schema + import path.
68. `dist/builtins.json` — 내장 미들웨어 / 가드 / 필터 메타 (augments + contextOps + 등록 phase + factory ref).
69. `dist/peer-contract.json` — `defineAdapter` 가 의존하는 `@zipbul/core` / `@zipbul/common` 심볼 (consumer rank step 등) 의 사용 흔적.
70. JSON 키 순서 결정적 정렬 (canonical serialization).
71. 모든 manifest 의 `$schemaName` 필드로 형식 자기 식별.

## G. Atomic Emit + 무결성

72. `dist/.staging/` 디렉토리에 모든 산출물 쓰기
73. 검증 통과 후 `.staging/` → `dist/` atomic rename
74. 실패 시 `.staging/` cleanup, 기존 `dist/` 무손상
75. 모든 산출물 작성 완료 전 `manifest.json` 쓰지 않음 (manifest 가 다른 파일 paths 참조하므로 마지막)
76. 결정성 검증 (같은 입력 → 동일 산출물, 재실행 후 byte-identical)
77. 산출물 파일 크기 / 해시 보고
78. tsbuildinfo / source-map 메타파일은 결정성 비교에서 제외 (timestamp 무관)

## H. Diagnostics

79. 모든 에러에 file:line:column 위치 정보
80. 에러 분류: `SYNTAX` / `CONTRACT` / `MISSING_EXPORT` / `DUPLICATE` / `TYPE` / `IO`
81. tsc 에러 → 어댑터 contract 위반인지 일반 타입 에러인지 판별
82. 다중 에러 보고 (첫 에러에서 stop 안 함, 가능한 모두 수집)
83. 진단 출력 형식 통일 (`file:line ERROR/WARN [CATEGORY] message`)
84. WARN vs ERROR 분리 (ERROR 만 빌드 실패)
85. JSON 출력 모드 (`--format=json`) — 머신 친화 진단 (CI 통합)
86. ANSI 컬러 자동 감지 + `--no-color` 플래그

## I. Build Pipeline Integration

87. tsc invoke (`tsc --noEmit` 타입 체크, `tsc --emitDeclarationOnly` .d.ts 생성)
88. tsc 종료 코드 처리
89. tsc stdout/stderr 캡처 + 진단 변환
90. tsc 실패 시 빌드 중단 + 산출물 cleanup
91. tsc 환경 부재 시 명확한 에러 메시지
92. `composite` / `references` 프로젝트 트리 처리 (해당 어댑터만 단일 빌드 단위)
93. tsbuildinfo 위치 고정 (`.zipbul/cache/<package>.tsbuildinfo`)

## J. CLI Contract

94. `zb build adapter` 서브커맨드 라우팅
95. 작업 디렉토리 = 어댑터 패키지 루트 (`package.json.zipbul.kind === "adapter"` 확인 후 진입)
96. 출력 디렉토리 옵션 (`--out-dir`, 기본 `dist/`)
97. Verbose / quiet 플래그
98. 종료 코드 0 = 성공, 1 = 컴파일 실패, 2 = 환경 오류
99. stdout = 진행상황, stderr = 진단
100. `--dry-run` — 산출물 검증만, dist/ 미수정
101. `--check-only` — manifest 결정성 + schema 적합성만 (CI 게이트용)

## K. Watch / Incremental

102. `zb dev adapter` 또는 `zb build adapter --watch` 모드
103. 파일 변경 감지 (Bun watch 우선, fallback chokidar)
104. 영향받는 모듈만 재추출 (모듈 의존 그래프 기반 invalidation)
105. tsc incremental (`tsBuildInfoFile`) 통합
106. `.zipbul/cache/` 디렉토리 관리
107. `tsconfig.json` / `package.json` 변경 시 전체 재빌드 트리거
108. 변경 디바운싱 (50–100ms) + in-flight 빌드 cancel-and-restart

## L. Self-test (Round-trip)

109. emit 직후 manifest 자체 schema 적합성 검증 (자기 출력을 자기 schema 로 검사)
110. emit 직후 manifest paths 가 실제 파일과 일치하는지 확인
111. .d.ts 파일이 컴파일 가능한 TS 인지 검증 (별도 `tsc --noEmit` 호출)
112. dist/index.js 가 Bun 으로 import 가능한지 (런타임 import smoke)
113. 데코레이터 enum/phase/step 의 런타임 값이 manifest 와 일치 (런타임 introspection 비교)

## M. CLI Consumer Protocol — 앱 빌드 측 짝 contract

> 어댑터 컴파일러가 ship 하는 manifest 를 사용자 앱 빌드 (`zb build`) 가 어떻게 소비하는지의 명세.
> 어댑터 컴파일러 자체 책임은 아니지만 짝으로 정해야 외부 환경 완결.

114. 사용자 앱 빌드 시 `node_modules/<adapter-package>/dist/adapter.manifest.json` 우선 로드
115. manifest 부재 시 — 기존 `.ts` 정적 분석 fallback 또는 명확한 에러 (정책 결정 항목)
116. manifest 의 `producedBy` 필드 ↔ 사용자가 설치한 `@zipbul/cli` 호환성 검사
117. manifest 가 결정적이 아닌 변경 (재게시 없이 dist/ 수정) 시 캐시 무효화
118. 사용자 앱 컴파일 출력에 의존한 어댑터 manifest 들의 hash 임베딩 (사용자 빌드 결정성)
119. 다중 어댑터 (사용자가 여러 어댑터 동시 사용) 시 manifest 병합 규칙 — 데코레이터 이름 충돌 검출

## N. AST 분석 인프라 정책 — `@zipbul/gildash` 단일 진입점

> 어댑터 컴파일러 + 미들웨어 컴파일러 + 사용자 앱 빌드 + dev 모드 — 모든 정적 분석은 `@zipbul/gildash` 의 공개 API 위에서만 수행.
> 본 정책은 본 PR 범위에서 동시 적용 (= 어댑터 컴파일러 MVP 와 oxc 직접 의존 제거를 한 묶음으로 진행).

### 정책

120. `@zipbul/cli` 의 `package.json` 에서 `oxc-parser` 의존성 제거. catalog 항목 (`workspaces.catalog["oxc-parser"]`) 도 삭제. transitive 로 길대시가 가져오는 것만 인정.
121. cli 의 어떤 파일도 `from 'oxc-parser'` import 금지 — 위반 시 빌드 실패 (lint rule 또는 typecheck 실패로 강제).
122. AST 노드 타입은 길대시 re-export (`Program`, `Node`, `Visitor`, `visitorKeys`, `VisitorObject`) 만 사용. 길대시가 노출하지 않는 raw oxc 타입 (`Class`, `CallExpression`, `Function`, `MethodDefinition`, `Expression`, `MemberExpression`, `VariableDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration`, `ModuleExportName`, `StaticImport`, `ImportNameKind`) 은 길대시 고수준 API (`extractSymbols`, `extractRelations`, `patternSearch`) 로 흡수.
123. `parseSync` / `parseAsync` 직접 호출 금지 — 모두 `parseSource(filePath, sourceText)` 의 `Result<ParsedFile, GildashError>` 반환을 통과해야 함.

### 길대시 API → cli 추출기 매핑 (확정)

| cli 책임 | 길대시 API | 비고 |
|---|---|---|
| 클래스/메서드/데코레이터/생성자/파라미터/heritage/modifiers 추출 | `extractSymbols(parsed)` | `ExtractedSymbol` 의 `kind === 'class'` 필터 후 `members` 순회 |
| `import { X, type Y } from 'M'` binding 단위 분리 | `extractRelations(ast, filePath)` | `'imports'` / `'type-references'` / `'re-exports'` 가 binding 단위로 split. `meta.isType` 도 보존 (메인테이너 회신 확정) |
| `defineAdapter` / `defineMiddleware` / `defineGuard` / `defineExceptionFilter` / `defineModule` 호출 인자 정규화 | `extractSymbols` 의 variable initializer (`ExpressionValue`) | cli 측에 50–100 줄 어댑터 1개 추가 (아래 Item 124) |
| `ctx.use(KEY)` / `ctx.set(KEY, V)` / `ctx.get(KEY)` 패턴 매칭 | `patternSearch({ pattern, filePaths })` | 파일 단위 매칭 → cli 측에서 메서드 `span` 으로 함수 본문 범위 필터 + ctx 매개변수 shadow 검사 후처리 |
| 노드 walk | 길대시 `Visitor` + `visitorKeys` | cli 의 자체 `walkChildren` 폐기 |
| byte offset → line·col 변환 | `buildLineOffsets` + `getLineColumn` | 이미 cli 가 사용 중 (변경 없음) |

### 신규 cli 측 어댑터

124. `@zipbul/cli/src/compiler/analyzer/expression-value-to-zipbul-ir.ts` 신설 — 단일 책임:
  - `ExpressionIdentifier` → `{ [ZIPBUL_REF]: name, [ZIPBUL_IMPORT_SOURCE]?: importSource }`
  - `ExpressionMember` → `{ [ZIPBUL_REF]: 'object.property', [ZIPBUL_IMPORT_SOURCE]?: importSource }`
  - `ExpressionCall` → `{ [ZIPBUL_CALL]: callee, [ZIPBUL_IMPORT_SOURCE]?: ..., args: [...] }` — `callee==='lazy'` + `arguments[0].kind==='function'` 이면 `{ [ZIPBUL_LAZY_REF]: refName }` 로 후처리 (refName 은 함수 본문에서 추출)
  - `ExpressionNew` → `{ [ZIPBUL_NEW]: callee, args: [...] }`
  - `ExpressionFunction` → `{ [ZIPBUL_FACTORY_CODE]: sourceText, __zipbul_factory_params?: [...] }`
  - `ExpressionSpread` → `{ [ZIPBUL_SPREAD]: argument }`
  - `ExpressionUnresolvable` / `ExpressionTemplate` → `{ [ZIPBUL_UNRESOLVABLE]: true, sourceText }`
  - `ExpressionObject` → 평이한 객체 + `computed` 키는 `${ZIPBUL_COMPUTED_PREFIX}${index}` 로 변환 (`ZIPBUL_COMPUTED_KEY`/`ZIPBUL_COMPUTED_VALUE` 에 배치)
  - `ExpressionArray` → 평이한 배열
  - 리터럴 (`string`/`number`/`boolean`/`null`/`undefined`) → 값 그대로

### 폐기 / 흡수 대상 cli 파일

125. 다음 11개 파일에서 `oxc-parser` 직접 import 0 으로 만들기 — 본 PR 의 인수 기준:

  - `packages/cli/src/compiler/analyzer/expression-converter.ts` — Item 124 의 어댑터로 대체 후 폐기
  - `packages/cli/src/compiler/analyzer/parser/ast-node-locator.ts` — `walkChildren` 폐기, 길대시 `Visitor` 직접 사용
  - `packages/cli/src/compiler/analyzer/parser/class-metadata-extractor.ts` — `extractSymbols` 호출 + 얇은 매핑 레이어
  - `packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.ts` — 동일
  - `packages/cli/src/compiler/analyzer/parser/import-export-extractor.ts` — `extractRelations` 분기로 전환
  - `packages/cli/src/compiler/analyzer/parser/context-operation-extractor.ts` — `patternSearch` + 메서드 span 필터
  - `packages/cli/src/compiler/analyzer/parser/handler-context-usage-extractor.ts` — 동일 (중복 제거 후 단일 헬퍼로 통합)
  - `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` — `extractSymbols` + `ExpressionValue` 어댑터
  - `packages/cli/src/compiler/analyzer/adapter/middleware-augment-collector.ts` — 동일
  - `packages/cli/src/compiler/analyzer/adapter/config-extractor.ts` — `defineAdapter` 호출 추출을 `extractSymbols.initializer` 기반으로 전환
  - `packages/cli/src/compiler/generator/lib-augment-injector.ts` — JS 후처리 시점의 oxc 사용을 길대시 기반 또는 string-level 처리로 흡수

### 회귀 가드

126. 본 PR 의 typecheck 단계에서 `oxc-parser` 가 `@zipbul/cli` 의 직간접 의존 그래프에 *직접 import* 형태로 등장하면 실패. (lockfile 의 transitive 로 존재하는 것은 허용 — 길대시가 가져오는 것이므로.)
127. 회귀 방지 단위 테스트 — cli 의 `oxc-parser` import 부재를 grep 으로 검증하는 lint 룰 또는 spec 1개 추가.
128. 기존 cli 의 모든 unit/integration/e2e 회귀 통과 (1909 / 369 / 94 / 1 baseline 보존).

### 메인테이너 협력 사항 — 본 PR 범위 외

- 길대시 측 신규 API 추가 0건 (확정).
- 길대시 측 modifier enum 에 `'generator'` 추가 — cli 사용 0건 확인됨, 불필요.
- 향후 cli 마이그레이션 중 길대시 API 의 사실상 부족분이 발견되면 그때 별도 회신.

---

## 책임 외 — 명시 제외

다음은 컴파일러 책임 아님:

- npm publish / 배포 자동화 (별도 인프라)
- 어댑터 onboarding 문서 / 템플릿 (`zb scaffold adapter` 별도 영역)
- Migration / schema versioning (개발 단계 불필요)
- Capability matrix (zipbul 본체에 capability 개념 없음)
- RFC 자동 검증 (어댑터 자체 런타임 책임)
- Multi-adapter 충돌 정책 — 검출만, 해소 정책은 사용자 영역
- Test harness (`zb test adapter` 별도 영역)
- 외부 프레임워크 비교

---

## 합계

128 항목. 14 카테고리 (A~N).

- A~L (1–113): 어댑터 패키지 빌드 시점에 어댑터 컴파일러가 직접 수행하는 책임.
- M (114–119): 사용자 앱 빌드 측이 manifest 를 소비하는 짝 contract — 어댑터 컴파일러와 동시 완성되어야 외부 환경 완결.
- N (120–128): AST 분석 인프라 정책 — `@zipbul/gildash` 단일 진입점, `oxc-parser` 직접 의존 제거. 어댑터 컴파일러 MVP 와 동일 PR 안에서 동시 적용.

근거는 모두 zipbul 본체 contract 또는 컴파일러 표준 책임. 새 항목 도입은 zipbul 본체 코드 라인 인용 후 추가.
