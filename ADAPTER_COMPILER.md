# Adapter Compiler — 책임 명세 + 실행 인수인계

> 어댑터 패키지 (`zb build adapter`) 가 컴파일러로서 수행해야 할 모든 일.
> 근거: zipbul 본체 (`packages/core`, `packages/common`, `packages/cli`) 가 어댑터에게 요구하는 contract.
> 외부 프레임워크 비교 0. 개발 단계 무관 항목 (마이그레이션·스키마 버전·생태계 거버넌스) 제외.

**Branch**: `fix/cli-js-bundle-bin`. **Baseline (현 시점)**: typecheck clean / unit `1873 pass` / integration `147 pass` / e2e `370 pass` / smoke `1 pass`.

상태 표기 — Section A~M 본문에서 사용:
- ✅ 완료. 코드/문서 머지 + 회귀 baseline 통과.
- 🟡 부분 구현. 무엇이 빠졌는지 항목 본문에 명시.
- ⬜ 미착수.
- ❌ 사용자 명시 거부.

---

## 0. 현재 상태 스냅샷 — 다음 에이전트 인수인계

### 0.0 본 문서를 읽는 새 에이전트에게 — 운영 컨텍스트

본 문서는 사용자가 conversation context 를 클리어하기 직전에 작성된 인수인계 패키지다. 새 에이전트는 이전 대화를 모르는 상태에서 본 파일과 git history (`git log --oneline -30`) 만으로 작업을 이어가야 한다. 따라서 본 섹션은 *작업 자체* 보다 먼저 알아야 할 *운영 환경* 을 다룬다.

**저장소 구조**: zipbul 모노레포. 루트는 `/home/revil/projects/zipbul/zipbul`. 작업 디렉토리는 항상 루트로 둔다. 패키지는 `packages/{cli,common,core,http-adapter,logger}` 5개 (검증: `ls packages/`); `@zipbul/result` 는 외부 의존 (workspace 패키지 아님). catalog 기반 dependency 공유 (Bun 1.3 catalog). 본 문서는 루트에 위치한 `ADAPTER_COMPILER.md` 다 — 다른 위치로 옮기지 마라.

**런타임·도구**: Bun (현재 설치 1.3.13). Node 사용 금지 — 본 프로젝트의 모든 스크립트·테스트가 `bun` / `bunx` 로 돌아간다. TypeScript 5.9. typecheck 는 `bunx tsc --noEmit` (루트 디렉토리에서). 테스트는 `bun run test:unit` / `bun run test:integration` / `bun run test:e2e` (루트의 `package.json.scripts` 참조). 패키지 매니저 명령도 `bun add`, `bun install`. npm/yarn/pnpm 사용 금지.

**git 작업 규칙**: 사용자가 명시 요청할 때만 커밋. 커밋 메시지는 한국어, scope 명시 (`feat(cli): ...`, `refactor(cli): ...`, `test(cli): ...`, `docs(compiler): ...`). 마지막 라인은 항상 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (개행 + 빈 줄 + Co-Authored-By). 메시지는 HEREDOC 으로 전달 (Bash 도구 시스템 가이드 참조). 커밋 amend 금지 — 새 커밋으로. `--no-verify` 금지 — Husky pre-commit hook 이 `commit-msg` / `pre-commit` / `pre-push` 3종 등록되어 있다 (검증: `ls .husky/`), 통과시켜야 한다. force push 금지. main 직접 push 금지. 본 작업 브랜치는 `fix/cli-js-bundle-bin` 이며 main 으로 PR 머지는 사용자가 직접 한다.

**테스트 카운트 운영 규칙**: 본 문서 헤더의 baseline 인용. 각 작업 후 **모두 동일하거나 증가** 해야 한다. 줄어들면 의도적 삭제거나 회귀. 의도였다면 헤더 즉시 갱신, 아니면 원인 추적.

**IDE 진단 vs tsc**: VSCode/JetBrains 의 TypeScript language server 가 표시하는 진단과 `bunx tsc --noEmit` 결과가 어긋날 수 있다. 충돌 시 `bunx tsc --noEmit` 을 단일 진실 원천으로 사용하고, IDE 가 빨간 줄을 그어도 tsc 가 clean 이면 IDE TypeScript server 재시작.

