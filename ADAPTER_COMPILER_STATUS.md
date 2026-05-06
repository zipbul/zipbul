# Adapter Compiler — 현재 상태 + 잔여 작업 인수인계

> 본 문서는 `ADAPTER_COMPILER.md` (책임 명세, Section A~N · 137 항목) 위에 얹는 **현재 진척과 잔여 작업** 단일 출처 인수인계 문서다. 책임 정의·항목 번호·아키텍처 의도는 그 문서가 진실의 근원. 본 문서는 (a) 어댑터 컴파일러가 현재 무엇을 하고 있는가 → (b) `ADAPTER_COMPILER.md` 가 명세한 137 항목 중 어디까지 구현되었는가 → (c) 사용자 명시 거부로 제거된 것은 무엇인가 → (d) 무엇이 남아있고 잘못되어 있는가 → (e) 완벽 동작까지 어떤 작업이 어떤 순서로 필요한가 를 측정·코드 라인 인용·git 명령으로 풀어 쓴다.
>
> **단일 출처 원칙**. 항목 번호와 명세는 `ADAPTER_COMPILER.md`. 본 문서는 그 항목 번호를 인용하고 진척만 갱신. 영역 1·2·3 (Section D) 가 완료되면 본 문서는 폐기되고 `ADAPTER_COMPILER.md` 가 단일 출처로 복귀한다 (영역 4 가 그 이전 작업).
>
> **Last sync**: 2026-04-29, HEAD `5143811` (refactor — 잉여 기능 제거 + 범위 축소). Branch `fix/cli-js-bundle-bin`.
>
> **Baseline 측정값 (HEAD `5143811` 시점, 본 문서 작성 시 직접 측정)**: typecheck clean / unit `1967 pass` / integration `120 pass` / e2e `370 pass`.

---

## 0. 본 문서를 읽는 새 에이전트에게 — 운영 컨텍스트

### 0.0 어댑터 컴파일러가 왜 존재하는가 — 본 작업의 큰 그림

zipbul 의 어댑터는 HTTP / WebSocket / Cron 같은 프로토콜별 진입점을 추상화한 패키지다. 어댑터는 (1) Adapter 클래스, (2) Context 클래스, (3) phase·step enum, (4) `defineAdapter()` 호출에 담긴 pipeline 선언, (5) controller / handler / option 데코레이터 함수, (6) 내장 미들웨어·가드·예외필터 (`defineMiddleware/Guard/ExceptionFilter`) 등을 패키지 안에 모아 둔다. 사용자 앱은 이 어댑터를 import 해서 자신의 controller 클래스에 어댑터의 데코레이터를 붙이고, `createApplication({ adapter: HttpAdapter, ... })` 으로 런타임 진입.

zipbul 은 AOT (Ahead-of-Time) 컴파일러를 가진다 — 사용자 앱 빌드 (`zb build`) 가 사용자 코드를 정적 분석해서 (a) controller 클래스 + handler 메서드 발견, (b) 미들웨어 / 가드 / 예외필터 등록, (c) Context augment 의 declaration merging, (d) 런타임 pipeline 생성 등을 빌드 시점에 해결한다. 이 정적 분석을 위해 빌드는 *어댑터의 구조 정보* — 어댑터 클래스 식별자, pipeline 순서, decorator 이름, Context 타입의 namespace 속성, ContextKey provides, 클러스터 전략 등 — 이 필요하다.

**이 구조 정보를 어디서 얻는가?** 두 가지 방안이 있다:

(A) **사용자 앱 빌드가 어댑터 패키지의 `.ts` 소스를 직접 파싱**. 어댑터의 `defineAdapter()` 호출 + 클래스 정의 + 데코레이터 본문을 모두 사용자 앱 빌드가 AST 분석. 이 흐름은 어댑터의 *소스 파일이 사용자 앱 머신에 존재* 해야 작동. 모노레포 워크스페이스 dev (어댑터 패키지가 `packages/http-adapter/src/*.ts` 로 노출됨) 에서는 잘 작동하지만, 어댑터를 패키지로 배포 (`bun pm pack` / `bun publish` — `package.json.files: ["dist"]` 만 포함) 한 후 사용자가 받아 설치하면 `.ts` 소스가 부재하므로 빌드 실패.

(B) **어댑터를 사전 컴파일 — `zb build adapter` 가 어댑터 패키지에서 정적 분석을 수행해 구조 정보를 JSON manifest 로 emit, 그 manifest 를 사용자 앱 빌드가 소비**. 이 방안은 어댑터의 `.ts` 소스가 사용자 앱 머신에 부재해도 동작 — `dist/*.json` + `dist/index.js` + `dist/*.d.ts` 만 있으면 됨. 어댑터를 진짜 배포 가능한 패키지로 만든다.

**어댑터 컴파일러 (`zb build adapter`) 의 존재 이유는 (B)**. (A) 는 *임시 dev 흐름이지, 진짜 배포 시나리오가 아님*. ADAPTER_COMPILER.md Section A~L 의 113 + 5 책임은 모두 (B) 흐름의 어댑터 측 컴파일러 (어댑터 → manifest 생산자) 책임이며, Section M Item 114~119 는 그 짝 contract — 사용자 앱 빌드 측의 manifest 소비자. 두 짝이 모두 작동해야 (B) 흐름이 완성되고, 그래야 어댑터를 패킹·설치 시나리오로 ship 할 수 있다.

**현재 상태 요약 (commit `5143811`)**. 어댑터 컴파일러 본체 (Section A~L 의 manifest 생산자) 는 부분 구현되어 작동 — `cd packages/http-adapter && zb build adapter` 가 7개 manifest + JS + d.ts 를 `dist/` 에 emit. 그러나 사용자 앱 빌드 측 manifest 소비 진입점 (Section M) 은 read API (`manifest-reader.ts`) 가 commit `5143811` 에서 잘못 일괄 삭제되었고 사용자 앱 빌드 (`zb build` 의 `AdapterDefinitionResolver`) wiring 도 미완. 결과: 패킹·설치 빌드 실패 (`bun pm pack` → 압축해제 설치 → `zb build` → "No adapter definition found", Section A.3 e2e 재현 가능). 어댑터 컴파일러의 존재 이유 (B) 의 절반만 작동.

