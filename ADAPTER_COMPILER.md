# Adapter Compiler — 책임 명세 + 실행 인수인계

> 어댑터 패키지 (`zb build adapter`) 가 컴파일러로서 수행해야 할 모든 일.
> 근거: zipbul 본체 (`packages/core`, `packages/common`, `packages/cli`) 가 어댑터에게 요구하는 contract.
> 외부 프레임워크 비교 0. 개발 단계 무관 항목 (마이그레이션·스키마 버전·생태계 거버넌스) 제외.

**Last sync**: 2026-04-28 (commit `6b92958`)
**Branch**: `fix/cli-js-bundle-bin` (main 대비 11 ahead)
**Baseline**: unit `1964 pass` / integration `94 pass` / e2e `370 pass` / typecheck clean.

상태 표기:
- ✅ 완료 (commit hash 명시)
- 🟡 진행 중
- ⬜ 미착수
- 🔵 검증·자동화 필요 (코드는 있으나 회귀 가드/문서화 부족)

---

## 0. 현재 상태 스냅샷 — 다음 에이전트 인수인계

### 0.1 Step 진척도

본 문서의 Section A~N (128 책임) 은 다음 12 Step 으로 실행한다. Step 1~9 는 Section N (gildash 단일 진입점) 의 점진 적용, Step 10~12 는 어댑터 컴파일러 MVP 의 본체 구현이다.

| # | Step | 상태 | Commit | 비고 |
|---|---|---|---|---|
| 1 | `expression-value-to-zipbul-ir` 어댑터 신설 + 소비자 wiring | ✅ | `002ce9e` → `23f32a2` → `0c74e04` | 14 엣지 케이스 + 파라미터 정보 전파 + 0.26 마이그레이션 (`6b92958`) |
| 2 | `import-export-extractor` → `extractRelations` | ✅ | `43fc643` → `5421dbc` → `934e02d` | binding-level split + side-effect import 회귀 복구 |
| 3a | `getMethodAstMeta` 제거 (dead code) | ✅ | `ae254d8` | — |
| 3b | `ast-node-locator` 의 oxc 직접 import 전면 제거 + 소비자 시그니처 업데이트 | 🟡 | — | **본 시점 in_progress**. Section 0.4 참조 |
| 4 | `convertExpressionDeep` walker hook 의 어댑터 흡수 | ⬜ | — | Step 1 어댑터에 흡수, `expression-converter.ts` 의 잔존 oxc import 제거 |
| 5 | `class-metadata-extractor` / `method-metadata-extractor` → `extractSymbols` | ⬜ | — | gildash 0.26 의 `ExtractedSymbol` + `members` 사용 |
| 6 | `context-operation-extractor` / `handler-context-usage-extractor` → `patternSearch` + 메서드 span 필터 | ⬜ | — | 두 추출기 중복 제거 + 단일 헬퍼로 통합 |
| 7 | `middleware-augment-extractor` / `middleware-augment-collector` / `config-extractor` → gildash 어댑터 | ⬜ | — | Step 1 어댑터의 `ExpressionValue` 사용 |
| 8 | `lib-augment-injector` 의 oxc 사용 제거 | ⬜ | — | JS 후처리 시점이라 string-level 또는 gildash 기반 결정 필요 |
| 9 | oxc 직접 import 부재 회귀 가드 (lint/spec) + catalog 항목 제거 | ⬜ | — | Item 126·127 회수 |
| 10 | 어댑터 컴파일러 MVP — `zb build adapter` 본체 (Section A~L 책임 직접 수행) | ⬜ | — | manifest 6종 emit, atomic stage→swap, self-test |
| 11 | CLI 앱 빌드 측이 `dist/adapter.manifest.json` 우선 소비 (Section M) | ⬜ | — | fallback 정책 (Item 115) 결정 필요 |
| 12 | External e2e — `.ts` 인젝션 없이 dist/manifest 만으로 동작 | ⬜ | — | Step 11 의 인수 기준 |

### 0.2 회귀 baseline (Step 별 통과 기준)

```
bunx tsc --noEmit            # exit 0, 0 lines stderr
bun run test:unit            # 1964 pass
bun run test:integration     #   94 pass
bun run test:e2e             #  370 pass
```

