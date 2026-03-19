# Gildash 업그레이드 계획: 0.8.2 → 0.9.4

> 작성일: 2026-03-19
> 현재 버전: `@zipbul/gildash` 0.8.2
> 목표 버전: `@zipbul/gildash` 0.9.4 (latest)

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

### 난이도

매우 낮음

### 테스트

- 기존 테스트 전체 통과 확인 (`bun test packages/cli/`)
- dev/build 명령 수동 실행 → gildash 초기화 정상 확인
- `.gildash/` DB 마이그레이션 자동 적용 확인

---

## 1. `pruneChangelog()` — Dev 세션 메모리 관리

### 목적

장시간 dev 세션에서 `0007_symbol_changelog` 테이블 무한 성장 방지.

### 적용 위치

`packages/cli/src/bin/dev.command.ts` — dev 서버 최초 부트 시, `rebuild()` 직후.

### 구현

```typescript
// rebuild() 최초 호출 직후 1회
const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);
ledger.pruneChangelog(ONE_DAY_AGO);
```

### 난이도

매우 낮음 (1-3줄)

### 테스트

- `pruneChangelog` mock 추가 (`cli-dev.test.ts`)
- 최초 부트 시 호출되는지 확인
- 에러 발생 시 dev 서버가 중단되지 않는지 확인 (try-catch 필요 여부)

---

## 2. Dev 모드 — Watch Loop 최적화

### 2-A. Fingerprint 최적화 (하이브리드 접근)

#### 목적

메서드 바디만 수정해도 불필요한 리빌드가 발생하는 false positive를 줄인다.

#### 현재 문제

`computeStructuralFingerprint()` (`dev.command.ts` line 61-64)가 `FileAnalysis` 전체를 `JSON.stringify`:

```typescript
function computeStructuralFingerprint(analysis: FileAnalysis): string {
  const { filePath: _, ...structural } = analysis;
  return JSON.stringify(structural);
}
```

`localValues`, `exportedValues` 등 내부 구현 세부사항까지 포함하므로, 구조적으로 무관한 변경(로컬 변수명 등)에도 fingerprint가 바뀔 수 있음.

#### ~~원래 계획: fingerprint를 gildash `diffSymbols()`로 교체~~

#### 교체 불가 사유

1. **`IndexResult.changedSymbols`에 `isExported` 필드 없음** — `{name, filePath, kind}` 3개 필드만 존재 (index-coordinator.d.ts line 39-55). export 상태 변경 감지 불가.
2. **Re-export 변경이 changedSymbols에 미반영** — `export { X } from './lib'` 변경은 심볼 추가/수정/삭제가 아니라 CodeRelation (`type: 're-exports'`) 변경. changedSymbols에 나타나지 않음.
3. **Spread bundle의 `exportedValues` 변경 감지 불가** — `exportedValues`는 AST에서 추출한 오브젝트 구조(AnalyzerValueRecord)로, gildash 심볼 시스템에 없음. spread provider 해석에 필수.
4. **Import source 변경 감지 불가** — 동일 심볼을 다른 파일에서 import하도록 변경 시 (`import { X } from './a'` → `import { X } from './b'`), 내보낸 심볼은 동일하므로 changedSymbols가 변경을 보고하지 않음.

#### ~~수정된 계획: localValues 제외~~

#### localValues 제외도 불가 사유

`localValues`는 `resolveSpreadBundle()` (`module-graph.ts` line 473, 479)에서 **직접 사용**됨:

```typescript
// module-graph.ts line 473-479
const fileAnalysis = this.fileMap.get(modulePath);
const localValues = fileAnalysis?.localValues;     // ← 직접 참조
targetValue = localValues[varName];                // ← spread 해석에 필수
```

`localValues`는 파일 내 **모든 변수 선언** (exported + non-exported)을 포함. spread bundle이 로컬 변수를 참조할 때 (`...localProviders`), `localValues`가 변경되면 provider 목록이 달라짐. fingerprint에서 제외하면 **spread bundle 변경을 감지 못해 provider 목록이 오염**됨.

예시:
```typescript
// BEFORE
const localProviders = [{ provide: 'A', useClass: ServiceA }];
// AFTER
const localProviders = [{ provide: 'A', useClass: ServiceA }, { provide: 'B', useClass: ServiceB }];
```

`localValues` 제외 시: fingerprint 동일 → 리빌드 미발생 → 구 provider 목록 사용 → **무성 버그**.

#### 현실적 대안: 현재 fingerprint 유지 + 진단 로깅만 강화

현재 `computeStructuralFingerprint()`는 **올바르게 동작**하고 있음. `localValues` 포함이 일부 false positive를 유발할 수 있으나, 제외 시 발생하는 무성 버그가 훨씬 심각. **fingerprint 로직은 변경하지 않는다.**

