# Adapter Compiler — 책임 명세 + 실행 인수인계

> 어댑터 패키지 (`zb build adapter`) 가 컴파일러로서 수행해야 할 모든 일.
> 근거: zipbul 본체 (`packages/core`, `packages/common`, `packages/cli`) 가 어댑터에게 요구하는 contract.
> 외부 프레임워크 비교 0. 개발 단계 무관 항목 (마이그레이션·스키마 버전·생태계 거버넌스) 제외.

**Last sync**: STATUS 문서 (`ADAPTER_COMPILER_STATUS.md`) 의 Last sync 단일 출처. 본 문서는 책임 명세 (Section A~N) 위주이며 commit-level 진척은 STATUS 문서 Section B 의 1:1 대조표 참조.

**Branch**: `fix/cli-js-bundle-bin`. **Baseline 카운트**: STATUS 문서 Section A.1 단일 출처 (현 시점 1967 / 120 / 370 baseline).

상태 표기 — 본 문서 전체에서 일관된 의미 (Section A~M 본문에서 사용):
- 🟡 진행 중. 부분 완료 또는 결정 대기.
- ⬜ 미착수.
- ❌ 사용자 명시 거부로 제거 — STATUS 문서 Section B 비고 참조.

> 완료 (✅) 항목은 STATUS 문서 Section B 의 1:1 대조표에서만 추적. 본 문서는 미완료/거부 항목만 보존.

---

## 0. 현재 상태 스냅샷 — 다음 에이전트 인수인계

### 0.0 본 문서를 읽는 새 에이전트에게 — 운영 컨텍스트

본 문서는 사용자가 conversation context 를 클리어하기 직전에 작성된 인수인계 패키지다. 새 에이전트는 이전 대화를 모르는 상태에서 본 파일과 git history (`git log --oneline -30`) 만으로 작업을 이어가야 한다. 따라서 본 섹션은 *작업 자체* 보다 먼저 알아야 할 *운영 환경* 을 다룬다.

**저장소 구조**: zipbul 모노레포. 루트는 `/home/revil/projects/zipbul/zipbul`. 작업 디렉토리는 항상 루트로 둔다. 패키지는 `packages/{cli,common,core,http-adapter,logger}` 5개 (검증: `ls packages/`); `@zipbul/result` 는 외부 의존 (workspace 패키지 아님). catalog 기반 dependency 공유 (Bun 1.3 catalog). 본 문서는 루트에 위치한 `ADAPTER_COMPILER.md` 다 — 다른 위치로 옮기지 마라.

**런타임·도구**: Bun (현재 설치 1.3.13). Node 사용 금지 — 본 프로젝트의 모든 스크립트·테스트가 `bun` / `bunx` 로 돌아간다. TypeScript 5.9. typecheck 는 `bunx tsc --noEmit` (루트 디렉토리에서). 테스트는 `bun run test:unit` / `bun run test:integration` / `bun run test:e2e` (루트의 `package.json.scripts` 참조). 패키지 매니저 명령도 `bun add`, `bun install`. npm/yarn/pnpm 사용 금지.

**git 작업 규칙**: 사용자가 명시 요청할 때만 커밋. 커밋 메시지는 한국어, scope 명시 (`feat(cli): ...`, `refactor(cli): ...`, `test(cli): ...`, `docs(compiler): ...`). 마지막 라인은 항상 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (개행 + 빈 줄 + Co-Authored-By). 메시지는 HEREDOC 으로 전달 (Bash 도구 시스템 가이드 참조). 커밋 amend 금지 — 새 커밋으로. `--no-verify` 금지 — Husky pre-commit hook 이 `commit-msg` / `pre-commit` / `pre-push` 3종 등록되어 있다 (검증: `ls .husky/`), 통과시켜야 한다. force push 금지. main 직접 push 금지. 본 작업 브랜치는 `fix/cli-js-bundle-bin` 이며 main 으로 PR 머지는 사용자가 직접 한다.

**테스트 카운트 운영 규칙**: baseline 은 STATUS 문서 Section A.1 단일 출처. 각 Step 작업 후 **세 카운트 모두 동일하거나 증가** 해야 한다. 줄어들면 — 의도적으로 테스트를 삭제했거나 리네임이 안 따라간 것. 의도였다면 STATUS 문서의 baseline 을 즉시 업데이트해라. 의도가 아니라면 회귀이므로 중단하고 원인 추적.