**사용자 의사소통**: 사용자는 한국어로 응답을 원한다 (메모리 `feedback_*` 참조). 검증 없이 추측을 사실처럼 보고하지 마라 — 코드 인용으로 뒷받침하지 못하면 "확인 필요" 로 표시. 사용자가 "완벽하냐?" 라고 물으면 자체 검증 (typecheck + 3종 테스트 + grep) 을 실제로 돌린 결과를 인용해서 답해라 — 거짓 보장은 가장 강하게 금지된 행동이다 (`feedback_fact_based_only`).

**작업 진입 시 반드시 확인할 것**:
- `git status` — 미커밋 변경사항 확인.
- `bunx tsc --noEmit` 한 번 — 진입 baseline 이 깨끗한지 검증.
- 본 문서의 헤더 baseline ↔ 실측 카운트 일치 확인. 다르면 본 문서 stale 가능 — Section A~M 의 마크 재검증.

### 0.1 진행 중 / 잔여 작업

**완료 영역**:
- Step 1~9 — gildash 단일 진입점 마이그레이션 (cli 의 `from 'oxc-parser'` 0건, Section N).
- Step 10 — `zb build adapter` 본체 (Section A~L 의 ✅ 항목들).
- 영역 1·2 — 사용자 앱 빌드 측 manifest 소비 (Section M Item 114·115·119, `AdapterDefinitionResolver` manifest-only wiring + `.ts` fallback 폐기).

**잔여 작업 — 영역 3: 어댑터 내장 미들웨어 augment 흡수**:
- 진입 조건: 어댑터 패키지 (예: `@zipbul/http-adapter`) 안에 `defineMiddleware/Guard/ExceptionFilter` 호출이 작성되는 시점. 현재 http-adapter 의 `src/` (spec 제외) 에 0건이라 진입 보류.
- 작업 범위:
  1. `extractBuiltins` 를 augment 추출까지 확장 — cli 측 `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` 의 `extractMiddlewareAugments` 흡수. 결과를 `BuiltinEntry.augments?: PropAugment[]` 필드로 직렬화 (`BuiltinsManifest` 인터페이스 확장).
  2. `dist/context-augments.d.ts` emit (Item 58) — `declare module '<adapter-package>' { interface <ContextType> { ... } }` 템플릿. `runCodegen` 의 .d.ts emit 분기에서 추가.
  3. `__augments` IR injection (Item 60) — 사전 변환 패턴: `Bun.build` 호출 *전* 에 `.ts` 소스를 임시 디렉토리에 변형 (defineMiddleware 호출 자리에 augments IR 인자 주입), 변형된 `.ts` 를 entrypoint 로 전달. 패턴 참조: `packages/cli/src/bin/build/lib-build.ts` + `lib-augment-injector.ts`.
  4. 검증 어댑터 — http-adapter 가 augment 0건이면 fixture (`packages/cli/test/fixtures/augment-adapter/`) 신설 후 e2e.

**남은 명세 미완 항목** (Section A~M 의 ⬜ / 🟡 표기):
- Section A·B·C·D·E·G·H·I·J 곳곳에 있는 보강 항목들 (test-fixtures 제외 룰, 워크스페이스 심볼릭 정규화, BOM 검증, Adapter 메서드 시그니처, Decorator 인자 schema, re-export 체인, handler step 카운트, files 필드 검증, 타입 schema 변환 / 제네릭 / overload, sourcemap, sideEffects 자동, WARN/ERROR 분리, tsc 라인별 진단, exit code 2 등). 우선순위 낮음.

### 0.2 회귀 baseline + 검증 명령

작업 시작 전과 작업 종료 시점에 동일하게 다음 명령을 루트에서 실행해서 "테스트 카운트 보존" 을 검증한다.

- `bunx tsc --noEmit` — exit 0, stderr 0 라인. IDE diagnostic 과 어긋나면 본 명령의 결과만 신뢰.
- `bun run test:unit` (`1873 pass`) / `bun run test:integration` (`147 pass`) / `bun run test:e2e` (`370 pass`) / `bun run test:smoke` (`1 pass`) — 각 작업 종료 시 **모두 동일하거나 증가**.

추가 회귀 가드 (workspace dev 흐름):
- `cd packages/http-adapter && bun run build` — 어댑터 manifest emit
- `cd examples && rm -rf .zipbul .zipbul-temp dist && bun run build` — manifest-only 사용자 앱 빌드
- `bun dist/entry.js & sleep 2 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/users` — HTTP 200 확인 후 kill

### 0.3 사용자 협업 원칙 — 메모리 동기화 + 강제 사항