각 Step 종료 시점에 **세 베이스라인 모두 동일하거나 증가**해야 한다. 테스트 수가 줄면 수정·삭제된 회귀가 있다는 뜻 — 의도하지 않았다면 회귀.

### 0.3 oxc-parser 직접 import 잔존 인벤토리 (17 파일)

소스 11 + 스펙 6. Step 별로 정확히 어느 파일이 처리 대상인지 명시한다.

**소스 (11)**
- `packages/cli/src/compiler/analyzer/expression-converter.ts` — Step 4
- `packages/cli/src/compiler/analyzer/parser/ast-node-locator.ts` — Step 3b
- `packages/cli/src/compiler/analyzer/parser/class-metadata-extractor.ts` — Step 5
- `packages/cli/src/compiler/analyzer/parser/method-metadata-extractor.ts` — Step 5
- `packages/cli/src/compiler/analyzer/parser/context-operation-extractor.ts` — Step 6
- `packages/cli/src/compiler/analyzer/parser/handler-context-usage-extractor.ts` — Step 6
- `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` — Step 7
- `packages/cli/src/compiler/analyzer/adapter/middleware-augment-collector.ts` — Step 7
- `packages/cli/src/compiler/analyzer/adapter/config-extractor.ts` — Step 7
- `packages/cli/src/compiler/generator/lib-augment-injector.ts` — Step 8
- (이미 처리됨) `import-export-extractor.ts` — Step 2 ✅

**스펙 (6)**
- `expression-converter.spec.ts` — Step 4 동시
- `ast-node-locator.spec.ts` — Step 3b 동시
- `method-metadata-extractor.spec.ts` — Step 5 동시
- `context-operation-extractor.spec.ts` — Step 6 동시
- `handler-context-usage-extractor.spec.ts` — Step 6 동시
- `middleware-augment-extractor.spec.ts` — Step 7 동시
- `integration-context-codegen.spec.ts` — Step 8 동시

### 0.4 Step 3b 인수인계 — 즉시 작업 컨텍스트

**목표**: `ast-node-locator.ts` + 그 spec 에서 `oxc-parser` 의 직접 import 를 0 으로 만들고, 모든 소비자가 gildash 의 노드 타입 (`Node`, `Visitor`, `visitorKeys`) 만 보도록 시그니처를 변경한다.

**현재 import (제거 대상)**:
```ts
import type { Class, OxcFunction, PropertyDefinition, VariableDeclaration,
              CallExpression, Directive, Statement, Expression, Node }
  from 'oxc-parser';
```

**대체 전략**:
1. gildash 의 `Node` (umbrella) 타입 + `kind` discriminant 로 분기. 타입 좁히기는 `node.kind === 'class'` 같은 in-line 가드 함수로.
2. `Visitor` / `visitorKeys` 는 gildash re-export 사용.
3. 소비자가 `Class` / `OxcFunction` / `PropertyDefinition` 같은 좁은 타입을 인자로 받던 시그니처는 `Node` 로 일반화 후 함수 진입부에서 `kind` 검사.

**과거 시도된 잘못된 접근 (반복 금지)**:
- ❌ 옵션 A — oxc-parser 를 type-only import 로만 유지. 사용자 거부 ("0.25 keyKind 이후 소스 100% 제거가 목표")
- ❌ 옵션 C — cli 안에 자체 structural type (~150 줄) 정의. 사용자 거부 ("자체 구조를 정의하냐고 개 호로새끼야")
- ❌ Extract 유틸리티 (`Extract<Node, { type: 'X' }>`) — oxc 의 Function umbrella 타입과 호환 안 됨

**올바른 접근**: gildash 가 이미 `Node` / `Visitor` / `visitorKeys` 를 re-export 한다 (Item 122 확정). 부족한 게 발견되면 길대시 측 패치 요청 (Item 137).

**검증**:
```
bunx tsc --noEmit
bun run test:unit && bun run test:integration && bun run test:e2e
grep -rn "from 'oxc-parser'" packages/cli/src/compiler/analyzer/parser/ast-node-locator.ts
# → 0 matches
```

### 0.5 catalog 상태

`package.json` 루트 catalog 현재 상태:
```jsonc
{
  "@zipbul/gildash": "0.26.0",
  "oxc-parser": "0.127.0"
}
```