**IDE 진단 vs tsc**: VSCode/JetBrains 의 TypeScript language server 가 표시하는 진단과 `bunx tsc --noEmit` 결과가 어긋날 수 있다. 충돌 시 `bunx tsc --noEmit` 을 단일 진실 원천으로 사용하고, IDE 가 빨간 줄을 그어도 tsc 가 clean 이면 IDE TypeScript server 재시작.

**사용자 의사소통**: 사용자는 한국어로 응답을 원한다 (메모리 `feedback_*` 참조). 검증 없이 추측을 사실처럼 보고하지 마라 — 코드 인용으로 뒷받침하지 못하면 "확인 필요" 로 표시. 사용자가 "완벽하냐?" 라고 물으면 자체 검증 (typecheck + 3종 테스트 + grep) 을 실제로 돌린 결과를 인용해서 답해라 — 거짓 보장은 가장 강하게 금지된 행동이다 (`feedback_fact_based_only`).

**작업 진입 시 반드시 확인할 것**:
- `git status` — 미커밋 변경사항 확인.
- `git log --oneline -10` — 최근 커밋과 STATUS 문서의 "Last sync" 비교. 차이가 있으면 STATUS 문서 Section B 의 1:1 대조표 (코드 라인 인용 포함) 를 grep 으로 재검증.
- `bunx tsc --noEmit` 한 번 — 진입 baseline 이 깨끗한지 검증.

### 0.1 진행 중 작업

**Step 10 — 어댑터 컴파일러 MVP (`zb build adapter`)**. Section A~L 에 명세된 책임의 vertical thin-slice 구현. 잔여 작업 + 의존성은 STATUS 문서 Section D 의 4 영역 (영역 1 manifest-reader 복원 → 영역 2 사용자 앱 빌드 wiring → 영역 3 augment 흡수 → 영역 4 본 문서 동기화) 단일 출처.

### 0.2 회귀 baseline + 검증 명령

작업 시작 전과 작업 종료 시점에 동일하게 다음 명령을 루트에서 실행해서 "테스트 카운트 보존" 을 검증한다.

- `bunx tsc --noEmit` — exit 0, stderr 0 라인. IDE diagnostic 과 어긋나면 본 명령의 결과만 신뢰 (Section 0.0 의 "IDE 진단 vs tsc" 참조).
- `bun run test:unit` / `bun run test:integration` / `bun run test:e2e` — 카운트는 STATUS 문서 (`ADAPTER_COMPILER_STATUS.md` Section A.1) 단일 출처. 각 작업 종료 시점에 **세 카운트 모두 동일하거나 증가**.

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
2. `git log --oneline -1` 결과가 본 문서의 "Last sync" 와 일치하는지 확인. 다르면 본 문서가 stale 일 수 있으니 STATUS 문서 (`ADAPTER_COMPILER_STATUS.md`) 의 Section B 1:1 대조표를 grep 으로 재검증.
3. `bunx tsc --noEmit` 한 번 — 진입 baseline 이 깨끗한지 확인.
4. 본 Section 0 전체를 처음부터 끝까지 + STATUS 문서 Section A·B·C·D·E.

---

## A. Front-end — 소스 수집·파싱

1. ⬜ 어댑터 패키지의 모든 `.ts` 소스 파일 수집 (test/spec/fixtures 제외 룰 명시)
2. ⬜ 심볼릭 링크 (workspace) 해상 후 정규화된 절대 경로 사용
3. ⬜ `tsconfig.json` 발견·로드·`extends` 체인 전체 평탄화
4. ⬜ `package.json` 로드 + `zipbul.kind === "adapter"` 확인
5. ⬜ 모듈 의존 그래프 구성 (import / export 추적)
6. ⬜ peer dependency (`@zipbul/core`, `@zipbul/common`) 해상도
7. ⬜ node_modules 의 ambient declaration / type-only import 처리
8. ⬜ UTF-8 인코딩 강제 (BOM 허용, locale-independent 파싱)

