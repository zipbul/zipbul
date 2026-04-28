# Adapter Compiler — 책임 명세 + 실행 인수인계

> 어댑터 패키지 (`zb build adapter`) 가 컴파일러로서 수행해야 할 모든 일.
> 근거: zipbul 본체 (`packages/core`, `packages/common`, `packages/cli`) 가 어댑터에게 요구하는 contract.
> 외부 프레임워크 비교 0. 개발 단계 무관 항목 (마이그레이션·스키마 버전·생태계 거버넌스) 제외.

**Last sync**: 2026-04-28 (commit `298384f` — 길대시 메인테이너 회신 2 라운드 결과 반영. Item 131·132 결정 종료, Item 54c·71b 필수 채택 확정. `git log --oneline -1` 로 현재 HEAD 재확인)
**Branch**: `fix/cli-js-bundle-bin` (main 대비 19 ahead 시점, 새 에이전트는 `git rev-list --count origin/main..HEAD` 로 재확인)
**Baseline**: unit `1964 pass` / integration `94 pass` / e2e `370 pass` / typecheck clean.

상태 표기 — 본 문서 전체에서 일관된 의미:
- ✅ 완료. 실제로 코드/문서가 머지되었고, 회귀 baseline 통과 확인됨. 옆에 적힌 commit hash 가 머지 지점.
- 🟡 진행 중. 부분 완료 또는 결정 대기. 진행 시 Section 0 의 해당 서브섹션 (특히 0.4 의 Step 3b 컨텍스트) 을 반드시 먼저 읽어라.
- ⬜ 미착수. 의존하는 선행 Step 이 끝나야 진입 가능한 경우가 있다 — 의존성은 0.1 에서 명시.
- 🔵 검증·자동화 필요. 코드는 cli 안에 있으나 어댑터 컴파일러 본체로 흡수되지 않았거나 회귀 가드가 없는 상태. Step 7 또는 Step 10 에서 흡수.

---

## 0. 현재 상태 스냅샷 — 다음 에이전트 인수인계

### 0.0 본 문서를 읽는 새 에이전트에게 — 운영 컨텍스트

본 문서는 사용자가 conversation context 를 클리어하기 직전에 작성된 인수인계 패키지다. 새 에이전트는 이전 대화를 모르는 상태에서 본 파일과 git history (`git log --oneline -30`) 만으로 작업을 이어가야 한다. 따라서 본 섹션은 *작업 자체* 보다 먼저 알아야 할 *운영 환경* 을 다룬다.

**저장소 구조**: zipbul 모노레포. 루트는 `/home/revil/projects/zipbul/zipbul`. 작업 디렉토리는 항상 루트로 둔다. 패키지는 `packages/{cli,common,core,http-adapter,logger}` 5개 (검증: `ls packages/`); `@zipbul/result` 는 외부 의존 (workspace 패키지 아님). catalog 기반 dependency 공유 (Bun 1.3 catalog). 본 문서는 루트에 위치한 `ADAPTER_COMPILER.md` 다 — 다른 위치로 옮기지 마라.

**런타임·도구**: Bun (현재 설치 1.3.13). Node 사용 금지 — 본 프로젝트의 모든 스크립트·테스트가 `bun` / `bunx` 로 돌아간다. TypeScript 5.9. typecheck 는 `bunx tsc --noEmit` (루트 디렉토리에서). 테스트는 `bun run test:unit` / `bun run test:integration` / `bun run test:e2e` (루트의 `package.json.scripts` 참조). 패키지 매니저 명령도 `bun add`, `bun install`. npm/yarn/pnpm 사용 금지.

**git 작업 규칙**: 사용자가 명시 요청할 때만 커밋. 커밋 메시지는 한국어, scope 명시 (`feat(cli): ...`, `refactor(cli): ...`, `test(cli): ...`, `docs(compiler): ...`). 마지막 라인은 항상 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (개행 + 빈 줄 + Co-Authored-By). 메시지는 HEREDOC 으로 전달 (Bash 도구 시스템 가이드 참조). 커밋 amend 금지 — 새 커밋으로. `--no-verify` 금지 — Husky pre-commit hook 이 `commit-msg` / `pre-commit` / `pre-push` 3종 등록되어 있다 (검증: `ls .husky/`), 통과시켜야 한다. force push 금지. main 직접 push 금지. 본 작업 브랜치는 `fix/cli-js-bundle-bin` 이며 main 으로 PR 머지는 사용자가 직접 한다.

**테스트 카운트 운영 규칙**: 본 문서 곳곳에 "1964 / 94 / 370" baseline 이 박혀있다. 각 Step 작업 후 **세 카운트 모두 동일하거나 증가** 해야 한다. 줄어들면 — 의도적으로 테스트를 삭제했거나 리네임이 안 따라간 것. 의도였다면 본 문서의 baseline 을 즉시 업데이트해라. 의도가 아니라면 회귀이므로 중단하고 원인 추적.

**IDE 진단 vs tsc**: VSCode/JetBrains 의 TypeScript language server 가 표시하는 진단과 `bunx tsc --noEmit` 결과가 어긋날 수 있다. 충돌 시 `bunx tsc --noEmit` 을 단일 진실 원천으로 사용하고, IDE 가 빨간 줄을 그어도 tsc 가 clean 이면 IDE TypeScript server 재시작.

**사용자 의사소통**: 사용자는 한국어로 응답을 원한다 (메모리 `feedback_*` 참조). 검증 없이 추측을 사실처럼 보고하지 마라 — 코드 인용으로 뒷받침하지 못하면 "확인 필요" 로 표시. 사용자가 "완벽하냐?" 라고 물으면 자체 검증 (typecheck + 3종 테스트 + grep) 을 실제로 돌린 결과를 인용해서 답해라 — 거짓 보장은 가장 강하게 금지된 행동이다 (`feedback_fact_based_only`).

**작업 진입 시 반드시 확인할 것**:
- `git status` — 미커밋 변경사항 확인. 작업 시작 전 워킹 디렉토리가 깨끗한지 확인.
- `git log --oneline -10` — 최근 커밋과 본 문서의 "Last sync" 비교. 차이가 있으면 본 문서가 stale 일 수 있으니 인벤토리 (Section 0.3, 0.5) 를 grep 으로 재검증.
- `bunx tsc --noEmit` 한 번 — 진입 baseline 이 본 문서의 baseline 과 동일한지 검증.

### 0.1 12 Step 실행 로드맵 — 진척도 + 의존성

본 문서의 Section A~N 에 적힌 137 책임은 다음 12 Step 으로 *순차 실행* 한다. Step 1~9 는 Section N 의 정책 ("AST 분석은 gildash 단일 진입점, oxc-parser 직접 import 0") 을 코드베이스 전반에 점진 적용하는 단계이며, Step 10~12 는 Section A~M 에 명세된 어댑터 컴파일러 (`zb build adapter`) 본체와 그 짝 contract (사용자 앱 빌드 측 manifest 소비) 의 본격 구현이다.

각 Step 의 의존성을 산문으로 풀면 다음과 같다. **Step 1 (어댑터 신설)** 은 다른 모든 Step 의 토대가 되는 `ExpressionValue → IR` 변환 어댑터를 만든 단계로, 이미 완료되었고 commit `002ce9e` 에서 신설, `23f32a2` 에서 소비자 wiring, `0c74e04` 에서 14개 엣지 케이스 + 파라미터 정보 전파, gildash 0.26 마이그레이션은 `6b92958` (`332315f` 도 동일 시리즈) 에서 처리되었다. **Step 2 (`import-export-extractor` → `extractRelations`)** 는 import binding 단위 분리를 gildash API 로 이관한 작업으로, `43fc643` (본체 이관), `5421dbc` (전용 spec 26케이스 추가), `934e02d` (side-effect import `import './x'` 회귀 복구 — `extractRelations` 가 빈 import 는 emit 안 하므로 `ast-parser.ts` 에 명시 walk 추가) 의 3 커밋으로 완성. **Step 3a (`getMethodAstMeta` 제거)** 는 `8a43f4f` 의 0.25 keyKind 마이그레이션 이후 dead code 가 된 함수를 `ae254d8` 에서 제거.

**Step 3b (현재 진행 중)** 는 `ast-node-locator.ts` 와 그 spec 에서 oxc-parser 의 직접 import 를 0 으로 만드는 작업이다. Section 0.4 가 이 Step 의 모든 컨텍스트를 담는 메인 진입점이다. **Step 3b 가 완료되어야 Step 5·6·7·8 이 진입 가능하다** — 이 4개 Step 의 대상 파일들이 `ast-node-locator` 의 `walkChildren`/`getCallExpressionName` 등 헬퍼를 소비하기 때문이며, 헬퍼 시그니처가 oxc 의 narrow 타입에서 gildash 의 `Node` union 으로 변경되는 것이 모든 소비자에게 전파된다.