`packages/cli/package.json` 의 dependencies 에 `"oxc-parser": "catalog:"` 가 **여전히 명시**되어 있다. Step 9 에서 동시 제거한다 — 그 이전 단계는 transitive 도 직접 명시도 모두 허용 (단계적 마이그레이션 범위).

### 0.6 심층 리뷰 결과 (2026-04-28, 3개 Explore 에이전트 병렬 검증)

본 섹션은 다음 에이전트가 작업 중 마주칠 **확정된 블로커·갭** 를 모은다. 각 항목은 실제 코드 인용 검증 완료.

#### 0.6.1 gildash 0.26 export surface — 검증 결과

- ✅ `Node` / `Program` / `Visitor` / `visitorKeys` / `VisitorObject` re-export — **oxc-parser 의 동일 타입을 그대로 re-export** (alias 가 아니라 실제 동일 reference). 따라서 narrow 타입 (`Class`, `CallExpression` 등) 은 `Node` union 으로 받은 뒤 `node.type === 'Class'` 같은 in-line 가드로 좁히는 게 정공법.
- ✅ `extractSymbols` — `ExtractedSymbol` 에 `members`, `decorators`, `heritage`, `modifiers`, `parameters`, `span` 모두 포함.
- ✅ `extractRelations` — relation `kind` 종류는 **`'imports' | 'type-references' | 're-exports' | 'calls' | 'extends' | 'implements'` (6종)**. Section N 표가 3종만 표기했었는데 6종으로 확장 가능 (Step 5/7 의 heritage 추출에 `'extends'`/`'implements'` 활용 가능).
- ✅ `findPattern` — ast-grep 문법, `PatternMatch[]` (line/column/offset/matchedText/captures).
- ✅ `parseSource` — `Result<ParsedFile, GildashError>`, `ParsedFile = { filePath, program, module, errors, comments, sourceText }`.
- ⚠️ **Walker 추상화 부재** — pre/post 훅 없는 raw oxc Visitor 만 노출. cli 의 `walkChildren` 폐기 시 직접 `visitorKeys` 위에 재귀 작성 필요 (Step 3b 에 명시).

#### 0.6.2 Step 분할 재검토 — 블로커

| Step | 블로커 | 결정 |
|---|---|---|
| 4 | `expression-converter.ts` 의 `buildImportMap()` 이 oxc `StaticImport` / `ImportNameKind` 의 raw 구조에 직접 의존. gildash `extractRelations` 는 binding 단위 relation tuple 을 주지만 `entry.importName.kind === 'Name'` 같은 enum 값에 1:1 대응되지 않음. **Step 2 의 `extractRelations` 산출물을 그대로 소비하도록 재설계** 또는 cli 측에서 relation tuple → import map 변환 헬퍼 신설 필요. 단순 type 교체로는 불가. |
| 7 | `middleware-augment-extractor.ts` 가 `TSType` 사용 (제네릭 함수 시그니처 캡처). gildash 미노출. **메인테이너 요청 (Item 137-a) 또는 string 기반 폴백** 결정 필요. |
| 3b | 17 파일 모두 narrow oxc 타입을 함수 파라미터로 받는다. gildash 의 `Node` union + in-line `kind` 가드로 변환 가능 (drop-in 별칭은 없음). 즉 단순 import 교체가 아니라 **시그니처 일반화 + 진입부 가드 추가**. |

#### 0.6.3 Section A~N 갭 5건 — 신규 책임 추가

심층 리뷰로 확인된 zipbul 본체 contract 누락:

- **Item 48b (신규, Section C)**: Adapter 인스턴스의 `clusterStrategy` 속성 추출 — 미명시 시 `ClusterStrategy.Shared` 기본. `packages/core/src/adapter/adapter.ts:104` + `packages/common/src/adapter/types.ts:39-55` 근거.
- **Item 54b (신규, Section D)**: `defineAdapter()` 인자의 `provides?: readonly ContextKey<unknown>[]` 추출 — 어댑터가 핸들러에게 제공하는 Context 키 선언. `packages/common/src/adapter/define-adapter.ts:42-43` 근거. `dist/peer-contract.json` (Item 69) 에 포함.
- **Item 54c (신규, Section D)**: Adapter 클래스 생성자 옵션 파라미터 타입 추출 (예: `HttpServerOptions`). 단순 시그니처 검증 (Item 44) 을 넘어 *옵션 schema 자체* 를 manifest 에 emit. `packages/http-adapter/src/http-adapter.ts:64` 근거.
- **Item 58 보강 (Section E)**: `dist/context-augments.d.ts` 의 *내용 형식* 명시 누락. 템플릿: `declare module '<adapter-package>' { interface <ContextType> { <augmentedProp>: <BaseType> & <Augment>; ... } }`. 모든 built-in 미들웨어의 `PropAugment` (path + RHS class/method) 머지. `packages/cli/src/compiler/analyzer/parser/middleware-augment-extractor.ts` 의 PropAugment 추출 결과 소비.
- **Item 20 정정**: 데코레이터 카테고리 "controller / method / option / param" 중 **param 모호** — `AdapterEntryDecorators` (`packages/common/src/adapter/types.ts:18-30`) 는 `controller` / `handlers` / `options` 만 정의, *param-level* 데코레이터는 어댑터 entry 가 아니라 provider 생성자 (`@Inject`) 로 별도 추출 경로. 본 카테고리 표기를 "controller / method / option" 으로 축소하고, provider 생성자 param 데코레이터는 Section B 의 `extractSymbols.parameters[*].decorators` 로 별도 처리 명시.

#### 0.6.4 메인테이너 요청 후보 (gildash 측)

- **Item 137-a (신규)**: `TSType` (generic type signature 노드) 의 길대시 노출 — Step 7 `middleware-augment-extractor` 차단. 또는 cli 측 string-level 폴백 (제네릭 `<T>(...)` regex) 결정 필요.
- **Item 137-b (신규)**: `extractRelations` relation 의 binding 메타에 oxc `ImportNameKind` 등가 정보 (Name / Default / Namespace) 노출 — Step 4 차단 해소.
- (둘 중 하나라도 보강되면 Step 4·7 의 "재설계" 부담이 "단순 교체" 로 떨어진다.)

### 0.7 사용자 협업 원칙 (메모리 동기화)

- 검증 없이 추측을 사실처럼 보고하지 말 것 (`feedback_no_unverified_claims`).
- 측정하지 않은 성능 주장 금지 (`feedback_no_unverified_claims`).
- 테스트 실패 시 분기/폴백으로 땜질 금지, 근본 원인 해결 (`feedback_no_patchwork`).
- 근거 없는 추상화 레이어 금지 (`feedback_no_groundless_abstraction`).
- JSDoc 어노테이션을 빌드 지시자로 제안 금지 (`feedback_no_annotation_magic`).
- 검토 요청 시 임의 수정/구현 계획 금지 (`feedback_review_only`).

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
41. ⬜ Decorator 카테고리별 최소 1개 — controller 1+, method 1+ (option/param 0 허용)
42. ⬜ Phase 이름 중복 없음
43. ⬜ Step 이름 중복 없음
44. ⬜ Adapter 생성자 시그니처: 옵션 객체 1개 인자 (또는 무인자) 만 허용
45. ⬜ `package.json` 의 `main` / `module` / `types` / `exports` 정합성
46. ⬜ peer dependency 버전 범위 명시 여부
47. ⬜ `package.json.zipbul.kind === "adapter"` 가 누락되면 hard error
48. ⬜ Manifest 출력 경로가 `files` 필드에 포함되는지
48b. ⬜ Adapter 인스턴스의 `clusterStrategy` 속성 추출 — 미명시 시 `ClusterStrategy.Shared` 기본. 근거: `packages/core/src/adapter/adapter.ts:104` + `packages/common/src/adapter/types.ts:39-55`. `dist/peer-contract.json` 에 포함.

## D. Type 처리