> Step 10 본체에서 1~8 을 일괄 구현. 어댑터 컴파일러 진입점 신설 — `packages/cli/src/compiler/adapter-build/` 디렉토리 권장.

## B. 정적 분석 — 추출

> 본 섹션의 모든 추출은 `@zipbul/gildash` 의 공개 API (`extractSymbols`, `extractRelations`, `patternSearch`, `Visitor`, `visitorKeys`) 위에서 수행한다. 자체 AST 노드 매칭 코드를 새로 추가하지 않는다 — 길대시 API 가 부족하면 길대시 측 패치 요청을 우선 (Section N).

10. ⬜ `defineAdapter()` 호출 위치 + 인자 객체 추출 — `extractSymbols` variable initializer (`ExpressionValue`) 또는 호출 패턴 매칭으로 획득. cli 측 `config-extractor` 가 부분 처리 중 — 어댑터 컴파일러 본체에서 재사용.
11. ⬜ `adapter` 필드 → 어댑터 클래스 식별
12. ⬜ `context` 필드 → Context 클래스 식별
13. ⬜ `pipeline` 배열 → phase/step 순서 추출
14. ⬜ `phase` enum → 멤버명·값 추출
15. ⬜ `step` enum → 멤버명·값 추출
16. ⬜ Context 클래스 속성/getter → namespace map 자동 도출
17. ⬜ Adapter 클래스 메서드 시그니처 수집
18. ⬜ Context 클래스 메서드 시그니처 수집
19. ⬜ 어댑터 export 데코레이터 함수 enumerate
20. ⬜ Decorator 분류: controller / method / option (어댑터 entry 한정 — param 은 provider 생성자 별도 경로)
21. ⬜ Decorator 인자 schema (리터럴 / 식별자 참조 한정)
21b. ⬜ Provider 클래스 생성자 파라미터 데코레이터 (`@Inject` 등) 추출 — `extractSymbols.parameters[*].decorators` 경유 (어댑터 entry 와 분리)
22. 🔵 어댑터 패키지 내 `defineMiddleware` 호출 추출 (built-in 미들웨어) — cli 의 미들웨어 컴파일러 인프라 존재, 어댑터 컴파일러로 흡수 필요
23. 🔵 내장 미들웨어의 augments + contextOps 추출 — 동일
24. ⬜ 어댑터 내장 `defineGuard` / `defineExceptionFilter` 추출
25. ⬜ Public export 전수 (index.ts barrel 분석)
26. ⬜ 어댑터 ID (어댑터 클래스 이름) 추출
27. ⬜ `defineAdapter` named export 단 1개 (default export 금지)
28. ⬜ Re-export 체인 분석 — barrel 파일이 다른 모듈의 `defineAdapter` 를 re-export 하는 케이스 추적

## C. 검증 — Contract Conformance

29. ⬜ Adapter 클래스가 `core/Adapter` interface 구현 (tsc 위임)
30. ⬜ Context 클래스가 `common/AdapterContext` interface 구현 (tsc 위임)
31. ⬜ `defineAdapter.pipeline` 의 모든 항목이 phase enum / step enum 의 멤버여야 함
32. ⬜ pipeline 에 핸들러 step (consumer rank) 정확히 1개 존재
33. ⬜ pipeline 비어있지 않음
34. ⬜ phase enum 멤버명 ↔ pipeline 사용 일치
35. ⬜ step enum 멤버명 ↔ pipeline 사용 일치
36. ⬜ Decorator 함수 시그니처가 zipbul 의 `MethodDecorator` / `ClassDecorator` / `PropertyDecorator` 와 호환
37. ⬜ 어댑터 클래스가 패키지에서 export 되는지
38. ⬜ Context 클래스가 패키지에서 export 되는지
39. ⬜ 한 패키지에 어댑터 클래스 정확히 1개
40. ⬜ Decorator 이름 중복 없음 (controller / method / option 그룹 내)
41. ⬜ Decorator 카테고리 카디널리티 — `controller` **정확히 1** (단수 `DecoratorRef`), `handlers` (=method) **1+** (배열 필수), `options` **0+** (optional). 근거: `packages/common/src/adapter/types.ts:18-30` `AdapterEntryDecorators` 정의. param 카테고리는 어댑터 entry 에 없음 (Item 20 정정).
42. ⬜ Phase 이름 중복 없음
43. ⬜ Step 이름 중복 없음
44. ⬜ Adapter 생성자 시그니처: 옵션 객체 1개 인자 (또는 무인자) 만 허용
45. ⬜ `package.json` 의 `main` / `module` / `types` / `exports` 정합성
46. ⬜ peer dependency 버전 범위 명시 여부
47. ⬜ `package.json.zipbul.kind === "adapter"` 가 누락되면 hard error
48. ⬜ Manifest 출력 경로가 `files` 필드에 포함되는지
48b. ⬜ Adapter 인스턴스의 `clusterStrategy` 속성 추출 — 미명시 시 `ClusterStrategy.Shared` 기본. 근거: `packages/core/src/adapter/adapter.ts:104` + `packages/common/src/adapter/types.ts:39-55` + 런타임 소비 `packages/core/src/application/application.ts:294`. **필수** — manifest 없으면 cluster 모드 동작 불가. `dist/peer-contract.json` 에 포함.