본 문서의 잔여 작업 4 영역은 이 절반을 채우는 작업이다 — 영역 1 (read API 복원) → 영역 2 (사용자 앱 빌드 wiring) → 영역 3 (augment 흡수) → 영역 4 (`ADAPTER_COMPILER.md` 동기화 + 본 문서 폐기).

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
4. `bun run test:unit && bun run test:integration && bun run test:e2e` — Section A.1 의 baseline (1967 / 120 / 370) 동일 확인.
5. `ADAPTER_COMPILER.md` 와 본 문서 동시 열어두기. 항목 번호 인용 시 본 문서가 ADAPTER_COMPILER.md 의 명세를 항상 우선.
6. 본 Section 0 + Section A · B · C · D · E 처음부터 끝까지. 특히 Section C (잔여 작업 4 영역) 의 우선순위·의존성·결정 사항.

---

## A. 회귀 baseline + 검증 명령

### A.1 측정된 baseline (HEAD `5143811`)

다음 4 명령을 루트에서 실행한 직접 측정값:

| 명령 | 결과 |
|---|---|
| `bunx tsc --noEmit` | exit 0, stderr 0 라인 |
| `bun run test:unit` | `1967 pass` / 73 files / 3529 expect calls |
| `bun run test:integration` | `120 pass` / 5 files / 263 expect calls |
| `bun run test:e2e` | `370 pass` / 8 files / 1293 expect calls |

각 영역 작업 종료 시 **세 카운트 모두 동일하거나 증가**. 카운트 감소는 회귀 또는 의도적 삭제. 후자라면 본 baseline 도 동시 갱신.

### A.2 영역별 예상 baseline 변동

영역 1 종료 시점:
- integration `120 + 5 (manifest-reader 테스트) + 2 (external-consumption 테스트) = 127` 예상.

영역 2 종료 시점:
- integration `127 + N (사용자 앱 빌드 통합 e2e — 최소 2 건: workspace dev 회귀 + 패킹·설치 e2e)` 예상.
- e2e `370 + M (examples 시나리오 회귀 + 패킹·설치 회귀)` 가능.

영역 3 종료 시점:
- integration · e2e 추가 (augment 케이스 별).

본 baseline 은 영역 종료 시마다 본 문서 Section A.1 갱신.

### A.3 패킹·설치 시나리오 재현 명령 — 영역 2 의 인수 기준

본 시나리오는 commit `5143811` 시점에서 실패한다. 영역 2 가 끝나면 통과해야 한다.

```bash
# 1. 어댑터 컴파일
cd /home/revil/projects/zipbul/zipbul/packages/http-adapter
bun /home/revil/projects/zipbul/zipbul/packages/cli/src/bin/zb.ts build adapter
# → {"ok":true,"adapterId":"HttpAdapter","manifestPath":".../dist/adapter.manifest.json"} (성공)

# 2. 어댑터 패키징
bun pm pack
# → zipbul-http-adapter-1.1.0.tgz 생성

# 3. examples 의 어댑터 심볼릭 링크를 패킹된 tarball 압축해제로 교체
cd /home/revil/projects/zipbul/zipbul/examples/node_modules/@zipbul
rm http-adapter
mkdir http-adapter
tar -xzf /home/revil/projects/zipbul/zipbul/packages/http-adapter/zipbul-http-adapter-*.tgz \
  -C http-adapter --strip-components=1
ls http-adapter/dist
# → adapter.manifest.json + 6개 child manifest + index.js + index.d.ts + src/*.d.ts (★ .ts 소스 부재)

# 4. examples 빌드
cd /home/revil/projects/zipbul/zipbul/examples
rm -rf .zipbul .zipbul-temp dist
bun /home/revil/projects/zipbul/zipbul/packages/cli/src/bin/zb.ts build
# 현재 (`5143811`): "No adapter definition found" → exit 1 (실패)
# 영역 2 완료 후: "Ready to deploy" (성공)

# 5. 빌드 산출물 실행
bun dist/entry.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/users
# 영역 2 완료 후: 200

# 6. (정리) 워크스페이스 심볼릭 복원
cd /home/revil/projects/zipbul/zipbul/examples/node_modules/@zipbul
rm -rf http-adapter
ln -s ../../../packages/http-adapter http-adapter
rm -f /home/revil/projects/zipbul/zipbul/packages/http-adapter/zipbul-http-adapter-*.tgz
```

본 시나리오의 통과 여부가 영역 2 의 단일 인수 기준이다.

---

## B. 미완료/거부 항목 — Spec 항목 ↔ 코드 1:1 대조

본 섹션은 `ADAPTER_COMPILER.md` Section A~M 의 137 항목 중 **미완료(⬜/🟡) 또는 거부(❌) 또는 복원 대상(🔁)** 만 코드 라인 인용으로 추적한다. ✅ 완료 항목은 본 표에서 제외 — 명세 정의는 ADAPTER_COMPILER.md 본문 참조.

**표기 규약**:
- 🟡 부분 구현. 명세의 일부만 충족. 무엇이 빠졌는지 비고에 명시.
- ⬜ 미구현. 명세는 있으나 코드 0 건.
- ❌ 사용자 명시 거부로 제거. commit `5143811` 변경. 거부 사유 비고에 명시.
- 🔁 인프라 잘못 삭제, 영역 1 에서 복원 대상.

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
| 21b | Provider 생성자 파라미터 데코레이터 | — | E3 결정 — 어댑터 컴파일러 책임 외, 사용자 앱 빌드 책임. 영역 4 시점에 본 항목 위치 정정 |
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

