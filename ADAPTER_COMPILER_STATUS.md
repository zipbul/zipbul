# Adapter Compiler — 현재 상태 + 잔여 작업 인수인계

> 본 문서는 `ADAPTER_COMPILER.md` (책임 명세, Section A~N) 위에 얹는 **잔여 작업 + 미완 항목 추적** 인수인계 문서다. 책임 정의는 ADAPTER_COMPILER.md, 진척만 본 문서.
>
> **단일 출처 원칙**. 항목 번호·명세는 ADAPTER_COMPILER.md. 본 문서는 미완료 항목과 잔여 영역 (3·4) 만 보존. 영역 3 종료 시 본 문서 폐기, ADAPTER_COMPILER.md 단일 출처 복귀.
>
> **Branch**: `fix/cli-js-bundle-bin`. **Baseline**: Section A.1 단일 출처.

---

## 0. 본 문서를 읽는 새 에이전트에게 — 운영 컨텍스트

### 0.0 어댑터 컴파일러가 왜 존재하는가 — 본 작업의 큰 그림

zipbul 의 어댑터는 HTTP / WebSocket / Cron 같은 프로토콜별 진입점을 추상화한 패키지다. 어댑터는 (1) Adapter 클래스, (2) Context 클래스, (3) phase·step enum, (4) `defineAdapter()` 호출에 담긴 pipeline 선언, (5) controller / handler / option 데코레이터 함수, (6) 내장 미들웨어·가드·예외필터 (`defineMiddleware/Guard/ExceptionFilter`) 등을 패키지 안에 모아 둔다. 사용자 앱은 이 어댑터를 import 해서 자신의 controller 클래스에 어댑터의 데코레이터를 붙이고, `createApplication({ adapter: HttpAdapter, ... })` 으로 런타임 진입.

zipbul 은 AOT (Ahead-of-Time) 컴파일러를 가진다 — 사용자 앱 빌드 (`zb build`) 가 사용자 코드를 정적 분석해서 (a) controller 클래스 + handler 메서드 발견, (b) 미들웨어 / 가드 / 예외필터 등록, (c) Context augment 의 declaration merging, (d) 런타임 pipeline 생성 등을 빌드 시점에 해결한다. 이 정적 분석을 위해 빌드는 *어댑터의 구조 정보* — 어댑터 클래스 식별자, pipeline 순서, decorator 이름, Context 타입의 namespace 속성, ContextKey provides, 클러스터 전략 등 — 이 필요하다.

**이 구조 정보를 어디서 얻는가?** 두 가지 방안이 있다:

(A) **사용자 앱 빌드가 어댑터 패키지의 `.ts` 소스를 직접 파싱**. 어댑터의 `defineAdapter()` 호출 + 클래스 정의 + 데코레이터 본문을 모두 사용자 앱 빌드가 AST 분석. 이 흐름은 어댑터의 *소스 파일이 사용자 앱 머신에 존재* 해야 작동. 모노레포 워크스페이스 dev (어댑터 패키지가 `packages/http-adapter/src/*.ts` 로 노출됨) 에서는 잘 작동하지만, 어댑터를 패키지로 배포 (`bun pm pack` / `bun publish` — `package.json.files: ["dist"]` 만 포함) 한 후 사용자가 받아 설치하면 `.ts` 소스가 부재하므로 빌드 실패.

(B) **어댑터를 사전 컴파일 — `zb build adapter` 가 어댑터 패키지에서 정적 분석을 수행해 구조 정보를 JSON manifest 로 emit, 그 manifest 를 사용자 앱 빌드가 소비**. 이 방안은 어댑터의 `.ts` 소스가 사용자 앱 머신에 부재해도 동작 — `dist/*.json` + `dist/index.js` + `dist/*.d.ts` 만 있으면 됨. 어댑터를 진짜 배포 가능한 패키지로 만든다.

**어댑터 컴파일러 (`zb build adapter`) 의 존재 이유는 (B)**. (A) 는 *임시 dev 흐름이지, 진짜 배포 시나리오가 아님*. ADAPTER_COMPILER.md Section A~L 의 113 + 5 책임은 모두 (B) 흐름의 어댑터 측 컴파일러 (어댑터 → manifest 생산자) 책임이며, Section M Item 114~119 는 그 짝 contract — 사용자 앱 빌드 측의 manifest 소비자. 두 짝이 모두 작동해야 (B) 흐름이 완성되고, 그래야 어댑터를 패킹·설치 시나리오로 ship 할 수 있다.

**현재 상태 요약**. (B) 흐름의 절반 (영역 1·2) 완료 — `readAdapterManifest` + `synthesizeAdapterExtraction` + `AdapterDefinitionResolver` manifest-only wiring 작동. `.ts` 정적 분석 fallback 폐기 (E1 hard error). 잔여는 영역 3 (어댑터 내장 미들웨어 augment 흡수, augment 가지는 어댑터 작성 시점까지 지연) + 영역 4 (본 문서 폐기 + `ADAPTER_COMPILER.md` 마크 동기화).