## D. Type 처리

49. ⬜ Context interface 의 namespace property 타입 → JSON-friendly schema 변환
50. ⬜ 제네릭 타입 파라미터 보존
51. ⬜ 메서드 overload 시그니처 모두 보존
52. 🔵 Built-in 미들웨어의 `PropAugment` 추출 (path + RHS class/method) — cli 측 인프라 있음
53. ⬜ Type-only import 추적 (declaration merging 의 import source 해상)
54. ⬜ tsconfig 의 `paths` alias 정규화 후 모듈 식별
54b. ⬜ `defineAdapter()` 인자의 `provides?: readonly ContextKey<unknown>[]` 추출 — 어댑터가 핸들러에게 제공하는 Context 키 선언. 근거: `packages/common/src/adapter/define-adapter.ts:42-43`. **필수** — Item 119 다중 어댑터 ContextKey 충돌 검출의 입력 데이터. `dist/peer-contract.json` (Item 69) 에 포함.
54c. ⬜ Adapter 클래스 생성자 옵션 파라미터 타입 추출 — 단순 시그니처 검증 (Item 44) 을 넘어 *옵션 schema 자체* 를 manifest 에 emit. 근거: `packages/http-adapter/src/http-adapter.ts:64` (`HttpServerOptions`). 배치: 신규 `dist/adapter-constructor-schema.json` (Item 71b). 컴파일 타임 옵션 검증이 본 컴파일러의 존재 이유와 직결 — 사용자 앱 빌드가 `HttpAdapter({ port: 'foo' })` 같은 잘못된 옵션을 빌드 단계에서 잡아내야 함.

## E. Code Generation

55. ⬜ TS → JS 컴파일 (bun build 또는 tsc)
56. ⬜ `dist/index.js` 생성 (런타임 barrel)
57. ⬜ `dist/index.d.ts` 생성 (타입 barrel)
58. ⬜ `dist/context-augments.d.ts` 생성 — 템플릿: `declare module '<adapter-package>' { interface <ContextType> { <augmentedProp>: <BaseType> & <Augment>; ... } }`. 모든 built-in 미들웨어의 `PropAugment` (path + RHS class/method) 머지. 소스: `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` 의 PropAugment 추출 결과 소비.
59. ⬜ Source map 생성 (`.js.map`, external 파일, sourcesContent 포함)
60. ⬜ JS 산출물 내 `__augments` / `__contextOps` IR injection (built-in 미들웨어용 — 기존 미들웨어 컴파일러 패턴)
61. ⬜ **런타임 보존** — 어댑터 클래스 / Context 클래스 / 데코레이터 함수 / phase·step enum 모두 dist/index.js 에서 *값으로* import 가능 (tree-shaking 시 dead code 제외, 사용된 export 무손상)
62. ⬜ ESM `export *` 의 named binding 안정성 (re-export 명시 권장, barrel 흡수 시 export name 보존)
63. ⬜ `sideEffects: false` 호환성 — 데코레이터 등록·전역 metadata mutation 의 side-effect 식별 후 `sideEffects` 필드 자동 산출