**전체 영역의 현재 상태**: 사용자 앱 빌드 측 manifest 소비 진입점. read API (`manifest-reader.ts` 251 줄 + `detectMultiAdapterConflicts` + 통합 테스트 7 건) 는 commit `5143811` 에서 잘못 일괄 삭제. 또한 read API 가 존재하던 시점에도 사용자 앱 빌드 (`AdapterDefinitionResolver.resolve()`, `definition-resolver.ts:53`) wiring 부재 — read API 만 단위 검증되어 있었고 빌드 흐름 통합은 미완. 영역 1 (read API 복원) → 영역 2 (wiring) 두 단계로 매듭.

| Item | 명세 요약 | 상태 | 근거 |
|---|---|---|---|
| 114 | 사용자 앱 빌드 시 `node_modules/<adapter>/dist/adapter.manifest.json` 우선 로드 | 🔁 | read API 삭제 + wiring 미연 |
| 115 | manifest 부재 시 fallback 정책 | 🔁 | E1 결정 = hard error. 영역 2 wiring 시 적용 |
| 116 | `producedBy` ↔ cli 버전 호환성 검사 | 🔁 | `manifest-reader.ts` 에 코드 있었음 (`8b88dff` 의 `userAppCliVersion` 옵션) — 같이 삭제 |
| 117 | manifest 비결정 변경 캐시 무효화 | ❌ | `contentHash` 제거로 감지 수단 없음. **거부 사유**: 사용자 명시 거부 |
| 118 | manifest hash 임베딩 (사용자 빌드 결정성) | ❌ | 동일 |
| 119 | 다중 어댑터 manifest 병합 + 충돌 검출 | 🔁 | `detectMultiAdapterConflicts` 가 `manifest-reader.ts` 와 같이 삭제 |

---

## C. 문제 진단 — 무엇이 부족하고 무엇이 잘못되었는가

본 섹션은 Section B 의 raw 분류 위에 *왜 그게 문제이고 어디에 영향이 있는지* 를 묶음별로 풀어 쓴다. 새 에이전트가 잔여 작업의 우선순위를 이해하기 위한 진단 단계.

### C.1 가장 큰 문제 — 어댑터 컴파일러의 존재 이유 절반이 작동 안 함

Section 0.0 의 (B) 흐름 — 어댑터를 진짜 배포 가능한 패키지로 만들어 사용자가 패킹·설치 후 빌드 가능하게 — 이 commit `5143811` 시점에 작동하지 않는다. Section A.3 의 재현 명령으로 즉시 검증 가능.

원인 두 갈래:

(원인-1) **사용자 앱 빌드의 `AdapterDefinitionResolver.resolve()` 가 manifest 를 안 읽음**. `definition-resolver.ts:55~59` 가 `collectPackageEntryFiles(fileMap)` 으로 어댑터 패키지의 *소스 파일* 을 모은 후 `resolveAdapterDefinitionExport(entryFile, fileMap, new Set(), this.parser)` 으로 그 소스를 파싱해서 `defineAdapter()` 호출의 AST 표현 (`ZIPBUL_CALL` IR) 을 추출한다. 어댑터의 `.ts` 소스가 부재하면 `fileMap` 에 entry 가 없거나 분석이 빈 결과 — `:106 if (adapterExtractions.length === 0) return err({ reason: 'No adapter definition found...' })`. 패킹된 어댑터는 `dist/index.d.ts` + `dist/index.js` + 7 개 manifest 만 가지므로 이 경로로는 영원히 빌드 안 됨.

(원인-2) **manifest 소비 진입점 부재**. 한때 `manifest-reader.ts` 에 `readAdapterManifest(adapterPackageDist)` 함수 (commit `8b88dff` `:65~166`) 가 있어서 `node_modules/<adapter>/dist/` 의 7 개 JSON 을 읽고 `ReadAdapterManifestResult` 로 join 했으나, 그 결과를 *어떻게 `AdapterExtraction` 으로 변환하는지* 의 합성기는 작성되지 않음. 즉 read API 만 있고 사용자 앱 빌드 흐름과의 매핑은 미완. 게다가 read API 자체도 `5143811` 에서 잘못 삭제됨.

따라서 영역 1 (read API 복원) → 영역 2 (합성기 신설 + AdapterDefinitionResolver wiring) 두 단계가 (B) 흐름 완성의 직접 경로.

### C.2 augment / 미들웨어 연결 — 영역 2 만으로 부족한 케이스

영역 2 가 끝나도 *어댑터의 내장 미들웨어가 augment 를 가지는 경우* 그 augment 가 사용자 앱에 전달되지 않는다. 구체:

- 어댑터 (예: `@zipbul/http-adapter`) 안에 `defineMiddleware<TInput>(handler)` 를 사용하는 내장 미들웨어가 있으면, 그 미들웨어는 `__augments` IR (Item 60) 또는 `dist/context-augments.d.ts` (Item 58) 의 declaration merging 형태로 사용자 앱의 Context 타입에 augment 를 더해야 한다. 이게 빠지면 사용자 코드에서 `ctx.body` 같은 augmented 속성이 타입 체크 안 됨.
- 현재 `extractBuiltins` (`:1099`) 는 호출 메타 (exportName / sourceFile / kind / adapters) 만 추출하고 augments / contextOps 미추출 (Item 23). 따라서 `dist/builtins.json` 에 augment 정보 부재.
- 사용자 앱 빌드 측 `middleware-augment-collector.ts` (cli, 761 줄) 는 사용자 코드의 augment 만 처리하고 어댑터 내장 augment 는 어댑터 소스 파싱에 의존. 패킹·설치 시나리오에서는 작동 불가.

영역 3 가 이 갭을 채운다 — `extractBuiltins` 를 augments 추출까지 확장 + `dist/context-augments.d.ts` emit + `__augments` IR injection.

http-adapter 의 현 시점 augment 사용 여부는 영역 3 진입 전 확인 필요 (`grep -rn "defineMiddleware<" packages/http-adapter/src` 로). 만약 augment 0 건이면 영역 2 만으로 examples 동작 — 이 경우 영역 3 는 나중 어댑터 (augment 가지는 어댑터) 작성 시점으로 지연 가능.