본 섹션은 메모리 시스템 (`/home/revil/.claude/projects/-home-revil-projects-zipbul-zipbul/memory/`) 의 feedback 메모를 본 문서에 인라인으로 옮긴 것이다. 새 에이전트가 메모리를 읽지 못하는 상황에서도 본 문서만으로 사용자 협업 규칙을 알 수 있도록.

- **검증 없는 추측 금지** (`feedback_no_unverified_claims`, `feedback_fact_based_only`): 코드를 인용하지 못하면 "확인 필요" 로 표시. 측정하지 않은 성능 주장 금지. 사용자가 "확실하냐?" / "완벽하냐?" 라고 물으면 typecheck + 3종 테스트 + grep 을 실제로 돌려서 결과를 인용.
- **땜질 금지** (`feedback_no_patchwork`): 테스트 실패 시 분기/폴백/조건문 추가로 회피하지 마라. 근본 원인을 찾아 해결. 임시 우회가 진짜 필요하면 사용자에게 설명하고 동의 받기.
- **근거 없는 추상화 금지** (`feedback_no_groundless_abstraction`): 새 helper/wrapper/abstraction layer 도입 전에 *기존 코드의 어떤 문제* 가 그것을 요구하는지 명시. "코드가 길어서 분리" 같은 이유는 부족.
- **JSDoc 어노테이션 빌드 지시자 금지** (`feedback_no_annotation_magic`): `/** @internal */` 같은 어노테이션을 빌드 시점 동작에 영향 주는 신호로 쓰지 마라. 구조로 표현 (export 안 함, separate file, etc.).
- **검토 모드 준수** (`feedback_review_only`): 사용자가 "검토" / "review" 만 요청하면 임의로 수정/구현 계획 만들지 마라 — 검토 결과만 보고.
- **린트 규칙 제거 시 대안 제시 금지** (`feedback_no_lint_suggestions`): 사용자가 lint 룰을 빼라고 하면 "그럼 대신 X 를 권장합니다" 같은 대안 부착 금지.
- **Bun/런타임 동작 검증 후 제안** (`feedback_verify_before_propose`): "Bun 에서 X 가 작동할 것이다" 같은 예상으로 제안하지 마라. 실제 테스트로 검증한 후에 제안.
- **아키텍처 제안 시 코드 분석 선행** (`feedback_no_unverified_architecture`): 프레임워크 코드를 직접 읽지 않고 아키텍처 제안 금지.
- **인수인계 문서는 디테일한 산문으로** (`feedback_doc_detail`): 본 문서처럼 다른 에이전트에게 인계할 문서를 작성할 때 코드 스니펫·체크리스트만으로 채우지 말고 상황·방향·근거·맥락을 산문으로 풀어 써라. 본 Section 0 가 그 형태의 예시다.

**작업 시작 전 강제 체크리스트**:
1. `git status` 로 워킹 디렉토리 깨끗한지 확인.
2. `bunx tsc --noEmit` + 4 종 테스트 — 본 문서 헤더의 baseline 과 일치하는지. 다르면 본 문서 stale.
3. 본 Section 0 전체 + 메모리 (`memory/project_adapter_compiler_contract.md`) 를 읽기.

---

## A. Front-end — 소스 수집·파싱

1. 🟡 어댑터 패키지의 모든 `.ts` 소스 파일 수집 — `walkSourceTree` 가 `node_modules`/`dist`/`.zipbul`/`*.spec.ts`/`*.test.ts`/`*.d.ts` 제외. **`test-fixtures/` 디렉토리 명시 제외 안 함**.
2. 🟡 심볼릭 링크 (workspace) 해상 — `resolve(packageRoot)` 로 절대화만. link target 으로의 정규화 미구현.
3. ⬜ `tsconfig.json` 의 `extends` 체인 평탄화 — adapter-build 자체 평탄화 0, tsc 위임. 명세 의도가 자체 평탄화였다면 미구현.
4. ✅ `package.json` 로드 + `zipbul.kind === "adapter"` 확인 — `validateAdapterKind`.
5. 🟡 모듈 의존 그래프 구성 — `extractRelations` 부분 활용 (`collectPeerSymbols` 의 imports/type-references 만). 풀 그래프 (re-export 체인, 의존 순서) 미구성.
6. ✅ peer dependency (`@zipbul/core`, `@zipbul/common`) 해상도 — `validatePackageFields`.
7. ⬜ ambient declaration / type-only import — 처리 코드 0.
8. 🟡 UTF-8 인코딩 — `readFile(p, 'utf8')` 명시. BOM 직접 검증 없음 (`parseSource` 위임 추정).
9. ✅ AST 파싱은 `@zipbul/gildash` 의 `parseSource` 단일 진입점.