### 0.1 운영 환경

- **저장소**: `/home/revil/projects/zipbul/zipbul`. 패키지 5 개 (`packages/{cli,common,core,http-adapter,logger}`). 작업 cwd 는 항상 루트.
- **런타임**: Bun 1.3.13. Node 사용 금지. 모든 스크립트 `bun` / `bunx`. npm/yarn/pnpm 금지.
- **TypeScript**: 5.9. typecheck 단일 출처 = `bunx tsc --noEmit`. IDE 진단과 다를 때 tsc 결과만 신뢰. IDE 가 빨간 줄이고 tsc 통과면 IDE TS server 재시작.
- **AST 분석**: `@zipbul/gildash` 단일 진입점 (`ADAPTER_COMPILER.md` Section N). 어떤 cli 파일도 `from 'oxc-parser'` import 금지 — 회귀 가드 `packages/cli/src/no-oxc-parser-import.spec.ts` 가 unit 테스트로 강제. 위반 시 단일 spec 실패로 빌드 차단.
- **git**: 사용자 명시 요청 시에만 커밋. 한국어 메시지, scope 명시 (`feat(cli)` / `refactor(cli)` / `test(cli)` / `docs(compiler)` / `docs(compiler-status)`). 마지막 라인 항상 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. amend 금지 (pre-commit hook 실패 시 새 커밋), force push 금지, `--no-verify` 금지. `.husky/` 의 commit-msg / pre-commit / pre-push 통과 필수. 작업 브랜치 `fix/cli-js-bundle-bin`, main PR 머지는 사용자 직접.
- **사용자 의사소통**: 한국어. 검증 없는 추측·보장 금지 (`feedback_no_unverified_claims` / `feedback_fact_based_only`). "확실하냐?" / "완벽하냐?" 질문 시 typecheck + 3 종 테스트 + grep 실측 결과 인용. 추측을 사실처럼 보고하면 가장 강하게 거부됨.

### 0.2 작업 시작 전 강제 체크리스트

작업 시작 시 다음을 순서대로:

1. `git status` — 워킹 디렉토리 깨끗한지.
2. `git log --oneline -1` — HEAD 가 본 문서 "Last sync" (`5143811`) 와 일치하는지. 다르면 본 문서 stale 가능, Section B 의 line 번호와 코드 인용을 grep 으로 재검증한 후 진행.
3. `bunx tsc --noEmit` — 0 에러.
4. `bun run test:unit && bun run test:integration && bun run test:e2e` — Section A.1 의 baseline 동일 확인.
5. `ADAPTER_COMPILER.md` 와 본 문서 동시 열어두기. 항목 번호 인용 시 본 문서가 ADAPTER_COMPILER.md 의 명세를 항상 우선.
6. 본 Section 0 + Section A · B · C · D · E 처음부터 끝까지. 특히 Section C (잔여 작업 4 영역) 의 우선순위·의존성·결정 사항.

---

## A. 회귀 baseline + 검증 명령

### A.1 측정된 baseline (영역 1 완료 시점)

다음 4 명령을 루트에서 실행한 직접 측정값:

| 명령 | 결과 |
|---|---|
| `bunx tsc --noEmit` | exit 0, stderr 0 라인 |
| `bun run test:unit` | `1955 pass` / 73 files / 3516 expect calls |
| `bun run test:integration` | `130 pass` / 7 files / 289 expect calls |
| `bun run test:e2e` | `370 pass` / 8 files / 1293 expect calls |
| `bun run test:smoke` | `1 pass` / 1 file / 11 expect calls |

각 영역 작업 종료 시 **세 카운트 모두 동일하거나 증가**. 카운트 감소는 회귀 또는 의도적 삭제. 후자라면 본 baseline 도 동시 갱신.

### A.2 패킹·설치 시나리오 재현 runbook (회귀 가드)

manifest-only consumption 의 자동화된 e2e 는 `packages/cli/test/integration/external-consumption.test.ts` (2 케이스). 본 통합 테스트가 (i) `buildAdapter` → manifest emit, (ii) `readAdapterManifest` 의 `.ts` 부재 상태 소비, (iii) `detectMultiAdapterConflicts` 다중 어댑터 검증 모두 cover. 본 PR 의 `adapter-definition-resolver.test.ts` (8 케이스) 는 wiring 분기 cover.

**진짜 패킹·설치 e2e (워크스페이스 외부) 가 자동화 안 된 이유**: zipbul 워크스페이스 패키지들의 `package.json` 이 `catalog:` / `workspace:*` 를 사용 — `bun pm pack` 산출물을 워크스페이스 *외부* 에 설치하면 `catalog:` 가 해상 불가 (catalog 정의가 루트 `package.json` 에만 존재). 본 issue 는 어댑터 컴파일러 로직 결함이 아니라 *publishing 단계* 의 concern (어댑터 작성자가 공개 publish 시 `bun publish --resolve-deps` 또는 동등 매커니즘으로 catalog 를 concrete 버전으로 평탄화 필요). 영역 외.

