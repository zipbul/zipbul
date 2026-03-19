# Gildash 업그레이드 계획: 0.8.2 → 0.10.0

> 작성일: 2026-03-19
> 실제 업그레이드: `@zipbul/gildash` 0.10.0 (0.10.0에 Phase 8, 9, 12 선행 API 포함)
> 구현 완료: Phase 0~4-A, 7~12 (3-B 제외)
> 미구현: Phase 3-B (벤치마크 결과 불필요), 5, 6 (향후 작업)

---

## 0. 버전 업그레이드 + 즉시 수혜

### 작업

`packages/cli/package.json`에서 `"@zipbul/gildash": "0.8.2"` → `"0.9.4"` 변경 후 `bun install`.

### Breaking Change

없음. 기존 API 시그니처 동일.

### 즉시 수혜

**버그 수정 (v0.9.1-0.9.2):**

- reader→owner 승격 시 `ctx.role` 미갱신 + heartbeat 타이머 미정리
- fullIndex 경로에서 파일 읽기 실패 추적 누락
- closed 인스턴스 에러 메시지 비표준
- `searchByQuery` regex 옵션에서 결과가 `limit`보다 적고 전체 레코드가 `limit*100` 초과 시 빈 배열 반환
- `searchAnnotations` whitespace-only 텍스트로 FTS5 크래시
- null byte가 SQLite로 전달되어 "unterminated string" 에러

**성능 개선 (v0.9.1):**

- symbol/annotation/changelog INSERT 배치화
- 이진탐색 JSDoc 코멘트 연결 (extractSymbols)
- progressive regex fetch 전략 (고정 5000행 over-fetch 제거)
- `getQualifiedName`에서 O(n²) unshift → push+reverse

**DB 마이그레이션:**

- `0006_annotations`, `0007_symbol_changelog` 자동 적용 (`Gildash.open()` 시)
- `.gildash/` 디렉토리는 이미 `.gitignore`에 포함

### 신규 API (0.9.0+)

| 메서드 | 설명 |
|--------|------|
| `searchAnnotations(query: AnnotationSearchQuery)` | FTS5 기반 코멘트 annotation 검색 |
| `getSymbolChanges(since, options?)` | 심볼 변경 이력 조회 (rename/move 감지 포함) |
| `pruneChangelog(before)` | 오래된 changelog 엔트리 정리 |

신규 타입: `AnnotationSource`, `ExtractedAnnotation`, `AnnotationSearchQuery`, `AnnotationSearchResult`, `SymbolChange`, `SymbolChangeType`, `SymbolChangeQueryOptions`

### 테스트

- 기존 테스트 전체 통과 확인 (`bun test packages/cli/`)
- dev/build 명령 수동 실행 → gildash 초기화 정상 확인
- `.gildash/` DB 마이그레이션 자동 적용 확인

---

## 1. `pruneChangelog()` — Dev 세션 메모리 관리

장시간 dev 세션에서 `0007_symbol_changelog` 테이블 무한 성장 방지.

`packages/cli/src/bin/dev.command.ts` — dev 서버 최초 부트 시, `rebuild()` 직후 1회 호출.

```typescript
const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);
ledger.pruneChangelog(ONE_DAY_AGO);
```

### 테스트

- `pruneChangelog` mock 추가 (`cli-dev.test.ts`)
- 최초 부트 시 호출되는지 확인
- 에러 발생 시 dev 서버가 중단되지 않는지 확인

---

## 2. Dev 모드 — Watch Loop 최적화

### 2-A. `getSymbolChanges()` 진단 로깅

`onIndexed` 콜백에서 rename/move 감지 정보를 개발자에게 표시.

```typescript
// onIndexed 콜백 내부 — 개발자 피드백 강화
const changes = ledger.getSymbolChanges(lastRebuildTime);
const renames = changes.filter(c => c.changeType === 'renamed');
if (renames.length > 0) {
  renderer.info(`Renamed: ${renames.map(r => `${r.oldName} → ${r.symbolName}`).join(', ')}`);
}
```