## F. Manifest Emission

각 manifest 는 결정적 JSON (canonical key 정렬, UTF-8, LF). 모든 path 는 `dist/` 기준 상대.

64. ⬜ `dist/adapter.manifest.json` — 루트 manifest. 다른 manifest paths 인덱스 + 어댑터 식별자 + 빌드 도구 버전 (`producedBy: "zb@x.y.z"`).
65. ⬜ `dist/pipeline-schema.json` — pipeline 배열 + consumer rank step + phase enum 값 + step enum 값.
66. ⬜ `dist/context-namespaces.json` — Context type 이름 + namespace map → property/method schema.
67. ⬜ `dist/decorator-schema.json` — controller / method / option (어댑터 entry, Item 20 정정) + provider-param (`extractSymbols.parameters[*].decorators`, Item 21b) 별 데코레이터 이름 + 인자 schema + import path.
68. ⬜ `dist/builtins.json` — 내장 미들웨어 / 가드 / 필터 메타 (augments + contextOps + 등록 phase + factory ref).
69. ⬜ `dist/peer-contract.json` — `defineAdapter` 가 의존하는 `@zipbul/core` / `@zipbul/common` 심볼 (consumer rank step 등) 의 사용 흔적.
70. ⬜ JSON 키 순서 결정적 정렬 (canonical serialization).
71. ⬜ 모든 manifest 의 `$schemaName` 필드로 형식 자기 식별.
71b. ⬜ `dist/adapter-constructor-schema.json` — Adapter 클래스 생성자 옵션 파라미터 schema (Item 54c). `peer-contract.json` 과 의미 분리 — peer-contract 는 *어댑터가 의존하는* 심볼, 본 manifest 는 *어댑터가 노출하는* 옵션 인터페이스. **필수 채택 확정** (Item 54c 결정 근거 참조).

## G. Atomic Emit + 무결성

72. ⬜ `dist/.staging/` 디렉토리에 모든 산출물 쓰기
73. ⬜ 검증 통과 후 `.staging/` → `dist/` atomic rename
74. ⬜ 실패 시 `.staging/` cleanup, 기존 `dist/` 무손상
75. ⬜ 모든 산출물 작성 완료 전 `manifest.json` 쓰지 않음 (manifest 가 다른 파일 paths 참조하므로 마지막)
76. ⬜ 결정성 검증 (같은 입력 → 동일 산출물, 재실행 후 byte-identical)
77. ⬜ 산출물 파일 크기 / 해시 보고
78. ⬜ tsbuildinfo / source-map 메타파일은 결정성 비교에서 제외 (timestamp 무관)

## H. Diagnostics

79. ⬜ 모든 에러에 file:line:column 위치 정보
80. ⬜ 에러 분류: `SYNTAX` / `CONTRACT` / `MISSING_EXPORT` / `DUPLICATE` / `TYPE` / `IO`
81. ⬜ tsc 에러 → 어댑터 contract 위반인지 일반 타입 에러인지 판별
82. ⬜ 다중 에러 보고 (첫 에러에서 stop 안 함, 가능한 모두 수집)
83. ⬜ 진단 출력 형식 통일 (`file:line ERROR/WARN [CATEGORY] message`)
84. ⬜ WARN vs ERROR 분리 (ERROR 만 빌드 실패)
85. ⬜ JSON 출력 모드 (`--format=json`) — 머신 친화 진단 (CI 통합)
86. ⬜ ANSI 컬러 자동 감지 + `--no-color` 플래그

## I. Build Pipeline Integration

87. ⬜ tsc invoke (`tsc --noEmit` 타입 체크, `tsc --emitDeclarationOnly` .d.ts 생성)
88. ⬜ tsc 종료 코드 처리
89. ⬜ tsc stdout/stderr 캡처 + 진단 변환
90. ⬜ tsc 실패 시 빌드 중단 + 산출물 cleanup
91. ⬜ tsc 환경 부재 시 명확한 에러 메시지
92. ⬜ `composite` / `references` 프로젝트 트리 처리 (해당 어댑터만 단일 빌드 단위)
93. ⬜ tsbuildinfo 위치 고정 (`.zipbul/cache/<package>.tsbuildinfo`)