## B. 정적 분석 — 추출

> 본 섹션의 모든 추출은 `@zipbul/gildash` 의 공개 API (`extractSymbols`, `extractRelations`, `patternSearch`) 위에서 수행. cli 자체 AST 노드 매칭 코드 신설 금지.

10. ✅ `defineAdapter()` 호출 위치 + 인자 객체 추출 — `findDefineAdapterCall` + `extractAdapterDefinition`.
11. ✅ `adapter` 필드 → 어댑터 클래스 식별.
12. ✅ `context` 필드 → Context 클래스 식별.
13. ✅ `pipeline` 배열 → phase/step 순서 추출 — `readPipelineField`.
14. ✅ `phase` enum → 멤버명·값 추출 — `resolveEnumMembers` (인라인 dedup).
15. ✅ `step` enum → 멤버명·값 추출.
16. ✅ Context 클래스 속성/getter → namespace map 자동 도출 — `extractContextNamespaces`.
17. ⬜ Adapter 클래스 메서드 시그니처 수집 — 생성자만 추출됨 (Item 54c). 인스턴스 메서드 (`start`/`stop` 등) manifest 누락.
18. ✅ Context 클래스 메서드 시그니처 수집 — `extractContextNamespaces.methods`.
19. ✅ 어댑터 export 데코레이터 함수 enumerate — `extractDecoratorSchema`.
20. ✅ Decorator 분류: controller / handlers / options (어댑터 entry 한정 — param 은 provider 생성자 별도 경로).
21. ⬜ Decorator 인자 schema (리터럴 / 식별자 참조 한정) — 데코레이터 이름만 추출, 인자 schema 미추출.
21b. — Provider 생성자 파라미터 데코레이터 (`@Inject` 등) — 어댑터 컴파일러 책임 외 (사용자 앱 빌드 책임). 명세 분류 오류로 후속 정리 대상.
22. ✅ 어댑터 패키지 내 `defineMiddleware` 호출 추출 — `extractBuiltins` (kind: 'middleware'). 호출 메타만.
23. ⬜ 내장 미들웨어의 augments + contextOps 추출 — augment 흡수 영역 (영역 3, 어댑터 내장 미들웨어 작성 시점에 진입).
24. ✅ 어댑터 내장 `defineGuard` / `defineExceptionFilter` 추출 — 동일 함수.
25. ❌ Public export 전수 (barrel 분석) — 사용자 명시 거부 (`PeerContract.publicExports` 제거). 어댑터 contract 와 무관.
26. ✅ 어댑터 ID (어댑터 클래스 이름) 추출.
27. ✅ `defineAdapter` named export 단 1개 — `findDefineAdapterCall` 단일 매칭 강제.
28. ⬜ Re-export 체인 분석 — barrel `index.ts` 가 다른 모듈의 `defineAdapter` 를 re-export 하는 케이스 미처리.

## C. 검증 — Contract Conformance

29. 🟡 Adapter 클래스가 `core/Adapter` interface 구현 — tsc 위임 (`--emitDeclarationOnly` 부산물).
30. 🟡 Context 클래스가 `common/AdapterContext` interface 구현 — 동일.
31. ✅ pipeline 항목 ↔ phase/step 멤버 매칭 — `validatePipeline`.
32. ⬜ pipeline 에 핸들러 step 정확히 1개 — consumer rank 카운트 없음.
33. ✅ pipeline 비어있지 않음 — `readPipelineField` null 시 throw.
34. ✅ phase enum 멤버명 ↔ pipeline 일치.
35. ✅ step enum 멤버명 ↔ pipeline 일치.
36. 🟡 Decorator 함수 시그니처 호환 — tsc 위임.
37. ✅ 어댑터 클래스 export 검증 — `validateClassExports`.
38. ✅ Context 클래스 export 검증 — 동일 함수.
39. ✅ 한 패키지에 어댑터 클래스 정확히 1개 — `findDefineAdapterCall` 단일 매칭.
40. ✅ Decorator 이름 중복 없음 — `ensureUnique`.
41. ✅ Decorator 카디널리티 (`controller` 단수 1, `handlers` 1+, `options` 0+) — `AdapterEntryDecorators` 정의 (`packages/common/src/adapter/types.ts`).
42. ✅ Phase 이름 중복 없음 — `resolveEnumMembers` dedup.
43. ✅ Step 이름 중복 없음.
44. ✅ Adapter 생성자 옵션 1 인자 (또는 무인자) — `extractAdapterConstructorSchema`.
45. ✅ `package.json` main / module / types / exports 정합성 — `validatePackageFields`.
46. ✅ peer dep 버전 범위 명시.
47. ✅ `zipbul.kind` 누락 hard error — `validateAdapterKind`.
48. ⬜ Manifest 출력 경로의 `package.json.files` 포함 검증 — 어댑터가 `files: ["dist"]` 누락 시 알림 없음.
48b. ✅ `clusterStrategy` 추출 (Shared 기본) — `readClusterStrategy`.

