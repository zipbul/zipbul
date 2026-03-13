# Plan: Gildash 0.8.2 최대 활용 CLI 리팩토링

## 목표

`@zipbul/gildash` 0.8.2의 전체 API를 최대한 활용하여 CLI의 기능, 성능, 안정성을 끌어올린다. Dev와 Build의 검증 수준 격차를 해소하고, 0.8.0에서 추가된 이벤트 시스템(onError, onFileChanged, onRoleChanged)과 개선된 BatchParseResult를 적극 활용한다.

## 범위 판정

심층 리뷰 결과 일부 영역은 Gildash 대체가 **불가능**하거나 **역효과**인 것으로 판명:

| 영역 | 판정 | 근거 |
|------|------|------|
| Build BFS 파일 스캐닝 | **대체 불가** | `getTransitiveDependencies()`는 진입점 도달 파일만 반환. 현재 BFS는 모든 src/ 파일 수집 (ModuleGraph 고아 감지에 필수). Gildash는 relative path 반환 vs BFS absolute path. `resolveDistToSource()` (모노레포 워크스페이스 dist→src 매핑) Gildash 미지원. |
| `ModuleGraph.detectCycles()` | **중복 아님** | Gildash `hasCycle()`은 **파일 레벨** import 순환 감지. `detectCycles()`는 **DI 레벨** 모듈 간 provider 의존 순환 감지. 감지 대상이 다르므로 양쪽 모두 필요. |
| AstParser | **대체 불가** | 도메인 특화 메타데이터 (decorator 인자, DI 토큰, `__zipbul_ref`) 추출. Gildash는 decorator 이름만 제공. |
| AdapterDefinitionResolver | **대체 불가** | 프로퍼티 초기화 값 AST 검사 필요. Gildash 미지원. |
| Generators | **무관** | 출력 단계. Gildash 관여 없음. |

## 타입 원칙

`ledger`는 **항상 `Gildash` 타입**이다. Dev watch 모드는 `onIndexed` 콜백에 전적으로 의존하므로 Gildash 없이 Dev는 동작 불가능하다. Gildash 완전 실패 시 dev 명령 자체가 에러로 중단되며, 이는 현재 동작과 동일하다. 따라서 `Gildash | undefined` 타입이나 `undefined` 가드는 사용하지 않는다.

---

## Phase 0: 버전 업그레이드

### 0-1. @zipbul/gildash 0.8.0 → 0.8.2

**파일**: `packages/cli/package.json`

**변경**: `"@zipbul/gildash": "0.8.0"` → `"@zipbul/gildash": "0.8.2"`

**후속**: `bun install` 실행. 현재 bun 캐시가 0.7.0을 resolve하는 불일치 해소.

**0.8.0 → 0.8.2 변경사항**:
- 0.8.0: `onError()`, `onFileChanged()`, `onRoleChanged()` 이벤트 추가. `BatchParseResult` 타입 변경 (`{ parsed, failures }`). 파일 변경 감지 에러 노출, UUID 인스턴스 추적.
- 0.8.1: `ResolvedType`/`SemanticReference` 타입 배포 수정.
- 0.8.2: 소스맵 제거로 패키지 크기 54% 감소 (630KB → 287KB).

---

## Phase 1: Dev → Build 검증 격차 해소

### 1-1. Gildash 초기화를 초기 빌드 이전으로 이동 + semantic 모드

**파일**: `packages/cli/src/bin/dev.command.ts`

**현재 순서**:
```
scan → initial rebuild() → processManager.start() → Gildash init → onIndexed(재빌드)
```

**문제**: 초기 `rebuild()`는 ledger 없이 실행되어 DI 검증 (`validateProviderImplementations`, `validateInheritedScopes`, `resolveSymbol`)이 누락된다.

**변경 순서**:
```
scan → Gildash init → initial rebuild() → processManager.start() → onIndexed(재빌드)
```

**구체적 변경**:

1. **기존 Gildash 초기화 블록 삭제** (lines 407-417): `let ledger: Gildash` 선언부터 catch 블록까지 전부 제거.

2. 초기 스캔 완료 후 (`scanSpinner.stop` 이후, line 256 이후), `buildSpinner` 시작 전에 `ledger` 선언 + Gildash 초기화 삽입. **별도 스피너 추가** (semantic 모드 초기화에 시간 소요 가능):