## J. CLI Contract

94. ⬜ `zb build adapter` 서브커맨드 라우팅
95. ⬜ 작업 디렉토리 = 어댑터 패키지 루트 (`package.json.zipbul.kind === "adapter"` 확인 후 진입)
96. ⬜ 출력 디렉토리 옵션 (`--out-dir`, 기본 `dist/`)
97. ⬜ Verbose / quiet 플래그
98. ⬜ 종료 코드 0 = 성공, 1 = 컴파일 실패, 2 = 환경 오류
99. ⬜ stdout = 진행상황, stderr = 진단
100. ⬜ `--dry-run` — 산출물 검증만, dist/ 미수정
101. ⬜ `--check-only` — manifest 결정성 + schema 적합성만 (CI 게이트용)

## K. Watch / Incremental

102. ⬜ `zb dev adapter` 또는 `zb build adapter --watch` 모드
103. ⬜ 파일 변경 감지 (Bun watch 우선, fallback chokidar)
104. ⬜ 영향받는 모듈만 재추출 (모듈 의존 그래프 기반 invalidation)
105. ⬜ tsc incremental (`tsBuildInfoFile`) 통합
106. ⬜ `.zipbul/cache/` 디렉토리 관리
107. ⬜ `tsconfig.json` / `package.json` 변경 시 전체 재빌드 트리거
108. ⬜ 변경 디바운싱 (50–100ms) + in-flight 빌드 cancel-and-restart

## L. Self-test (Round-trip)

109. ⬜ emit 직후 manifest 자체 schema 적합성 검증 (자기 출력을 자기 schema 로 검사)
110. ⬜ emit 직후 manifest paths 가 실제 파일과 일치하는지 확인
111. ⬜ .d.ts 파일이 컴파일 가능한 TS 인지 검증 (별도 `tsc --noEmit` 호출)
112. ⬜ dist/index.js 가 Bun 으로 import 가능한지 (런타임 import smoke)
113. ⬜ 데코레이터 enum/phase/step 의 런타임 값이 manifest 와 일치 (런타임 introspection 비교)

## M. CLI Consumer Protocol — 앱 빌드 측 짝 contract

> 어댑터 컴파일러가 ship 하는 manifest 를 사용자 앱 빌드 (`zb build`) 가 어떻게 소비하는지의 명세.
> 어댑터 컴파일러 자체 책임은 아니지만 짝으로 정해야 외부 환경 완결.

114. ⬜ 사용자 앱 빌드 시 `node_modules/<adapter-package>/dist/adapter.manifest.json` 우선 로드
115. ⬜ manifest 부재 시 — hard error (STATUS 문서 Section E1 결정).
116. ⬜ manifest 의 `producedBy` 필드 ↔ 사용자가 설치한 `@zipbul/cli` 호환성 검사
117. ⬜ manifest 가 결정적이 아닌 변경 (재게시 없이 dist/ 수정) 시 캐시 무효화
118. ⬜ 사용자 앱 컴파일 출력에 의존한 어댑터 manifest 들의 hash 임베딩 (사용자 빌드 결정성)
119. ⬜ 다중 어댑터 (사용자가 여러 어댑터 동시 사용) 시 manifest 병합 규칙 — 데코레이터 이름 충돌 검출


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

**진척도 1:1 대조**: STATUS 문서 (`ADAPTER_COMPILER_STATUS.md`) 의 Section B 가 137 항목 각각에 대해 ✅/🟡/⬜/❌/🔁 마크 + 코드 라인 인용을 단일 출처로 유지. 본 문서의 Section A~N 본문 ⬜ 마크는 stale 가능 — 항상 STATUS 문서 우선.

**다음 에이전트의 진입점**: STATUS 문서 Section D 의 4 영역 (영역 1 manifest-reader 복원 → 영역 2 사용자 앱 빌드 wiring → 영역 3 augment 흡수 → 영역 4 본 문서 동기화) 우선순위 + 의존성 + 측정 가능한 인수 기준 단일 출처.

근거는 모두 zipbul 본체 contract 또는 컴파일러 표준 책임. 새 항목 도입은 zipbul 본체 코드 라인 인용 후 추가.