**워크스페이스 dev 에서 manifest-only 흐름 회귀 가드** (실측 가능):

```bash
ROOT=/home/revil/projects/zipbul/zipbul

# 1. 어댑터 manifest 빌드
cd "$ROOT/packages/http-adapter" && bun run build
# → {"ok":true,"adapterId":"HttpAdapter",...}

# 2. examples 빌드 — 어댑터 dist 만 사용 (사용자 앱 빌드가 어댑터 .ts 분석 안 함을 본 PR 의 wiring 이 보장)
cd "$ROOT/examples" && rm -rf .zipbul .zipbul-temp dist && bun run build
# → "Ready to deploy"

# 3. 산출물 실행
bun dist/entry.js &
APP_PID=$!
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/users
# → 200
kill $APP_PID
```

---

## B. 미완료/거부 항목 — Spec 항목 ↔ 코드 1:1 대조

본 섹션은 `ADAPTER_COMPILER.md` Section A~M 의 137 항목 중 **미완료(⬜/🟡) 또는 거부(❌) 또는 복원 대상(🔁)** 만 코드 라인 인용으로 추적한다. ✅ 완료 항목은 본 표에서 제외 — 명세 정의는 ADAPTER_COMPILER.md 본문 참조.

**표기 규약**:
- 🟡 부분 구현. 명세의 일부만 충족. 무엇이 빠졌는지 비고에 명시.
- ⬜ 미구현. 명세는 있으나 코드 0 건.
- ❌ 사용자 명시 거부로 제거. 거부 사유 비고에 명시.

### B.1 Section A — Front-end (소스 수집·파싱)

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 1 | `.ts` 소스 수집 (test/spec/fixtures 제외) | 🟡 | `adapter-build.command.ts:531 collectSourceTree` → `:555 walkSourceTree` 가 `node_modules` / `dist` / `.zipbul` 디렉토리 + `*.spec.ts` / `*.test.ts` / `*.d.ts` 제외 (`:563~573`). **`test-fixtures/` 디렉토리 명시 제외 안 함** |
| 2 | 심볼릭 링크 정규화 | 🟡 | `:74 packageRoot = resolve(...)` 로 절대화. 워크스페이스 심볼릭 링크 별도 해상 안 함 — 어댑터 패키지가 모노레포 심볼릭으로 link 된 경우 link target 으로의 정규화 미구현 |
| 3 | `tsconfig.json` 발견·로드·`extends` 체인 평탄화 | ⬜ | adapter-build 자체 평탄화 코드 0. tsc invoke (Item 87) 에 위임 — 명세상 어댑터 컴파일러가 평탄화하라는 의도였다면 미구현 |
| 5 | 모듈 의존 그래프 구성 | 🟡 | `extractRelations` 부분 활용 (`:1182 collectPeerSymbols` 가 imports/type-references relation 만 활용). 풀 모듈 그래프 (re-export 체인 추적, 의존 순서) 미구성 |
| 7 | ambient declaration / type-only import | ⬜ | 처리 코드 0 |
| 8 | UTF-8 인코딩 강제 (BOM 허용) | 🟡 | `readFile(path, 'utf8')` 명시 (`:1`, `:401`, `:577~578`). BOM 처리 명시 없음 — `parseSource` 위임 추정, 직접 검증 안 함 |

### B.2 Section B — 정적 분석 추출

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 17 | Adapter 클래스 메서드 시그니처 수집 | ⬜ | adapter 클래스 자체의 method 별도 추출 없음 — 생성자만 |
| 21 | Decorator 인자 schema | ⬜ | 데코레이터 *이름* 만 추출, 인자 schema 미추출 |
| 21b | Provider 생성자 파라미터 데코레이터 | — | E2 결정 — 어댑터 컴파일러 책임 외, 사용자 앱 빌드 책임. 영역 4 시점에 본 항목 위치 정정 |
| 23 | 미들웨어 augments + contextOps 추출 | ⬜ | `extractBuiltins` 가 augments / contextOps 미추출. cli 측 `middleware-augment-extractor.ts` 가 사용자 앱 빌드 흐름에서 같은 일을 하나 어댑터 컴파일러로 흡수 안 됨. 영역 3 흡수 대상 |
| 25 | Public export 전수 (barrel 분석) | ❌ | commit `5143811` 에서 `PeerContract.publicExports` 제거. **거부 사유**: barrel 분석 자체가 어댑터 contract 와 무관 |
| 28 | Re-export 체인 분석 | ⬜ | adapter-build 측 미처리 |

