# gildash 0.28.0 → 0.34.2 적용 계획 (초안)

## 0. 결론 요약

- d.ts 공개 타입은 0.28 ↔ 0.34.2 **동일**(파괴적 변경 없음). 8개 릴리스 변경은 전부 신규 메서드 추가 + 동작/구현 수정.
- 신규 API(0.29~0.34.0) **거의 전부가 우리와 다른 소비자**(dataflow/dead-store 바인딩 해석, tsc 타입 질의) 대상 → 우리 CLI(구조 추출 AOT)와 직교.
- 우리에게 직접 의미 있던 단 하나(0.34.2 depth-cap)는 **이미 업그레이드 완료**.
- 실제 leverage 지점은 좁다: **#3(싸고 정확성 이득)** 즉시, **#1(레저 배선)** 별도 설계, 나머지 채택 근거 없음.

## 1. 버전별 변경 (릴리스 노트 원문 기준)

| 버전 | 변경 | 소비자 |
|---|---|---|
| 0.29.0 | `getEnrichedReferences` — tsc 바인더 기반 바인딩(writeKind/isAmbient/enclosingScope), var 호이스팅 오탐 해결 | dataflow |
| 0.30.0 | `getFileBindings` — 파일 1-pass 바인딩(~150×) | dataflow |
| 0.31.0 | `getFileBindingsBatch` + `notifyFileChanged/Deleted` public·멱등 | ad-hoc 소스 |
| 0.32.0 | `getStandaloneFileBindings` — 격리 단일파일 program, O(file)(~1ms vs ~210ms) | 테스트 픽스처 |
| 0.33.0 | span 타입 프리미티브: `getExpressionTypeAtSpan`/`isThenableAtSpan`/`getContextualCallReturnsAtSpan` + `ByteSpan` | 타입 질의 |
| 0.34.0 | `isTypeAssignableToTypeAtSpan` + `getHeritageChain` 절대경로 정규화 픽스 | 타입 질의 |
| 0.34.1 | 내부 하드닝(공개 API 무변경): 파일/그래프 질의 API 절대경로 정규화, `RelPath` 브랜드, guard 프리미티브, 데드코드 제거 | 전 소비자 |
| 0.34.2 | `convertExpression` depth-cap 8→64 + `reason:'depth-cap'` | **우리** |

## 2. Leverage 지점 (우선순위)

### #3 — depth-cap 복구 (즉시, 싸고 무조건 이득) ✅ 채택 후보
- 위치: `cli/src/compiler/analyzer/expression-value-to-zipbul-ir.ts:170`
- 현재: 모든 unresolvable → `{ [ZIPBUL_UNRESOLVABLE]: true, sourceText }` 로 뭉갬.
- 0.34.2가 준 `ExpressionUnresolvable.reason === 'depth-cap'` 분기 추가 → `sourceText` 재파싱으로 값 복구.
- 효과: "재귀 한계로 잘림" vs "문법 미지원" 구분, 손실 케이스 복구 가능.
- 규모: 3~5줄 + TDD(RED: depth-cap 노드가 unresolvable로 떨어지는 픽스처 → GREEN: 복구).

### #1 — enum re-export 추적 → `resolveSymbol` (최대 갭, 아키텍처 게이팅) ⏸ 보류
- 위치: `cli/src/compiler/analyzer/adapter/enum-type-resolver.ts` `findEnumMemberMap`(~85줄).
- 손수 구현(reExports 재귀 + as-alias + `export *` + `./dir`→index.ts + 사이클)이 정확히 gildash `resolveSymbol`의 `reExportChain`/`originalFilePath`/`circular`.
- README 헤드라인 기능. 적용 시 `findEnumMemberMap` + `reExportLocalName` + `scanAllForEnum` + 수동 dir/index 탐색(~120줄) 제거 가능.
- **블로커**: 이 경로(`phase-key-resolver`)는 외부 어댑터 패키지를 on-demand `AstParser`로 보는 계층이라 `Gildash` 레저가 스코프에 없음. 레저를 이 계층까지 배선해야 가능 → 드롭인 아님, 별도 설계 작업.

### 미사용 신규 API (현 단계 채택 근거 없음)
- `searchRelations({ type: 're-exports' })`, `getModuleInterface`, `batchParse`, semantic 계열(`getResolvedType`/span 타입 질의) — 전부 레저/tsconfig 전제. #1 배선 시 재검토.

### #2 — `resolvePath`(bare specifier·dist→source) ❌ 교체 불가, 유지
- gildash에 standalone `resolveModuleSpecifier` export 없음. 우리 건 zipbul dist→source 리매핑까지 수행.

## 3. 실행 순서 (제안)
1. (지금) gildash 0.34.2 의존성 업그레이드 — **완료**, depth-cap 정상 파싱 검증됨.
2. #3 depth-cap 복구 TDD — 소규모, 정확성 이득. (다음 후보)
3. #1 레저 배선 — 별도 설계/삼자리뷰 필요. 본 작업과 분리.