`getSymbolChanges()` (v0.9.0 신규)를 **진단 로깅 용도로만** 사용:

```typescript
// onIndexed 콜백 내부 — 개발자 피드백 강화
const changes = ledger.getSymbolChanges(lastRebuildTime);
const renames = changes.filter(c => c.changeType === 'renamed');
if (renames.length > 0) {
  renderer.info(`Renamed: ${renames.map(r => `${r.oldName} → ${r.symbolName}`).join(', ')}`);
}
```

#### 난이도

낮음

#### 테스트

- `getSymbolChanges()` rename 로깅 정상 출력 확인
- `getSymbolChanges()` 호출 실패 시 dev 서버 중단 없음 확인

### 2-B. DI Signature Hash 기반 Early Cutoff

#### 목적

DI 구조가 바뀌지 않았으면 검증 + 코드 생성을 스킵한다.

#### 배경 (업계 사례)

- **Dagger/Hilt (Android)**: isolating phase (per-file) + aggregating phase (graph). metadata 동일하면 aggregating 스킵.
- **TypeScript incremental**: `version` (파일 hash) + `signature` (`.d.ts` hash) 이중 해시. signature 불변이면 의존 모듈 재컴파일 안 함.
- **Rust 컴파일러 (Salsa/Red-Green)**: 입력이 바뀌어도 출력이 동일하면 하위 단계 실행 안 함 (early cutoff).
- **Go 컴파일러**: export data hash 별도 관리. export 불변이면 의존 패키지 스킵.

#### 핵심 발견

`ModuleGraph.build()` 내부의 5개 검증 함수가 **전부 read-only** — 그래프 상태를 수정하지 않음:

- `validateModuleNameUniqueness()` (line 677): `node.name` 읽기만
- `validateVisibilityAndScope()` (line 594): `node.providers` 읽기만
- `validateProviderImplementations()` (line 637): gildash 호출, 읽기만
- `validateFactoryInjectTokens()` (line 697): provider metadata 읽기만
- `detectCycles()` (line 225): DFS 순회, 읽기만

따라서 DI signature가 이전 빌드와 동일하면 이 5개 + cycle detection을 안전하게 스킵 가능.

#### DI Signature 정의

모듈별로 다음 필드만 추출하여 hash:

```typescript
interface DiSignature {
  name: string;
  providers: Array<{
    token: string;
    className?: string;
    deps: string[];          // constructor parameter types
    visibility: string;
    visibleTo?: string[];
    scope?: string;
  }>;
  controllers: string[];
  exports: string[];
}
```

`filePath`, `imports` (순환 참조), `visiting`/`visited` (런타임 상태)는 제외. 모든 필드가 JSON-serializable이고 deterministic.

#### 구현

```typescript
async function rebuild(): Promise<RebuildResult> {
  // Phase A: 그래프 구축 (항상 실행)
  const fileMap = new Map(fileCache.entries());
  const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);
  graph.buildStructure();  // population만 (lines 61-203)

  // DI signature 비교
  const currentSignatures = computeDiSignatures(graph.modules);
  const signaturesChanged = !mapsEqual(previousSignatures, currentSignatures);

  if (signaturesChanged) {
    // Phase B: 검증 + cycle detection (DI 변경 시만)
    graph.validate();  // lines 205-220
    await graph.validateInheritedScopes();

    // Phase C: adapter + 코드 생성
    const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot });
    graph.registerControllers(controllerDecoratorNames);

    // manifest + runtime.ts + entry.ts 생성
    const manifestJson = manifestGen.generateJson({ graph, ... });
    const runtimeResult = manifestGen.generate({ graph, ... });
    await writeIfChanged(join(outDir, 'manifest.json'), manifestJson);
    await writeIfChanged(join(outDir, 'runtime.ts'), runtimeResult);
    await writeIfChanged(join(outDir, 'entry.ts'), entryContent);
  }
  // DI 미변경 → Phase B, C 전체 스킵

  previousSignatures = currentSignatures;
}
```

#### `buildStructure()` 분리

현재 `build()` 메서드를 2개로 분리:

```typescript
// module-graph.ts
buildStructure(): void {
  // lines 61-203: module discovery + provider registration
}

validate(): void {
  // lines 205-220: 5개 검증 + cycle detection
}
```

기존 `build()` 호출부(`build.command.ts`)는 `buildStructure()` + `validate()`를 순차 호출하여 호환성 유지.

#### 효과

DI 미변경 시 (메서드 바디, private 필드 등 수정):
- 검증 5개 + cycle detection: **~35ms → 0ms**
- adapter resolution + 코드 생성: **~180ms → 0ms**
- 합계: **~215ms 절약** (rebuild 300ms 중 ~70%)

#### 주의사항