### B.3 Section C — 검증

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 29 | Adapter 가 `core/Adapter` interface 구현 (tsc 위임) | 🟡 | `runTsc` 가 `--emitDeclarationOnly` 호출하지만 별도 `--noEmit` 으로 interface 구현 강제는 안 함 |
| 30 | Context 가 `common/AdapterContext` interface 구현 (tsc 위임) | 🟡 | 동일 |
| 32 | pipeline 에 핸들러 step 정확히 1 개 | ⬜ | `validatePipeline` 에 consumer rank 카운트 없음 |
| 36 | Decorator 시그니처 호환 (MethodDecorator 등) | 🟡 | tsc 위임 |
| 48 | Manifest 출력 경로가 `files` 필드에 포함 | ⬜ | `validatePackageFields` 가 `files` 필드 검사 안 함 |

### B.4 Section D — Type 처리

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 49 | namespace property 타입 → JSON-friendly schema | 🟡 | `ContextNamespaceProperty.type: string \| null` 으로 raw 타입 텍스트 보존만. JSON schema 변환 안 함 |
| 50 | 제네릭 타입 파라미터 보존 | ⬜ | raw 타입 텍스트로 묻어가기는 함 (구조화 안 됨) |
| 51 | 메서드 overload 시그니처 모두 보존 | ⬜ | `extractContextNamespaces.methods` 가 단일 시그니처만 |
| 52 | Built-in 미들웨어 PropAugment 추출 | ⬜ | `extractBuiltins` augments 미추출 (Item 23 과 동일 영역) |
| 53 | Type-only import 추적 | ⬜ | 미처리 |
| 54 | tsconfig `paths` alias 정규화 | ⬜ | 미처리 |

### B.5 Section E — Code Generation

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 57 | `dist/index.d.ts` 생성 | 🟡 | `:252 if (await pathExists(tsconfigBuildPath)) await runTsc(...)` — `tsconfig.build.json` 존재 시에만. 부재 시 skip |
| 58 | `dist/context-augments.d.ts` declaration merging | ⬜ | 코드 0 건. **누락**. 영역 3 |
| 59 | Source map (`.js.map`) | ⬜ | `Bun.build` 호출에 `sourcemap` 옵션 없음 — 미생성 |
| 60 | JS 산출물 `__augments` / `__contextOps` IR injection | ⬜ | 코드 0 건. 영역 3 |
| 61 | 런타임 보존 (import 가능) | 🟡 | `minify: { identifiers: false }` 식별자 보존. 실제 import 성공 검증은 self-test 가 했으나 ❌제거 |
| 62 | ESM `export *` named binding 안정성 | ⬜ | 미검증 |
| 63 | `sideEffects: false` 호환성 자동 산출 | ⬜ | 미처리 |

### B.6 Section G — Atomic Emit + 무결성

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 76 | 결정성 (재실행 byte-identical) | 🟡 | `serializeJson` + `canonicalize` 가 키 정렬로 결정성 보장. byte-identical 직접 측정 코드 없음 |
| 77 | 산출물 size / hash 보고 | ❌ | commit `5143811` 에서 `result.artifacts` 제거. **거부 사유**: CI 게이트 등 외부 운영 영역, 어댑터 컴파일러 본 책임 외 |

### B.7 Section H — Diagnostics

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 81 | tsc 에러 → contract 위반 vs 일반 타입 에러 분류 | ⬜ | tsc 에러는 IO 카테고리로 통합 — 분류 안 함 |
| 83 | 진단 출력 형식 통일 (`file:line ERROR/WARN [CATEGORY] message`) | 🟡 | `taggedReason = [${category}] ${reason} at ${file}:${line}:${col}` 형식. WARN/ERROR 통일은 미확인 |
| 84 | WARN vs ERROR 분리 | ⬜ | adapter-build 는 모두 ERROR. WARN 경로 없음 |
| 85 | `--format=json` | ❌ | commit `5143811` 에서 옵션 제거, JSON 출력 고정. **거부 사유**: 옵션 분기 불필요 (항상 JSON) |
| 86 | ANSI 컬러 + `--no-color` | ❌ | 옵션 제거. **거부 사유**: 출력은 항상 JSON 단일 라인 — 컬러 무관 |

### B.8 Section I — Build Pipeline Integration

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 87 | tsc invoke (`--noEmit` / `--emitDeclarationOnly`) | 🟡 | `:257 runTsc` 가 `--emitDeclarationOnly` 호출 (tsconfig.build.json 의 옵션 의존). `--noEmit` 별도 호출 없음 — typecheck 강제는 emit 부산물에 의존 |
| 89 | tsc stdout/stderr 캡처 + 진단 변환 | 🟡 | spawn 으로 캡처하나 raw 출력을 단일 IO 메시지로 묶음 — 진단 라인별 변환 안 함 |