**Step 4 (`expression-converter.ts` 의 잔존 oxc import 제거)** 의 본질은 `buildImportMap()` 의 raw `StaticImport` 의존 해소 + 원본 module specifier (`ZIPBUL_IMPORT_SOURCE` IR 에 emit) 의 안정적 획득이다. 본 항목은 길대시 메인테이너와의 2 라운드 회신 끝에 **결정 완료** — 길대시 0.26.0 의 `CodeRelation.specifier` 가 unresolved 케이스에만 보존되는 결함을 0.26.1 patch 로 *resolved 케이스 포함 모든 relation 에 항상 보존* 하도록 수정 (Item 132). 따라서 Step 4 의 작업은 (a) 0.26.1 배포 합류 (catalog `@zipbul/gildash` 버전 갱신), (b) `buildImportMap` 을 `extractRelations` 의 `imports` relation 위로 재설계하면서 aliased named 검출 (`srcSymbolName !== dstSymbolName && dstSymbolName !== 'default' && dstSymbolName !== '*'`) 을 cli 측 헬퍼로 처리, (c) `ImportInfo.importSource` 를 `relation.specifier` 로 교체. **Step 4 는 0.26.1 배포 회신을 받은 후 Step 3b 완료 시점에 진입한다** — 0.26.1 미배포 상태에서 Step 4 진입 시 specifier 누락으로 빌드된 manifest 가 틀린 import 경로를 emit 한다.

**Step 5 (`class-metadata-extractor` / `method-metadata-extractor` → `extractSymbols`)** 는 클래스/메서드 추출을 gildash 의 `extractSymbols` 고수준 API 로 이관하는 작업이다. 0.26 의 `ExtractedSymbol` 는 `members` (중첩 멤버), `decorators`, `heritage`, `modifiers`, `parameters` (파라미터 데코레이터 포함), `span` 을 모두 포함하므로 이론상 cli 의 자체 walker 없이 한 호출로 추출 가능하다. 이 Step 은 Step 3b 가 끝나야 진입 가능 (`ast-node-locator` 의 헬퍼 시그니처가 변경된 후에 그 소비자인 추출기를 손대는 게 안전하다 — 동시 변경 시 회귀 추적이 어려워진다).

**Step 6 (`context-operation-extractor` / `handler-context-usage-extractor` → `findPattern`)** 은 `ctx.use(KEY)` / `ctx.set(KEY, V)` / `ctx.get(KEY)` 같은 패턴 매칭을 gildash 의 `findPattern` (ast-grep 문법) 으로 이관하고, 메서드 `span` 으로 함수 본문 범위 필터링 + ctx 매개변수 shadow 검사를 cli 측 후처리로 남기는 작업이다. 두 추출기는 현재 거의 동일한 로직을 중복 구현하고 있으므로 **단일 헬퍼로 통합** 하는 리팩토링이 같이 들어간다. Step 3b 완료가 진입 조건.

**Step 7 (`middleware-augment-extractor` / `middleware-augment-collector` / `config-extractor` → gildash 어댑터)** 은 미들웨어 augments + contextOps 추출, `defineAdapter` 호출 정규화를 Step 1 어댑터 (`expression-value-to-zipbul-ir.ts`) 의 `ExpressionValue` 변환 위로 이관하는 작업이다. `middleware-augment-extractor.ts` 의 `TSType` 의존은 길대시 메인테이너와의 2 라운드 회신 끝에 **(β) cli 자체 stringifier 채택** 으로 결정 완료 (Item 131). 즉 길대시는 `TSType` 을 노출하지 않으며, cli 가 길대시 re-export 5종 (`Program`, `Node`, `Visitor`, `visitorKeys`, `VisitorObject`) 위에 자체 `stringifyTSType` 를 작성한다 — 진입점만 길대시 `Node` 로 받고 변환 로직 (12+ TSType 변형 처리, declaration merging IR emit 형태) 은 cli 도메인 안에서 처리. 본 stringifier 작성이 Step 7 작업 범위에 포함된다. Step 3b 완료 후 즉시 진입 가능 (정책 대기 없음, 0.26.1 배포 의존도 없음).

**Step 8 (`lib-augment-injector` 의 oxc 사용 제거)** 은 JS 산출물 후처리 시점이라 입력이 *컴파일된 JS* 다. 이 단계에서 oxc 를 쓰는 이유는 JS 를 다시 파싱해서 미들웨어 augment 메타를 IR 로 주입하기 위함이다. 두 가지 방향 — (a) gildash 로 다시 파싱 (정공법, 단 비용 큼), (b) string-level 처리 (정규식 기반 sentinel 치환, 가벼움 단 fragility). 본 문서는 결정을 보류 — Step 7 의 메인테이너 요청 결과를 보고 같이 결정.

**Step 9 (회귀 가드 + catalog 정리)** 는 cli 의 어떤 파일도 `from 'oxc-parser'` import 를 가지지 않음을 lint 룰 또는 grep 기반 spec 으로 강제하고, `package.json` 의 catalog 에서 `oxc-parser` 항목을 삭제하는 마무리 단계다. Step 3b~8 가 모두 끝나야 진입.

**Step 10 (어댑터 컴파일러 MVP, `zb build adapter` 본체)** 는 본 문서 Section A~L 에 명세된 113 + 4 책임 (어댑터 패키지 입력 → dist/manifest 산출) 을 직접 수행하는 새 cli 서브커맨드다. 이 Step 은 Step 1~9 가 모두 끝나야 진입 가능 — 모든 분석기가 gildash 단일 진입점 위에 있어야 어댑터 컴파일러도 동일 인프라를 재사용할 수 있다. 신규 디렉토리 `packages/cli/src/compiler/adapter-build/` 권장.

**Step 11 (사용자 앱 빌드 측 manifest 소비, Section M)** 은 Step 10 의 산출물을 사용하는 짝 로직이다. 사용자 앱 빌드 (`zb build`) 가 `node_modules/<adapter-package>/dist/adapter.manifest.json` 을 우선 로드하도록 만들고, fallback 정책 (Item 115: manifest 없을 때 기존 `.ts` 정적 분석으로 떨어뜨릴지 hard error 인지) 을 결정해야 한다.

**Step 12 (External e2e)** 는 Step 11 의 인수 기준이다. 별도 폴더에 어댑터 + 사용자 앱을 설치하고, `.ts` 인젝션 없이 (= 어댑터 소스 분석을 cli 가 안 하고 dist/manifest 만 읽어도) 빌드+런이 끝나는지 검증한다.

다음은 빠른 색인용 표 — 자세한 의존성·블로커는 위 산문 참조.

| # | Step | 상태 | Commit | 의존성 (선행) |
|---|---|---|---|---|
| 1 | `expression-value-to-zipbul-ir` 어댑터 신설 + 소비자 wiring | ✅ | `002ce9e` → `23f32a2` → `0c74e04` → `6b92958` (0.26) | — |
| 2 | `import-export-extractor` → `extractRelations` | ✅ | `43fc643` → `5421dbc` → `934e02d` | — |
| 3a | `getMethodAstMeta` 제거 (dead code) | ✅ | `ae254d8` | — |
| 3b | `ast-node-locator` 의 oxc 직접 import 전면 제거 | 🟡 | — | — |
| 4 | `expression-converter.ts` 잔존 oxc import 제거 | ⬜ | — | 3b + 길대시 0.26.1 배포 (Item 132 specifier 보존 patch) |
| 5 | class/method extractors → `extractSymbols` | ⬜ | — | 3b |
| 6 | ctx ops extractors → `findPattern` + span 필터 | ⬜ | — | 3b |
| 7 | middleware/adapter extractors → gildash + cli stringifier | ⬜ | — | 3b (Item 131 (β) cli 자체 stringifier 결정 완료) |
| 8 | `lib-augment-injector` 의 oxc 제거 | ⬜ | — | 7 |
| 9 | oxc 부재 회귀 가드 + catalog 항목 제거 | ⬜ | — | 3b·4·5·6·7·8 |
| 10 | 어댑터 컴파일러 MVP — `zb build adapter` 본체 | ⬜ | — | 9 |
| 11 | CLI 앱 빌드 측 manifest 우선 소비 (Section M) | ⬜ | — | 10 |
| 12 | External e2e — `.ts` 인젝션 없이 dist/manifest 만으로 동작 | ⬜ | — | 11 |