```typescript
const gildashSpinner = renderer.startSpinner('Initializing code intelligence');
const ignorePatterns = ['dist', '.zipbul', '.gildash'];
const openGildash = deps.createGildash ?? Gildash.open;
let ledger: Gildash;
try {
  ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true });
} catch (e) {
  renderer.warn(`Semantic mode unavailable, falling back: ${e instanceof Error ? e.message : 'unknown'}`);
  ledger = await openGildash({ projectRoot, ignorePatterns });
}
gildashSpinner.stop('Code intelligence ready');
```

semantic fallback 시 **Build와 동일하게 `renderer.warn()` 출력**. non-semantic fallback도 실패하면 `openGildash()`가 throw → dev 명령 중단. 현재 동작과 동일.

**주의**: 기존 코드에서 Gildash init 실패 시 `processManager.stop()`을 호출했지만, 새 위치에서는 processManager가 아직 시작 전이므로 stop 호출 불필요.

### 1-2. rebuild()에서 ledger 활용 (closure 변수)

**파일**: `packages/cli/src/bin/dev.command.ts`

**현재** (line 142-143):
```typescript
async function rebuild(): Promise<RebuildResult> {
  const fileMap = new Map(fileCache.entries());
  const graph = new ModuleGraph(fileMap, moduleFileName, srcDir);
```

**변경**: `rebuild()` 내부에서 closure 변수 `ledger`를 직접 사용. `rebuild()`는 `dev()` 내부 함수이므로 lexical scope에서 `ledger`에 접근 가능. `rebuild()`는 정의 시점이 아니라 호출 시점에 `ledger`를 참조하므로 TDZ 문제 없음 — 호출 시점에는 `ledger`가 이미 초기화되어 있다.

```typescript
async function rebuild(): Promise<RebuildResult> {
  const fileMap = new Map(fileCache.entries());
  const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);

  graph.build();

  try {
    await graph.validateInheritedScopes();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Scope validation failed.';
    throw new DiagnosticError(buildDiagnostic({ reason }));
  }

  const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot });
  // ... 이하 기존 로직 동일
}
```

**핵심 포인트**:
- `ledger`는 `Gildash` 타입. 항상 유효한 인스턴스.
- `validateInheritedScopes()`는 raw `Error`를 throw하므로 `DiagnosticError`로 래핑
- `validateProviderImplementations()`는 `graph.build()` 내부에서 `if (this.gildash)` 조건으로 자동 호출됨 — 별도 호출 불필요

### 1-3. Dev 재빌드 시 파일 레벨 순환 import 감지

**파일**: `packages/cli/src/bin/dev.command.ts`

**위치**: onIndexed 콜백, `rebuild()` 호출 직전

**중요**: Gildash `hasCycle()`은 **파일 레벨** import 순환만 감지한다. `ModuleGraph.detectCycles()`는 **DI 레벨** 모듈 간 provider 의존 순환을 감지한다. 이 둘은 보완적이며, 둘 다 필요하다.

**변경**: `needsRebuild`일 때 파일 레벨 순환 검사 실행:
```typescript
if (needsRebuild) {
  // 파일 레벨 import 순환 감지 (경고만, 빌드 중단 안 함)
  try {
    const hasCycle = await ledger.hasCycle();
    if (hasCycle) {
      const cyclePaths = await ledger.getCyclePaths(undefined, { maxCycles: 3 });
      const summary = cyclePaths.map(c => c.join(' → ')).join('\n');
      renderer.warn(`Circular file import detected:\n${summary}`);
    }
  } catch { /* Gildash cycle 감지 실패 시 무시, ModuleGraph가 DI 레벨에서 잡음 */ }

  await rebuild();
  // ...
}
```

**설계 결정**:
- **경고(warn)**, 에러가 아님 — 파일 레벨 순환이 반드시 DI 순환은 아님. Dev에서는 비차단 경고가 적절.
- Build에서는 기존대로 파일 레벨 순환 시 에러 throw 유지 (엄격 모드).
- `needsRebuild` 블록 안에 배치 — 구조적 변경이 없으면 순환 상태도 변하지 않으므로 불필요한 검사 방지.

### 1-4. IndexResult.changedSymbols 직접 활용 — 심볼 캐시 제거

**파일**: `packages/cli/src/bin/dev.command.ts`

**현재** (lines 420-471): 초기화 시 모든 파일에 대해 `getSymbolsByFile()` 호출하여 `symbolCache` 구축. `onIndexed` 콜백에서 변경된 파일마다 `getSymbolsByFile()` + `diffSymbols()` 루프 실행.