### B.9 Section J — CLI Contract

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 96 | `--out-dir` 옵션 | ❌ | commit `5143811` 에서 제거, `dist/` 고정. **거부 사유**: 어댑터 산출 위치는 contract — 옵션 분기 불필요 |
| 97 | verbose / quiet 분리 | 🟡 | `--verbose, -v` 만. `--quiet` 제거. **거부 사유**: JSON 단일 라인 출력 모드에서 quiet 의미 없음 |
| 98 | exit code (0 / 1 / 2 분리) | 🟡 | success → 0, DiagnosticError → 1. 환경 오류 (2) 분리 안 됨 |
| 100 | `--dry-run` | ❌ | 제거. **거부 사유**: 산출물 검증만의 특수 모드 — 사용자 명시 거부 |
| 101 | `--check-only` | ❌ | 제거. **거부 사유**: CI 게이트는 별도 운영 영역 — 어댑터 컴파일러 책임 외 |

### B.10 Section K — Watch / Incremental (Item 102~108)

전부 ❌ — commit `5143811` 에서 `watch.ts` + `watch.test.ts` 삭제. **거부 사유**: 어댑터 컴파일러는 1 회 실행 컴파일러. watch 는 사용자 앱 빌드 (`zb dev`) 의 영역. 어댑터는 변경 빈도 낮고 watch 가 어댑터 컴파일러 본 책임 외.

### B.11 Section L — Self-test (Item 109~113)

전부 ❌ — `runSelfTest` 함수 + 호출부 + `--with-self-test` 옵션 제거. **거부 사유**: 자기 검증 모드는 사용자 기능과 컴파일러 개발자 검증을 혼합. 검증은 정식 통합 테스트로 분리되며 (`adapter-build.test.ts` 26 건이 그 역할), 별도 실행 모드 불필요.

### B.12 Section M — CLI Consumer Protocol (Item 114~119)

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 117 | manifest 비결정 변경 캐시 무효화 | ❌ | `contentHash` 제거로 감지 수단 없음. **거부 사유**: 사용자 명시 거부 |
| 118 | manifest hash 임베딩 (사용자 빌드 결정성) | ❌ | 동일 |

---

## C. 문제 진단 — 무엇이 부족하고 무엇이 잘못되었는가

본 섹션은 Section B 의 raw 분류 위에 *왜 그게 문제이고 어디에 영향이 있는지* 를 묶음별로 풀어 쓴다. 새 에이전트가 잔여 작업의 우선순위를 이해하기 위한 진단 단계.

### C.1 augment / 미들웨어 연결 — 영역 3 영역

- 어댑터 (예: `@zipbul/http-adapter`) 안에 `defineMiddleware<TInput>(handler)` 를 사용하는 내장 미들웨어가 있으면, 그 미들웨어는 `__augments` IR (Item 60) 또는 `dist/context-augments.d.ts` (Item 58) 의 declaration merging 형태로 사용자 앱의 Context 타입에 augment 를 더해야 한다. 이게 빠지면 사용자 코드에서 `ctx.body` 같은 augmented 속성이 타입 체크 안 됨.
- 현재 `extractBuiltins` (`:1099`) 는 호출 메타 (exportName / sourceFile / kind / adapters) 만 추출하고 augments / contextOps 미추출 (Item 23). 따라서 `dist/builtins.json` 에 augment 정보 부재.
- 사용자 앱 빌드 측 `middleware-augment-collector.ts` (cli, 761 줄) 는 사용자 코드의 augment 만 처리하고 어댑터 내장 augment 는 어댑터 소스 파싱에 의존. 패킹·설치 시나리오에서는 작동 불가.

영역 3 가 이 갭을 채운다 — `extractBuiltins` 를 augments 추출까지 확장 + `dist/context-augments.d.ts` emit + `__augments` IR injection.

http-adapter 의 현 시점 augment 사용 여부는 영역 3 진입 전 확인 필요 (`grep -rn "defineMiddleware<" packages/http-adapter/src` 로). 만약 augment 0 건이면 영역 2 만으로 examples 동작 — 이 경우 영역 3 는 나중 어댑터 (augment 가지는 어댑터) 작성 시점으로 지연 가능.

### C.2 명세 미완 항목 — 어댑터 컴파일러 본 책임이지만 부분 충족

Section B 표에서 ⬜ / 🟡 표기된 항목 중 영역 1·2·3 에 흡수되지 않는 것들. 우선순위는 영역 4 또는 별도 후속.