- `validateProviderImplementations()`는 gildash semantic 호출 포함. DI signature 동일해도 gildash symbol index가 변경되면 실행 필요. `semanticAvailable && symbolIndexChanged` 조건 추가.
- 파일 삭제 시 항상 full rebuild (기존 동작 유지).
- `previousSignatures`는 메모리에 보관, dev 서버 재시작 시 초기화.

#### 난이도

중간 (~200 LOC, `build()` → `buildStructure()` + `validate()` 분리 + signature 계산)

#### 테스트

- 메서드 바디만 변경 → DI signature 동일 → Phase B/C 스킵 확인
- provider 추가 → DI signature 변경 → full rebuild 확인
- provider scope 변경 → DI signature 변경 → full rebuild 확인
- controller 추가 → DI signature 변경 → full rebuild 확인
- 파일 삭제 → 항상 full rebuild 확인
- `previousSignatures` 비어있으면 (첫 빌드) → full rebuild 확인
- 연속 2회 동일 수정 → 2회째 스킵 확인

### 2-C. Cycle Detection 조건부 스킵

#### 목적

import 구조가 바뀌지 않았으면 `hasCycle()` 호출을 스킵한다.

#### 구현

```typescript
// fingerprint 비교 시 import 변경 여부도 별도 추적
const importsChanged = changedFiles.some(file => {
  const oldAnalysis = oldFileAnalysisCache.get(file);
  const newAnalysis = fileCache.get(file);
  return JSON.stringify(oldAnalysis?.imports) !== JSON.stringify(newAnalysis?.imports);
});

if (importsChanged) {
  const hasCycle = await ledger.hasCycle();
  // ...
}
```

#### 난이도

낮음

#### 테스트

- import 구조 변경 시 → cycle detection 실행 확인
- import 미변경 시 → cycle detection 스킵 확인
- 새 파일 추가 시 → cycle detection 실행 확인 (새 import 관계)

---

## 3. ModuleGraph — 배치 Gildash 호출 최적화

### 3-A. `validateProviderImplementations()` 배치화

#### 현재 문제

`module-graph.ts` line 637-669에서 모든 provider에 대해 `getFullSymbol()` + `getImplementations()` 개별 호출:

```typescript
for (const provider of node.providers.values()) {
  const sym = this.gildash.getFullSymbol(provider.token, lookupPath);
  const impls = this.gildash.getImplementations(provider.token, lookupPath);
}
```

Provider 100개 → 200+ gildash 왕복 (~150ms).

#### 구현

```typescript
// 1회 배치 조회로 인터페이스 목록 확보
const allInterfaces = this.gildash.searchSymbols({
  kind: 'interface',
  isExported: true,
  limit: 5000,
});
const interfaceSet = new Set(allInterfaces.map(s => s.name));

// provider 순회 시 인터페이스 여부를 Set lookup (O(1))
for (const provider of node.providers.values()) {
  if (!interfaceSet.has(provider.token)) continue;
  // 인터페이스인 경우만 getImplementations() 호출
  const impls = this.gildash.getImplementations(provider.token, lookupPath);
  // ...
}
```

#### 효과

`getFullSymbol()` N번 → `searchSymbols()` 1번 + Set lookup. ~150ms → ~20ms.

#### 난이도

낮음

#### 테스트

- 인터페이스 provider → 기존과 동일한 검증 결과
- 클래스 provider → getImplementations 호출 스킵 확인
- 인터페이스 5000개 초과 시 limit 처리 확인

### 3-B. `searchSymbols({ decorator })` 컨트롤러 발견

#### 현재 문제

`registerControllers()` (line 740-756)에서 전체 `classDefinitions` 순회:

```typescript
registerControllers(controllerDecoratorNames: readonly string[]): void {
  const nameSet = new Set(controllerDecoratorNames);
  for (const [className, def] of this.classDefinitions) {
    const isController = def.metadata.decorators.some(d => nameSet.has(d.name));
    // ...
  }
}
```

#### 구현

```typescript
if (this.gildash) {
  for (const decoratorName of controllerDecoratorNames) {
    const controllers = this.gildash.searchSymbols({
      decorator: decoratorName,
      kind: 'class',
      limit: 5000,
    });
    for (const ctrl of controllers) {
      // classMap에서 모듈 노드 조회 후 등록
    }
  }
} else {
  // fallback: 기존 수동 순회
}
```

#### 제한사항

`searchSymbols({ decorator })` — **데코레이터 인자 필터링 불가**

`decorator` 필드는 데코레이터 **이름**으로만 매칭 (symbol-search.d.ts line 23-27). `@Injectable()`과 `@Injectable({ scope: 'request' })`를 구분할 수 없음. 인자별 필터링이 필요한 경우 결과를 후처리해야 함.

현재 `registerControllers()`는 데코레이터 인자를 검사하지 않으므로 이 제한에 영향 없음.

#### 효과

O(전체 클래스) → O(컨트롤러 수). 대규모 프로젝트에서 유의미.