### 0.2 회귀 baseline + 검증 명령

작업 시작 전과 작업 종료 시점에 동일하게 다음 명령을 루트에서 실행해서 "테스트 카운트 보존" 을 검증한다. 본 baseline 은 commit `79656ac` 시점 측정값이다.

- `bunx tsc --noEmit` — exit 0, stderr 0 라인. IDE diagnostic 과 어긋나면 본 명령의 결과만 신뢰 (Section 0.0 의 "IDE 진단 vs tsc" 참조).
- `bun run test:unit` — `1964 pass`. 32 파일.
- `bun run test:integration` — `94 pass`. 4 파일.
- `bun run test:e2e` — `370 pass`. 8 파일.

각 Step 종료 시점에 **세 카운트 모두 동일하거나 증가**. 카운트 감소는 회귀 신호. 새 테스트를 의도적으로 추가했다면 본 문서의 baseline 도 같이 업데이트.

### 0.3 oxc-parser 직접 import 잔존 인벤토리 — 17 파일

다음 명령으로 즉시 재확인할 수 있다 — 본 인벤토리가 stale 인지 의심되면 먼저 실행:

```
grep -rln "from 'oxc-parser'" packages/cli/src --include="*.ts"
```

현재 시점 (commit `54542c1`) 의 결과는 다음 17개. 소스 10개 (미처리) + 스펙 7개 (미처리) + Step 2 에서 이미 완료된 1개 (`import-export-extractor.ts` — 이미 grep 에 잡히지 않음, 참고용).

소스 (미처리 10):
- `packages/cli/src/compiler/analyzer/expression-converter.ts` — Step 4. `StaticImport` 사용 → `extractRelations` 산출물 소비로 재설계.
- `packages/cli/src/compiler/analyzer/parser/ast-node-locator.ts` — Step 3b (현재 작업). narrow 타입 9종 사용.
- `packages/cli/src/compiler/analyzer/parser/class-metadata-extractor.ts` — Step 5. `Node` / `Class` / `PropertyDefinition` / `Function` 사용 → `extractSymbols` 흡수.
- `packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.ts` — Step 5. `Function` / `Expression` / `Class` 사용.
- `packages/cli/src/compiler/analyzer/parser/context-operation-extractor.ts` — Step 6. `Function` / `ArrowFunctionExpression` / `CallExpression` / `MemberExpression` 사용.
- `packages/cli/src/compiler/analyzer/parser/handler-context-usage-extractor.ts` — Step 6. `Function` / `CallExpression` / `MemberExpression` 사용. `context-operation-extractor` 와 중복 로직 → 단일 헬퍼로 통합.
- `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` — Step 7. `Function` / `AssignmentExpression` / `ArrowFunctionExpression` / `NewExpression` / **`TSType`** 사용. `TSType` 이 Item 131 메인테이너 요청 블로커.
- `packages/cli/src/compiler/analyzer/adapter/middleware-augment-collector.ts` — Step 7. `CallExpression` / `Function` / `ImportDeclaration` / `VariableDeclaration` 사용.
- `packages/cli/src/compiler/analyzer/adapter/config-extractor.ts` — Step 7. `Node` 한 곳만 — 사실상 trivial migration.
- `packages/cli/src/compiler/generator/lib-augment-injector.ts` — Step 8. JS 후처리 시점.

스펙 (미처리 7):
- `packages/cli/src/compiler/analyzer/expression-converter.spec.ts` — Step 4 동시.
- `packages/cli/src/compiler/analyzer/parser/ast-node-locator.spec.ts` — Step 3b 동시.
- `packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.spec.ts` — Step 5 동시.
- `packages/cli/src/compiler/analyzer/parser/context-operation-extractor.spec.ts` — Step 6 동시.
- `packages/cli/src/compiler/analyzer/parser/handler-context-usage-extractor.spec.ts` — Step 6 동시.
- `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.spec.ts` — Step 7 동시.
- `packages/cli/src/compiler/integration-context-codegen.spec.ts` — Step 8 동시.

스펙은 본체 이관과 같은 커밋에서 처리한다 — type 시그니처가 달라지므로 spec 만 따로 두면 typecheck 통과 안 함.

### 0.4 Step 3b 즉시 작업 컨텍스트 — 본 시점의 메인 진입점

**상황**. `ast-node-locator.ts` (현재 9.3 KB) 는 cli 의 모든 메서드/클래스/호출 노드 추출기가 공유하는 헬퍼 모듈이다. 이 모듈이 oxc-parser 의 narrow 타입 9종 (`Class`, `OxcFunction`, `PropertyDefinition`, `VariableDeclaration`, `CallExpression`, `Directive`, `Statement`, `Expression`, `Node`) 을 직접 import 해서 함수 시그니처에 사용한다. 이 헬퍼를 소비하는 추출기들 (Section 0.3 의 Step 5~8 대상 파일들) 도 동일한 narrow 타입을 받아서 자체 가드/매칭을 수행한다. 따라서 `ast-node-locator.ts` 의 시그니처가 narrow → `Node` union 으로 일반화되면 *모든 소비자에게 전파* 되는 것이 본 Step 의 핵심 부담이다. Step 3a (`getMethodAstMeta` 제거, commit `ae254d8`) 는 0.25 keyKind 마이그레이션 (`8a43f4f`) 이후 dead code 가 된 함수를 미리 청소한 것이며, 본 Step 3b 가 본 모듈의 oxc 직접 의존을 제거하는 본 마이그레이션이다.

**방향**. 다음 순서로 진행:

(1) `ast-node-locator.ts` 의 `import type { ... } from 'oxc-parser'` 라인을 제거하고 동일 위치에서 `import type { Node, Visitor, visitorKeys } from '@zipbul/gildash'` (또는 이미 길대시 인덱스에서 re-export 되는 경로) 로 교체. 이때 narrow 타입 9종은 *어떤 것도* import 하지 않는다 — 모두 `Node` union 으로 받고 함수 진입부에서 `node.type === 'Class'` 같은 in-line 가드로 좁힌다. 이 discriminant 가 lowercase `kind` 가 아니라 PascalCase `type` 임을 주의해라 — gildash 가 oxc-parser 의 `Node` 를 그대로 re-export 하므로 oxc 의 명명 규약을 따른다 (Section 0.6.1 검증).

(2) 본 모듈의 모든 export 함수의 파라미터 타입을 `Node` 로 일반화. 예: `getCalleeMethodName(node: CallExpression): string` → `getCalleeMethodName(node: Node): string` 로 변경 후 함수 본문 첫 줄에 `if (node.type !== 'CallExpression') throw new Error('expected CallExpression')` 또는 `if (node.type !== 'CallExpression') return null` 같은 가드. 가드의 throw vs return null 선택은 호출자가 이미 타입을 보장하는지에 따라 다르며, 기존 호출자가 narrow 타입으로 전달했었으므로 throw 가 보수적 안전망. 단, 호출자가 union 으로 전달하던 경우는 null/undefined 폴백 유지.

(3) `walkChildren` 같은 자체 walker 가 있다면 폐기하고 gildash 의 `visitorKeys` 위에 직접 재귀 함수를 작성. gildash 는 pre/post 훅을 제공하지 않는다 (Section 0.6.1 검증) — 즉 `Visitor` 객체에 `enter`/`exit` 콜백을 설정하는 oxc-parser 표준 API 만 노출되어 있으므로, 그 위에 cli 측 wrapper 가 필요하면 직접 작성한다. wrapper 가 너무 두꺼워지면 그 자체로 구조 결함 신호 — gildash 의 `extractSymbols`/`findPattern` 같은 고수준 API 로 흡수 가능한 사용 패턴인지 다시 검토.

(4) `ast-node-locator.spec.ts` 의 `import type { Class, CallExpression } from 'oxc-parser'` 도 동일하게 제거. 테스트 fixture 가 narrow 타입으로 cast 하던 부분 (`as Class`) 은 `as Node` 로 일반화하거나, 더 나은 방향으로는 fixture 자체를 gildash `parseSource` 로 만들고 첫 statement 를 그대로 사용 (cast 없이). spec 도 본체와 같은 commit 에서 처리.

(5) 검증. 다음 4 명령을 순차로 실행:
- `bunx tsc --noEmit` — 0 에러.
- `bun run test:unit` — `1964 pass` 동일하거나 증가.
- `bun run test:integration` — `94 pass` 동일하거나 증가.
- `bun run test:e2e` — `370 pass` 동일하거나 증가.
- `grep -rn "from 'oxc-parser'" packages/cli/src/compiler/analyzer/parser/ast-node-locator.ts packages/cli/src/compiler/analyzer/parser/ast-node-locator.spec.ts` — 0 매치.