### C.3 명세 미완 항목 — 어댑터 컴파일러 본 책임이지만 부분 충족

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

### C.4 정리할 deadweight — 코드에 남아있으나 책임 외이거나 미연결

본 항목은 사용자 질문 "불필요해서 정리해야 되는 것" 에 직접 답하는 영역.

- **`extractBuiltins` 가 builtins 호출 메타만 추출하고 augment 미연결** (Item 23). 함수 시그니처 `BuiltinEntry { exportName, sourceFile, kind, adapters }` 가 augment 의도를 시사하나 실제로는 호출 사실만 기록. 영역 3 에서 augments 필드 추가하지 않을 거라면 함수 의도 명확히 — JSDoc 정정 또는 책임 축소 명시.
- **`packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` (cli, 사용자 앱 빌드 측)** 가 어댑터 컴파일러로 흡수 안 됨. 영역 3 가 이걸 어댑터 컴파일러로 흡수하면 사용자 앱 빌드 측은 manifest 소비로 단순화 — 흡수 결정 후 사용자 앱 빌드 측 코드 일부 폐기 가능.
- **`extractContextNamespaces` 의 raw 타입 텍스트 보존** (Item 49). manifest 소비자가 raw 타입 텍스트를 그대로 받으면 제네릭 / overload / paths alias 해상이 어렵다. JSON-friendly schema 변환은 영역 외이지만, 현재 보존 방식이 미완 contract 임을 명시.
- **`pickEntrySourceFile`** (`:605`) 의 entry 후보 우선순위 (`module` 필드 → `src/index.ts` fallback) — 명세 (Item 45) 의 `module` 필드 정합성과 맞물림. 검증 자체는 `validatePackageFields` 에 있으나 entry pick 과의 일관성은 별도 검증 없음.

---

## D. 잔여 작업 — 우선순위 + 의존성 (4 영역)

각 영역은 (a) 상황 — 왜 필요한가, (b) 방향 — 어떻게 진행할지 + 무엇을 만들지 + 무엇을 만들지 *않을지*, (c) 근거 — 어떤 측정·코드 인용에 기반, (d) 맥락 — 미묘한 제약·결정 지점 으로 풀어 쓴다.

### D.1 [영역 1, 우선순위 최고, 선행 의존성 없음] manifest-reader 인프라 복원

**상황**. commit `5143811` 이 `packages/cli/src/compiler/adapter-build/manifest-reader.ts` (251 줄, `522b59a` 시점), `packages/cli/test/integration/manifest-reader.test.ts` (5 건), `packages/cli/test/integration/external-consumption.test.ts` (2 건) 를 일괄 삭제. 사용자 명시 거부 13 건 중 manifest-reader 관련 7 건은 사용자 명시 거부 *대상이 아님* — 제 잉여 판단으로 같이 삭제됨. 이 read API 는 어댑터 컴파일러의 짝 contract — 사용자 앱 빌드 측 manifest 소비 진입점. 영역 2 의 wiring 작업이 이 read API 위에 얹힌다.

**방향**. 3 단계.

(1) **`manifest-reader.ts` 복원**. `git show 522b59a:packages/cli/src/compiler/adapter-build/manifest-reader.ts > packages/cli/src/compiler/adapter-build/manifest-reader.ts` 로 원본 그대로 복원. 251 줄. 단 — 복원된 파일이 `BuildAdapterResult.artifacts` 필드를 참조하지 않는지 확인 (해당 필드는 `5143811` 에서 제거됨, 합리적으로 manifest-reader 는 read-only 라 BuildAdapterResult 참조 없을 가능성 높음 — 직접 확인 필수). 참조한다면 그 라인은 정정.

(2) **`packages/cli/src/compiler/adapter-build/index.ts` re-export 추가**. 현재 `index.ts` 는 `buildAdapter` + `BuildAdapterOptions` / `BuildAdapterResult` 만 export. 복원 후 `readAdapterManifest`, `detectMultiAdapterConflicts`, `ReadAdapterManifestResult`, `ReadAdapterManifestOptions`, `AdapterConflict` (상기 2 개와 그 타입들) re-export 추가.

(3) **테스트 파일 2 건 복원**. `git show 1d21bad:packages/cli/test/integration/external-consumption.test.ts > packages/cli/test/integration/external-consumption.test.ts` (158 줄, 2 건). `git show 8b88dff:packages/cli/test/integration/manifest-reader.test.ts > packages/cli/test/integration/manifest-reader.test.ts` (5 건). 단 — 두 테스트 파일이 `BuildAdapterResult.artifacts` 또는 `AdapterManifest.contentHash` 를 참조하면 그 expect 라인 제거 (해당 필드들은 사용자 명시 거부로 제거되었으므로 복원 대상 아님).

(4) **검증**. `bun test test/integration/manifest-reader.test.ts test/integration/external-consumption.test.ts` 가 모두 pass. `bunx tsc --noEmit` 0 에러. baseline integration `120 → 127` 증가 확인.

(5) **커밋**. `restore(cli/adapter-build): manifest-reader + 통합 테스트 복원 — 잘못된 일괄 삭제 정정`. 본문에 (a) 5143811 에서 잘못 삭제된 정황, (b) 영역 2 의 선행 인프라임을 명시.

**근거**. 측정으로 검증된 사실:
- `git show --stat 8b88dff` — `manifest-reader.ts` 168 줄 신규 + `manifest-reader.test.ts` 5 건 신규.
- `git show --stat 522b59a` — `manifest-reader.ts` 168 → 251 줄 (detectMultiAdapterConflicts 추가) + 테스트 5 → 8 건.
- `git show --stat 1d21bad` — `external-consumption.test.ts` 158 줄 신규.
- `git show 5143811 -- packages/cli/src/compiler/adapter-build/manifest-reader.ts` — 본 커밋이 251 줄 삭제 확인.