- Item 1 — `test-fixtures/` 디렉토리 명시 제외 룰 보강 (`walkSourceTree:563~573`).
- Item 2 — 워크스페이스 심볼릭 링크의 link target 정규화. 현재 `resolve()` 는 절대화만, 심볼릭 자체를 따라가지 않음. 어댑터가 모노레포 심볼릭으로 link 된 경우 link target 으로 정규화하는 방향 — 영향: 어댑터 패키지 root 식별의 일관성.
- Item 3 — tsconfig `extends` 평탄화. **결정**: tsc 위임 유지, 별도 평탄화 신설 안 함. 근거: tsc 가 `extends` 체인을 자체 처리 (composite/references 포함, Item 92 이미 `tsconfigNeedsBuildMode` 로 분기). 어댑터 컴파일러가 자체 평탄화하면 tsc 와 결과 일치 보장이 추가 부담 — 단일 출처 원칙 위반.
- Item 5 — 풀 모듈 의존 그래프. 현재 부분만 (peer symbols 만 활용). 영향: 어댑터 패키지 내부의 import cycle / unused export 감지 불가.
- Item 7 — ambient declaration / type-only import. 어댑터의 `*.d.ts` 만의 type 의존 추적 안 됨.
- Item 8 — UTF-8 BOM 처리 명시 검증.
- Item 17 — Adapter 클래스 메서드 시그니처 수집 — 현재 생성자만. 어댑터가 노출하는 인스턴스 메서드 (예: `start`, `stop`) 의 시그니처는 manifest 에 안 담김.
- Item 21 — Decorator 인자 schema. 현재 이름만 추출, 인자 (예: `@Get('/path')` 의 path) 는 사용자 코드 분석 시 사용자 앱 빌드가 처리.
- Item 28 — Re-export 체인. 어댑터의 barrel `index.ts` 가 다른 모듈의 `defineAdapter` 를 re-export 하는 경우 미처리.
- Item 32 — pipeline 핸들러 step 정확히 1 개 카운트.
- Item 36 — Decorator 시그니처 호환성 — tsc 위임, 별도 검증 없음.
- Item 48 — manifest 출력 경로의 `package.json.files` 포함 검증. 어댑터가 `files: ["dist"]` 누락 시 알림 없음.
- Item 49·50·51 — namespace property 타입의 JSON schema 변환 / 제네릭 / overload — raw 텍스트 보존만.
- Item 53·54 — type-only import / tsconfig paths alias.
- Item 59 — Source map. `Bun.build({ sourcemap: 'external' })` 추가로 해결 — 단순.
- Item 62·63 — `export *` named binding 안정성 / `sideEffects` 자동 산출.
- Item 81·83·84 — 진단 분류 / 형식 통일 / WARN-ERROR 분리.
- Item 87·89 — tsc invoke 의 `--noEmit` 별도 호출 / 진단 라인별 변환.
- Item 98 — exit code 2 (환경 오류) 분리.

### C.3 정리할 deadweight — 코드에 남아있으나 책임 외이거나 미연결

본 항목은 사용자 질문 "불필요해서 정리해야 되는 것" 에 직접 답하는 영역.

- **`extractBuiltins` 가 builtins 호출 메타만 추출하고 augment 미연결** (Item 23). 함수 시그니처 `BuiltinEntry { exportName, sourceFile, kind, adapters }` 가 augment 의도를 시사하나 실제로는 호출 사실만 기록. 영역 3 에서 augments 필드 추가하지 않을 거라면 함수 의도 명확히 — JSDoc 정정 또는 책임 축소 명시.
- **`packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` (cli, 사용자 앱 빌드 측)** 가 어댑터 컴파일러로 흡수 안 됨. 영역 3 가 이걸 어댑터 컴파일러로 흡수하면 사용자 앱 빌드 측은 manifest 소비로 단순화 — 흡수 결정 후 사용자 앱 빌드 측 코드 일부 폐기 가능.
- **`extractContextNamespaces` 의 raw 타입 텍스트 보존** (Item 49). manifest 소비자가 raw 타입 텍스트를 그대로 받으면 제네릭 / overload / paths alias 해상이 어렵다. JSON-friendly schema 변환은 영역 외이지만, 현재 보존 방식이 미완 contract 임을 명시.
- **`pickEntrySourceFile`** (`:605`) 의 entry 후보 우선순위 (`module` 필드 → `src/index.ts` fallback) — 명세 (Item 45) 의 `module` 필드 정합성과 맞물림. 검증 자체는 `validatePackageFields` 에 있으나 entry pick 과의 일관성은 별도 검증 없음.

---

## D. 잔여 작업 — 우선순위 + 의존성 (4 영역)

각 영역은 (a) 상황 — 왜 필요한가, (b) 방향 — 어떻게 진행할지 + 무엇을 만들지 + 무엇을 만들지 *않을지*, (c) 근거 — 어떤 측정·코드 인용에 기반, (d) 맥락 — 미묘한 제약·결정 지점 으로 풀어 쓴다.

### D.1 [영역 3, 우선순위 중, augment 가지는 어댑터 작성 시점에 비로소 필요] augment 흡수

**상황**. Section C.2 의 augment 갭. 어댑터의 내장 미들웨어가 `defineMiddleware<TInput>` 을 사용해 Context 타입을 augment 하는 경우 manifest 가 그 augment 정보를 담지 않아 사용자 앱 빌드가 augment 를 적용 못 함. 현재 http-adapter 가 augment 를 가지는지 미확인 — 영역 3 진입 전 `grep -rn "defineMiddleware<" packages/http-adapter/src` 로 측정. 만약 0 건이면 영역 3 는 다른 어댑터 (augment 가지는 미들웨어 포함) 작성 시점으로 지연 가능.