#### 난이도

낮음

#### 테스트

- 컨트롤러 데코레이터 가진 클래스만 등록되는지 확인
- gildash 미사용 시 fallback 동작 확인
- 여러 adapter에서 서로 다른 controller 데코레이터 사용 시

### 3-C. Adapter Definition Resolver 최적화

#### 현재 문제

`adapter-definition-resolver.ts`에서 triple-nested iteration:

- `collectPackageEntryFiles()` (line 132-156): 전체 fileMap 순회
- `buildControllerAdapterMap()` (line 413-464): 전체 fileMap 2회 순회
- `buildHandlerIndex()` (line 522-694): 파일 → 클래스 → 메서드 3중 순회

#### 구현

`searchSymbols({ decorator })`로 controller 후보를 직접 조회하여 순회 범위 축소:

```typescript
// 전체 fileMap 순회 대신:
for (const adapterName of adapterDecoratorNames) {
  const controllers = this.gildash.searchSymbols({
    decorator: adapterName,
    kind: 'class',
  });
  // controllers만 대상으로 handler 인덱싱
}
```

#### 효과

O(n²) → O(n). 파일 수에 비례하는 선형 탐색.

#### 난이도

중간 — adapter resolver 내부 구조 리팩토링 동반

#### 테스트

- 기존 handler index 결과와 동일한 출력 확인
- adapter 없는 프로젝트에서 빈 결과 확인
- 여러 adapter 동시 사용 시 충돌 없음 확인

---

## 4. Build 모드 — 빌드 타임 검증 강화

### 4-A. DI Token 타입 호환성 검증

#### 목적

useClass/useExisting 토큰이 올바른 인터페이스를 구현하는지 빌드 타임에 검증.

#### 현재 문제

`injector-generator.ts` (line 213-260)에서 useClass/useExisting 처리 시 타입 호환성 검증 없음. 런타임에야 잘못된 DI 와이어링 발견.

#### 구현

`getImplementations()`로 explicit implements 관계 확인:

```typescript
// ModuleGraph 검증 단계에서
if (provider.useClass && provider.token !== provider.useClass) {
  const impls = this.gildash.getImplementations(provider.token, tokenFilePath);
  if (impls && impls.length > 0) {
    const classIsImplementer = impls.some(i => i.symbolName === provider.useClass);
    if (!classIsImplementer) {
      this.warnings.push(
        `Provider '${provider.token}': useClass '${provider.useClass}' ` +
        `does not implement '${provider.token}'`
      );
    }
  }
}
```

#### 제한사항

- `getImplementations()` — **semantic 모드 필수** (`Gildash.open({ semantic: true })`). 현재 dev/build 모두 semantic 모드 사용 중이나 fallback 경로 존재.
- **인터페이스/추상 클래스에만 동작** — 일반 클래스 토큰에는 `getImplementations()`가 빈 배열 반환.
- **string 토큰 불가** — `provide: 'CONFIG'` 같은 string 토큰은 심볼 해석 불가. guard 필요.

#### 난이도

중간

#### 테스트

- 클래스가 인터페이스를 `implements`로 구현 → 검증 통과
- 클래스가 인터페이스 미구현 → warning 발생
- string 토큰 → 검증 스킵 (에러 없음)
- semantic 모드 비가용 → graceful skip
- 인터페이스가 아닌 클래스 토큰 → 검증 스킵

### ~~4-B. useFactory 파라미터 타입 검증~~

#### 절대 불가 사유

TS structural typing 때문에 이름 수준 비교로는 타입 호환성을 판단할 수 없음. `getFullSymbol().parameters`는 `string` 형태 타입 표현(`"UserService"`, `"Promise<Config>"` 등)만 반환. `string` vs `String`, 제네릭, 유니온, 조건부 타입, intersection 등에서 false positive/negative 빈번 발생. tsc의 `isTypeAssignableTo()`는 gildash에 노출되지 않으므로 정확한 구조적 호환성 검사 불가. `getResolvedType()`의 member tree 비교로 근사할 수 있으나, 실용적 가치 대비 구현 복잡도가 과도함.

---

## 5. `findPattern()` — 정책 자동 강제

### 목적

Zipbul 핵심 원칙 "런타임 리플렉션 절대 금지"를 빌드 타임에 코드로 강제.

### 구현

```typescript
async validateNoBannedImports(): Promise<void> {
  if (!this.gildash) return;

  const patterns = [
    'import "reflect-metadata"',
    'import { $$$ } from "reflect-metadata"',
    'import * as $_ from "reflect-metadata"',
  ];

  for (const pattern of patterns) {
    const matches = await this.gildash.findPattern(pattern, {
      filePaths: Array.from(this.fileMap.keys()),
    });
    if (matches.length > 0) {
      const locations = matches.map(m => `  ${m.filePath}:${m.startLine}`).join('\n');
      throw new DiagnosticError(buildDiagnostic({
        reason: `[Policy] reflect-metadata import forbidden:\n${locations}`,
      }));
    }
  }
}
```