**맥락**.
- 본 영역은 *복원만* 하는 작업으로 합성기 / wiring 은 영역 2. 단일 책임 분리하는 이유: 복원 그 자체의 회귀 검증이 wiring 작업과 섞이지 않게 — git history 가 깔끔하고 회귀 발생 시 어느 작업이 원인인지 격리 가능.
- 복원 후 영역 2 진입 전까지 `readAdapterManifest` 는 *호출자가 없는 상태* 가 일시적으로 유지된다. 이는 영역 2 가 짝으로 따라온다는 전제 — 영역 2 미진입 시 dead code 로 남으므로 영역 1 종료 시점에 즉시 영역 2 시작.

### D.2 [영역 2, 우선순위 최고, 영역 1 선행] AdapterDefinitionResolver 의 manifest 우선 분기 wiring

**상황**. Section C.1 의 (원인-1) 과 (원인-2) 의 매듭 풀기. 영역 1 에서 read API 가 복원된 후, 사용자 앱 빌드 (`AdapterDefinitionResolver.resolve()`) 가 어댑터 패키지에서 manifest 를 우선 검사하고 있으면 그것을 소비하도록 분기 신설. 이 분기가 (B) 흐름의 핵심.

**방향**. 4 단계.

(1) **manifest → AdapterExtraction 합성기 신설**. 신규 파일 `packages/cli/src/compiler/adapter-build/manifest-to-adapter-extraction.ts` 권장. 입력: `ReadAdapterManifestResult`. 출력: `AdapterExtraction` (`packages/cli/src/compiler/analyzer/interfaces.ts:153 export interface AdapterExtraction { adapterId: string; staticSchema: AdapterStaticSchema; }`).

매핑 detail (구체):
- `result.adapter.adapterId` → `AdapterExtraction.adapterId`.
- `result.pipeline.pipeline: PipelineRef[]` → `AdapterStaticSchema.pipeline: readonly string[]` — `PipelineRef.qualifier + '.' + PipelineRef.name` 으로 합쳐서 string 화 (예: `'HttpPhase.OnRequest'`).
- `result.pipeline.phaseEnum` + `pipeline.stepEnum` → `AdapterStaticSchema.validPhases: Set<string>` (현재 `phase` 만 검증) — `phaseEnum` 의 멤버명 set. 이건 `manifest-reader` 가 `pipeline-schema.json` 만 읽으면 enum 멤버명을 모르므로 *추가 정보 필요* — 매니페스트에 phase/step enum 멤버 자체가 없다. 현재 매니페스트 spec (Item 14·15) 이 멤버명·값을 추출은 하지만 `pipeline-schema.json` 의 emit shape 가 enum 식별자만 담고 멤버는 안 담음. 영역 2 진행 중 매니페스트 shape 확장 필요.
- `result.decorators` → `AdapterStaticSchema.entryDecorators: AdapterEntryDecoratorsSchema` — `controller` (string) + `handlers: string[]` + `options?: string[]` 그대로 매핑.
- `result.contextNamespaces.contextType` + `namespaces` → `AdapterStaticSchema.contextNamespaces: ContextNamespaceMap`. `ContextNamespaceMap` shape (`interfaces.ts` 의 `contextType` + `module` (어댑터 패키지 specifier) + `namespaces: Record<string, string>`) 의 `module` 필드는 `result.packageName` 에서 도출 (E7 결정 — `readAdapterManifest` 가 package.json 을 같이 로드해 `ReadAdapterManifestResult.packageName` 노출). 합성기 시그니처: `synthesizeAdapterExtraction(result: ReadAdapterManifestResult): AdapterExtraction` — 단일 인자.

(2) **`AdapterDefinitionResolver.resolve()` 분기 신설**. `definition-resolver.ts:55~104` 의 entry-loop 안에서, 각 `entryFile` 에 대해 그 파일이 속한 패키지 root 를 찾고 그 root 의 `dist/adapter.manifest.json` 존재 여부 검사. 존재 시 `readAdapterManifest(packageRoot/dist)` → 합성기 호출 → `AdapterExtraction` 직접 push. 부재 시 기존 흐름 (`resolveAdapterDefinitionExport` → `extractFromConfigObject`) fallback.

패키지 root 식별: `entryFile` 의 디렉토리에서 위로 거슬러 올라가며 `package.json` 발견 시 그 디렉토리. 헬퍼 함수 신설 권장 (`findPackageRoot(entryFile: string): Promise<string | null>`).

(3) **fallback 정책 적용 (E1 결정 = hard error)**. manifest 부재 시 즉시 DiagnosticError throw — `[CONTRACT] Adapter package <name> at <path> has no compiled manifest. Run \`zb build adapter\` in the adapter package first.` `.ts` 파싱 fallback 경로는 진입부에서 차단. 워크스페이스 dev 흐름은 사용자가 어댑터 패키지에서 `zb build adapter` 한 번 실행 후 진행 — 어댑터의 `package.json.scripts` 에 build chain 추가 권장 (예: `"dev": "zb build adapter && cd ../../examples && zb dev"`).

(4) **검증**. Section A.3 의 6 단계 명령으로 패킹·설치 e2e 통과. 워크스페이스 dev 시나리오 회귀 (`cd examples && rm -rf .zipbul .zipbul-temp dist && zb build && bun dist/entry.js && curl ...`) 도 통과. 통합 테스트 신규 추가 — `packages/cli/test/integration/adapter-manifest-consumption.test.ts` (가칭) — 합성기 단위 + AdapterDefinitionResolver wiring 단위 검증.

(5) **커밋**. `feat(cli): AdapterDefinitionResolver 의 manifest 우선 분기 + 합성기`. 본문에 (a) Section M Item 114·115·116·119 충족, (b) 패킹·설치 e2e 인수 기준 통과, (c) baseline 갱신 명시.