(6) 커밋. 메시지 예: `refactor(cli): ast-node-locator 의 oxc 직접 import 제거 — Step 3b`. 본문에 변경 사유 (gildash 단일 진입점 정책, Section N) + 회귀 baseline 보존을 적고 마지막에 `Co-Authored-By: ...` 라인.

**근거**. 이 방향을 채택하는 이유는 두 가지다. 첫째, gildash 가 노출하는 `Node` 는 oxc-parser 의 동일 reference (alias 가 아닌 동일 타입) 이므로, 모든 narrow 타입의 union 에 그대로 좁힐 수 있다 — TypeScript 의 discriminated union narrowing 표준 동작 (Section 0.6.1 의 Agent 3 검증 결과). 둘째, 본 마이그레이션의 최종 목표는 "cli 의 어떤 파일도 oxc-parser 를 직접 import 하지 않음" (Section N Item 121) 이므로, 중간 형태로 "type-only import 만 유지" (옵션 A) 나 "cli 자체 structural type 정의" (옵션 C) 를 거치면 그 중간 형태를 다시 제거하는 작업이 추가된다.

**과거 시도된 잘못된 접근 (반복 금지)**. 본 마이그레이션 작업 중 사용자가 강하게 거부한 접근들이며, 새 에이전트가 동일 패턴을 다시 제안하지 않도록 인용으로 보존한다.

- ❌ **옵션 A (type-only import 유지)**: oxc-parser 를 `import type` 으로만 유지하되 런타임 의존은 제거. 사용자 거부 사유: "0.25 keyKind 이후 소스 100% 제거가 목표". 즉 type-level 도 직접 의존을 허용하지 않으며, gildash re-export 만 인정. 본 정책이 Section N Item 122 다.
- ❌ **옵션 C (cli 자체 structural type 정의)**: cli 안에 자체 AST 노드 타입을 정의하고 oxc 와 호환 가능한 형태로 캐스팅. 사용자 거부 사유 (직접 인용): "자체 구조를 정의하냐고 개 호로새끼야 oxc-parser 를 gildash 로 하는데 왜 자체 구조를 정의하냐고". 즉 gildash 가 책임져야 할 영역을 cli 가 떠안는 것을 금지 — 부족한 부분은 gildash 측 패치 요청 (Item 131·132).
- ❌ **Extract 유틸리티 (`Extract<Node, { type: 'X' }>`)**: 좁은 타입을 `Extract` 로 합성 시도. 실패 사유: oxc 의 `Function` 이 `FunctionExpression | FunctionDeclaration` 같은 umbrella 인 경우 `type` discriminant 만으로는 분리 안 되며, `Extract<Node, { type: 'Function' }>` 가 never 또는 잘못된 union 으로 평가됨. 결론적으로 in-line 가드 (`if (node.type === 'X')`) 사용.

**맥락 — 놓치면 안 되는 미묘한 제약**.
- `walkChildren` 의 폐기는 본 Step 의 진짜 비용이다. cli 는 현재 `walkChildren(node, visitor)` 같은 자체 helper 를 갖고 있을 수 있는데 (확인: `grep -n "walkChildren" packages/cli/src` 로 직접 확인 후 진행), 이를 폐기하면서 호출자 모두를 gildash `Visitor` 패턴으로 교체해야 한다. 이 변경이 Step 5·6·7 의 작업 일부와 겹칠 수 있다 — Step 3b 안에서 `walkChildren` 을 *완전히* 폐기하지 않고 *deprecated* 로 표시하고 점진 폐기하는 게 안전할 수도 있다. 판단은 `walkChildren` 의 외부 호출자 수에 따른다.
- IDE TypeScript language server 는 캐시 시점이 tsc 와 다를 수 있다. `bunx tsc --noEmit` 의 결과만 단일 진실 원천으로 사용, IDE 가 빨간 줄을 그어도 tsc 가 clean 이면 무시. 의심되면 IDE 의 TypeScript server 재시작 (Section 0.0 도 참조).
- 본 Step 작업 중 다른 파일 (Step 5~8 대상) 의 typecheck 가 깨질 수 있다 — `ast-node-locator.ts` 의 시그니처가 변하면 소비자도 같이 수정해야 한다. 하지만 그 소비자들의 *로직 마이그레이션* 은 Step 5~8 의 영역이므로, Step 3b 에서는 *시그니처 호환성* 만 유지하는 최소 변경 (예: 소비자에서 `as Class` 캐스팅 추가) 으로 typecheck 통과시키고, 진짜 마이그레이션은 후속 Step 으로 넘긴다. 이 임시 캐스팅들은 Step 5~8 가 끝나면 자연스럽게 사라진다.

**검증 명령 (반복 가능, 작업 종료 시 마지막 실행)**:

```
bunx tsc --noEmit
bun run test:unit && bun run test:integration && bun run test:e2e
grep -rn "from 'oxc-parser'" packages/cli/src/compiler/analyzer/parser/ast-node-locator.ts packages/cli/src/compiler/analyzer/parser/ast-node-locator.spec.ts
# → 0 matches
```

### 0.5 catalog + 의존성 상태

**상황**. 본 작업의 최종 목표는 cli 가 oxc-parser 에 *직접 의존하지 않는* 것이다 (Section N Item 120, 121). gildash 가 oxc-parser 를 transitive 로 가져오는 것은 허용 — 그 경로로만 oxc 노드 타입에 도달해야 한다. 현재 시점 (commit `79656ac`) 의 의존 상태는 점진 마이그레이션 중간 단계라 직접 의존이 *여전히 명시되어 있다*. Step 3b~8 단계에서는 import 자체는 gildash 경유로 전환하면서, `package.json` 의 dependency 명시는 Step 9 까지 남겨둔다 — 중간 단계에서 cli 의 일부 파일이 여전히 `from 'oxc-parser'` 라인을 가진 채로 작업이 진행되므로, 그 파일들이 모두 정리되기 전에 catalog 에서 항목을 지우면 해당 파일들의 typecheck 가 깨진다.

**현재 상태** (직접 확인 명령: `grep "oxc-parser" package.json packages/cli/package.json`):

루트 `package.json` 의 catalog:
- `@zipbul/gildash`: `0.26.0`
- `oxc-parser`: `0.127.0`

`packages/cli/package.json` 의 dependencies:
- `oxc-parser`: `catalog:` (← 여전히 명시)

**방향**. Step 9 진입 시점에 다음 두 동작을 한 커밋으로 처리: (a) `packages/cli/package.json` 의 `dependencies."oxc-parser"` 라인 삭제, (b) 루트 `package.json` 의 `workspaces.catalog["oxc-parser"]` 라인 삭제. 이 시점에는 cli 안에 oxc-parser import 가 0이어야 하므로 lockfile 의 transitive 만 남고 typecheck 통과한다. 만약 다른 패키지 (`packages/cli` 외) 에서 oxc-parser 를 직접 사용하는 곳이 있다면 그 패키지의 dependencies 만 남기고 cli 만 떼어낸다 — 본 정책은 cli 한정 (Item 120 의 "@zipbul/cli 의 package.json").

**근거**. 직접 명시된 dependency 가 있으면 transitive 변경 시 cli 가 영향받지 않을 수 있다 (lockfile 의 hoisting 과 별개로 dependency declaration 이 path 결정에 우선). 본 정책의 의도는 "gildash 가 결정한 oxc-parser 버전을 cli 가 *유일한 진실의 근원* 으로 받아들임" 이다. 즉 cli 가 별도로 oxc-parser 버전을 지정하지 않음으로써 gildash 의 결정에 묶인다 — 미래에 gildash 가 oxc 메이저 버전을 올릴 때 cli 가 자동 따라가도록.

### 0.6 심층 리뷰 결과 — 2026-04-28, 3개 Explore 에이전트 병렬 검증

본 섹션은 사용자 요청 ("심층 리뷰했냐? 보장하냐?") 에 따라 3개 Explore 에이전트를 병렬로 돌려 (a) gildash 0.26 export surface, (b) 17 잔존 파일의 oxc 사용 패턴, (c) Section A~L 의 zipbul 본체 contract 누락 여부 를 검증한 결과다. 각 항목은 코드 라인 인용으로 뒷받침되어 있어 다음 에이전트가 재검증할 필요 없이 직접 사용 가능 — 단 *코드가 변경되었으면* 재검증.