### 제한사항

- `findPattern()` — **비동기** (`Promise<PatternMatch[]>`). 현재 `validateInheritedScopes()`도 async이므로 기존 패턴과 일관됨.
- 반환값이 `{ filePath, startLine, endLine, matchedText }` — **심볼 참조나 AST 노드 정보 없음**. 정밀한 컨텍스트 분석(예: 주석 내부 vs 코드)은 불가하나, ast-grep은 AST 노드만 매칭하므로 주석은 자동 제외됨.
- dynamic `import()` 표현식 감지 어려움 — `import("reflect-metadata")`는 별도 패턴 필요.

### 난이도

낮음

### 테스트

- named import 감지: `import { Reflect } from "reflect-metadata"` → 에러
- side-effect import 감지: `import "reflect-metadata"` → 에러
- namespace import 감지: `import * as RM from "reflect-metadata"` → 에러
- 정상 import (다른 패키지) → 에러 없음
- gildash 미사용 시 → graceful skip
- 주석 내 "reflect-metadata" 문자열 → 매칭 안 됨 (ast-grep 특성)

---

## 6. 미사용 Provider 감지

### 목적

등록됐지만 실제로 inject되지 않는 데드 provider를 빌드 타임에 warning.

### ~~원래 계획: `getSemanticReferences()` 사용~~

### `getSemanticReferences()` 불가 사유

`getSemanticReferences()` (semantic/types.d.ts line 40-58)는 tsc `LanguageService.findReferences` 기반. 반환 타입:

```typescript
interface SemanticReference {
  filePath: string;
  position: number;
  line: number;
  column: number;
  isDefinition: boolean;
  isWrite: boolean;
}
```

**문제**: `inject([MyService])` 같은 함수 인자 위치의 값 참조를 tsc findReferences가 안정적으로 반환하지 않음. tsc는 타입 수준 참조(`: MyService`)와 할당(`x = MyService`)은 잘 찾지만, 배열 리터럴 내부의 값 참조(`[MyService]`)는 구현에 따라 누락될 수 있음. 따라서 inject() 기반 DI에서 provider 사용 여부를 정확히 판단할 수 없음.

### ~~수정된 계획: `searchRelations()` + `findPattern()` 결합~~

### gildash 기반 접근 전체 불가 사유

Zipbul의 DI에서 provider 참조는 크게 3가지 경로로 발생:

1. **Constructor type annotation**: `constructor(private svc: MyService)` — 이것은 **타입 참조**이지 값 import가 아님. gildash `searchRelations({ type: 'imports' })`에 나타나지 않음. AOT 컴파일러가 타입 annotation에서 `ZIPBUL_REF`를 추출하여 DI 토큰으로 변환하는 것이므로, gildash import 관계로는 감지 불가.

2. **inject() 호출**: `inject([MyService])` — 배열 리터럴 내부의 값 참조. `findPattern('inject(MyService)')` 패턴은 단일 인자만 매칭하고 `inject([A, B])` 배열 형태는 별도 패턴 필요. 또한 ast-grep은 `{ filePath, startLine, matchedText }` 수준의 정보만 반환하므로 정확한 토큰 매칭이 어려움.

3. **useExisting/useClass**: provider 객체 내부의 속성값 참조. `searchRelations`는 이를 import 관계로 추적하지 않음.

**결론**: gildash API로는 provider 사용 여부를 신뢰성 있게 판단할 수 없음. false negative (사용 중인데 미사용으로 오탐)이 발생하면 개발자가 잘못된 warning을 받게 됨.

### 현실적 대안: AOT 컴파일러 내부 데이터 활용

AOT 컴파일러는 이미 모든 DI 관계를 파악하고 있음:

- `classDefinitions`: 모든 클래스 + 데코레이터
- `ModuleGraph.providers`: 등록된 모든 provider
- `ClassMetadata.constructorParams`: 각 클래스의 생성자 파라미터 (ZIPBUL_REF 포함)
- `InjectCall[]`: 모든 inject() 호출과 토큰

gildash 없이 **AOT 컴파일러의 기존 데이터만으로** 정확하게 구현 가능:

```typescript
// 1. 모든 등록된 provider 토큰 수집
const allProviderTokens = new Set<string>();
for (const module of this.modules.values()) {
  for (const token of module.providers.keys()) {
    allProviderTokens.add(token);
  }
}

// 2. 모든 참조된 토큰 수집 (생성자 + inject + useExisting)
const referencedTokens = new Set<string>();
for (const [_, def] of this.classDefinitions) {
  for (const param of def.metadata.constructorParams ?? []) {
    const token = normalizeToken(param.type);
    if (token) referencedTokens.add(token);
  }
}
for (const injectCall of allInjectCalls) {
  const token = normalizeToken(injectCall.token);
  if (token) referencedTokens.add(token);
}

// 3. 차집합 = 미사용 provider
for (const token of allProviderTokens) {
  if (!referencedTokens.has(token)) {
    this.warnings.push(`Provider '${token}' is registered but never injected`);
  }
}
```