**근거**. 측정으로 검증된 사실:
- `definition-resolver.ts:55~59` — 어댑터 패키지의 `.ts` 소스 파싱 흐름 진입점.
- `definition-resolver.ts:106~110` — manifest 부재 + `.ts` 파싱 실패 시 "No adapter definition found" 에러.
- `interfaces.ts:153~156` — `AdapterExtraction` 의 명확한 shape.
- `interfaces.ts AdapterStaticSchema` — `entryDecorators` (필수) + `validPhases` / `pipeline` / `contextNamespaces` (선택).
- `manifest-reader.ts (8b88dff)` 의 `ReadAdapterManifestResult` — manifest 7 개 join 결과.
- 본 문서 Section A.3 의 패킹·설치 e2e 가 `definition-resolver.ts:108` 의 "No adapter definition found" 로 실패 — 직접 측정 확인.

**맥락**.
- **합성기의 정확성이 통합의 성패**. 합성기가 만드는 `AdapterStaticSchema` 가 downstream 의 `buildAdapterStaticSchemaSet` (`handler-index-builder.ts`) / `validateMiddlewarePhaseInputs` (`phase-id-validator.ts`) / `buildHandlerIndex` (`handler-index-builder.ts`) 가 기대하는 shape 와 정확히 일치해야 함. 단계별 검증 — 각 downstream 호출의 입력 shape 를 합성기 구현 *전에* 코드 인용으로 확정.
- **enum 멤버명 매니페스트 누락 갭**. (1)(b) 항목의 `validPhases`. 현재 `pipeline-schema.json` 이 phase/step enum 식별자만 담고 멤버명을 안 담음. 영역 2 진행 중 매니페스트 shape 확장 — `pipeline-schema.json` 에 `phaseMembers: string[]` + `stepMembers: string[]` 추가 (또는 별도 JSON). 이 shape 변경은 backward-compat 영향 — 기존 emit 코드 (`adapter-build.command.ts:139`) 에서 `extractAdapterDefinition` 의 `pipelineSchema` 객체 확장 + `interfaces.ts PipelineSchema` 인터페이스 확장. 이 변경 자체가 영역 2 에 포함.
- **어댑터 패키지 root 식별의 미묘한 케이스**. 사용자 앱 자체가 어댑터인 경우 (`zipbul.kind: "adapter"` 가 사용자 앱 패키지에 선언), 사용자 앱 entry 가 어댑터 entry 와 같은 위치 → manifest 부재 fallback 의 무한 재귀 위험. `AdapterDefinitionResolver` 호출 시점에 사용자 앱 자체가 빌드 대상이므로 이 케이스는 사용자 앱 빌드 흐름에서 진입 안 함 — 단 검증 필요.
- **합성기 unit 테스트의 핵심 케이스**: (i) 정상 manifest tree → 정상 AdapterExtraction, (ii) `controller` 단수 / `handlers` 1+ 카디널리티 매핑, (iii) `pipeline` qualifier+name 합성, (iv) Optional manifest (예: `peer-contract` 부재) → null 처리, (v) `contextNamespaces` 의 `module` 이 `package.json.name` 에서 도출.

### D.3 [영역 3, 우선순위 중, 영역 2 선행, augment 가지는 어댑터 작성 시점에 비로소 필요] augment 흡수

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

### D.4 [영역 4, 우선순위 낮, 영역 1·2·3 선행] 본 문서 폐기

**상황**. 영역 1·2·3 모두 완료되면 잔여 작업 0 — 본 문서의 존재 이유 소멸.

**방향**. 영역 1·2·3·4 모두 완료 시점에 본 문서 폐기 (`git rm`). `ADAPTER_COMPILER.md` 단일 출처 복귀. baseline 카운트는 ADAPTER_COMPILER.md Header 또는 별도 단일 출처로 이관.

**맥락**. 코드 변경 0 — 영역 1·2·3 가 끝나기 전에 진행하면 다시 stale. 후순위 강제.

---

## E. 확정된 결정 + 근거

본 섹션은 영역 2·3 진행에 필요한 7 건의 설계 결정. 모두 코드 인용 또는 측정으로 확정 — 사용자 결정 대기 사안 없음. 새 에이전트는 본 결정을 그대로 적용한다. 결정을 뒤집는 변경은 사용자에게 명시 보고 후 진행.

### E1 — Item 115 fallback 정책: **(b) hard error**

**상황**. manifest 가 어댑터 패키지에 없을 때 사용자 앱 빌드가 어떻게 동작할지.

**결정**. **manifest 부재 = hard error**. 단 친절한 에러 메시지 — `[CONTRACT] Adapter package <name> at <path> has no compiled manifest. Run \`zb build adapter\` in the adapter package first.`

**근거**. 어댑터 컴파일러의 존재 이유 자체가 Section 0.0 의 (B) 흐름 — `.ts` 소스 비공개 + 컴파일된 contract 만 노출. fallback `.ts` 파싱을 허용하면 (A) 흐름이 silent 하게 유지되어 패킹·설치 시나리오에서 어댑터를 컴파일 안 한 채 빌드가 작동하는 듯 보이다가 *어댑터를 정식 배포* 한 시점에야 깨지는 false positive 발생. 모노레포 워크스페이스 dev 에서도 어댑터 패키지에서 한 번 `zb build adapter` 를 돌리는 건 큰 부담 아님 — `package.json.scripts.dev` 에 `bun run build:adapter && zb dev` 형태로 chain 가능.

**적용**. 영역 2 의 D.2 (3) 의 fallback 경로 자체를 폐기. `AdapterDefinitionResolver` 의 manifest 분기에서 manifest 부재 시 즉시 DiagnosticError throw, `.ts` 파싱 경로로 떨어지지 않음.

### E2 — Stale manifest 검출: **`producedBy` 메이저 mismatch 시 hard error**

**상황**. 사용자 앱이 cli 버전 X 로 빌드, 어댑터는 cli 버전 Y 로 컴파일. manifest 의 `producedBy` 와 사용자 cli 버전이 다를 때.