## D. Type 처리

49. 🟡 namespace property 타입 → JSON-friendly schema — `ContextNamespaceProperty.type: string \| null` 으로 raw 텍스트 보존만. JSON schema 변환 안 함.
50. ⬜ 제네릭 타입 파라미터 보존 — raw 텍스트로 묻어가기는 함 (구조화 안 됨).
51. ⬜ 메서드 overload 시그니처 모두 보존 — 단일 시그니처만.
52. ⬜ Built-in 미들웨어 PropAugment 추출 — Item 23 과 동일 augment 영역 (영역 3).
53. ⬜ Type-only import 추적.
54. ⬜ tsconfig `paths` alias 정규화.
54b. ✅ `defineAdapter.provides` 추출 — `readProvidesField` → peer-contract 에 emit.
54c. ✅ Adapter 생성자 옵션 schema — `extractAdapterConstructorSchema` → `dist/adapter-constructor-schema.json` emit.

## E. Code Generation

55. ✅ TS → JS 컴파일 — `Bun.build` (target=bun, format=esm, packages=external, minify={ syntax, whitespace }).
56. ✅ `dist/index.js` 생성.
57. 🟡 `dist/index.d.ts` 생성 — `tsconfig.build.json` 존재 시에만. 부재 시 skip.
58. ⬜ `dist/context-augments.d.ts` declaration merging — augment 영역 (영역 3).
59. ⬜ Source map (`.js.map`) — `Bun.build` 의 sourcemap 옵션 부재.
60. ⬜ JS 산출물 `__augments` / `__contextOps` IR injection — augment 영역 (영역 3, 사전 변환 패턴).
61. 🟡 런타임 보존 — `minify: { identifiers: false }` 식별자 보존. self-test 가 검증했으나 ❌제거.
62. ⬜ ESM `export *` named binding 안정성 미검증.
63. ⬜ `sideEffects: false` 호환성 자동 산출 미처리.

## F. Manifest Emission

각 manifest 는 결정적 JSON (canonical key 정렬, UTF-8, LF). 모든 path 는 `dist/` 기준 상대.

64. ✅ `dist/adapter.manifest.json` (루트 인덱스).
65. ✅ `dist/pipeline-schema.json` — phaseEnum/stepEnum + phaseMembers/stepMembers (선언 순서) + pipeline.
66. ✅ `dist/context-namespaces.json` — Context type + methods + namespaces.
67. ✅ `dist/decorator-schema.json` — controller / handlers / options.
68. ✅ `dist/builtins.json` — 호출 메타 (augments 미포함, 영역 3 영역).
69. ✅ `dist/peer-contract.json` — clusterStrategy + provides + peerSymbols.
70. ✅ JSON 키 순서 결정적 정렬 — `canonicalize` 재귀.
71. ✅ 모든 manifest `$schemaName` 자기 식별.
71b. ✅ `dist/adapter-constructor-schema.json`.

## G. Atomic Emit + 무결성

72. ✅ `dist/.staging/` 에 쓰기.
73. ✅ 검증 후 `.staging/` → `dist/` atomic rename.
74. ✅ 실패 시 staging cleanup, dist 무손상.
75. ✅ manifest 가 마지막 — child 6 개 후 `adapter.manifest.json`.
76. 🟡 결정성 — `serializeJson` + `canonicalize` 가 키 정렬로 보장. byte-identical 직접 측정 코드 없음.
77. ❌ 산출물 size / hash 보고 — 사용자 명시 거부 (CI 게이트는 외부 운영 영역).
78. ✅ tsbuildinfo / sourcemap 결정성 비교 제외 — `.zipbul/cache/<pkg>.tsbuildinfo` (dist 외부).

## H. Diagnostics