#### 테스트

- `getSymbolChanges()` rename 로깅 정상 출력 확인
- `getSymbolChanges()` 호출 실패 시 dev 서버 중단 없음 확인

### 2-B. Cycle Detection 조건부 스킵

import 구조가 바뀌지 않았으면 `hasCycle()` 호출을 스킵.

```typescript
const importsChanged = changedFiles.some(file => {
  const oldAnalysis = oldFileAnalysisCache.get(file);
  const newAnalysis = fileCache.get(file);
  return JSON.stringify(oldAnalysis?.imports) !== JSON.stringify(newAnalysis?.imports);
});

if (importsChanged) {
  const hasCycle = await ledger.hasCycle();
}
```

#### 테스트

- import 구조 변경 시 → cycle detection 실행 확인
- import 미변경 시 → cycle detection 스킵 확인
- 새 파일 추가 시 → cycle detection 실행 확인

---

## 3. ModuleGraph — 배치 Gildash 호출 최적화

### 3-A. `validateProviderImplementations()` 배치화

`module-graph.ts` line 637-669에서 모든 provider에 대해 `getFullSymbol()` + `getImplementations()` 개별 호출 (provider 100개 → 200+ gildash 왕복, ~150ms).

`searchSymbols({ kind: 'interface', isExported: true })` 1회 배치 조회 → Set lookup으로 교체. ~150ms → ~20ms.

#### 테스트

- 인터페이스 provider → 기존과 동일한 검증 결과
- 클래스 provider → getImplementations 호출 스킵 확인

### 3-B. `searchSymbols({ decorator })` 컨트롤러 발견

`registerControllers()` (line 740-756)에서 전체 `classDefinitions` 순회를 `searchSymbols({ decorator: controllerName, kind: 'class' })` 직접 조회로 교체.

제한사항: `decorator` 필드는 이름으로만 매칭. 인자 필터링 불가. 현재 `registerControllers()`는 인자를 검사하지 않으므로 영향 없음.

### 3-C. Adapter Definition Resolver 최적화

`adapter-definition-resolver.ts`에서 triple-nested iteration을 `searchSymbols({ decorator })`로 controller 후보 직접 조회하여 O(n²) → O(n).

난이도 중간 — adapter resolver 내부 구조 리팩토링 동반.

---

## 4. Build 모드 — 빌드 타임 검증 강화

### 4-A. DI Token 타입 호환성 검증

useClass/useExisting 토큰이 올바른 인터페이스를 구현하는지 `getImplementations()`로 빌드 타임 검증.

제한사항:
- semantic 모드 필수 (현재 사용 중이나 fallback 경로 존재)
- 인터페이스/추상 클래스에만 동작
- string 토큰 불가 (`provide: 'CONFIG'`)

#### 테스트

- 클래스가 인터페이스를 `implements`로 구현 → 검증 통과
- 클래스가 인터페이스 미구현 → warning 발생
- string 토큰 → 검증 스킵
- semantic 모드 비가용 → graceful skip

---

## 5. `findPattern()` — 정책 자동 강제

Zipbul 핵심 원칙 "런타임 리플렉션 절대 금지"를 빌드 타임에 ast-grep 패턴으로 강제.

```typescript
const patterns = [
  'import "reflect-metadata"',
  'import { $$$ } from "reflect-metadata"',
  'import * as $_ from "reflect-metadata"',
];
```

제한사항: `findPattern()`은 비동기. dynamic `import()` 감지는 별도 패턴 필요.

---

## 6. 크로스패키지 Deep Import 검증

CLAUDE.md 정책 "deep import(`@zipbul/*/src/`) 금지"를 빌드 타임에 강제.