### 제한사항 (AOT 접근)

- controller는 직접 inject되지 않지만 항상 인스턴스화됨 → 제외 필요
- lifecycle hook provider (`OnInit`, `OnStart`)는 inject 없이도 사용됨 → 제외 필요
- `visibleTo`로 다른 모듈에 노출된 provider → 해당 모듈에서 사용될 수 있음

### 난이도

낮음 (gildash 불필요, 기존 데이터만 사용)

### 테스트

- constructor에서 inject된 provider → warning 없음
- 어디서도 참조 안 된 provider → warning
- controller → warning 없음 (제외)
- lifecycle hook provider → warning 없음 (제외)
- useExisting 대상 provider → warning 없음

---

## ~~7. Dead Import 제거~~

### 삭제 사유

`Bun.build()`가 tree shaking을 이미 수행. 생성된 runtime.ts에 미사용 import가 있어도 번들 결과물에서 제거됨. AOT 컴파일러가 별도로 처리할 필요 없음.

---

## 8. 빌드 캐싱

### 목적

변경되지 않은 파일의 재파싱을 스킵하여 후속 빌드 속도를 향상한다.

### ~~원래 불가 판정: BFS가 parseResult에 구조적 의존~~

### 불가 판정 정정 사유

1. **BFS 대체 가능**: `getTransitiveDependencies(entryPoint)`가 `imports` + `type-references` + `re-exports` 3개 관계를 모두 포함한 도달 가능 파일 목록을 반환. DependencyGraph 내부에서 3개 타입 모두 조회하여 그래프 구축 (`dependency-graph.ts` line 39-68). BFS 루프 완전 대체 가능.
2. **dist→src 변환 불필요**: gildash에 `ignorePatterns: ['dist']` 전달하므로 dist 경로를 반환하지 않음. 모든 경로가 소스 경로.
3. **FileAnalysis JSON 직렬화 안전**: 모든 데이터가 primitives + plain objects + arrays. `AnalyzerProgram`(oxc AST)은 파서가 명시적으로 필터링하여 FileAnalysis에 도달하지 않음. ZIPBUL_REF 등 매직 키도 전부 plain string (`@zipbul/common/src/constants.ts` line 8-21).

### 구현

```typescript
// 1. gildash 초기화 (fullIndex 수행)
const ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true, watchMode: false });

// 2. 도달 가능 파일 목록 (re-export 포함)
const reachableFiles = await ledger.getTransitiveDependencies(userMain);

// 3. 캐시 로드
const cacheFilePath = join(zipbulDir, 'file-analysis-cache.json');
const cache: Record<string, { contentHash: string; analysis: FileAnalysis }> =
  await loadCacheIfExists(cacheFilePath);

// 4. 변경된 파일만 파싱
const fileMap = new Map<string, FileAnalysis>();
for (const filePath of reachableFiles) {
  const fileInfo = ledger.getFileInfo(filePath);
  const cached = cache[filePath];

  if (cached && fileInfo && cached.contentHash === fileInfo.contentHash) {
    // 캐시 히트 → 파싱 스킵
    fileMap.set(filePath, cached.analysis);
  } else {
    // 캐시 미스 → 파싱
    const content = await Bun.file(filePath).text();
    const parseResult = parser.parse(filePath, content);
    const analysis = buildFileAnalysis(filePath, parseResult);
    fileMap.set(filePath, analysis);
    cache[filePath] = { contentHash: fileInfo?.contentHash ?? '', analysis };
  }
}

// 5. 캐시 저장
await Bun.write(cacheFilePath, JSON.stringify(cache));
```

### 주의사항

- **tsconfig.json 변경**: path alias 변경 시 모든 파일의 import resolution이 달라짐. tsconfig 내용의 hash를 캐시 키에 포함하여 변경 시 전체 캐시 무효화 필요.
- **첫 빌드는 개선 없음**: 캐시가 비어있으므로 전체 파싱 필요.
- **캐시 파일 크기**: 대규모 프로젝트에서 `file-analysis-cache.json`이 커질 수 있음. `.zipbul/`에 저장하고 `.gitignore`에 이미 포함됨.

### 난이도

중간

### 테스트

- 두 번째 빌드에서 변경 없는 파일 파싱 스킵 확인
- 파일 내용 변경 후 빌드 → 변경 파일만 재파싱 확인
- tsconfig.json 변경 → 전체 캐시 무효화 확인
- `.zipbul/` 삭제 후 빌드 → 정상 동작 (첫 빌드와 동일)
- 캐시된 FileAnalysis와 직접 파싱한 FileAnalysis가 동일한지 확인 (JSON roundtrip 검증)