**방향**. 3 단계 (augment 가지는 어댑터가 존재할 때만 진입).

(1) **`extractBuiltins` 를 augment 추출까지 확장**. cli 측에 이미 존재하는 `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` 의 `extractMiddlewareAugments(call, parsed)` 흡수. 어댑터 컴파일러의 `extractBuiltins` 가 각 `defineMiddleware` 호출에 대해 이 추출을 수행하고 결과를 `BuiltinEntry.augments?: PropAugment[]` 필드로 직렬화. `interfaces.ts BuiltinsManifest` 의 `BuiltinEntry` 인터페이스 확장.

(2) **`dist/context-augments.d.ts` emit 추가** (Item 58). 추출된 모든 augments 를 머지하여 `declare module '<adapter-package>' { interface <ContextType> { <augmentedProp>: <BaseType> & <Augment>; ... } }` 템플릿으로 .d.ts 생성. `runCodegen` 의 .d.ts emit 분기 (현재 tsc 만, `:252`) 와 같은 위치에서 추가.

(3) **`__augments` IR injection** (Item 60). JS 산출물의 `defineMiddleware()` 호출 자리에 augments IR 주입. 패턴 참조: `packages/cli/src/bin/build/lib-augment-injector.ts` 의 미들웨어 라이브러리 처리. 어댑터 컴파일러가 Bun.build 를 사용하는 점이 다름 — 사전 변환 (Bun.build 입력 .ts 를 변형 후 빌드) 또는 사후 변환 (산출 .js 를 후처리) 결정 필요. 권장: 사전 변환 (lib-augment-injector 와 같은 패턴).

(4) **검증 어댑터 작성**. http-adapter 가 augment 0 건이면 영역 3 의 e2e 검증을 위한 *별도 fixture 어댑터* 필요 — `packages/cli/test/fixtures/augment-adapter/` 같은 위치에 augment 가지는 미들웨어 포함한 미니 어댑터 작성 후 그것으로 e2e.

**근거**.
- `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` 의 `stringifyTSType` — 검증 시점에 라인 재확인. cli 측 자체 stringifier 존재.
- `packages/cli/src/bin/build/lib-augment-injector.ts` — 미들웨어 라이브러리 컴파일에서 동일 패턴.
- `ADAPTER_COMPILER.md` Item 23·52·58·60 모두 ⬜ 또는 🔵 — 영역 3 가 일괄 진척.

**맥락**.
- 영역 2 e2e 통과가 영역 3 의 진입 조건. 영역 2 만으로 examples 가 동작해야 함 (http-adapter 가 augment 0 건이면 영역 2 만으로 충분).
- 영역 3 흡수 후 cli 사용자 앱 빌드 측의 `middleware-augment-collector.ts` (761 줄) 가 어댑터 augment 처리 부분에서 manifest 소비로 단순화 가능 — 코드 일부 폐기. 별도 cleanup.

### D.2 [영역 4, 우선순위 낮, 영역 3 선행] 본 문서 폐기

**상황**. 영역 3 완료되면 잔여 작업 0 — 본 문서의 존재 이유 소멸.

**방향**. 영역 3 종료 시점에 본 문서 폐기 (`git rm`). `ADAPTER_COMPILER.md` 단일 출처 복귀. baseline 카운트는 별도 단일 출처로 이관.

**맥락**. 코드 변경 0 — 영역 3 끝나기 전에 진행하면 다시 stale. 후순위 강제.

---

## E. 확정된 결정 + 근거

본 섹션은 잔여 영역 (3) 진행에 필요한 설계 결정. 영역 1·2 작업 시 적용된 결정 (E1·E4·E5·E6) 은 코드에 반영되어 본 섹션에서 제거됨.

### E1 — Item 21b (Provider param decorator) 책임 소재: **사용자 앱 빌드 책임 (어댑터 컴파일러 외)**

**상황**. `@Inject(Token)` 같은 Provider 클래스 생성자 파라미터 데코레이터를 누가 추출할지.

**결정**. **어댑터 컴파일러 책임 외**. 사용자 앱 빌드의 분석 체인 (`packages/cli/src/compiler/analyzer/parser/inject-call-analyzer.ts` 등) 이 사용자 코드를 스캔할 때 처리. 어댑터 패키지 안에 자체 provider 가 있는 경우는 어댑터가 그 provider 를 export 만 하고, 사용자 앱이 그 export 를 import 해서 자기 모듈에 등록 — 사용자 앱 빌드의 분석 범위 안에 들어옴.