```typescript
// 현재: 심볼 캐시 초기화 (lines 420-426)
const symbolCache = new Map<string, SymbolSearchResult[]>();
for (const filePath of fileCache.keys()) {
  try {
    symbolCache.set(filePath, ledger.getSymbolsByFile(filePath));
  } catch { /* ... */ }
}

// 현재: 파일별 diff 루프 (lines 450-471)
for (const file of result.changedFiles) {
  const before = symbolCache.get(file) ?? [];
  const after = ledger.getSymbolsByFile(file);
  const diff = ledger.diffSymbols(before, after);
  // ...
  symbolCache.set(file, after);
}
```

**발견**: `IndexResult.changedSymbols`는 `{ added: Array<{name, filePath, kind}>, modified: Array<{name, filePath, kind}>, removed: Array<{name, filePath, kind}> }` 구조. 각 항목에 `filePath` 필드 존재하여 파일별 그루핑 가능. 단, `SymbolSearchResult`가 아닌 경량 객체이며, `modified`는 `{before, after}` 쌍이 아닌 단일 항목.

**변경**: `symbolCache` 전체 제거, `getSymbolsByFile()`/`diffSymbols()` 루프 제거. `result.changedSymbols` 직접 사용:

```typescript
// 삭제 대상:
// - symbolCache 선언 및 초기화 (lines 420-426)
// - symbolCache.delete(file) (line 438)
// - 파일별 diff 루프 (lines 450-471)

// 대체:
const { added, modified, removed } = result.changedSymbols;

if (removed.length > 0) {
  const grouped = Map.groupBy(removed, (s) => s.filePath);
  for (const [file, symbols] of grouped) {
    renderer.warn(`Removed: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
  }
}
if (modified.length > 0) {
  const grouped = Map.groupBy(modified, (s) => s.filePath);
  for (const [file, symbols] of grouped) {
    renderer.info(`Modified: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
  }
}
if (added.length > 0) {
  const grouped = Map.groupBy(added, (s) => s.filePath);
  for (const [file, symbols] of grouped) {
    renderer.info(`Added: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
  }
}
```

**효과**:

- `symbolCache` (`Map<string, SymbolSearchResult[]>`) 제거 → 메모리 절약
- 초기화 시 N번 `getSymbolsByFile()` 동기 호출 제거 → 시작 시간 단축
- `onIndexed` 콜백에서 N번 `getSymbolsByFile()` + `diffSymbols()` 호출 제거 → 리빌드 루프 간소화
- `symbolCache.delete(file)` (line 438) 삭제

**주의**: `Map.groupBy`는 ES2024. Bun 1.x에서 지원됨.

### 1-5. getAffected()로 targeted rebuild 최적화

**파일**: `packages/cli/src/bin/dev.command.ts`

**현재**: `onIndexed` 콜백에서 `needsRebuild`가 true이면 **전체** `rebuild()` 실행 — 모든 파일을 다시 파싱하고 ModuleGraph를 처음부터 재구축.

**발견**: `Gildash.getAffected(changedFiles)`는 변경된 파일로부터 transitive하게 영향받는 파일 목록을 반환. 이를 활용하면 변경에 영향받는 파일만 선별하여 rebuild 범위를 좁힐 수 있다.

**변경**: `needsRebuild` 블록에서 `getAffected()`로 영향 범위를 계산하고, `rebuild()`에 affected 파일 목록을 전달:

```typescript
if (needsRebuild) {
  // 파일 레벨 import 순환 감지 (Phase 1-3)
  // ...

  // 영향 범위 계산
  const changedFiles = result.changedFiles;
  let affectedFiles: string[];
  try {
    affectedFiles = await ledger.getAffected(changedFiles);
  } catch {
    affectedFiles = []; // 실패 시 전체 rebuild fallback
  }

  // affectedFiles가 비어있으면 전체 rebuild, 아니면 targeted rebuild
  const rebuildScope = affectedFiles.length > 0
    ? new Set([...changedFiles, ...affectedFiles])
    : undefined; // undefined = 전체 rebuild

  await rebuild(rebuildScope);
  // ...
}
```

**rebuild() 시그니처 변경**:
```typescript
async function rebuild(scope?: ReadonlySet<string>): Promise<RebuildResult> {
  const fileMap = scope
    ? new Map([...fileCache.entries()].filter(([path]) => scope.has(path)))
    : new Map(fileCache.entries());
  const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);
  // ... 이하 동일
}
```

**설계 결정**:
- `getAffected()` 실패 시 빈 배열 → `rebuildScope = undefined` → **전체 rebuild fallback**. 안전성 우선.
- `changedFiles` + `affectedFiles` 합집합 = rebuild scope. 변경 파일 자체도 포함 필수.
- 초기 빌드 (`rebuild()` 첫 호출)는 scope 없이 전체 빌드 — `onIndexed` 콜백에서만 targeted rebuild 적용.
- `fileCache`에서 scope에 해당하는 파일만 추출하여 `ModuleGraph`에 전달. ModuleGraph는 전달받은 fileMap 범위 내에서만 동작.

**효과**:
- 대규모 프로젝트에서 단일 파일 변경 시 N개 파일 전체 재파싱 → affected 파일만 재파싱으로 축소
- Gildash의 import graph 정보를 활용한 정밀한 invalidation

---

## Phase 2: Gildash 이벤트 시스템 전면 활용

### 2-1. onError() 콜백 등록 (Dev + Build)

**파일**: `dev.command.ts`, `build.command.ts`

**현재**: Gildash 내부 에러 (파싱 실패, 인덱싱 에러, semantic 에러 등)가 완전 무시됨.

**Dev 변경**: Gildash 초기화 직후 `onError()` 등록:
```typescript
const unsubscribeError = ledger.onError((error) => {
  renderer.warn(`Gildash: ${error.message}`);
});
```

**Build 변경**: Gildash 초기화 직후 (line 290 이후, `try` 블록 진입 전) `onError` 등록:
```typescript
const unsubscribeError = ledger.onError((error) => {
  renderer.warn(`Gildash: ${error.message}`);
});
```

**shutdown 처리** (Dev): 기존 `unsubscribe()` (onIndexed)와 함께 호출:
```typescript
const shutdown = async (signal: string): Promise<void> => {
  // ...
  unsubscribe();          // onIndexed
  unsubscribeError();     // onError
  unsubscribeRole();      // onRoleChanged (Phase 2-2)
  try { await ledger.close(); } catch { /* cleanup 실패 무시 */ }
  process.exit(0);
};
```

**Build shutdown**: `finally` 블록에서 `close()` 전에 `unsubscribeError()` 호출:
```typescript
finally {
  unsubscribeError();
  try { await ledger.close(); } catch { /* ... */ }
}
```

### 2-2. onRoleChanged() 콜백 등록 (Dev)

**파일**: `packages/cli/src/bin/dev.command.ts`

**문제**: 다중 Gildash 인스턴스 환경(여러 터미널에서 `zb dev`)에서 owner 역할을 잃으면 reindex가 다른 인스턴스로 위임됨. 개발자가 이를 인지하지 못하면 watch 정확도 저하를 원인 모르게 겪을 수 있음.

**변경**: Gildash 초기화 직후 `onRoleChanged()` 등록:
```typescript
const unsubscribeRole = ledger.onRoleChanged((newRole) => {
  if (newRole === 'reader') {
    renderer.warn('Another instance took watcher ownership. File change detection delegated.');
  } else {
    renderer.info('Reacquired watcher ownership.');
  }
});
```

**shutdown 처리**: `unsubscribeRole()` 추가 (Phase 2-1 shutdown 코드 참조).

### 2-3. onRoleChanged 동작 주의사항

**주의**: `onRoleChanged`로 role이 `reader`가 되어도 `onIndexed` 콜백은 계속 호출된다 — reader는 owner가 수행한 인덱싱 결과를 DB에서 읽어 콜백을 발화한다. 따라서 watch 루프는 계속 동작하며, 별도 behavioral 변경(rebuild 스킵 등)은 불필요하다. 경고 로그만으로 충분.

### 2-4. onFileChanged() 제외 판정

**판정**: **제외**

`onIndexed()` 콜백과 중복 로그 발생. `onFileChanged`는 "Changed: foo.ts" 출력 후 `onIndexed`가 "Modified: FooService in foo.ts" 재출력. UX 저하.

---

## Phase 3: Build watchMode: false 최적화

### 3-1. Build에서 watchMode: false 설정

**파일**: `packages/cli/src/bin/build.command.ts`

**현재** (line 286):
```typescript
ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true });
```

`watchMode` 기본값은 `true` — Build는 one-shot 분석인데 file watcher가 불필요하게 시작됨. ownership 경쟁, heartbeat 타이머, signal handler가 모두 활성화됨.

**변경**:
```typescript
ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true, watchMode: false });
```

fallback도 동일:
```typescript
ledger = await openGildash({ projectRoot, ignorePatterns, watchMode: false });
```

**효과**:
- watcher ownership 경쟁 스킵 — 다른 `zb dev` 인스턴스와 충돌 방지
- heartbeat 타이머 (30초 간격) 미등록
- signal handler 미등록
- 초기 indexing만 수행 후 쿼리 전용 모드

**close 변경**: `cleanup: true` 옵션으로 DB 파일 정리 가능하나, **동시 실행 중인 `zb dev`가 같은 `.gildash/` DB를 사용 중이면 충돌**할 수 있다. `watchMode: false`는 ownership 경쟁만 방지할 뿐, 다른 프로세스의 열린 DB 파일을 보호하지 않는다.

따라서 `cleanup: false` (기본값) 유지:

```typescript
finally {
  unsubscribeError();
  try { await ledger.close(); } catch { /* ... */ }
}
```

향후 `--cleanup` CLI 플래그를 추가하여 사용자가 명시적으로 요청할 때만 `close({ cleanup: true })` 호출하는 것을 고려.

---

## Phase 4: Build 리포트 강화 (profile=full)

### 4-1. getFanMetrics() 코드 결합도 리포트

**파일**: `packages/cli/src/bin/build.command.ts`

**위치**: 빌드 완료 후, `renderer.outputFiles()` 직전 (line 583 부근)

**조건**: `buildProfile === 'full'` 일 때만 실행.

```typescript
if (buildProfile === 'full') {
  const filePaths = Array.from(fileMap.keys());
  const metricsResults = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        return { filePath, ...await ledger.getFanMetrics(filePath) };
      } catch {
        return null;
      }
    })
  );

  const highCoupling = metricsResults
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .filter(m => m.fanIn > 10 || m.fanOut > 8)
    .sort((a, b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut))
    .slice(0, 5);

  if (highCoupling.length > 0) {
    renderer.outputPaths('🔗 High Coupling', highCoupling.map(m => ({
      label: relative(projectRoot, m.filePath),
      value: `fan-in: ${m.fanIn}, fan-out: ${m.fanOut}`,
    })));
  }
}
```

### 4-2. getFileStats() 파일 복잡도 리포트

**파일**: `packages/cli/src/bin/build.command.ts`

**위치**: fan metrics 직후, 동일 `if (buildProfile === 'full')` 블록 내

```typescript
  const complexFiles = filePaths
    .map((filePath) => {
      try {
        return { filePath, stats: ledger.getFileStats(filePath) };
      } catch {
        return null;
      }
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .filter(f => f.stats.symbolCount > 20 || f.stats.lineCount > 500)
    .sort((a, b) => b.stats.symbolCount - a.stats.symbolCount)
    .slice(0, 5);

  if (complexFiles.length > 0) {
    renderer.outputPaths('📊 Complex Files', complexFiles.map(f => ({
      label: relative(projectRoot, f.filePath),
      value: `${f.stats.symbolCount} symbols, ${f.stats.lineCount} lines, ${f.stats.exportedSymbolCount} exports`,
    })));
  }
```

### 4-3. getStats() 프로젝트 요약 통계

**파일**: `packages/cli/src/bin/build.command.ts`

**위치**: fan metrics / file stats 블록 직후, 동일 `if (buildProfile === 'full')` 블록 내

```typescript
  try {
    const stats = ledger.getStats();
    renderer.info(`Project: ${stats.totalFiles} files, ${stats.totalSymbols} symbols, ${stats.totalRelations} relations`);
  } catch { /* 통계 조회 실패 시 무시 */ }
```

**효과**: 빌드 완료 시 프로젝트 전체 규모 한 줄 요약. `getStats()`는 인덱싱된 DB에서 집계하므로 추가 비용 거의 없음.

**표시 조건**:
- `--profile full` 일 때만 계산 및 표시
- 상위 5개 파일만 표시하여 출력 제한 (fan metrics, file stats)
- `renderer.outputPaths()` 사용 — 기존 build 출력과 동일 포맷

---

## Phase 5: interface-catalog.json 실데이터 채우기

### 5-1. getSemanticModuleInterface() / getModuleInterface()로 인터페이스 카탈로그 생성

**파일**: `packages/cli/src/bin/build.command.ts`

**현재** (line 374): `interface-catalog.json`이 빈 placeholder로 생성됨:

```typescript
const interfaceCatalogJson = JSON.stringify({ schemaVersion: '1', entries: [] }, null, 2);
```

**발견**: Gildash는 두 가지 모듈 인터페이스 API를 제공:
- `getModuleInterface(filePath)`: exported symbols의 `{ name, kind, parameters?, returnType?, jsDoc? }` — 기본
- `getSemanticModuleInterface(filePath)`: semantic 모드에서만 동작. **resolved types** 포함 — `{ name, kind, type: ResolvedType, references: SemanticReference[] }`. 타입 alias 해석, 제네릭 인스턴스화 결과까지 포함.

**변경**: semantic 모드 성공 시 `getSemanticModuleInterface()` 우선 사용, fallback으로 `getModuleInterface()`:

```typescript
if (buildProfile === 'standard' || buildProfile === 'full') {
  const catalogEntries = [];
  for (const [modulePath, moduleNode] of graph.modules) {
    try {
      // semantic 모드 성공 시 resolved types 포함 인터페이스
      const iface = semanticAvailable
        ? ledger.getSemanticModuleInterface(modulePath)
        : ledger.getModuleInterface(modulePath);
      catalogEntries.push({
        module: moduleNode.name,
        filePath: relative(projectRoot, modulePath),
        exports: iface.exports,
        semantic: semanticAvailable,
      });
    } catch {
      // getSemanticModuleInterface 실패 시 non-semantic fallback
      try {
        const iface = ledger.getModuleInterface(modulePath);
        catalogEntries.push({
          module: moduleNode.name,
          filePath: relative(projectRoot, modulePath),
          exports: iface.exports,
          semantic: false,
        });
      } catch { /* 완전 실패 시 스킵 */ }
    }
  }

  const interfaceCatalogJson = JSON.stringify(
    { schemaVersion: '2', entries: catalogEntries },
    null,
    2,
  );
  await writeIfChanged(interfaceCatalogFile, interfaceCatalogJson);
}
```

**`semanticAvailable` 플래그**: Gildash 초기화 시 semantic 모드 성공 여부를 boolean으로 저장. Build는 이미 semantic fallback 패턴이 있으므로 (lines 281-290):
```typescript
let semanticAvailable = true;
try {
  ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true, watchMode: false });
} catch {
  semanticAvailable = false;
  ledger = await openGildash({ projectRoot, ignorePatterns, watchMode: false });
}
```

**효과**:
- `interface-catalog.json`이 빈 배열 대신 실제 모듈 인터페이스 정보를 포함
- semantic 모드에서는 resolved types까지 포함 → API 문서 생성, 타입 검증 등에 활용 가능
- schemaVersion `'1'` → `'2'`로 올려 호환성 구분
- 각 entry에 `semantic: boolean` 필드로 데이터 품질 명시

**Dev에서도 동일**: dev.command.ts의 `rebuild()` 함수 내 동일 위치 (line 194-200)에서도 같은 로직 적용. Dev도 semantic 모드 fallback이 있으므로 `semanticAvailable` 플래그 동일 사용.

---

## Phase 6: Orphaned Extractors 정리

### 6-1. extractors/ 디렉토리 삭제

**삭제 대상 파일**:
- `packages/cli/src/compiler/extractors/imports.extractor.ts`
- `packages/cli/src/compiler/extractors/extends.extractor.ts`
- `packages/cli/src/compiler/extractors/implements.extractor.ts`
- `packages/cli/src/compiler/extractors/calls.extractor.ts`
- `packages/cli/src/compiler/extractors/utils.ts`
- `packages/cli/src/compiler/extractors/index.ts`
- `packages/cli/src/compiler/extractors/test/extractors.spec.ts`
- `packages/cli/test/compiler-code-relations.test.ts` (외부 테스트 파일)

**근거**:
- 외부 사용처 없음 — `ImportsExtractor`, `ExtendsExtractor`, `ImplementsExtractor`, `CallsExtractor`는 build/dev 파이프라인에서 import되지 않음
- `@zipbul/cli`는 `"private": true` — 외부 소비자 없음
- Gildash의 `searchRelations()` / `extractRelations()`이 동일 기능 제공
- 일부 extractor 파일에 `@ts-ignore` 사용 — CLAUDE.md 정책 위반 코드 제거
- 대체 테스트 불필요 — Gildash는 외부 의존성으로 자체 테스트 보유

### 6-2. 관련 타입 및 export 정리

**`packages/cli/src/compiler/interfaces.ts`**: 파일 삭제.
- 이 파일은 `CodeRelation`, `CodeRelationType`, `CodeRelationExtractor` 3개만 포함. 전부 extractors 전용이므로 파일 전체 삭제.

**`packages/cli/src/compiler/index.ts`**:
- `export * from './extractors'` 행 제거
- `export * from './interfaces'` 행 제거

**검증**: `bun run knip` 실행으로 미사용 export 없음 확인.

---

## 테스트 수정

### Dev 테스트 (`packages/cli/test/cli-dev.test.ts`)

**1. `makeGildashLedgerMock` 업데이트**:
```typescript
const makeGildashLedgerMock = () => ({
  onIndexed: mock((_cb: unknown) => mock(() => {})),
  onError: mock((_cb: unknown) => mock(() => {})),
  onRoleChanged: mock((_cb: unknown) => mock(() => {})),
  hasCycle: mock(async () => false),
  getCyclePaths: mock(async () => []),
  getAffected: mock(async (_files: string[]) => [] as string[]),
  close: mock(async () => {}),
}) as unknown as Gildash;
```

**2. 제거 대상**: `getSymbolsByFile`, `diffSymbols` mock — Phase 1-4에서 `changedSymbols` 직접 사용으로 전환되어 불필요.

**3. 인라인 `ledgerMock` 업데이트**: 개별 테스트 케이스에서 인라인으로 생성하는 ledgerMock 객체에도 `onError`, `onRoleChanged`, `hasCycle`, `getCyclePaths` 추가. `makeGildashLedgerMock()`을 spread하여 일관성 유지:
```typescript
const ledgerMock = { ...makeGildashLedgerMock(), /* 테스트별 오버라이드 */ };
```

### Build 테스트 (`packages/cli/test/cli-build.test.ts`)

Gildash mock에 `onError`, `getStats`, `getModuleInterface`, `getSemanticModuleInterface` 추가:
```typescript
const makeGildashLedgerMock = () => ({
  hasCycle: mock(async () => false),
  getCyclePaths: mock(async () => []),
  onError: mock((_cb: unknown) => mock(() => {})),
  getFanMetrics: mock(async (_file: string) => ({ filePath: _file, fanIn: 0, fanOut: 0 })),
  getFileStats: mock((_file: string) => ({ filePath: _file, lineCount: 0, symbolCount: 0, relationCount: 0, size: 0, exportedSymbolCount: 0 })),
  getStats: mock(() => ({ totalFiles: 0, totalSymbols: 0, totalRelations: 0 })),
  getModuleInterface: mock((_file: string) => ({ exports: [] })),
  getSemanticModuleInterface: mock((_file: string) => ({ exports: [] })),
  close: mock(async () => {}),
}) as unknown as Gildash;
```

### 신규 테스트 케이스

**Dev 테스트 추가**:

1. **Semantic fallback**: `createGildash`가 첫 호출(semantic)에서 throw, 두 번째 호출(non-semantic)에서 성공 → `renderer.warn()` 호출 확인.
2. **Cycle detection in watch**: `hasCycle()` → `true`, `getCyclePaths()` → `[['a.ts', 'b.ts', 'a.ts']]` → `renderer.warn()` 호출 확인.
3. **changedSymbols grouping**: `onIndexed` 콜백의 `changedSymbols.added`에 2개 파일의 심볼 → `renderer.info()` 파일별 그루핑 확인.
4. **onError forwarding**: `onError` 콜백에 mock `GildashError` 전달 → `renderer.warn()` 호출 확인.
5. **onRoleChanged logging**: `onRoleChanged` 콜백에 `'reader'` 전달 → `renderer.warn()` 호출 확인.
6. **getAffected targeted rebuild**: `onIndexed`에서 `changedFiles: ['a.ts']` → `getAffected(['a.ts'])` 호출 확인. `getAffected`가 `['b.ts']`를 반환하면 rebuild scope에 `a.ts` + `b.ts` 포함 확인.
7. **getAffected 실패 시 전체 rebuild fallback**: `getAffected` mock이 throw → rebuild가 scope 없이 (전체) 호출되는지 확인.

**Build 테스트 추가**:

1. **watchMode: false 전달**: `createGildash` mock에서 전달받은 `opts.watchMode`가 `false`인지 확인.
2. **profile=full fan metrics 리포트**: `getFanMetrics` mock이 높은 fanIn/fanOut 반환 → `renderer.outputPaths('🔗 High Coupling', ...)` 호출 확인.
3. **profile=full file stats 리포트**: `getFileStats` mock이 높은 symbolCount/lineCount 반환 → `renderer.outputPaths('📊 Complex Files', ...)` 호출 확인.
4. **profile=full project stats**: `getStats` mock 반환값 → `renderer.info()` 호출 확인.
5. **interface-catalog semantic**: semantic 모드에서 `getSemanticModuleInterface` 호출 확인 + catalog entry에 `semantic: true` 포함.
6. **interface-catalog non-semantic fallback**: `getSemanticModuleInterface` throw 시 `getModuleInterface` fallback 호출 확인 + `semantic: false`.

### Extractor 테스트 삭제

- `packages/cli/src/compiler/extractors/test/extractors.spec.ts` — 삭제
- `packages/cli/test/compiler-code-relations.test.ts` — 삭제

---

## 수정 파일 요약

| 파일 | Phase | 변경 내용 |
|------|-------|----------|
| `packages/cli/package.json` | 0 | `@zipbul/gildash` 0.8.0 → 0.8.2 |
| `packages/cli/src/bin/dev.command.ts` | 1, 2 | 기존 Gildash init 블록(407-417) 삭제, scan 후 위치에 semantic 모드 init 삽입 (스피너), rebuild()에서 closure `ledger` 전달 + `validateInheritedScopes`, 재빌드 시 cycle 감지, `changedSymbols` 직접 사용 + symbolCache 제거, `getAffected()` targeted rebuild, onError/onRoleChanged 등록, shutdown에 unsubscribe 추가 |
| `packages/cli/src/bin/build.command.ts` | 2, 3, 4, 5 | onError 등록 + finally에 unsubscribeError, `watchMode: false`, fan metrics + file stats + `getStats()` 리포트, `getSemanticModuleInterface()`/`getModuleInterface()` interface-catalog 실데이터, `semanticAvailable` 플래그 |
| `packages/cli/src/compiler/extractors/` | 5 | 디렉토리 전체 삭제 |
| `packages/cli/src/compiler/interfaces.ts` | 5 | 파일 삭제 (CodeRelation, CodeRelationType, CodeRelationExtractor만 포함) |
| `packages/cli/src/compiler/index.ts` | 5 | extractors + interfaces export 제거 |
| `packages/cli/test/cli-dev.test.ts` | 테스트 | Gildash mock에 onError, onRoleChanged, hasCycle, getCyclePaths 추가. getSymbolsByFile, diffSymbols 제거. 인라인 mock spread 통합 |
| `packages/cli/test/cli-build.test.ts` | 테스트 | Gildash mock에 onError, getFanMetrics, getFileStats, getStats, getModuleInterface, getSemanticModuleInterface 추가 |
| `packages/cli/test/compiler-code-relations.test.ts` | 5 | 파일 삭제 |

## 변경하지 않는 파일

| 파일 | 이유 |
|------|------|
| `module-graph.ts` | 이미 `gildash?` optional 파라미터로 설계됨. `detectCycles()`는 DI 레벨 순환 감지로 Gildash의 파일 레벨 감지와 상호 보완. 변경 불필요. |
| `build.command.ts` BFS 로직 | `getTransitiveDependencies()` 대체 불가 (모든 src 파일 필요, relative/absolute path 불일치, dist→source 매핑 미지원). |
| `ast-parser.ts` | 도메인 특화 파싱. Gildash 대체 불가. |
| `adapter-definition-resolver.ts` | AST 레벨 디테일 필요. Gildash 대체 불가. |
| `generators/*.ts` | 출력 단계. Gildash 무관. |

## 검증 계획

1. `cd examples && zb build` — 기존과 동일한 출력 확인 (manifest.json, runtime.ts, entry.ts 바이트 동일)
2. `cd examples && zb build --profile full` — fan metrics + file stats + project stats 리포트 출력 확인
3. `cd examples && zb build --profile standard` — `interface-catalog.json`에 실데이터 포함 확인 (entries 비어있지 않음)
4. `cd examples && zb dev` — 초기 부팅 시 "Code intelligence ready" 스피너, DI 검증 동작 확인
5. Dev 재빌드 시 `validateProviderImplementations()` + `validateInheritedScopes()` 동작 확인
6. Dev `changedSymbols` 로그 출력 확인 — 기존 파일별 diff와 동일 정보 표시
7. Dev 단일 파일 수정 → `getAffected()` 호출 후 targeted rebuild 동작 확인 (전체 파일 재파싱 아님)
8. 순환 import 의도적 도입 → Dev에서 파일 레벨 순환 경고 출력 확인
9. Gildash semantic 실패 시뮬레이션 → non-semantic fallback + `renderer.warn()` 출력 확인
10. `bun run knip` — extractors 삭제 후 미사용 코드 없음 확인
11. `bun test packages/cli` — 테스트 mock 업데이트 후 전체 통과
12. Ctrl+C → 정상 종료 확인 (unsubscribeError + unsubscribeRole 포함)
13. Build `watchMode: false` → file watcher 미시작, ownership 경쟁 없음 확인
14. Build semantic 모드 → `interface-catalog.json`에 `semantic: true` entry 확인