---

## 9. 크로스패키지 Deep Import 검증

### 목적

CLAUDE.md 정책 "deep import(`@zipbul/*/src/`) 금지"를 빌드 타임에 강제.

### `searchRelations()` 패턴 매칭 불가 사유

`RelationSearchQuery` (relation-search.d.ts)의 모든 필드가 **exact string match**:

```typescript
interface RelationSearchQuery {
  srcFilePath?: string;      // exact match
  dstFilePath?: string;      // exact match
  srcSymbolName?: string;    // exact match
  dstSymbolName?: string;    // exact match
  dstProject?: string;       // exact match
  type?: CodeRelation['type'];
  project?: string;          // exact match
  limit?: number;
}
```

glob, regex, 패턴 매칭 일체 미지원.

### 대안: `project` 필터 활용

gildash는 monorepo 패키지 경계를 자동 감지 (`discoverProjects()` → `ProjectBoundary[]`). 각 패키지가 독립 project로 인식됨.

```typescript
// 방법 1: dstProject 필터로 크로스패키지 import만 추출
const crossPkgImports = ledger.searchAllRelations({ type: 'imports' });
const violations = crossPkgImports.filter(rel => {
  // 같은 프로젝트 내 import은 허용
  if (rel.srcFilePath와 rel.dstFilePath가 같은 패키지) return false;
  // index.ts (public facade)를 통한 import은 허용
  if (rel.dstFilePath.endsWith('/index.ts')) return false;
  // /src/ 경로를 직접 import → 위반
  return rel.dstFilePath.includes('/src/');
});
```

```typescript
// 방법 2: 패키지별 project 이름으로 필터
for (const boundary of ledger.projects) {
  const imports = ledger.searchRelations({
    project: boundary.project,
    type: 'imports',
  });
  for (const imp of imports) {
    // dstFilePath가 다른 패키지의 /src/ 내부인지 확인
  }
}
```

### 사전 설계 결정 필요

| 결정 사항 | 선택지 |
|-----------|--------|
| 검증 대상 패키지 | 전체 `packages/*` vs 특정 패키지만 |
| 허용 deep import | 없음 (엄격) vs 화이트리스트 |
| 강제 수준 | 빌드 에러 vs warning |
| 실행 시점 | 매 빌드 vs 별도 lint 명령 |

### 난이도

중간 — 로직은 단순하나 설계 결정과 `searchAllRelations()` 전체 조회 비용 고려 필요

### 테스트

- `@zipbul/core`가 `@zipbul/http-adapter/src/middleware.ts` import → 위반
- `@zipbul/core`가 `@zipbul/http-adapter` (index.ts) import → 허용
- 같은 패키지 내 `/src/` import → 허용
- `node_modules` import → 무시

---

## 10. Interface Catalog 확장

### 목적

`interface-catalog.json`에 모듈 메트릭을 추가하여 다운스트림 도구가 별도 파싱 없이 활용 가능하게 한다.

### 구현

`build-artifact-writer.ts` `writeInterfaceCatalog()`에서:

```typescript
// 기존 export 정보에 추가
const stats = ledger.getFileStats(modulePath);

catalogEntries.push({
  module: moduleNode.name,
  filePath: relative(projectRoot, modulePath),
  exports: iface.exports,
  semantic: semanticAvailable,
  // 신규:
  stats: {
    lineCount: stats.lineCount,
    symbolCount: stats.symbolCount,
    exportedSymbolCount: stats.exportedSymbolCount,
    size: stats.size,
  },
});
```

Build profile `full`에서만 fan metrics 추가:

```typescript
if (buildProfile === 'full') {
  const metrics = await ledger.getFanMetrics(modulePath);
  entry.fanMetrics = { fanIn: metrics.fanIn, fanOut: metrics.fanOut };
}
```

### 난이도

낮음

### 테스트

- catalog에 stats 필드 포함 확인
- stats 값이 실제 파일 메트릭과 일치 확인
- build profile standard → fanMetrics 미포함 확인
- build profile full → fanMetrics 포함 확인
- schemaVersion 업데이트 ("2" → "3") 확인

---

## ~~11. Bun.build() Splitting 힌트~~

### 삭제 사유

Bun.build() `BuildConfig` (bun-types bun.d.ts line 2448-2841)에 chunk 경계 제어 API 없음:

- `splitting: boolean` — 단순 on/off 플래그만 존재
- `naming.chunk` — 출력 파일명 패턴만 제어, 어떤 코드가 어떤 chunk에 들어가는지 제어 불가
- `manualChunks`, `splitChunks`, `chunkStrategy` 등 chunk 그룹핑 옵션 **미존재**
- `plugins: BunPlugin[]` — `onLoad`/`onResolve` 훅만 제공, chunk 제어 불가