**결정**. **메이저 버전 mismatch 시 hard error**. 마이너·패치 mismatch 는 통과. (commit `8b88dff` 의 `manifest-reader.ts` 가 이미 이 정책 — `userAppCliVersion` 옵션 + 메이저만 비교, 영역 1 복원으로 정책 그대로 회복.)

**근거**. Item 116 의 명세. 메이저 버전이 cli 의 contract breaking 변경을 의미 — `ReadAdapterManifestResult` shape 변경 등. 마이너·패치는 hash·서식·제약 추가만 허용 — backward compat. `package.json.version` 의 semver 의미 그대로 활용.

**적용**. `manifest-reader.ts` 의 기존 검증 로직 보존. `AdapterDefinitionResolver` 의 manifest 분기에서 `userAppCliVersion: PRODUCER_VERSION` 전달.

### E3 — Item 21b (Provider param decorator) 책임 소재: **사용자 앱 빌드 책임 (어댑터 컴파일러 외)**

**상황**. `@Inject(Token)` 같은 Provider 클래스 생성자 파라미터 데코레이터를 누가 추출할지.

**결정**. **어댑터 컴파일러 책임 외**. 사용자 앱 빌드의 분석 체인 (`packages/cli/src/compiler/analyzer/parser/inject-call-analyzer.ts` 등) 이 사용자 코드를 스캔할 때 처리. 어댑터 패키지 안에 자체 provider 가 있는 경우는 어댑터가 그 provider 를 export 만 하고, 사용자 앱이 그 export 를 import 해서 자기 모듈에 등록 — 사용자 앱 빌드의 분석 범위 안에 들어옴.

**근거**. zipbul 의 의존성 주입 (DI) 모델에서 provider 는 *사용자 앱 module 의 등록 대상* — 어댑터 패키지가 자체 provider 를 노출해도 *사용자 앱이 import 해서 module 에 추가* 하는 시점에 사용자 앱 빌드의 분석 흐름으로 들어온다. 어댑터 컴파일러는 어댑터 자체 contract (Adapter 클래스, Context 클래스, pipeline, decorator 함수, 내장 미들웨어) 만 manifest 화. provider 는 어댑터 contract 의 일부가 아님.

**적용**. `extractBuiltins` 와 별개의 provider 추출 함수 신설하지 않음. Item 21b 는 ⬜ 로 표기되어 있으나 책임 소재가 어댑터 컴파일러 외이므로 본 문서 Section B.2 의 ⬜ 표기는 명세 자체의 분류 오류 — 영역 4 시점에 `ADAPTER_COMPILER.md` 의 Item 21b 위치를 "어댑터 컴파일러 책임 외" 표시 또는 명세에서 제거.

### E4 — augment IR injection 시점 (Item 60): **사전 변환 (Bun.build 입력 .ts 변형)**

**상황**. 어댑터 내장 미들웨어의 `__augments` IR 을 JS 산출물에 어떻게 주입할지.

**결정**. **사전 변환**. `Bun.build` 호출 *전* 에 `.ts` 소스를 메모리 또는 임시 디렉토리에 변형 (defineMiddleware 호출 자리에 augments IR 인자 주입), 변형된 `.ts` 를 Bun.build 의 entrypoint 로 전달.

**근거**. `packages/cli/src/bin/build/lib-build.ts` + `packages/cli/src/compiler/analyzer/parser/lib-augment-injector.ts` 가 미들웨어 라이브러리 패키지에서 정확히 같은 일을 같은 패턴으로 수행. 사후 변환 (산출 .js 후처리) 은 Bun.build 의 minify·tree-shaking 결과를 다시 손대야 해서 산출물 안정성 위험 + Bun.build plugin API 가 cli 의 다른 곳에서 미사용 — 패턴 일관성 손상.

**적용**. 영역 3 진입 시 `lib-build.ts` 의 패턴 참조해서 어댑터 컴파일러용 사전 변환 모듈 신설 (`packages/cli/src/compiler/adapter-build/lib-augment-injector.ts` 또는 기존 모듈을 어댑터 컴파일러로도 호출). `runCodegen` 의 Bun.build 호출 직전에 변형된 .ts 들을 임시 디렉토리에 쓰고 그 디렉토리를 entrypoint root 로 사용.

### E5 — `pipeline-schema.json` 에 phase/step enum 멤버 추가: **추가**

**상황**. 영역 2 의 합성기가 `AdapterStaticSchema.validPhases: Set<string>` 을 채우려면 phase enum 멤버명을 알아야 함. 현재 `pipeline-schema.json` 은 enum *식별자만* 담고 멤버는 안 담음.

**결정**. **`PipelineSchema` 인터페이스에 `phaseMembers: readonly string[]` + `stepMembers: readonly string[]` 추가**. emit 코드 (`adapter-build.command.ts` 의 `extractAdapterDefinition` → `pipelineSchema` 객체 생성 부분) 도 같이 확장.

**근거**. 어댑터 컴파일러는 `extractAdapterDefinition` 안에서 이미 `resolveEnumMembers(tree, phaseEnum)` 으로 phase 멤버 set 을 계산하지만 manifest 에 emit 안 함. 단순 추가만 하면 영역 2 합성기가 매니페스트만 읽고도 `validPhases` 채울 수 있음. 대안 (manifest 외부에서 어댑터 .d.ts 파싱) 은 사용자 앱 빌드가 다시 .d.ts AST 분석을 해야 해서 (B) 흐름의 의도 위반.

**적용**. 영역 2 의 D.2 첫 단계 — 매니페스트 shape 확장 + emit 코드 변경. backward-compat: 기존 manifest 에 두 필드가 없으면 `manifest-reader` 는 빈 배열로 처리 (영역 1 복원 시점에 기본값 설정).

### E6 — http-adapter augment 여부 (영역 3 진입 조건): **0 건, 영역 3 지연**

**상황**. http-adapter 의 내장 미들웨어가 `defineMiddleware<TInput>` 같은 제네릭 (= augment) 을 사용하는지.