**근거**. zipbul 의 의존성 주입 (DI) 모델에서 provider 는 *사용자 앱 module 의 등록 대상* — 어댑터 패키지가 자체 provider 를 노출해도 *사용자 앱이 import 해서 module 에 추가* 하는 시점에 사용자 앱 빌드의 분석 흐름으로 들어온다. 어댑터 컴파일러는 어댑터 자체 contract (Adapter 클래스, Context 클래스, pipeline, decorator 함수, 내장 미들웨어) 만 manifest 화. provider 는 어댑터 contract 의 일부가 아님.

**적용**. `extractBuiltins` 와 별개의 provider 추출 함수 신설하지 않음. Item 21b 는 ⬜ 로 표기되어 있으나 책임 소재가 어댑터 컴파일러 외이므로 본 문서 Section B.2 의 ⬜ 표기는 명세 자체의 분류 오류 — 영역 4 시점에 `ADAPTER_COMPILER.md` 의 Item 21b 위치를 "어댑터 컴파일러 책임 외" 표시 또는 명세에서 제거.

### E2 — augment IR injection 시점 (Item 60): **사전 변환 (Bun.build 입력 .ts 변형)**

**상황**. 어댑터 내장 미들웨어의 `__augments` IR 을 JS 산출물에 어떻게 주입할지.

**결정**. **사전 변환**. `Bun.build` 호출 *전* 에 `.ts` 소스를 메모리 또는 임시 디렉토리에 변형 (defineMiddleware 호출 자리에 augments IR 인자 주입), 변형된 `.ts` 를 Bun.build 의 entrypoint 로 전달.

**근거**. `packages/cli/src/bin/build/lib-build.ts` + `packages/cli/src/compiler/analyzer/parser/lib-augment-injector.ts` 가 미들웨어 라이브러리 패키지에서 정확히 같은 일을 같은 패턴으로 수행. 사후 변환 (산출 .js 후처리) 은 Bun.build 의 minify·tree-shaking 결과를 다시 손대야 해서 산출물 안정성 위험 + Bun.build plugin API 가 cli 의 다른 곳에서 미사용 — 패턴 일관성 손상.

**적용**. 영역 3 진입 시 `lib-build.ts` 의 패턴 참조해서 어댑터 컴파일러용 사전 변환 모듈 신설. `runCodegen` 의 Bun.build 호출 직전에 변형된 .ts 들을 임시 디렉토리에 쓰고 그 디렉토리를 entrypoint root 로 사용.

### E3 — http-adapter augment 여부 (영역 3 진입 조건): **0 건, 영역 3 지연**

**상황**. http-adapter 의 내장 미들웨어가 `defineMiddleware<TInput>` 같은 제네릭 (= augment) 을 사용하는지.

**결정·측정**. `grep -rn "defineMiddleware<" packages/http-adapter/src` 결과 **0 매치**. http-adapter 는 augment 가지는 미들웨어 없음.

**적용**. **영역 3 는 augment 가지는 어댑터가 작성되는 시점까지 지연**. 영역 3 의 인수 어댑터가 부재하므로 지금 진입해도 검증 fixture 를 별도로 만들어야 하고 — 그 fixture 가 미래 실제 augment 어댑터의 형태와 어긋날 위험. 후속 어댑터 개발 시점에 영역 3 진입.

---

## F. 잔여 영역 인수 기준

| 영역 | 인수 기준 | 검증 명령 |
|---|---|---|
| 3 | augment 가지는 fixture 어댑터의 e2e 통과 (사용자 앱 build 가 어댑터 augment 적용된 Context 타입 받음) | 별도 e2e (fixture 어댑터 별 작성) |
| 4 | `ADAPTER_COMPILER.md` 마크와 코드 실상 1:1 일치 / baseline 갱신 | `grep -oE "^[0-9]+[a-z]?\\. [✅🟡⬜🔵❌]"` 결과가 본 문서 Section B 와 1:1 |

각 영역 종료 시 Section A.1 의 baseline 카운트 갱신.

---

## G. 본 문서 갱신 + 폐기 규칙

- 각 영역 종료 시 Section D 의 해당 영역에 ✅ + commit hash 추가.
- baseline 카운트 변동 시 Section A.1 즉시 갱신.
- 영역 3 종료 시 본 문서 폐기 (`git rm`). `ADAPTER_COMPILER.md` 단일 출처 복귀.
- 본 문서 변경 commit scope: `docs(compiler-status): ...`. 마지막 라인 `Co-Authored-By: ...`.

---

## H. 합계

본 문서는 어댑터 컴파일러의 manifest-only consumption 갭 (Section 0.0 의 (B) 흐름) 을 메우는 작업을 추적했다. 영역 1 (manifest read API 복원), 영역 2 (`AdapterDefinitionResolver` wiring + `.ts` fallback 폐기) 는 commit 분리 후 완료 — 본 문서에서 제거됨. 잔여는 영역 3 (augment 흡수, augment 가지는 어댑터 작성 시점까지 지연) + 영역 4 (본 문서 폐기 + 명세 동기화).