Bun이 향후 chunk 제어 API를 추가하면 재검토.

---

## 테스트 Mock 업데이트 (전 Phase 공통)

### `cli-dev.test.ts` / `cli-build.test.ts`

각 Phase에서 사용하는 신규 gildash API에 대한 mock 추가:

```typescript
const makeGildashLedgerMock = () => ({
  // 기존 mock 유지...
  onIndexed: mock((_cb: unknown) => mock(() => {})),
  onError: mock((_cb: unknown) => mock(() => {})),
  onRoleChanged: mock((_cb: unknown) => mock(() => {})),
  hasCycle: mock(async () => false),
  getCyclePaths: mock(async () => []),
  getAffected: mock(async (_files: string[]) => [] as string[]),
  getModuleInterface: mock((_file: string) => ({ exports: [] })),
  getSemanticModuleInterface: mock((_file: string) => ({ exports: [] })),
  close: mock(async () => {}),

  // Phase 1: pruneChangelog
  pruneChangelog: mock((_before: unknown) => 0),

  // Phase 2: getSymbolChanges (진단 로깅)
  getSymbolChanges: mock((_since: unknown, _opts?: unknown) => []),

  // Phase 3: searchSymbols (배치 검증)
  searchSymbols: mock((_query: unknown) => []),

  // Phase 5: findPattern (정책 강제)
  findPattern: mock(async (_pattern: unknown, _opts?: unknown) => []),

  // Phase 9: searchAllRelations (크로스패키지 검증)
  searchAllRelations: mock((_query: unknown) => []),

  // Phase 10: getFileStats, getFanMetrics (catalog 확장)
  // 이미 cli-build.test.ts에 존재
});
```

### `module-graph.spec.ts`

Phase 3-A, 3-B, 4-A, 5, 6에서 추가되는 검증 로직에 대한 테스트 추가 필요.

---

## 실행 순서 요약

### 실행 가능

| 순서 | Phase | 작업 | 난이도 | 효과 |
|------|-------|------|--------|------|
| 1 | 0 | 버전 업그레이드 | 매우 낮음 | 버그/성능 즉시 수혜 |
| 2 | 1 | `pruneChangelog()` | 매우 낮음 | 장기 세션 안정성 |
| 3 | 2-A | `getSymbolChanges()` 진단 로깅 추가 | 낮음 | 개발자 피드백 강화 |
| 4 | 2-C | Cycle detection 조건부 스킵 | 낮음 | ~20-50ms 절약 |
| 5 | 3-A | validateProviderImplementations 배치화 | 낮음 | ~130ms 절약 |
| 6 | 5 | findPattern() 리플렉션 금지 | 낮음 | 정책 자동 강제 |
| 7 | 3-B | searchSymbols 컨트롤러 발견 | 낮음 | 스케일링 개선 |
| 8 | 4-A | DI 타입 호환성 검증 | 중간 | 런타임 에러 → 빌드 에러 |
| 9 | 9 | 크로스패키지 deep import 검증 | 중간 | 아키텍처 규칙 강제 |
| 10 | 10 | Interface catalog 확장 | 낮음 | 다운스트림 도구 지원 |
| 11 | 3-C | Adapter resolver 최적화 | 중간 | O(n²)→O(n) |

### gildash 업그레이드와 무관 (별도 AOT 컴파일러 최적화)

| 순서 | Phase | 작업 | 난이도 | 효과 |
|------|-------|------|--------|------|
| 1 | 6 | 미사용 provider 감지 | 낮음 | 데드 코드 발견 (AOT 컴파일러 내부 데이터) |
| 2 | 2-B | DI Signature Hash early cutoff | 중간 | 리빌드 ~70% 단축 (DI 미변경 시) |
| 3 | 8 | 빌드 캐싱 (getTransitiveDependencies + FileAnalysis 캐시) | 중간 | 후속 빌드 가속 |

### 절대 불가

| Phase | 작업 | 사유 |
|-------|------|------|
| 2-A | fingerprint 교체/localValues 제외 | `resolveSpreadBundle()`이 `localValues` 직접 참조. 제외 시 spread 변경 미감지 → 무성 버그 |
| 11 | Bun.build() splitting 힌트 | Bun.build() API에 chunk 경계 제어 옵션 미존재 |

### gildash 개선 시 가능

| Phase | 작업 | 필요한 개선 |
|-------|------|-------------|
| 2-A | fingerprint 교체 | `IndexResult.changedSymbols`에 `isExported` 필드 추가, `changedRelations` (re-export 변경) 추가 |
| 4-B | useFactory 파라미터 타입 검증 | `isTypeAssignableTo()` API 노출 |
| 9 | 크로스패키지 검증 효율화 | `RelationSearchQuery`에 glob/regex 패턴 매칭 지원 |