gildash `RelationSearchQuery`에 패턴 매칭 구현 확정. `dstFilePathPattern`으로 deep import 위반을 직접 조회:

```typescript
const violations = ledger.searchRelations({
  type: 'imports',
  dstFilePathPattern: '**/packages/*/src/**',
});

for (const rel of violations) {
  const srcPkg = extractPackageName(rel.srcFilePath);
  const dstPkg = extractPackageName(rel.dstFilePath);
  if (srcPkg !== dstPkg) {
    this.warnings.push(`Deep import violation: ${rel.srcFilePath} → ${rel.dstFilePath}`);
  }
}
```

사전 설계 결정 필요: 대상 패키지 범위, 허용 deep import, 강제 수준 (에러 vs warning).

---

## 7. Interface Catalog 확장

`interface-catalog.json`에 `getFileStats()` (lineCount, symbolCount, exportedSymbolCount, size) 추가. Build profile `full`에서만 `getFanMetrics()` (fanIn, fanOut) 추가.

---

## 8. Fingerprint 교체 — 재파싱 스킵 (gildash 선행)

gildash에 `changedSymbols[].isExported` + `changedRelations` 구현 후 착수.

`onIndexed` 콜백에서 `changedSymbols`의 `isExported: true` 변경 + `changedRelations`의 re-export 변경 여부로 재파싱 + 리빌드 스킵 판단.

### gildash API 유의사항

- **`isExported`는 변경 후 값만 제공** — `modified`에 항목이 있으면 `isExported` 무관하게 해당 파일을 검사하는 것이 안전.
- **`export *` 간접 변경은 미감지** — 문서화된 한계. periodic full rebuild 또는 기존 fingerprint fallback으로 보완.

### 구현

```typescript
const result: IndexResult = /* onIndexed callback */;

// modified는 isExported 무관하게 전부 변경으로 간주 (이전 값 미제공)
const hasExportedChange = result.changedSymbols.modified.length > 0
  || result.changedSymbols.added.some(s => s.isExported)
  || result.changedSymbols.removed.some(s => s.isExported);

const hasReExportChange = result.changedRelations.added.some(r => r.type === 're-exports')
  || result.changedRelations.removed.some(r => r.type === 're-exports');

if (!hasExportedChange && !hasReExportChange) {
  // fast path: 재파싱 + 리빌드 스킵
} else {
  // 기존 fingerprint 플로우
}
```

`export *` 간접 변경 보완: N회 리빌드마다 1회 full fingerprint 검증 실행.

---

## 9. useFactory 파라미터 타입 검증 (gildash 선행)

gildash에 `isTypeAssignableTo()` + `isTypeAssignableToAt()` 구현 후 착수.

### gildash API 유의사항

- **`isTypeAssignableTo()` 반환 타입은 `boolean | null`** — `null`은 tsc 해석 실패. 검증 스킵 처리.
- **파라미터 레벨 비교는 `isTypeAssignableToAt()` 사용** — 심볼 레벨 API로 부족한 경우 position 기반 API로 정밀 비교.

### 구현

```typescript
for (let i = 0; i < injectTokens.length; i++) {
  const compatible = this.gildash.isTypeAssignableToAt(
    injectTokenFilePath, injectTokenPosition,
    factoryFilePath, factoryParamPosition,
  );

  if (compatible === false) {
    this.warnings.push(
      `Factory '${factoryName}': inject[${i}] type mismatch`
    );
  }
  // compatible === null → tsc 해석 실패, 스킵
}
```

---

## 10. 미사용 Provider 감지

gildash 불필요. AOT 컴파일러 내부 데이터(`classDefinitions`, `ModuleGraph.providers`, `constructorParams`, `injectCalls`)로 구현.

등록된 provider 토큰 집합과 참조된 토큰 집합의 차집합 = 미사용 provider → warning.

controller, lifecycle hook provider는 제외 처리 필요.

---

## 11. DI Signature Hash Early Cutoff