#### 0.6.1 gildash 0.26 export surface — Agent 3 검증

**상황**. cli 가 의존하는 모든 gildash API 의 형태가 0.26 시점에 어떤지가 본 마이그레이션의 대전제다. 0.25 → 0.26 변경에서 `keyKind: string` → `key: KeyExpression` 같은 구조화가 일어났고 (`332315f`), 이외의 API 가 어떤 모양인지 확인할 필요가 있었다.

**검증 결과** (출처: `node_modules/@zipbul/gildash/dist/*.d.ts` 직접 읽기):

- **`Node` / `Program` / `Visitor` / `visitorKeys` / `VisitorObject`**: gildash 가 oxc-parser 의 *동일 타입* 을 그대로 re-export. alias 가 아니라 reference identity 가 동일. 따라서 cli 에서 `import type { Node } from '@zipbul/gildash'` 와 `import type { Node } from 'oxc-parser'` 는 타입 시스템에서 100% 호환. `Node` 는 discriminated union 이며 discriminant 는 `type` 필드 (PascalCase 문자열, 예: `'Class'`, `'CallExpression'`, `'Function'`).
- **`extractSymbols(parsed)`**: 파일의 클래스/함수/변수 등 top-level 심볼을 `ExtractedSymbol[]` 로 반환. `ExtractedSymbol` 은 `kind`, `name`, `span`, `isExported`, `methodKind`, `members` (중첩 멤버), `decorators`, `heritage` (`{ kind, name, typeArguments }`), `modifiers`, `parameters` (각 파라미터의 `decorators` 포함) 를 모두 포함. Step 5 가 이 API 만으로 클래스/메서드 추출을 끝낼 수 있다는 근거.
- **`extractRelations(ast, filePath)`**: 모듈 간 관계를 추출. `kind` 종류는 `'imports'`, `'type-references'`, `'re-exports'`, `'calls'`, `'extends'`, `'implements'` 의 6종. 본 문서 Section N 의 표에는 처음에 3종만 적혀있었으나 6종으로 확장 가능. heritage 추출 (Step 5) 에 `'extends'`/`'implements'` 를 활용하면 자체 walker 없이 상속 관계를 얻을 수 있다.
- **`findPattern(pattern, opts?)`**: ast-grep 문법 (`'console.log($$$)'` 같은 메타변수 포함) 으로 노드 패턴 매칭. `PatternMatch[]` 로 `startLine`/`endLine`/`startColumn`/`endColumn`/`startOffset`/`endOffset`/`matchedText`/`captures` 반환. Step 6 의 `ctx.use(KEY)` / `ctx.set(KEY, V)` / `ctx.get(KEY)` 매칭에 사용.
- **`parseSource(filePath, sourceText, options?)`**: `Result<ParsedFile, GildashError>` 반환. `ParsedFile = { filePath, program, module, errors, comments, sourceText }` — `module` 은 oxc 가 미리 추출한 ESM 메타데이터 (정적 import/export 등) 라 빠르다. cli 의 `ast-parser.ts` 가 이미 이 경로를 통과 (`934e02d`).
- **Walker pre/post 훅 부재** — gildash 는 raw oxc Visitor 만 노출하고 별도의 walker abstraction 을 제공하지 않는다. cli 의 `walkChildren` 같은 헬퍼를 폐기할 때 직접 `visitorKeys` 위에 재귀를 작성해야 한다. Step 3b 의 작업 컨텍스트에 명시.
- **노출 안 함 (전수)** — 다음 oxc 좁은 타입은 gildash 가 *re-export 하지 않음*: `Class`, `CallExpression`, `Function`, `MethodDefinition`, `Expression`, `MemberExpression`, `VariableDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration`, `ModuleExportName`, `StaticImport`, `ImportNameKind`, `PropertyDefinition`, `Directive`, `Statement`, `ArrowFunctionExpression`, `AssignmentExpression`, `NewExpression`, `ImportDeclaration`, `TSType`. 즉 cli 가 이 타입들을 사용하려면 `Node` union + `node.type === 'X'` 가드로 풀거나, gildash 메인테이너 측 추가 노출을 요청해야 한다. `TSType` 과 `ImportNameKind` 가 실제로 메인테이너 요청 후보 (Item 131, 132) — 다른 타입들은 union narrowing 으로 충분.

**근거 — 왜 이게 중요한가**. cli 마이그레이션의 모든 Step 은 "gildash 의 `Node` union + `extractSymbols`/`extractRelations`/`findPattern` 고수준 API + `visitorKeys` walker" 4가지 위에서 수행된다. 위 검증으로 이 4가지가 0.26 에 모두 존재함이 확인되었으므로, cli 측 작업은 *어떻게 사용할지* 의 문제이지 *gildash 가 부족한지* 의 문제가 아니다 — 단 `TSType` (Step 7 차단), `ImportNameKind` 등가 메타 (Step 4 차단) 두 가지만 예외.

#### 0.6.2 Step 분할 블로커 — Agent 1 의 17 파일 분석

**상황**. 본 문서는 17 잔존 파일을 Step 3b~8 에 배정해 놨는데, 각 파일이 실제로 어떤 oxc 타입을 어떻게 사용하는지 검증하지 않으면 Step 분할 자체가 잘못되었을 수 있다. Agent 1 이 17 파일을 전수 분석한 결과, Step 분할은 대체로 옳지만 *3개 Step 에 블로커* 가 있다.

**Step 4 블로커**. `expression-converter.ts` 의 `buildImportMap()` 은 oxc 의 `StaticImport[]` 배열을 받아서 각 entry 의 `entry.importName.kind === 'Name' | 'Default' | 'NamespaceObject'` 같은 enum 분기를 한다. gildash 의 `extractRelations` 는 `kind: 'imports'` 의 relation tuple 을 binding 단위로 주지만, `ImportNameKind` 같은 enum 값에 1:1 대응되는 메타데이터를 노출하지 않는다 (Section 0.6.1). 따라서 단순한 *type 교체* 로 끝나지 않으며, 두 가지 방향 중 선택해야 한다 — (a) cli 측에서 `extractRelations` 산출물 → 기존 import map 형태로 변환하는 헬퍼 작성, (b) Item 132 메인테이너 요청. 이 결정이 Step 4 의 작업 범위 (cli 측 변환 헬퍼만 추가 vs gildash 측 PR 작성·머지 대기 후 단순 교체) 를 좌우한다. **결정 보류 시 Step 4 진입 금지**.

**Step 7 블로커**. `middleware-augment-extractor.ts` 가 `TSType` (제네릭 함수 시그니처 노드) 을 사용한다. 미들웨어가 `defineMiddleware<TInput, TOutput>` 같은 제네릭 형태로 타입 augment 를 선언할 때, 그 제네릭 인자를 추출하려면 TS AST 의 `TSType` 노드에 직접 접근해야 한다. gildash 가 노출하지 않는다. 두 가지 방향 — (a) Item 131 메인테이너 요청, (b) cli 측 string-level 폴백 (제네릭 `<T, ...>(...)` regex). string 폴백은 fragile 하지만 gildash 측 변경 없이 즉시 진입 가능. 사용자 결정.

**Step 3b 자체** 도 "단순 import 교체" 가 아니다. 17 파일 모두 narrow oxc 타입을 함수 파라미터로 받는 시그니처를 갖고 있어서, gildash `Node` union 으로 일반화하면서 진입부 가드를 추가하는 *시그니처 일반화 작업* 이다. drop-in 별칭이 없으므로 이 부분이 Step 3b 의 진짜 비용이다.

**근거**. 본 블로커들을 사전에 식별해서 본 문서에 명시함으로써 다음 에이전트가 (1) Step 4·7 진입 전 사용자에게 정책 결정을 묻고, (2) Step 3b 작업 시 단순 교체로 끝날 거라는 잘못된 가정을 피하도록 한다.

#### 0.6.3 Section A~N 갭 — Agent 2 의 contract 검증

**상황**. 본 문서가 정의하는 128 책임 + 5 신규 = 137 책임이 zipbul 본체의 실제 contract 를 모두 커버하는지 의심되었다. Agent 2 가 `packages/core/src`, `packages/common/src`, `packages/http-adapter/src` 를 전수 읽고 누락을 확인했다.

**확정된 갭 5건** (모두 코드 인용으로 검증, 4건 즉시 채택 + 1건 조건부):