49. ⬜ Context interface 의 namespace property 타입 → JSON-friendly schema 변환
50. ⬜ 제네릭 타입 파라미터 보존
51. ⬜ 메서드 overload 시그니처 모두 보존
52. 🔵 Built-in 미들웨어의 `PropAugment` 추출 (path + RHS class/method) — cli 측 인프라 있음
53. ⬜ Type-only import 추적 (declaration merging 의 import source 해상)
54. ⬜ tsconfig 의 `paths` alias 정규화 후 모듈 식별
54b. ⬜ `defineAdapter()` 인자의 `provides?: readonly ContextKey<unknown>[]` 추출 — 어댑터가 핸들러에게 제공하는 Context 키 선언. 근거: `packages/common/src/adapter/define-adapter.ts:42-43`. `dist/peer-contract.json` (Item 69) 에 포함.
54c. ⬜ Adapter 클래스 생성자 옵션 파라미터 타입 추출 — 단순 시그니처 검증 (Item 44) 을 넘어 *옵션 schema 자체* 를 manifest 에 emit. 근거: `packages/http-adapter/src/http-adapter.ts:64` (`HttpServerOptions`). `dist/peer-contract.json` 또는 `dist/adapter-constructor-schema.json` 신규 manifest 에 배치 (Section F 결정 필요).

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
67. ⬜ `dist/decorator-schema.json` — controller / method / option / param 분류 별 데코레이터 이름 + 인자 schema + import path.
68. ⬜ `dist/builtins.json` — 내장 미들웨어 / 가드 / 필터 메타 (augments + contextOps + 등록 phase + factory ref).
69. ⬜ `dist/peer-contract.json` — `defineAdapter` 가 의존하는 `@zipbul/core` / `@zipbul/common` 심볼 (consumer rank step 등) 의 사용 흔적.
70. ⬜ JSON 키 순서 결정적 정렬 (canonical serialization).
71. ⬜ 모든 manifest 의 `$schemaName` 필드로 형식 자기 식별.

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
122. 🟡 AST 노드 타입은 길대시 re-export (`Program`, `Node`, `Visitor`, `visitorKeys`, `VisitorObject`) 만 사용. 길대시가 노출하지 않는 raw oxc 타입 (`Class`, `CallExpression`, `Function`, `MethodDefinition`, `Expression`, `MemberExpression`, `VariableDeclaration`, `ExportNamedDeclaration`, `ExportDefaultDeclaration`, `ModuleExportName`, `StaticImport`, `ImportNameKind`) 은 길대시 고수준 API (`extractSymbols`, `extractRelations`, `patternSearch`) 로 흡수. **Step 3b~8 진행 중**.
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

### 메인테이너 요청 후보 (심층 리뷰 2026-04-28 신규)

131. ⬜ **`TSType` 노출 요청 (Item 137-a)** — 제네릭 함수 시그니처 캡처용. Step 7 `middleware-augment-extractor.ts` 차단 해소. 대안: cli 측 string-level 폴백 (제네릭 `<T>(...)` regex). 결정 필요.
132. ⬜ **`extractRelations` binding 메타 강화 (Item 137-b)** — oxc `ImportNameKind` 등가 정보 (Name / Default / Namespace) 노출. Step 4 `expression-converter.ts:buildImportMap` 의 raw `StaticImport` 의존 해소. 대안: cli 측 relation tuple → import map 변환 헬퍼 신설.

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

136 항목 (128 책임 + 5 신규 (21b·48b·54b·54c + Item 58 보강) + 4 메인테이너 협력 (129·130·131·132)) + 인수인계 섹션 (0).

- 0 (인수인계): 진행 상태 + Step 3b 컨텍스트 + **0.6 심층 리뷰 결과 (gildash 표면 검증 + Step 분할 블로커 + Section 갭 5건 + 메인테이너 요청 2건)** + 사용자 협업 원칙.
- A~L (1–113 + 21b·48b·54b·54c): 어댑터 패키지 빌드 시점 책임. **현재 9 ✅, 4 🔵, 104 ⬜** — Step 10 본체 진입 전.
- M (114–119): 사용자 앱 빌드 측 manifest 소비 짝 contract — Step 11.
- N (120–132): AST 분석 인프라 정책 — `@zipbul/gildash` 단일 진입점. **현재 4 ✅, 1 🟡, 8 ⬜** (메인테이너 요청 2건 포함).

**총 진행률**: ✅ 13 / 🟡 1 / 🔵 4 / ⬜ 118. 약 10%.

**다음 에이전트가 즉시 시작할 작업**: Step 3b. Section 0.4 의 컨텍스트 + Section 0.6.1 의 gildash surface (`Node` 는 oxc 와 동일 reference, narrow 타입은 `node.type === 'X'` 가드) + Section 0.6.2 의 Step 분할 블로커 (Step 4·7 은 메인테이너 요청 결정 후 착수) 를 먼저 읽을 것.

근거는 모두 zipbul 본체 contract 또는 컴파일러 표준 책임. 새 항목 도입은 zipbul 본체 코드 라인 인용 후 추가.