gildash 불필요. AOT 컴파일러 내부 리팩토링.

`ModuleGraph.build()`를 `buildStructure()` (population) + `validate()` (검증)로 분리. 모듈별 DI signature (providers, tokens, deps, scope, controllers, exports) hash 비교. 이전 빌드와 동일하면 validate + 코드 생성 스킵.

업계 사례: Dagger/Hilt (isolating + aggregating), TypeScript incremental (version + signature 이중 해시), Rust 컴파일러 (red-green early cutoff).

효과: DI 미변경 시 리빌드 ~70% 단축.

---

## 12. 빌드 캐싱

`getTransitiveDependencies(entryPoint)`로 도달 가능 파일 목록 획득 (imports + type-references + re-exports 포함). 각 파일의 `contentHash` 비교 → 변경된 파일만 파싱, 나머지는 `.zipbul/file-analysis-cache.json`에서 로드.

FileAnalysis는 JSON 직렬화 안전 (모든 데이터가 primitives + plain objects + arrays).

tsconfig.json 변경 시 전체 캐시 무효화 필요.

---

## 테스트 Mock 업데이트

```typescript
const makeGildashLedgerMock = () => ({
  // 기존 mock 유지...
  pruneChangelog: mock((_before: unknown) => 0),
  getSymbolChanges: mock((_since: unknown, _opts?: unknown) => []),
  searchSymbols: mock((_query: unknown) => []),
  findPattern: mock(async (_pattern: unknown, _opts?: unknown) => []),
  searchAllRelations: mock((_query: unknown) => []),
  isTypeAssignableTo: mock(() => true),
  isTypeAssignableToAt: mock(() => true),
});
```

---

## 실행 순서

| 순서 | Phase | 작업 | 난이도 | 효과 |
|------|-------|------|--------|------|
| 1 | 0 | 버전 업그레이드 | 매우 낮음 | 버그/성능 즉시 수혜 |
| 2 | 1 | `pruneChangelog()` | 매우 낮음 | 장기 세션 안정성 |
| 3 | 2-A | `getSymbolChanges()` 진단 로깅 | 낮음 | 개발자 피드백 강화 |
| 4 | 2-B | Cycle detection 조건부 스킵 | 낮음 | ~20-50ms 절약 |
| 5 | 3-A | validateProviderImplementations 배치화 | 낮음 | ~130ms 절약 |
| 6 | 5 | findPattern() 리플렉션 금지 | 낮음 | 정책 자동 강제 |
| 7 | 3-B | searchSymbols 컨트롤러 발견 | 낮음 | 스케일링 개선 |
| 8 | 4-A | DI 타입 호환성 검증 | 중간 | 런타임 에러 → 빌드 에러 |
| 9 | 6 | 크로스패키지 deep import 검증 | 중간 | 아키텍처 규칙 강제 |
| 10 | 7 | Interface catalog 확장 | 낮음 | 다운스트림 도구 지원 |
| 11 | 3-C | Adapter resolver 최적화 | 중간 | O(n²)→O(n) |
| 12 | 8 | fingerprint 교체 (재파싱 스킵) — gildash `isExported` + `changedRelations` 선행 (구현 확정) | 중간 | dev 체감 속도 대폭 향상 |
| 13 | 9 | useFactory 파라미터 타입 검증 — gildash `isTypeAssignableTo()` / `isTypeAssignableToAt()` 선행 (구현 확정) | 중간 | 런타임 에러 → 빌드 에러 |
| 14 | 10 | 미사용 provider 감지 (AOT 컴파일러 내부 데이터) | 낮음 | 데드 코드 발견 |
| 15 | 11 | DI Signature Hash early cutoff | 중간 | 리빌드 ~70% 단축 |
| 16 | 12 | 빌드 캐싱 (`getTransitiveDependencies()` + FileAnalysis 캐시) | 중간 | 후속 빌드 가속 |