- ✅ **Item 48b (필수, Section C)** — Adapter 인스턴스의 `clusterStrategy` 속성 추출. 미명시 시 `ClusterStrategy.Shared` 기본값. 근거: `packages/core/src/adapter/adapter.ts:104` (모든 어댑터 클래스가 `readonly clusterStrategy: ClusterStrategy` 선언) + `packages/common/src/adapter/types.ts:39-55` (enum 정의). 런타임 소비: `packages/core/src/application/application.ts:294` (cluster mode 결정 로직). 즉 manifest 가 이 값을 emit 하지 않으면 사용자 앱이 cluster mode 로 동작 못 함. **즉시 채택**.
- ✅ **Item 54b (필수, Section D)** — `defineAdapter()` 인자의 `provides?: readonly ContextKey<unknown>[]` 추출. 근거: `packages/common/src/adapter/define-adapter.ts:42-43` (config schema 에 optional 필드로 정의). 본 문서 Item 119 (다중 어댑터 ContextKey 충돌 검출) 의 입력 데이터다. **즉시 채택**.
- ✅ **Item 54c (필수 채택 확정, Section D)** — Adapter 클래스 생성자 옵션 schema 추출. 예: `HttpAdapter` 생성자가 `HttpServerOptions` 를 받음 (`packages/http-adapter/src/http-adapter.ts:64`). 본 문서의 기존 Item 44 는 시그니처 *검증* 만 다루고, 옵션의 구조 schema 자체는 emit 하지 않는다. **결정 근거 (사용자 확정)**: 어댑터 컴파일러의 존재 이유 자체가 *컴파일 타임에* 어댑터 contract 를 굳혀 사용자 앱 빌드가 그걸 소비하게 하는 것 — 사용자가 `HttpAdapter({ port: 'foo' })` 같은 잘못된 옵션을 *런타임* 에 알게 되는 건 본 컴파일러의 존재 이유와 정면 충돌. 따라서 옵션 schema 의 manifest emit 은 필수. 신규 manifest `dist/adapter-constructor-schema.json` (Item 71b) 으로 분리 — `peer-contract.json` (어댑터가 *의존* 하는 심볼) 과 의미가 반대 (어댑터가 *제공* 하는 인터페이스). Step 10 진입 시 본체 구현.
- ✅ **Item 58 보강 (필수, Section E)** — `dist/context-augments.d.ts` 의 *내용 형식* 명시. 본 문서가 처음에는 "declaration merging 코드" 라고만 적었으나 구체 템플릿이 없었다. 확정 템플릿: `declare module '<adapter-package>' { interface <ContextType> { <augmentedProp>: <BaseType> & <Augment>; ... } }`. intersection (`&`) 패턴은 TS interface merging 의 표준 방식이며, 사용자 앱이 어댑터 패키지 import 만으로 자동 적용 (별도 augment import 불필요). 소스: `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` 의 `PropAugment` 추출 결과 소비.
- ✅ **Item 20·41 정정 (필수, Section B/C)** — 데코레이터 카테고리 표기 정정. 본 문서가 처음에는 "controller / method / option / param" 4분류로 적었으나, `AdapterEntryDecorators` (`packages/common/src/adapter/types.ts:18-30`) 는 `controller: DecoratorRef` (단수, 정확히 1개), `handlers: readonly DecoratorRef[]` (배열, 1개 이상), `options?: readonly DecoratorRef[]` (optional, 0개 이상) 의 3분류만 정의한다. param-level 데코레이터는 어댑터 entry 가 아니라 provider 클래스 생성자 (`@Inject` 등) 에서 별도 추출된다 (Item 21b 신설). Item 41 의 카디널리티 룰도 정정 — controller "정확히 1" (이전 "1+" 는 틀림).

**근거**. 위 갭들이 발견되지 않았다면 어댑터 컴파일러 MVP 가 "어댑터 패키지 입력 → manifest 산출" 의 핵심 책임을 누락한 채 ship 될 수 있다. 특히 `clusterStrategy` 는 `application.ts:294` 의 cluster 분기 로직 (`if (entry.adapter.clusterStrategy === ClusterStrategy.Exclusive)`) 의 입력이므로, manifest 가 이 값을 emit 하지 않으면 사용자 앱은 기본값 `Shared` 로 동작하게 된다 — 즉 `Exclusive` 가 필요한 어댑터 (예: Cron, Leader Election) 도 `Shared` 로 동작해 부작용 (중복 실행, 리더 충돌) 이 발생할 수 있다.

#### 0.6.4 메인테이너 회신 결과 — gildash 측 (Item 131·132 결정 종료)

**상황**. Section 0.6.2 의 Step 4·7 블로커에 대해 cli 측이 길대시 메인테이너에게 보강 요청 2 건 (`TSType` 노출, `extractRelations` binding 메타 강화) 을 발송. **2 라운드 회신** 끝에 양 항목 모두 결정 종료 — 사용자가 추가로 정책 결정할 사안 없음.

- **Item 131 (TSType) → (β) cli 자체 stringifier 채택, 길대시 변경 0**. 1차 회신: 길대시가 거절 + 카운터안 `ExpressionCall.typeArguments: string[]` 제시. 2차 회신: cli 측이 사용처 정정 — 카운터안이 callsite 측 typeArguments 를 겨냥했으나 실제 사용처는 미들웨어 팩토리 *내부* 의 inner `ArrowFunctionExpression.typeParameters` (정의 측) + `param.typeAnnotation` 과 `returnType` 의 12+ TSType 변형 구조적 stringification 이라는 점을 코드 인용 (`packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts:240, 276`) 으로 정정. 이를 받아 길대시는 카운터안 철회. 부분 노출 (α: `ExpressionFunction.typeParameters` 등) 도 거절 — 점진적 부분 노출이 누적되면 길대시가 "인덱싱 엔진 → 타입 시스템 어웨어 도구" 정체성 이동을 강요받기 때문. 최종 결정: **(β) cli 가 길대시 re-export 5종 (`Program`, `Node`, `Visitor`, `visitorKeys`, `VisitorObject`) 위에 자체 `stringifyTSType` 를 작성**. 진입점만 길대시 `Node` 로 받고 변환 로직 (TSType 변형 처리, declaration merging IR emit 형태) 은 cli 도메인 안에서 처리. 본 stringifier 작성이 Step 7 작업 범위에 포함된다. 0.26 마이그레이션의 핵심 목표 (cli 의 oxc 직접 의존 0) 는 (β) 만으로 충족.
- **Item 132 (specifier 보존) → 길대시 0.26.1 patch 결함 수정 수락**. 1차 회신에서 cli 측이 binding kind enum 노출 요청, 길대시가 `dstSymbolName` 으로 1:1 도출 가능하다며 거절. 2차 회신에서 cli 측이 본 요청의 본질을 정정 — binding kind 가 아니라 *raw module specifier 항상 보존* 이 진짜 필요 (cli 가 `ZIPBUL_IMPORT_SOURCE` IR 에 원본 소스 텍스트 emit). 0.26.0 의 `CodeRelation.specifier` 가 unresolved 케이스에만 보존되어 resolved (상대 경로 / 외부 패키지 해상 / tsconfig paths alias 해상) 시 원본 specifier 가 사라지는 누락이 확인됨 — `dstFilePath` 절대 경로에서 원본 텍스트로의 역변환은 fragile (`./foo` vs `./foo/index`, paths alias, exports map 모두 복원 불가). 길대시가 0.26.1 patch 로 *모든* `imports`/`re-exports`/`type-references`/dynamic import/`require()` relation 에 `specifier` 를 항상 보존하도록 결함 수정 (non-breaking, 추가만). 다음 영업일 내 PR + 머지/배포 회신 예정. 한편 aliased detection (`import { Foo as Bar }` → originalName='Foo') 은 0.26.1 와 무관하게 `srcSymbolName !== dstSymbolName && dstSymbolName !== 'default' && dstSymbolName !== '*'` 로 cli 측 헬퍼만으로 해결 가능 — 설계는 지금 시작 가능.

**Step 진입 영향**.
- Step 4 — 0.26.1 배포 회신 합류 (catalog 갱신) 후 진입. 이전 본 문서의 "정책 결정 대기" 차단은 해소되었으며, 단일 패키지 배포 대기로 약화되었다.
- Step 7 — 차단 해소. Step 3b 완료 후 즉시 진입 가능 (정책 대기 없음, 0.26.1 배포 의존도 없음).