**결정·측정**. `grep -rn "defineMiddleware<" packages/http-adapter/src` 결과 **0 매치**. http-adapter 는 augment 가지는 미들웨어 없음.

**근거**. 직접 측정.

**적용**. **영역 3 는 augment 가지는 어댑터가 작성되는 시점까지 지연**. examples 의 패킹·설치 e2e (Section A.3) 는 영역 1·2 만으로 통과 가능. 영역 3 의 인수 어댑터가 부재하므로 지금 진입해도 검증 fixture 를 별도로 만들어야 하고 — 그 fixture 가 미래 실제 augment 어댑터의 형태와 어긋날 위험. 후속 어댑터 개발 시점에 영역 3 진입.

### E7 — 합성기로의 `packageName` 전달: **`readAdapterManifest` 가 package.json 같이 로드 (read API 책임 확장)**

**상황**. 합성기가 `ContextNamespaceMap.module` 필드 (= 어댑터 패키지 specifier) 를 채우려면 어댑터 `package.json.name` 이 필요. 그 값이 어디서 흘러오는지.

**결정**. **`readAdapterManifest(adapterPackageDist)` 가 `dist/` 부모 디렉토리의 `package.json` 을 같이 로드해서 `ReadAdapterManifestResult.packageName: string` 필드로 노출**. 합성기 시그니처는 `synthesizeAdapterExtraction(result: ReadAdapterManifestResult): AdapterExtraction` — 단일 인자, 호출자는 별도 로드 불필요.

**근거**. 옵션 (i) (합성기 시그니처에 `packageName` 추가) 은 호출자 (`AdapterDefinitionResolver`) 가 어댑터 패키지 root 를 식별해서 별도 로드 — 두 곳에서 path resolution. 옵션 (ii) 는 read API 가 어댑터 패키지의 *모든 컴파일 후 정체성* 을 한 곳에서 노출 — 합성기는 데이터 변환만, 호출자는 read API 만 호출. 책임 분리 명확. read API 의 입력 (`adapterPackageDist`) 자체가 dist 디렉토리이므로 그 부모의 `package.json` 위치는 결정적 — 책임 확장의 cost 0.

**적용**. 영역 1 의 `manifest-reader.ts` 복원 시 원본에 `packageName` 로드 단계 추가. `ReadAdapterManifestResult` 인터페이스 확장. 영역 1 의 5건 테스트 중 정상 emit 테스트에 `result.packageName` assertion 추가 (총 6건 또는 기존 1건에 expect 추가).

---

## F. 영역별 인수 기준 — 측정 가능한 종료 조건

| 영역 | 인수 기준 | 검증 명령 |
|---|---|---|
| 1 | manifest-reader 5 건 + external-consumption 2 건 통과 / typecheck 0 에러 / integration baseline `120 → 127` | `bun test test/integration/manifest-reader.test.ts test/integration/external-consumption.test.ts && bunx tsc --noEmit` |
| 2 | Section A.3 의 6 단계 (패킹·설치 e2e) 통과 + 워크스페이스 dev 회귀 통과 + 신규 통합 테스트 (합성기 + wiring) 통과 | Section A.3 절차 + `bun test test/integration/adapter-manifest-consumption.test.ts` |
| 3 | augment 가지는 fixture 어댑터의 e2e 통과 (사용자 앱 build 가 어댑터 augment 적용된 Context 타입 받음) | 별도 e2e (fixture 어댑터 별 작성) |
| 4 | `ADAPTER_COMPILER.md` 마크와 코드 실상 1:1 일치 / Last sync = HEAD / baseline 갱신 | `awk '/^## A\./,0' ADAPTER_COMPILER.md \| grep -oE "^[0-9]+[a-z]?\\. [✅🟡⬜🔵❌]"` 가 본 문서 Section B 와 1:1 |

각 영역 종료 시 본 문서 Section A.1 의 baseline 카운트 갱신.

---

## G. 본 문서 갱신 + 폐기 규칙

- 각 영역 (1·2·3·4) 종료 시점에 Section D 의 해당 영역에 ✅ + commit hash 추가.
- baseline 카운트 변동 시 Section A.1 즉시 갱신.
- 결정 사안 (Section E) 의 사용자 확정 시 권장/대안 결과 즉시 본 문서에 반영.
- 영역 1·2·3·4 모두 완료 시 본 문서 폐기 (`git rm`). `ADAPTER_COMPILER.md` 단일 출처 복귀.
- 본 문서 변경 commit scope: `docs(compiler-status): ...`. 마지막 라인 `Co-Authored-By: ...`.

---

## H. 합계

본 문서는 commit `5143811` 시점에서 어댑터 컴파일러 (Section 0.0 의 (B) 흐름) 가 절반만 작동하는 상태를 진단하고, 그 절반의 갭을 메우기 위한 4 영역의 작업을 우선순위 + 의존성 + 측정 가능한 인수 기준으로 풀어 쓴다. 영역 1 (read API 복원) 과 영역 2 (사용자 앱 빌드 wiring) 는 패킹·설치 시나리오 동작의 직접 경로이며, 영역 3 (augment 흡수) 는 augment 가지는 어댑터 작성 시점에 비로소 필요한 후속, 영역 4 는 영역 1·2·3 종료 후 단일 출처 (`ADAPTER_COMPILER.md`) 복귀를 위한 문서 정정.

근거는 모두 commit `5143811` 시점 코드 직접 인용 (`adapter-build.command.ts` line 번호 검증 완료, `definition-resolver.ts` / `interfaces.ts` 의 `AdapterExtraction` shape 인용) 또는 직접 측정 (Section A.3 의 패킹·설치 e2e 실패 재현 + Section A.1 의 1967 / 120 / 370 baseline + Section E6 의 augment 0건 grep + 사용자 앱 빌드의 `dist/runtime.js.map` 544KB sourcemap emit 측정 + reflection 0건 + switch 기반 step dispatch + 20 route 인라인 측정 — AOT 인라인 동작 검증). 새 항목 도입은 zipbul 본체 코드 라인 인용 후 추가.