79. ✅ file:line:column 위치 정보 — `diag` + `lineOffsets`/`getLineColumn`.
80. ✅ 카테고리 (SYNTAX / CONTRACT / MISSING_EXPORT / DUPLICATE / TYPE / IO).
81. ⬜ tsc 에러 분류 — IO 카테고리로 통합, 분류 안 함.
82. ✅ 다중 에러 보고 — `collectFrom` aggregate.
83. 🟡 진단 출력 형식 — `[CATEGORY] reason at file:line:col`. WARN/ERROR 통일 미확인.
84. ⬜ WARN vs ERROR 분리 — 모두 ERROR. WARN 경로 없음.
85. ❌ `--format=json` — 옵션 제거, JSON 출력 고정.
86. ❌ ANSI 컬러 + `--no-color` — 옵션 제거.

## I. Build Pipeline Integration

87. 🟡 tsc invoke — `runTsc` 가 `--emitDeclarationOnly` 호출. `--noEmit` 별도 호출 없음.
88. ✅ tsc 종료 코드 처리 — exit code 검사 후 비 0 시 throw.
89. 🟡 tsc stdout/stderr 캡처 + 진단 변환 — raw 출력을 단일 IO 메시지로 묶음 (라인별 변환 안 함).
90. ✅ tsc 실패 시 빌드 중단 + cleanup — `runCodegen` throw → staging cleanup.
91. ✅ tsc 환경 부재 시 명확한 에러 — `resolveTscBin` 부재 시 throw.
92. ✅ composite / references 트리 처리 — `tsconfigNeedsBuildMode` 검사 후 build mode 분기.
93. ✅ tsbuildinfo `.zipbul/cache/<pkg>.tsbuildinfo`.

## J. CLI Contract

94. ✅ `zb build adapter` 서브커맨드 라우팅.
95. ✅ 작업 디렉토리 = 어댑터 패키지 루트 (`zipbul.kind` 확인 후 진입).
96. ❌ `--out-dir` 옵션 — 사용자 명시 거부, `dist/` 고정.
97. 🟡 verbose / quiet 분리 — `--verbose, -v` 만. quiet 거부 (JSON 단일 라인 출력 모드에서 의미 없음).
98. 🟡 exit code (0 / 1 / 2 분리) — success → 0, DiagnosticError → 1. 환경 오류 (2) 분리 안 됨.
99. ✅ stdout = 진행 / stderr = 진단.
100. ❌ `--dry-run` — 사용자 명시 거부.
101. ❌ `--check-only` — 사용자 명시 거부.

## K. Watch / Incremental

102~108. ❌ — 어댑터 컴파일러는 1 회 실행 컴파일러. watch 는 사용자 앱 빌드 (`zb dev`) 영역. 사용자 명시 거부.

## L. Self-test (Round-trip)

109~113. ❌ — 자기 검증 모드는 사용자 기능과 컴파일러 개발자 검증을 혼합. 검증은 정식 통합 테스트 (`adapter-build.test.ts`) 로 분리. 사용자 명시 거부.

## M. CLI Consumer Protocol — 앱 빌드 측 짝 contract

> 어댑터 컴파일러가 ship 하는 manifest 를 사용자 앱 빌드 (`zb build`) 가 어떻게 소비하는지의 명세.

114. ✅ 사용자 앱 빌드 시 `node_modules/<adapter-package>/dist/adapter.manifest.json` 우선 로드 — `AdapterDefinitionResolver` 의 manifest-only wiring.
115. ✅ manifest 부재 시 hard error — `.ts` 파싱 fallback 폐기.
117. ❌ manifest 캐시 무효화 — `contentHash` 제거로 감지 수단 없음. 사용자 명시 거부.
118. ❌ manifest hash 임베딩 — 동일.
119. ✅ 다중 어댑터 manifest 충돌 검출 — `detectMultiAdapterConflicts`.


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

**구성**. 137 항목 = 128 원본 책임 (1~128) + 6 신규 (21b·48b·54b·54c·58보강·71b) + 4 메인테이너 협력 (129·130·131·132). Item 41 카디널리티 룰 정정 포함.

**다음 에이전트의 진입점**: Section 0.1 의 잔여 작업 (영역 3 — 어댑터 내장 미들웨어 augment 흡수). 진입 조건 부재 시 (어댑터에 `defineMiddleware` 호출 0건) 보류.

근거는 모두 zipbul 본체 contract 또는 컴파일러 표준 책임. 새 항목 도입은 zipbul 본체 코드 라인 인용 후 추가.