### 0.7 사용자 협업 원칙 — 메모리 동기화 + 강제 사항

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
2. `git log --oneline -1` 결과가 본 문서의 "Last sync" (`54542c1`) 와 일치하는지 확인. 다르면 본 문서가 stale 일 수 있으니 인벤토리 (Section 0.3, 0.5) 를 grep 으로 재검증.
3. `bunx tsc --noEmit` 한 번 — 진입 baseline 이 깨끗한지 확인.
4. 본 Section 0 전체를 처음부터 끝까지 읽어라. 특히 0.4 (Step 3b 작업 컨텍스트), 0.6.2 (블로커), 0.7 (협업 원칙).
5. Step 4 진입 전 길대시 0.26.1 배포 (Item 132 specifier 보존 patch) 합류 확인 — `packages/cli/node_modules/@zipbul/gildash/package.json` 의 version 이 `0.26.1` 이상인지. Step 7 은 정책 대기 없음 (Item 131 (β) cli 자체 stringifier 결정 완료) — Step 3b 완료 후 즉시 진입 가능.

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
9. ✅ AST 파싱은 `@zipbul/gildash` 의 `parseSource(filePath, sourceText)` 단일 진입점만 사용 (Section N 정책). 현재 `ast-parser.ts` 가 이미 이 경로를 통과 (`934e02d`).

> Step 10 본체에서 1~8 을 일괄 구현. 어댑터 컴파일러 진입점 신설 — `packages/cli/src/compiler/adapter-build/` 디렉토리 권장.

## B. 정적 분석 — 추출

> 본 섹션의 모든 추출은 `@zipbul/gildash` 의 공개 API (`extractSymbols`, `extractRelations`, `patternSearch`, `Visitor`, `visitorKeys`) 위에서 수행한다. 자체 AST 노드 매칭 코드를 새로 추가하지 않는다 — 길대시 API 가 부족하면 길대시 측 패치 요청을 우선 (Section N).

10. ⬜ `defineAdapter()` 호출 위치 + 인자 객체 추출 — `extractSymbols` variable initializer (`ExpressionValue`) 또는 호출 패턴 매칭으로 획득. *Step 7 에서 cli 측 `config-extractor` 가 부분 처리 중 — 어댑터 컴파일러 본체에서 재사용*.
11. ⬜ `adapter` 필드 → 어댑터 클래스 식별
12. ⬜ `context` 필드 → Context 클래스 식별
13. ⬜ `pipeline` 배열 → phase/step 순서 추출
14. ⬜ `phase` enum → 멤버명·값 추출
15. ⬜ `step` enum → 멤버명·값 추출
16. ⬜ Context 클래스 속성/getter → namespace map 자동 도출
17. ⬜ Adapter 클래스 메서드 시그니처 수집
18. ⬜ Context 클래스 메서드 시그니처 수집
19. ⬜ 어댑터 export 데코레이터 함수 enumerate
20. ⬜ Decorator 분류: controller / method / option (어댑터 entry 한정 — param 은 provider 생성자 별도 경로, Section 0.6.3 정정)
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
54c. ⬜ Adapter 클래스 생성자 옵션 파라미터 타입 추출 — 단순 시그니처 검증 (Item 44) 을 넘어 *옵션 schema 자체* 를 manifest 에 emit. 근거: `packages/http-adapter/src/http-adapter.ts:64` (`HttpServerOptions`). 배치: 신규 `dist/adapter-constructor-schema.json` (Item 71b). **사용자 결정 (확정)**: 컴파일 타임 옵션 검증이 본 컴파일러의 존재 이유와 직결되어 필수 채택 — 사용자 앱 빌드가 `HttpAdapter({ port: 'foo' })` 같은 잘못된 옵션을 빌드 단계에서 잡아내야 함. Step 10 진입 시 본체 구현.

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
115. ⬜ manifest 부재 시 — 기존 `.ts` 정적 분석 fallback 또는 명확한 에러 (정책 결정 항목). **Step 11 진입 시 사용자 결정 필요**.
116. ⬜ manifest 의 `producedBy` 필드 ↔ 사용자가 설치한 `@zipbul/cli` 호환성 검사
117. ⬜ manifest 가 결정적이 아닌 변경 (재게시 없이 dist/ 수정) 시 캐시 무효화
118. ⬜ 사용자 앱 컴파일 출력에 의존한 어댑터 manifest 들의 hash 임베딩 (사용자 빌드 결정성)
119. ⬜ 다중 어댑터 (사용자가 여러 어댑터 동시 사용) 시 manifest 병합 규칙 — 데코레이터 이름 충돌 검출

## N. AST 분석 인프라 정책 — `@zipbul/gildash` 단일 진입점

> 어댑터 컴파일러 + 미들웨어 컴파일러 + 사용자 앱 빌드 + dev 모드 — 모든 정적 분석은 `@zipbul/gildash` 의 공개 API 위에서만 수행.
> 본 정책은 본 PR 범위에서 동시 적용 (= 어댑터 컴파일러 MVP 와 oxc 직접 의존 제거를 한 묶음으로 진행).

### 정책

120. ⬜ `@zipbul/cli` 의 `package.json` 에서 `oxc-parser` 의존성 제거. catalog 항목 (`workspaces.catalog["oxc-parser"]`) 도 삭제. transitive 로 길대시가 가져오는 것만 인정. **Step 9 에서 회수**. *현재 상태: cli `dependencies."oxc-parser": "catalog:"` 잔존, 루트 catalog `0.127.0` 잔존*.
121. ⬜ cli 의 어떤 파일도 `from 'oxc-parser'` import 금지 — 위반 시 빌드 실패 (lint rule 또는 typecheck 실패로 강제). **Step 9 에서 회수**.
122. 🟡 AST 노드 타입은 길대시 re-export (`Program`, `Node`, `Visitor`, `visitorKeys`, `VisitorObject`) 만 사용. 길대시가 노출하지 않는 raw oxc 타입 (`Class`, `CallExpression`, `Function`, `MethodDefinition`, `Expression`, `MemberExpression`, `VariableDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration`, `ModuleExportName`, `StaticImport`, `ImportNameKind`, `PropertyDefinition`, `Directive`, `Statement`, `ArrowFunctionExpression`, `AssignmentExpression`, `NewExpression`, `ImportDeclaration`, `TSType`) 은 길대시 고수준 API (`extractSymbols`, `extractRelations`, `findPattern`) + `Node` union + `node.type === 'X'` 가드로 흡수. **Step 3b~8 진행 중**. `TSType` / `ImportNameKind` 는 Item 131·132 메인테이너 요청 후보.
123. ✅ `parseSync` / `parseAsync` 직접 호출 금지 — 모두 `parseSource(filePath, sourceText)` 의 `Result<ParsedFile, GildashError>` 반환을 통과. 현재 cli 전체에서 ✅.

### 길대시 API → cli 추출기 매핑 (확정)

| cli 책임 | 길대시 API | Step | 상태 |
|---|---|---|---|
| 클래스/메서드/데코레이터/생성자/파라미터/heritage/modifiers 추출 | `extractSymbols(parsed)` | 5 | ⬜ |
| `import { X, type Y } from 'M'` binding 단위 분리 | `extractRelations(ast, filePath)` — relation `kind` 6종 (`'imports'` / `'type-references'` / `'re-exports'` / `'calls'` / `'extends'` / `'implements'`) 모두 활용 가능. `meta.isType` 보존. heritage (Step 5) 에 `'extends'`/`'implements'` 사용. | 2 | ✅ `43fc643` |
| `defineAdapter` / `defineMiddleware` / `defineGuard` / `defineExceptionFilter` / `defineModule` 호출 인자 정규화 | `extractSymbols` 의 variable initializer (`ExpressionValue`) → cli 측 어댑터 | 1 | ✅ `002ce9e` (`packages/cli/src/compiler/analyzer/expression-value-to-zipbul-ir.ts`) |
| `ctx.use(KEY)` / `ctx.set(KEY, V)` / `ctx.get(KEY)` 패턴 매칭 | `patternSearch({ pattern, filePaths })` + 메서드 `span` 으로 함수 본문 범위 필터 + ctx 매개변수 shadow 검사 후처리 | 6 | ⬜ |
| 노드 walk | 길대시 `Visitor` + `visitorKeys` (cli 자체 `walkChildren` 폐기) | 3b | 🟡 |
| byte offset → line·col 변환 | `buildLineOffsets` + `getLineColumn` (이미 사용 중) | — | ✅ |

### Step 1 결과 — `expression-value-to-zipbul-ir.ts` 어댑터 (참조용)

124. ✅ `packages/cli/src/compiler/analyzer/expression-value-to-zipbul-ir.ts` — 단일 책임 (현재 236 줄):
  - `ExpressionIdentifier` → `{ [ZIPBUL_REF]: name, [ZIPBUL_IMPORT_SOURCE]?: importSource }`
  - `ExpressionMember` → `{ [ZIPBUL_REF]: 'object.property', [ZIPBUL_IMPORT_SOURCE]?: importSource }`
  - `ExpressionCall` → `{ [ZIPBUL_CALL]: callee, [ZIPBUL_IMPORT_SOURCE]?: ..., args: [...] }` — `callee==='lazy'` + `arguments[0].kind==='function'` 이면 `{ [ZIPBUL_LAZY_REF]: refName }` 후처리
  - `ExpressionNew` → `{ [ZIPBUL_NEW]: callee, args: [...] }`
  - `ExpressionFunction` → `{ [ZIPBUL_FACTORY_CODE]: sourceText, __zipbul_factory_params?: [...] }`
  - `ExpressionSpread` → `{ [ZIPBUL_SPREAD]: argument }`
  - `ExpressionUnresolvable` / `ExpressionTemplate` → `{ [ZIPBUL_UNRESOLVABLE]: true, sourceText }`
  - `ExpressionObject` → 평이한 객체 + spread/computed 키는 `${ZIPBUL_COMPUTED_PREFIX}${index}` 슬롯 (`ZIPBUL_COMPUTED_KEY`/`ZIPBUL_COMPUTED_VALUE` 배치)
  - `ExpressionArray` → 평이한 배열
  - 리터럴 (`string`/`number`/`boolean`/`null`/`undefined`) → 값 그대로

  Spec: `expression-value-to-zipbul-ir.spec.ts` (43+ 케이스, 0.26 spread/literal-key/member-access 포함).

### 폐기 / 흡수 대상 cli 파일 (Step 별 배정)

125. **현재 진척**: 11개 중 1개 ✅ (`import-export-extractor.ts` Step 2). 나머지 10개는 Step 3b~8 에 배정. Section 0.3 인벤토리 참조.

### 회귀 가드

126. ⬜ 본 PR 의 typecheck 단계에서 `oxc-parser` 가 `@zipbul/cli` 의 직간접 의존 그래프에 *직접 import* 형태로 등장하면 실패. (lockfile 의 transitive 로 존재하는 것은 허용.) **Step 9**.
127. ⬜ 회귀 방지 단위 테스트 — cli 의 `oxc-parser` import 부재를 grep 으로 검증하는 lint 룰 또는 spec 1개 추가. **Step 9**.
128. ✅ 기존 cli 의 모든 unit/integration/e2e 회귀 통과. **Baseline 갱신: 1964 / 94 / 370** (이전 1909 / 94 / 369 에서 증가, 회귀 없음).

### 메인테이너 협력 사항

129. 길대시 측 modifier enum 에 `'generator'` 추가 — cli 사용 0건 확인됨, 불필요.
130. 향후 cli 마이그레이션 중 길대시 API 의 사실상 부족분이 발견되면 그때 별도 회신.

### 메인테이너 결정 결과 (2026-04-28 회신 2 라운드 종료)

131. ✅ **`TSType` 노출 요청 — 길대시 거절 + (β) cli 자체 stringifier 채택**. cli 의 사용처가 callsite typeArguments 가 아니라 미들웨어 팩토리 *내부* inner method 정의 측 (`ArrowFunctionExpression.typeParameters`) 의 typeParameters + param/returnType 의 12+ TSType 변형 구조적 stringification 임을 양측 합의. 길대시는 "인덱싱 엔진 → 타입 시스템 어웨어 도구" 정체성 이동을 받지 않기로 결정 (점진적 부분 노출도 거절). cli 가 길대시 re-export 5종 (`Program`, `Node`, `Visitor`, `visitorKeys`, `VisitorObject`) 위에 자체 `stringifyTSType` 를 작성 — 진입점만 길대시 `Node` 로 받고 변환 로직 전부 cli 도메인 (`stringifyTSType`/declaration merging IR emit 형태) 안에서 처리. **Step 7 작업 범위에 stringifier 작성 포함**.
132. 🟡 **`extractRelations` binding 메타 강화 — 길대시 결함 수정으로 수락 (0.26.1 patch)**. 본 요청의 본질은 binding kind enum 노출이 아니라 *raw module specifier 항상 보존* 이었음 (cli 가 `ZIPBUL_IMPORT_SOURCE` IR 에 원본 소스 텍스트 emit 필요). 길대시 0.26.0 의 `CodeRelation.specifier` 가 unresolved 케이스에만 보존되어 resolved (상대 경로 / 외부 패키지 해상 / tsconfig paths alias 해상) 시 원본 specifier 가 사라지는 누락 — `dstFilePath` 절대 경로에서 원본 텍스트로의 역변환은 fragile (`./foo` vs `./foo/index`, paths alias, exports map 모두 복원 불가). 길대시가 0.26.1 patch 로 *모든* `imports`/`re-exports`/`type-references`/dynamic import/`require()` relation 에 `specifier` 를 항상 보존하기로 결정 (non-breaking, 추가만). 다음 영업일 내 PR + 머지/배포 회신 예정. **cli 측 `buildImportMap` 재설계 (Step 4) 는 0.26.1 배포 합류 후 진입**. 한편 aliased detection (`import { Foo as Bar }` → originalName='Foo') 은 `srcSymbolName !== dstSymbolName && dstSymbolName !== 'default' && dstSymbolName !== '*'` 로 cli 측 헬퍼만으로 해결 — 0.26.1 와 무관하게 설계 가능.

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

**구성**. 137 항목 = 128 원본 책임 (1~128) + 6 신규 (21b·48b·54b·54c·58보강·71b) + 4 메인테이너 협력 (129·130·131·132 — 131·132 는 회신 2 라운드로 결정 종료). Item 41 카디널리티 룰 정정 포함. 인수인계 섹션 (0) 은 별도.

**섹션별 진척도**:
- **Section 0 (인수인계)**: 운영 컨텍스트 (저장소·런타임·git·테스트·소통) + 12 Step 로드맵 + 회귀 baseline + 잔존 17 파일 인벤토리 + Step 3b 작업 컨텍스트 + catalog 상태 + 심층 리뷰 결과 (gildash 표면 / Step 분할 블로커 / 갭 5건) + 메인테이너 회신 결과 (Item 131·132 결정 종료) + 사용자 협업 원칙.
- **Section A~L (1–113 + 21b·48b·54b·54c·71b)**: 어댑터 패키지 빌드 시점 직접 책임. 9 ✅ / 4 🔵 / 0 🟡 / 105 ⬜ (Item 54c·71b 필수 채택 확정으로 🟡 해제). Step 10 본체 진입 전 진척률 ~7%.
- **Section M (114–119)**: 사용자 앱 빌드 측 manifest 소비 짝 contract. 0 ✅ / 6 ⬜. Step 11 진입 시 일괄.
- **Section N (120–132)**: AST 분석 인프라 정책 — `@zipbul/gildash` 단일 진입점. 5 ✅ (Item 131 (β) 결정 포함) / 2 🟡 (122 진행 중·132 0.26.1 배포 대기) / 6 ⬜. Step 3b~9 진행 중.

**전체 진행률**: ✅ 14 / 🟡 2 / 🔵 4 / ⬜ 117 = 137. 완료율 약 10%. Step 1·2·3a·회귀 baseline 갱신·심층 리뷰·메인테이너 회신 2 라운드 + 결정 7건 반영 완료.

**다음 에이전트가 즉시 시작할 작업** — Step 3b. 진입 전 다음을 순서대로 읽고 실행:

1. Section 0.0 (운영 컨텍스트) — 저장소/런타임/git/baseline 환경 파악.
2. Section 0.7 (사용자 협업 원칙) — 절대 어기면 안 되는 규칙 9개.
3. Section 0.4 (Step 3b 즉시 작업 컨텍스트) — 본 작업의 상황·방향·근거·맥락.
4. Section 0.6.1 (gildash surface) — `Node` 가 oxc 와 동일 reference 임 확인, narrow 타입은 `node.type === 'X'` 가드 사용.
5. Section 0.6.2 의 Step 3b 항목 — "단순 import 교체가 아니라 시그니처 일반화 + 진입부 가드 추가" 라는 본 Step 의 본질 비용.
6. Section 0.6.4 (메인테이너 회신 결과) — Item 131·132 결정 종료. Step 4 는 길대시 0.26.1 배포 합류 후 진입, Step 7 은 정책 대기 없음 (Step 3b 완료 후 즉시 진입). cli 자체 `stringifyTSType` 작성이 Step 7 작업 범위에 포함됨.

근거는 모두 zipbul 본체 contract 또는 컴파일러 표준 책임. 새 항목 도입은 zipbul 본체 코드 라인 인용 후 추가.
