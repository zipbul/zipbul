# @zipbul/gildash CLI 마이그레이션 계획서

## 1. 현황 분석 (AS-IS)

### 1.1 커맨드별 아키텍처

CLI에는 3개 커맨드(`build`, `dev`, `mcp`)가 있으며, 파일 수집 방식과 Watch 메커니즘이 서로 다르다.

#### build 커맨드 (`src/bin/build.command.ts`, 301줄)

```
build(commandOptions?)
  ├─ ConfigLoader.load()
  ├─ Glob('**/*.ts') + scanGlobSorted()       ← 전체 .ts 파일 목록 수집
  ├─ BFS queue + Bun.resolveSync()            ← entry에서 import 추적하여 도달 가능 파일만 queue에 추가
  ├─ AstParser.parse(filePath, fileContent)   ← 각 파일 → FileAnalysis (도메인 메타데이터)
  ├─ fileMap: Map<string, FileAnalysis>       ← BFS 도달 파일만 포함
  ├─ validateCreateApplication(fileMap)
  ├─ ModuleGraph(fileMap, moduleFileName).build()
  ├─ AdapterSpecResolver.resolve({ fileMap, projectRoot })
  ├─ ManifestGenerator.generateJson({ graph, ... })
  ├─ ManifestGenerator.generate() → runtime.ts
  ├─ EntryGenerator.generate() → entry.ts
  ├─ manifest 결정론 guardrail (2회 생성 비교)
  └─ Bun.build({ entrypoints, outdir }) → dist/
```

**핵심 특성**: entry point로부터 BFS import 추적. `Glob`은 초기 큐 시드만 제공하고, `Bun.resolveSync()` + `visited` Set으로 도달 가능 파일만 `fileMap`에 포함. 심볼 없는 파일도 import만 되면 포함됨.

#### dev 커맨드 (`src/bin/dev.command.ts`, 325줄)

```
dev(commandOptions?)
  ├─ ConfigLoader.load()
  ├─ Glob('**/*.ts') + scanGlobSorted()       ← 전체 .ts 파일 목록
  ├─ shouldAnalyzeFile() 필터                  ← .d.ts, .spec.ts, .test.ts 제외
  ├─ analyzeFile(fullPath)                     ← AstParser.parse() → fileCache에 저장
  ├─ validateCreateApplication(fileCache)
  ├─ rebuild()                                 ← ModuleGraph.build() → ManifestGenerator
  │
  ├─ [Watch 인프라] OwnerElection.acquire()
  │   ├─ owner 역할:
  │   │   ├─ ProjectWatcher.start(onChange)     ← @parcel/watcher 래핑
  │   │   ├─ ChangesetWriter.append()          ← changeset.jsonl 기록
  │   │   ├─ analyzeFile() 또는 fileCache.delete()
  │   │   ├─ buildDevIncrementalImpactLog()    ← buildModuleImpact() 호출 → 모듈 레벨 영향
  │   │   └─ rebuild()
  │   └─ reader 역할:
  │       ├─ @parcel/watcher.subscribe(cacheDir)  ← changeset.jsonl 변경 감시
  │       ├─ fileCache.clear()
  │       ├─ Glob 전체 re-scan + analyzeFile()    ← 전파일 재분석
  │       └─ rebuild()
  └─ process.on('SIGINT', cleanup)
```

**핵심 특성**: `Glob`으로 전체 `.ts` 수집 (BFS 아님). owner는 단일 파일 증분 처리, reader는 전파일 재스캔.

#### mcp 커맨드 (`src/bin/mcp.command.ts`, 158줄)

```
mcp(positionals, commandOptions)           ← createMcpCommand(deps) 팩토리 패턴 이미 적용
  ├─ subcommand 없음: ensureRepo → loadConfig → startServer
  └─ subcommand 'rebuild':
      ├─ OwnerElection.acquire()
      │   ├─ owner: createDb → indexProject → closeDb → election.release()
      │   └─ reader: emitReindexSignal() → election.release()
      └─ ok: true/false
```

**핵심 특성**: `OwnerElection`으로 역할 분리. reader면 `emitReindexSignal()`로 owner에게 재인덱싱 요청. **이미 `createMcpCommand(deps)` + `__testing__` 패턴이 적용되어 있으므로 Phase 0의 참조 모델.**

#### zp.ts (`src/bin/zp.ts`, 82줄) — CLI 엔트리포인트

```
parseArgs() → switch(command)
  ├─ 'dev'   → dev(commandOptions)
  ├─ 'build' → build(commandOptions)
  └─ 'mcp'   → mcp(positionals.slice(1), commandOptions)
```

### 1.2 핵심 파일 & 줄 수

| 파일 | 줄 수 | 역할 | 카테고리 |
|---|---:|---|---|
| `src/compiler/analyzer/ast-parser.ts` | 1,871 | oxc-parser AST → ClassMetadata | 도메인 (유지) |
| `src/compiler/analyzer/graph/module-graph.ts` | 788 | 모듈 트리 구축 (providers, controllers) | 도메인 (유지) |
| `src/compiler/analyzer/adapter-spec-resolver.ts` | 966 | adapterSpec export 추적 & 정적 스펙 추출 | 도메인 (유지) |
| `src/compiler/analyzer/ast-type-resolver.ts` | 195 | AST 타입 노드 해석. AstParser가 사용 | 도메인 (유지) |
| `src/compiler/analyzer/module-discovery.ts` | 62 | `__module__.ts` 기반 모듈 발견 | 도메인 (유지) |
| `src/compiler/analyzer/validation.ts` | 88 | createApplication 유효성 검사 | 도메인 (유지) |
| `src/compiler/analyzer/graph/module-node.ts` | 26 | ModuleGraph 노드 구조체 | 도메인 (유지) |
| `src/bin/build.command.ts` | 301 | 프로덕션 빌드 | 커맨드 (수정) |
| `src/bin/dev.command.ts` | 325 | Dev 서버 + Watch | 커맨드 (대규모 수정) |
| `src/bin/mcp.command.ts` | 158 | MCP 서버 + rebuild | 커맨드 (수정) |
| `src/bin/zp.ts` | 82 | CLI 엔트리포인트 | 커맨드 (수정) |
| `src/bin/dev-incremental-impact.ts` | 49 | 증분 영향 로그 포매팅 | 인프라 (재작성) |
| `src/compiler/analyzer/incremental/module-impact.ts` | 152 | 변경 파일 → 영향 모듈 계산 | 인프라 (삭제) |
| `src/watcher/project-watcher.ts` | 55 | @parcel/watcher 래퍼 | 인프라 (삭제) |
| `src/watcher/owner-election.ts` | 131 | 파일 기반 소유권 선거 | 인프라 (삭제) |
| `src/watcher/changeset.ts` | 101 | 변경 이벤트 JSONL 기록 | 인프라 (삭제) |
| `src/watcher/reindex-signal.ts` | 75 | 재인덱싱 시그널 | 인프라 (삭제) |
| `src/watcher/interfaces.ts` | 4 | FileChangePayload 인터페이스 | 인프라 (삭제) |
| `src/watcher/index.ts` | 4 | watcher barrel export | 인프라 (수정) |
| `src/compiler/index.ts` | 4 | compiler barrel export | 인프라 (수정) |
| `src/compiler/analyzer/index.ts` | 10 | analyzer barrel export | 인프라 (수정) |

### 1.3 의존 관계 맵 (import 기준)

```
build.command.ts
  ─imports→ AstParser, ModuleGraph, FileAnalysis, AdapterSpecResolver  (from ../compiler/analyzer)
  ─imports→ ManifestGenerator, EntryGenerator                          (from ../compiler/generator)
  ─imports→ validateCreateApplication                                  (from ../compiler/analyzer/validation)
  ─imports→ ConfigLoader, ConfigLoadError                              (from ../config)
  ─imports→ Glob                                                       (from bun)
  ─imports→ scanGlobSorted, zipbulDirPath, zipbulTempDirPath,
            compareCodePoint, writeIfChanged                           (from ../common)
  ─imports→ buildDiagnostic, DiagnosticReportError, reportDiagnostics  (from ../diagnostics)

dev.command.ts
  ─imports→ AstParser, ModuleGraph, FileAnalysis, AdapterSpecResolver  (from ../compiler/analyzer)
  ─imports→ ManifestGenerator                                          (from ../compiler/generator)
  ─imports→ validateCreateApplication                                  (from ../compiler/analyzer/validation)
  ─imports→ ConfigLoader, ConfigLoadError                              (from ../config)
  ─imports→ Glob                                                       (from bun)
  ─imports→ ChangesetWriter, OwnerElection, ProjectWatcher             (from ../watcher)
  ─imports→ buildDevIncrementalImpactLog                               (from ./dev-incremental-impact)
  ─imports→ watcher                                                    (from @parcel/watcher) [reader mode]
  ─imports→ scanGlobSorted, zipbulDirPath, writeIfChanged              (from ../common)
  ─imports→ zipbulCacheDirPath                                         (from ../common/zipbul-paths)
  ─imports→ buildDiagnostic, DiagnosticReportError, reportDiagnostics  (from ../diagnostics)

mcp.command.ts
  ─imports→ OwnerElection                                              (from ../watcher/owner-election)
  ─imports→ emitReindexSignal                                          (from ../watcher/reindex-signal)
  ─imports→ ConfigLoader                                               (from ../config)
  ─imports→ createDb, closeDb                                          (from ../store/connection)
  ─imports→ indexProject                                               (from ../mcp/index/index-project)
  ─imports→ startZipbulMcpServerStdio                                  (from ../mcp/server/mcp-server)
  ─imports→ zipbulCacheDirPath                                         (from ../common/zipbul-paths)
  ─imports→ buildDiagnostic, reportDiagnostics                         (from ../diagnostics)

dev-incremental-impact.ts
  ─imports→ FileAnalysis                                               (from ../compiler/analyzer/graph/interfaces)
  ─imports→ buildModuleImpact, ModuleImpact                            (from ../compiler/analyzer/incremental/module-impact)

zp.ts
  ─imports→ dev                                                        (from ./dev.command)
  ─imports→ build                                                      (from ./build.command)
  ─imports→ mcp                                                        (from ./mcp.command)
  ─imports→ buildDiagnostic, reportDiagnostics                         (from ../diagnostics)

ModuleGraph      ─imports→ ModuleDiscovery, ModuleNode, FileAnalysis
AdapterSpecResolver ─imports→ AstParser (자체 인스턴스: private parser = new AstParser()), FileAnalysis
ManifestGenerator   ─imports→ ModuleGraph, ModuleNode, ClassMetadata
InjectorGenerator   ─imports→ ModuleGraph, ModuleNode, ClassMetadata
ProjectWatcher      ─imports→ FileChangePayload (from ./interfaces), watcher (from @parcel/watcher)
```

## 2. gildash API 레퍼런스

> 출처: https://www.npmjs.com/package/@zipbul/gildash (v0.0.2)

### 2.1 인스턴스 생성/종료

| API | 동기/비동기 | 시그니처 | 반환 |
|---|---|---|---|
| `Gildash.open(options)` | async | `options: { projectRoot: string, extensions?: string[], ignorePatterns?: string[], parseCacheCapacity?: number, logger?: Logger }` | `Promise<Gildash>` |
| `ledger.close()` | async | — | `Promise<void>` |
| `ledger.reindex()` | async | — (owner 전용, reader 호출 시 에러) | `Promise<IndexResult>` |

`Gildash.open()` 기본값: `extensions = ['.ts', '.mts', '.cts']`, `ignorePatterns = []`, `parseCacheCapacity = 500`, `logger = console`.
Owner/Reader 역할은 **자동 결정** (SQLite 단일 writer 보장). open() 옵션에 role 지정 파라미터 없음.

### 2.2 검색

| API | 동기/비동기 | 파라미터 | 반환 |
|---|---|---|---|
| `ledger.searchSymbols(query)` | sync | `{ text?, kind?, filePath?, isExported?, project?, limit? }` | `SymbolSearchResult[]` |
| `ledger.searchRelations(query)` | sync | `{ srcFilePath?, srcSymbolName?, dstFilePath?, dstSymbolName?, type?, project?, limit? }` | `CodeRelation[]` |

- `kind`: `'function' | 'method' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'property'`
- `type` (relation): `'imports' | 'calls' | 'extends' | 'implements'`
- `SymbolSearchResult`: `{ id, filePath, kind, name, span, isExported, signature, fingerprint, detail }`
- `CodeRelation`: `{ type, srcFilePath, srcSymbolName, dstFilePath, dstSymbolName, metaJson? }`

### 2.3 의존성 그래프

| API | 동기/비동기 | 파라미터 | 반환 | 설명 |
|---|---|---|---|---|
| `ledger.getDependencies(filePath, project?)` | sync | 파일 경로 | `string[]` | 해당 파일이 import하는 파일 목록 |
| `ledger.getDependents(filePath, project?)` | sync | 파일 경로 | `string[]` | 해당 파일을 import하는 파일 목록 |
| `ledger.getAffected(changedFiles, project?)` | async | 변경 파일 배열 | `Promise<string[]>` | 전이적 영향 **파일** 목록 (모듈 아님) |
| `ledger.hasCycle(project?)` | async | — | `Promise<boolean>` | **파일 레벨** 순환 의존성 감지 |

### 2.4 이벤트/메타

| API | 동기/비동기 | 반환 | 설명 |
|---|---|---|---|
| `ledger.onIndexed(callback)` | sync | `() => void` (unsubscribe) | 인덱싱 완료 이벤트 구독. callback은 `IndexResult` 수신 |
| `ledger.projects` | getter | `ProjectBoundary[]` | `{ dir: string, project: string }[]` |
| `ledger.getStats(project?)` | sync | `{ symbolCount: number, fileCount: number }` | 통계 |

### 2.5 저수준 파싱

| API | 동기/비동기 | 반환 | 설명 |
|---|---|---|---|
| `ledger.parseSource(filePath, sourceText)` | sync | `ParsedFile` | 내부 캐시 저장 |
| `ledger.extractSymbols(parsed)` | sync | `ExtractedSymbol[]` | 심볼 추출 |
| `ledger.extractRelations(parsed)` | sync | `CodeRelation[]` | 관계 추출 |

### 2.6 IndexResult 구조체

```typescript
interface IndexResult {
  indexedFiles: number;
  removedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  durationMs: number;
  changedFiles: string[];     // 변경/추가된 파일 경로
  deletedFiles: string[];     // 삭제된 파일 경로
  failedFiles: string[];      // 파싱 실패 파일 경로
}
```

### 2.7 에러 계층

모든 에러는 `GildashError`를 extends. `GildashError`는 `Error`를 extends.

| 에러 | 발생 상황 |
|---|---|
| `ParseError` | gildash 내부 oxc-parser AST 파싱 실패 |
| `ExtractError` | 심볼/관계 추출 실패 |
| `IndexError` | 인덱싱 파이프라인 실패 |
| `StoreError` | SQLite DB 연산 실패 |
| `SearchError` | 검색 쿼리 실패 |
| `WatcherError` | 파일 워처 시작/중지 실패 |

### 2.8 Owner/Reader 패턴

- **Owner**: 파일 워처 실행, 인덱싱 수행, 30초 간격 heartbeat 전송
- **Reader**: 읽기 전용 접근, 60초 간격으로 owner 상태 폴링, owner가 stale이면 자가 승격(self-promote)
- **역할 자동 결정**: `Gildash.open()` 호출 시 SQLite lock 기반으로 자동. 수동 지정 불가.
- **reader에서 `onIndexed()` 동작**: gildash v0.0.2 공식 문서에 reader의 onIndexed 트리거 메커니즘이 명시되지 않음. → **Phase 1 구현 전 반드시 실험 검증 필요** (섹션 10 참조)

## 3. 대체 가능/불가 영역

### 3.1 대체 가능 (Infrastructure Layer)

| 현재 컴포넌트 | gildash 대체 API | 비고 | 제약사항 |
|---|---|---|---|
| `ProjectWatcher` (dev, @parcel/watcher 래핑) | gildash 내장 watcher | owner가 자동 감지+인덱싱 | — |
| `OwnerElection` (dev+mcp) | gildash owner/reader role | 자동 결정, heartbeat 30s | reader→owner 재인덱싱 요청 메커니즘 변경 필요 (mcp) |
| `ChangesetWriter` (dev owner) | `IndexResult.changedFiles` / `.deletedFiles` | onIndexed 콜백으로 수신 | — |
| `buildModuleImpact()` (dev, 파일→모듈 영향) | `ledger.getAffected()` (파일→파일 영향) | **파일 레벨만 반환** | 모듈 레벨 매핑은 별도 로직 필요 (섹션 3.3) |
| `emitReindexSignal()` (mcp reader) | `ledger.reindex()` | **owner 전용** | reader에서는 호출 불가 → 대체 전략 필요 (Phase 1) |
| `ReindexSignalWatcher` | gildash 자동 폴링 | reader가 60s 간격으로 poll | — |

### 3.2 대체 불가 (Domain Layer) — 유지

| 컴포넌트 | 줄 수 | 유지 사유 |
|---|---|---|
| `AstParser` | 1,871 | ClassMetadata (decorators, constructorParams, methods, properties, heritage, middlewares, errorFilters) + ModuleDefinition, CreateApplicationCall, DefineModuleCall, InjectCall, exportedValues, localValues 등 zipbul 도메인 전용 메타데이터. gildash `SymbolSearchResult`에는 `kind`, `name`, `signature`, `span`, `detail` 등 범용 정보만 있고, zipbul 도메인 구조체 없음. |
| `ModuleGraph` | 788 | zipbul 모듈 트리 (ModuleNode: providers, controllers, visibility, scope, dynamicImports, cycle detection). gildash에 zipbul 모듈 개념 없음. |
| `ModuleNode` | 26 | ModuleGraph 노드 구조체 |
| `ModuleDiscovery` | 62 | `__module__.ts` 패턴 기반 모듈 발견. ModuleGraph.build()이 내부 호출. |
| `AdapterSpecResolver` | 966 | defineAdapter 호출 인자 추출, adapterSpec re-export 체인 추적. 자체 `new AstParser()` 보유. |
| `AstTypeResolver` | 195 | AST 타입 노드 해석. AstParser 내부 사용. |
| `validation.ts` | 88 | createApplication 유효성 검사 |
| 모든 Generator | — | ManifestGenerator, InjectorGenerator, EntryGenerator — ModuleGraph/ClassMetadata 기반 코드 생성 |
| `Glob` + `scanGlobSorted()` | — | gildash에 `listFiles()` API 없음. 파일 목록 수집은 Glob 유지. |

### 3.3 핵심 의미 차이: `buildModuleImpact` vs `getAffected`

이 차이는 dev 커맨드의 증분 빌드 로직에 직접 영향을 주므로 정확히 이해해야 한다.

**AS-IS: `buildModuleImpact(fileMap, moduleFileName, changedFiles)`**
1. `ModuleDiscovery`로 fileMap의 모든 파일을 `__module__.ts` 패턴에 기반하여 파일→모듈 매핑
2. `importEntries` + `reExports`를 이용해 역방향 의존성 그래프(reverseDeps) 구축
3. 변경 파일에서 BFS로 전이적 영향 파일 수집
4. 파일→모듈 매핑을 통해 **모듈 레벨** `changedModules`/`affectedModules` 반환
5. 반환 타입: `{ changedModules: Set<string>, affectedModules: Set<string> }` — 모듈 경로 집합

**TO-BE: `ledger.getAffected(changedFiles)`**
1. gildash 내부 SQLite 의존성 그래프에서 전이적 영향 **파일** 목록 반환
2. 반환 타입: `string[]` — 파일 경로 배열
3. 모듈 개념 없음

**차이 해소 전략**:
- `getAffected()`로 영향 파일 목록을 얻은 뒤, `ModuleDiscovery`로 파일→모듈 재매핑
- `dev-incremental-impact.ts`를 재작성: `getAffected()` → `ModuleDiscovery.discover()` → 영향 모듈 집합 산출
- 이 재매핑 로직의 정확한 구현은 Phase 1에서 기술

## 4. 목표 아키텍처 (TO-BE)

### 4.1 build 커맨드

```
build(commandOptions?)
  ├─ ConfigLoader.load()
  ├─ Gildash.open({ projectRoot, ignorePatterns })   ← 백그라운드 인덱싱 시작
  ├─ Glob('**/*.ts') + scanGlobSorted()               ← 파일 목록 수집 (유지)
  ├─ BFS queue + Bun.resolveSync()                    ← import 추적 (유지)
  ├─ AstParser.parse() → fileMap                      ← 도메인 메타데이터 (유지)
  ├─ validateCreateApplication(fileMap)
  ├─ ModuleGraph(fileMap).build()
  ├─ ledger.hasCycle()                                ← 파일 레벨 순환 감지 (보강, 경고 출력)
  ├─ AdapterSpecResolver.resolve({ fileMap, projectRoot })
  ├─ ManifestGenerator → manifest.json, runtime.ts, entry.ts
  ├─ Bun.build() → dist/
  └─ ledger.close()
```

**변경점**: gildash 인스턴스 열기/닫기 + `hasCycle()` 경고. 나머지 로직 동일.
**Glob 유지 사유**: gildash에 `listFiles()` API 없음. `searchSymbols()`는 심볼 없는 파일을 누락함. build의 BFS 도달 파일은 entry의 import 그래프에 의존하므로 gildash 전체 인덱스와 범위가 다름.

### 4.2 dev 커맨드

```
dev(commandOptions?)
  ├─ ConfigLoader.load()
  ├─ Glob + analyzeFile() → fileCache                 ← 초기 전파일 분석 (유지)
  ├─ validateCreateApplication(fileCache)
  ├─ rebuild()                                         ← 초기 빌드 (유지)
  │
  ├─ Gildash.open({ projectRoot, ignorePatterns })     ← 워칭 + owner/reader 자동 관리
  ├─ ledger.onIndexed(async (result: IndexResult) => {
  │     // 삭제 파일 처리
  │     for (const file of result.deletedFiles) {
  │       fileCache.delete(file);
  │     }
  │     // 영향 파일 계산 (파일 레벨)
  │     const affectedFiles = await ledger.getAffected(result.changedFiles);
  │     // 영향 파일만 재분석
  │     for (const file of affectedFiles) {
  │       if (shouldAnalyzeFile(file)) await analyzeFile(file);
  │     }
  │     // 파일→모듈 재매핑으로 증분 영향 로그 생성
  │     const impactLog = buildDevIncrementalImpactLog({
  │       affectedFiles, fileCache, moduleFileName, toProjectRelativePath
  │     });
  │     console.info(impactLog.logLine);
  │     await rebuild();
  │   })
  └─ process.on('SIGINT', () => { void ledger.close(); })
```

**제거 대상**: `OwnerElection`, `ProjectWatcher`, `ChangesetWriter`, `@parcel/watcher` 직접 import, `buildModuleImpact()`.
**reader mode**: gildash 내부에서 자동 관리. → **단, reader에서 `onIndexed`가 트리거되는지 반드시 사전 검증 필요** (섹션 10).

### 4.3 mcp 커맨드

```
mcp(positionals, commandOptions)                        ← createMcpCommand(deps) 기존 패턴 유지
  ├─ subcommand 없음: ensureRepo → loadConfig → startServer
  └─ subcommand 'rebuild':
      ├─ Gildash.open({ projectRoot })                   ← owner/reader 자동 결정
      ├─ owner: ledger.reindex() → IndexResult → ledger.close()
      └─ reader: ledger.close() (인덱싱은 owner 프로세스에 위임)
```

**변경점**: `OwnerElection` → `Gildash.open()`, `emitReindexSignal()` → 불필요 (reader는 인덱싱 불가, owner에 위임).
**reader에서 rebuild 요청 불가 이슈**: gildash reader는 `reindex()` 호출 불가. 현재의 `emitReindexSignal()`(reader→owner 시그널) 메커니즘은 gildash에 없음.
**해결 전략**: reader인 경우 `{ ok: true }`를 반환하고 재인덱싱은 owner 프로세스의 자동 인덱싱에 위임. 사유: gildash owner는 @parcel/watcher로 파일 변경을 자동 감지하여 인덱싱하므로, 명시적 재인덱싱 요청이 불필요. `--full` 옵션(강제 전체 재인덱싱)은 owner 프로세스에서만 유효하도록 제한.

### 4.4 zp.ts (엔트리포인트)

```
parseArgs() → switch(command)
  ├─ 'dev'   → dev(commandOptions)                     ← Phase 0에서 createDevCommand(deps) 전환
  ├─ 'build' → build(commandOptions)                    ← Phase 0에서 createBuildCommand(deps) 전환
  └─ 'mcp'   → mcp(positionals, commandOptions)        ← 기존 유지 (이미 팩토리 패턴)
```

**변경점**: build/dev 호출을 팩토리 기반으로 전환. deps 조립 코드가 zp.ts에 추가됨.

## 5. 단계별 구현 명세

### Phase 0: 기반 구축 — DI 팩토리 + 테스트 하네스

**목표**: build/dev 커맨드를 mcp.command.ts와 동일한 DI 팩토리 패턴으로 전환. gildash 설치 확인.

**선행 조건**: `bun install` 실행 (`@zipbul/gildash` 설치). `bun.lockb` 변경이 있으면 커밋에 포함.

**참조 모델**: `src/bin/mcp.command.ts`의 `createMcpCommand(deps)` + `McpCommandDeps` 인터페이스 + `__testing__` export 패턴.

#### 작업 파일 (생성)

| 파일 | 설명 |
|---|---|
| `src/compiler/gildash-provider.ts` | Gildash 인스턴스 관리 래퍼 |
| `src/compiler/gildash-provider.spec.ts` | GildashProvider unit test |
| `test/cli-build.test.ts` | build 커맨드 integration test |
| `test/cli-dev.test.ts` | dev 커맨드 integration test |

#### 작업 파일 (수정)

| 파일 | 변경 내용 |
|---|---|
| `src/bin/build.command.ts` | `BuildCommandDeps` 인터페이스 + `createBuildCommand(deps)` 팩토리 추가. 기존 `build()` 함수는 디폴트 deps로 위임. |
| `src/bin/dev.command.ts` | `DevCommandDeps` 인터페이스 + `createDevCommand(deps)` 팩토리 추가. 기존 `dev()` 함수는 디폴트 deps로 위임. |
| `src/bin/zp.ts` | build/dev 호출을 팩토리 기반으로 전환. deps 조립 코드 추가. |
| `src/compiler/index.ts` | `export * from './gildash-provider'` 추가 |

#### `BuildCommandDeps` 인터페이스 상세

```typescript
export interface BuildCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedZipbulConfig; source: string }>;
  createParser: () => AstParser;
  createManifestGenerator: () => ManifestGenerator;
  createEntryGenerator: () => EntryGenerator;
  createAdapterSpecResolver: () => AdapterSpecResolver;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  resolveImport: (specifier: string, fromDir: string) => string;  // Bun.resolveSync 래핑
  buildBundle: typeof Bun.build;
}
```

#### `DevCommandDeps` 인터페이스 상세

```typescript
export interface DevCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedZipbulConfig; source: string }>;
  createParser: () => AstParser;
  createAdapterSpecResolver: () => AdapterSpecResolver;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
}
```

**참고**: Phase 0에서는 gildash를 주입하지 않음. Phase 1/2에서 deps에 gildash를 추가.

#### `GildashProvider` — Phase 0에서는 Type만 정의

Phase 0의 GildashProvider는 `Gildash.open()` 래핑만 수행하는 thin wrapper. Phase 1/2에서 실제 사용.

```typescript
export interface GildashProviderOptions {
  projectRoot: string;
  extensions?: string[];        // default: ['.ts', '.mts', '.cts']
  ignorePatterns?: string[];    // default: ['dist', 'node_modules', '.zipbul']
}

export class GildashProvider {
  private constructor(private readonly ledger: Gildash) {}

  static async open(options: GildashProviderOptions): Promise<GildashProvider>;
  getDependencies(filePath: string): string[];
  getDependents(filePath: string): string[];
  getAffected(changedFiles: string[]): Promise<string[]>;
  hasCycle(): Promise<boolean>;
  onIndexed(cb: (result: IndexResult) => void): () => void;
  async close(): Promise<void>;
}
```

**의도적 미포함**: `getIndexedFilePaths()` — Glob 유지 결정(섹션 4.1)에 따라 사용하지 않으므로 미구현.

#### 팩토리 패턴 전환 방식

현재:
```typescript
// build.command.ts
export async function build(commandOptions?: CommandOptions) {
  const parser = new AstParser();
  // ... 모든 의존성 내부 생성
}
```

전환 후:
```typescript
// build.command.ts
export function createBuildCommand(deps: BuildCommandDeps) {
  return async function build(commandOptions?: CommandOptions): Promise<void> {
    const parser = deps.createParser();
    // ... deps에서 의존성 획득
  };
}

export const __testing__ = { createBuildCommand };

// 디폴트 export (기존 호출과 호환)
export async function build(commandOptions?: CommandOptions): Promise<void> {
  const impl = createBuildCommand({ /* 디폴트 deps */ });
  await impl(commandOptions);
}
```

#### Phase 0 완료 기준

- [ ] `GildashProvider`가 `Gildash.open()`으로 인스턴스를 열고 `close()`로 닫을 수 있다
- [ ] `BuildCommandDeps` / `DevCommandDeps`를 mock으로 주입하여 build/dev 로직을 단위 테스트할 수 있다
- [ ] `src/compiler/gildash-provider.spec.ts` unit test 존재 (`TST-COVERAGE-MAP`)
- [ ] `test/cli-build.test.ts`, `test/cli-dev.test.ts` integration test 존재
- [ ] 기존 `build()`, `dev()` 함수가 디폴트 deps로 **동일하게 동작** (행동 변경 없음)
- [ ] `TST-OVERFLOW` + `TST-PRUNE` 체크포인트 산출 완료
- [ ] RED → GREEN
- [ ] `bun.lockb` 변경이 커밋에 포함됨

#### Phase 0 롤백

`git revert` — 팩토리 함수 추가 + 디폴트 export 유지이므로 기존 동작에 영향 없음.

---

### Phase 1: dev.command.ts + mcp.command.ts — Watch 인프라 교체

**목표**: dev의 Watch 인프라(OwnerElection, ProjectWatcher, ChangesetWriter, buildModuleImpact, @parcel/watcher 직접 사용)를 gildash로 교체. mcp의 OwnerElection + emitReindexSignal도 gildash로 전환.

**의존성**: Phase 0 완료 필수

#### 작업 파일 (수정)

| 파일 | 변경 내용 |
|---|---|
| `src/bin/dev.command.ts` | Watch 인프라 전체 교체 (line 178~326). [상세: 아래] |
| `src/bin/dev-incremental-impact.ts` | 재작성: 파일 레벨 getAffected() + ModuleDiscovery 재매핑. [상세: 아래] |
| `src/bin/mcp.command.ts` | `rebuildProjectIndexDefault()` 내부의 OwnerElection + emitReindexSignal → gildash 전환. `RebuildProjectIndexDefaultDeps` 타입 변경. |

#### dev.command.ts 변경 상세

**제거 대상 import** (line 13~17):
- `import * as watcher from '@parcel/watcher'`
- `import { ChangesetWriter, OwnerElection, ProjectWatcher } from '../watcher'`
- `import { zipbulCacheDirPath } from '../common/zipbul-paths'`

**추가 import**:
- `import { GildashProvider } from '../compiler/gildash-provider'`

**제거 대상 코드 블록** (line 178~326, Watch 인프라 전체):
```
OwnerElection.acquire() → if owner { ProjectWatcher + ChangesetWriter + buildDevIncrementalImpactLog + rebuild }
                        → else { watcher.subscribe(cacheDir) + re-scan all + rebuild }
process.on('SIGINT', ...)
```

**교체 코드**:
```typescript
const ledger = await GildashProvider.open({
  projectRoot,
  ignorePatterns: ['dist', 'node_modules', '.zipbul'],
});

const unsubscribe = ledger.onIndexed(async (result: IndexResult) => {
  // 1. 삭제 파일 제거
  for (const file of result.deletedFiles) {
    fileCache.delete(file);
  }

  // 2. 파싱 실패 파일 로깅 (gildash ParseError와 구분)
  for (const file of result.failedFiles) {
    const diagnostic = buildDiagnostic({
      code: 'GILDASH_PARSE_FAILED',
      severity: 'warning',
      summary: 'Gildash parse failed.',
      reason: `File could not be indexed: ${toProjectRelativePath(file)}`,
      file: toProjectRelativePath(file),
    });
    reportDiagnostics({ diagnostics: [diagnostic] });
  }

  // 3. 영향 파일 계산 (파일 레벨)
  const affectedFiles = await ledger.getAffected(result.changedFiles);

  // 4. 영향 파일만 재분석
  for (const file of affectedFiles) {
    if (shouldAnalyzeFile(file)) {
      await analyzeFile(file);
    }
  }

  // 5. 증분 영향 로그 (파일→모듈 재매핑 포함)
  const impactLog = buildDevIncrementalImpactLog({
    affectedFiles,
    fileCache,
    moduleFileName,
    toProjectRelativePath,
  });
  console.info(impactLog.logLine);

  // 6. 재빌드
  try {
    await rebuild();
  } catch (error) {
    if (error instanceof DiagnosticReportError) {
      reportDiagnostics({ diagnostics: [error.diagnostic] });
    }
  }
});

process.on('SIGINT', () => {
  unsubscribe();
  void ledger.close();
});
```

**핵심 차이점 요약**:
- `OwnerElection` 제거 → gildash 자동 owner/reader. `Gildash.open()` 시 결정.
- `ProjectWatcher` 제거 → gildash owner의 내장 @parcel/watcher.
- `ChangesetWriter` 제거 → `IndexResult.changedFiles` / `.deletedFiles`로 수신.
- `buildModuleImpact` 제거 → `ledger.getAffected()` (파일 레벨) + `ModuleDiscovery` 재매핑 (새 `buildDevIncrementalImpactLog`).
- **reader mode**: gildash reader는 읽기 전용. 60초 폴링으로 owner stale 감지 시 자가 승격. reader에서 `onIndexed`가 트리거되지 않으면 fallback 필요 → 섹션 10.
- **@parcel/watcher 직접 import 제거**: reader의 `watcher.subscribe(cacheDir, ...)` 코드 전체 제거.

#### dev-incremental-impact.ts 재작성

현재 시그니처:
```typescript
function buildDevIncrementalImpactLog(params: {
  previousFileMap, nextFileMap, moduleFileName, changedFilePath, isDeleted, toProjectRelativePath
}): { impact: ModuleImpact | null; logLine: string }
```

새 시그니처:
```typescript
function buildDevIncrementalImpactLog(params: {
  affectedFiles: string[];
  fileCache: Map<string, FileAnalysis>;
  moduleFileName: string;
  toProjectRelativePath: (path: string) => string;
}): { affectedModules: Set<string>; logLine: string }
```

새 알고리즘:
1. `ModuleDiscovery(Array.from(fileCache.keys()), moduleFileName).discover()` → `moduleMap: Map<string, Set<string>>`
2. `affectedFiles`의 각 파일에 대해 moduleMap을 역매핑하여 소속 모듈 찾기
3. 영향 모듈 집합 반환 + 로그 라인 포매팅

이 함수는 `buildModuleImpact()`를 호출하지 않으며, `module-impact.ts`에 대한 의존성이 제거됨.

#### mcp.command.ts 변경 상세

**제거 대상 import**:
- `import { OwnerElection } from '../watcher/owner-election'`
- `import { emitReindexSignal } from '../watcher/reindex-signal'`

**추가 import**:
- `import { GildashProvider } from '../compiler/gildash-provider'`

**`rebuildProjectIndexDefault()` 변경**:

현재:
```typescript
const election = createOwnerElection({ projectRoot, pid });
const res = election.acquire();
if (res.role === 'reader') {
  await emit({ projectRoot, pid, nowMs });  // emitReindexSignal
  election.release();
  return { ok: true };
}
// owner: createDb → indexProject → closeDb → election.release()
```

교체:
```typescript
const ledger = await GildashProvider.open({ projectRoot });

// gildash의 owner/reader 역할은 자동 결정
// owner인 경우만 reindex() 가능
try {
  await ledger.reindex();
} catch (error) {
  // reader인 경우 reindex()는 에러 (owner 전용)
  // → reader에서는 재인덱싱 불가. owner의 자동 감시에 위임.
  if (!(error instanceof GildashError)) throw error;
  // reader: ok: true 반환. owner가 자동으로 인덱싱 수행 중.
}
await ledger.close();
return { ok: true };
```

**`RebuildProjectIndexDefaultDeps` 변경**:
- `createOwnerElection`, `emitReindexSignal` 필드 제거
- `createGildashProvider?: (options: GildashProviderOptions) => Promise<GildashProvider>` 추가

#### Phase 1 완료 기준

- [ ] dev 커맨드가 gildash 워처를 사용하여 파일 변경 감지 (owner mode)
- [ ] `onIndexed` 콜백에서 `result.changedFiles` → `getAffected()` → 영향 파일만 재파싱
- [ ] `result.deletedFiles` 처리 (fileCache에서 제거)
- [ ] `result.failedFiles` 로깅 (warning 진단)
- [ ] `dev-incremental-impact.ts`가 `buildModuleImpact` 미사용, `ModuleDiscovery` 재매핑으로 모듈 레벨 로그 유지
- [ ] mcp rebuild가 gildash 기반으로 동작 (owner: reindex, reader: ok 반환 위임)
- [ ] mcp.command.ts에서 `OwnerElection`, `emitReindexSignal` import 제거
- [ ] reader mode에서의 `onIndexed` 동작 검증 완료 (섹션 10)
- [ ] `TST-OVERFLOW` + `TST-PRUNE` 체크포인트 산출 완료
- [ ] RED → GREEN

#### Phase 1 롤백

`git revert` — Phase 0의 팩토리 구조에서 디폴트 deps가 기존 구현을 사용하므로 revert 후 원래 동작 복원.

---

### Phase 2: build.command.ts — gildash 순환 감지 보강

**목표**: build 커맨드에 gildash 파일 레벨 순환 감지를 추가.

**의존성**: Phase 0 완료 필수. Phase 1과 독립 (순차 실행).

#### 작업 파일 (수정)

| 파일 | 변경 내용 |
|---|---|
| `src/bin/build.command.ts` | gildash 인스턴스 열기/닫기 + hasCycle() 경고 |

#### 변경 상세

**추가 import**:
- `import { GildashProvider } from '../compiler/gildash-provider'`

**gildash 인스턴스 위치**: `validateCreateApplication(fileMap)` 직후, `ModuleGraph.build()` 직전.

```typescript
// fileMap 구축 완료 후 (기존 Glob + BFS 코드 유지)
validateCreateApplication(fileMap);

// gildash 파일 레벨 순환 감지 (보강)
const ledger = await GildashProvider.open({
  projectRoot,
  ignorePatterns: ['dist', 'node_modules', '.zipbul'],
});

const hasFileCycle = await ledger.hasCycle();
if (hasFileCycle) {
  const diagnostic = buildDiagnostic({
    code: 'FILE_CYCLE_DETECTED',
    severity: 'warning',
    summary: 'File-level circular dependency detected.',
    reason: 'gildash detected a circular import chain. Check import graph.',
    file: '.',
  });
  reportDiagnostics({ diagnostics: [diagnostic] });
}

// ModuleGraph.build()는 모듈 레벨 순환을 내부적으로 감지하며, 발견 시 Error throw.
// hasCycle()은 파일 레벨이므로 별도 관심사. 둘 다 실행.
const graph = new ModuleGraph(fileMap, moduleFileName);
graph.build();  // 모듈 레벨 순환 시 여기서 throw

// ... 이후 동일 ...

await ledger.close();
```

**`hasCycle()`과 ModuleGraph 순환 감지의 관계**:
- `hasCycle()`: **파일 레벨** 순환. A.ts→B.ts→A.ts. 심각도: **warning** (파일 순환이 항상 문제는 아님).
- `ModuleGraph.build()`: **모듈 레벨** 순환. moduleA→moduleB→moduleA. 심각도: **fatal** (build throw).
- 두 감지는 **서로 다른 관심사**. 파일 순환은 경고만, 모듈 순환은 빌드 중단. 동시 실행.

**`ledger.close()` 위치**: 빌드 성공/실패와 무관하게 반드시 호출. try-finally로 보장.

```typescript
const ledger = await GildashProvider.open({ ... });
try {
  // ... hasCycle, ModuleGraph, ManifestGenerator, Bun.build ...
} finally {
  await ledger.close();
}
```

**gildash 인덱스 범위 vs fileMap 범위 차이에 대한 참고**:
- gildash: `projectRoot` 아래 모든 `.ts` 파일 인덱싱 (ignorePatterns 제외)
- build의 fileMap: entry에서 BFS 도달 가능 파일만 포함
- `hasCycle()`은 gildash 전체 인덱스 기준. 도달 불가능 파일 간의 순환도 감지할 수 있음.
- 이는 **의도된 동작**: 프로젝트 전체 health check.
- `getDependencies()`/`getDependents()`는 Phase 2에서 사용하지 않으므로 범위 불일치 이슈 없음.

#### Phase 2 완료 기준

- [ ] build에서 `GildashProvider.open()` → `hasCycle()` → `close()` 정상 동작
- [ ] `hasCycle()` true → `FILE_CYCLE_DETECTED` warning 진단 출력
- [ ] `ModuleGraph.build()` 모듈 순환 → 기존 Fatal 동작 유지
- [ ] `ledger.close()`가 try-finally로 항상 호출
- [ ] 기존 빌드 결과와 동일한 manifest 출력 (결정론적 guardrail 통과)
- [ ] `TST-OVERFLOW` + `TST-PRUNE` 체크포인트
- [ ] RED → GREEN

#### Phase 2 롤백

`git revert` — hasCycle() 추가만이므로 기존 빌드 로직에 영향 없음.

---

### Phase 3: 데드 코드 제거 & 정리

**목표**: gildash로 대체된 컴포넌트와 그 테스트를 삭제. barrel export 정리.

**의존성**: Phase 1 + Phase 2 **모두** 완료 필수

#### 삭제 전 검증

Phase 3 실행 전, 아래 검증을 **반드시** 수행:
1. `grep -r "from.*watcher/project-watcher\|from.*watcher/owner-election\|from.*watcher/changeset\|from.*watcher/reindex-signal\|from.*incremental/module-impact" src/ test/` → 0건 확인
2. `knip` 실행 → 삭제 대상 파일이 unused로 보고되는지 확인

#### 삭제 대상 파일

| 파일 | 줄 수 | 삭제 사유 |
|---|---:|---|
| `src/watcher/project-watcher.ts` | 55 | gildash 내장 watcher로 대체 (Phase 1) |
| `src/watcher/project-watcher.spec.ts` | — | 위 파일의 unit test |
| `src/watcher/owner-election.ts` | 131 | gildash owner/reader 패턴으로 대체 (Phase 1) |
| `src/watcher/owner-election.spec.ts` | — | 위 파일의 unit test |
| `src/watcher/changeset.ts` | 101 | `IndexResult.changedFiles`로 대체 (Phase 1) |
| `src/watcher/changeset.spec.ts` | — | 위 파일의 unit test |
| `src/watcher/reindex-signal.ts` | 75 | gildash 자동 인덱싱으로 대체 (Phase 1) |
| `src/watcher/reindex-signal.spec.ts` | — | 위 파일의 unit test |
| `src/watcher/interfaces.ts` | 4 | `FileChangePayload` — `project-watcher.ts`에서만 사용, 함께 삭제 |
| `src/compiler/analyzer/incremental/module-impact.ts` | 152 | `getAffected()` + `ModuleDiscovery` 재매핑으로 대체 (Phase 1) |
| `src/compiler/analyzer/incremental/module-impact.spec.ts` | — | 위 파일의 unit test |
| `src/bin/dev-incremental-impact.spec.ts` | — | Phase 1에서 `dev-incremental-impact.ts` 재작성 시 spec도 재작성됨. 기존 spec 삭제. |
| `test/incremental-impact.spec.ts` | — | `buildModuleImpact`의 integration test. `buildModuleImpact` 삭제로 불필요. |

#### 수정 대상 파일

| 파일 | 변경 내용 |
|---|---|
| `src/watcher/index.ts` | 모든 re-export 제거 (파일 자체를 빈 파일로 만들거나, 남은 export가 없으면 파일 삭제) |
| `src/compiler/analyzer/index.ts` | `incremental/` 관련 re-export 제거 (현재 incremental을 export하고 있다면) |

#### Phase 3 완료 기준

- [ ] 삭제된 파일의 import를 참조하는 코드가 **0건** (`grep` 검증)
- [ ] `knip` (데드 코드 검사) 통과
- [ ] TypeScript 컴파일 에러 없음
- [ ] 전체 테스트 스위트 GREEN

#### Phase 3 롤백

`git revert` — 삭제 파일 복원. Phase 1/2에서 이미 이 파일들을 import하지 않으므로 복원해도 충돌 없음.

---

### Phase 4: AdapterSpecResolver 개선 (선택)

**목표**: AdapterSpecResolver의 re-export 체인 추적에 gildash `searchRelations`를 활용하여 최적화.

**의존성**: Phase 0 + Phase 2 완료 필수

#### 작업 파일 (수정)

| 파일 | 변경 내용 |
|---|---|
| `src/compiler/analyzer/adapter-spec-resolver.ts` | gildash `searchRelations` 활용 |
| `src/compiler/analyzer/adapter-spec-resolver.spec.ts` | gildash mock 추가 |

#### 변경 상세

현재 AdapterSpecResolver는 `private parser = new AstParser()`를 보유하고, re-export 체인을 따라가며 각 파일을 on-demand 파싱한다.

최적화: gildash의 `searchRelations({ srcFilePath, type: 'imports' })`로 import 관계를 DB에서 조회하면, 파일을 다시 파싱하지 않고도 re-export 체인을 빠르게 추적할 수 있다.

```typescript
// 현재: re-export 체인 추적 시 매 파일을 AstParser로 파싱
// TO-BE: ledger.searchRelations({ srcFilePath: filePath, type: 'imports' })로 import 관계 조회
//        → dstFilePath를 따라가며 체인 추적
//        → adapterSpec export를 찾으면 해당 파일만 AstParser로 도메인 메타데이터 파싱
```

**주의**: 도메인 메타데이터(defineAdapter 호출 인자, adapterSpec 필드 등)는 여전히 AstParser로 추출해야 함. gildash는 re-export **관계 추적만** 대체.

#### Phase 4 완료 기준

- [ ] AdapterSpecResolver가 gildash `searchRelations`로 re-export 체인 추적
- [ ] `private parser = new AstParser()`는 도메인 메타데이터 파싱에만 사용 (on-demand 파싱 횟수 감소)
- [ ] 기존 adapterSpec 해석 결과와 동일한 출력
- [ ] `TST-OVERFLOW` + `TST-PRUNE` 체크포인트
- [ ] RED → GREEN

## 6. 영향 범위 전체 매트릭스

### 6.1 소스 파일 영향

| 파일 | Phase | 변경 유형 | 상세 |
|---|---|---|---|
| `src/compiler/gildash-provider.ts` | 0 | **신규 생성** | Gildash thin wrapper |
| `src/bin/build.command.ts` | 0, 2 | 수정 | DI 팩토리 (P0) + hasCycle() 경고 (P2) |
| `src/bin/dev.command.ts` | 0, 1 | **대규모 수정** | DI 팩토리 (P0) + Watch 인프라 전면 교체 (P1) |
| `src/bin/dev-incremental-impact.ts` | 1 | **재작성** | 시그니처 변경 + ModuleDiscovery 재매핑 |
| `src/bin/mcp.command.ts` | 1 | 수정 | rebuildProjectIndexDefault() → gildash 전환 |
| `src/bin/zp.ts` | 0 | 수정 | build/dev 팩토리 호출 + deps 조립 |
| `src/compiler/index.ts` | 0 | 수정 | GildashProvider re-export 추가 |
| `src/compiler/analyzer/index.ts` | 3 | 수정 | incremental/ export 제거 (있을 경우) |
| `src/compiler/analyzer/adapter-spec-resolver.ts` | 4 | 수정 | gildash searchRelations 활용 |
| `src/watcher/project-watcher.ts` | 3 | **삭제** | — |
| `src/watcher/owner-election.ts` | 3 | **삭제** | — |
| `src/watcher/changeset.ts` | 3 | **삭제** | — |
| `src/watcher/reindex-signal.ts` | 3 | **삭제** | — |
| `src/watcher/interfaces.ts` | 3 | **삭제** | FileChangePayload, project-watcher에서만 사용 |
| `src/watcher/index.ts` | 3 | 수정/삭제 | re-export 전부 제거 |
| `src/compiler/analyzer/incremental/module-impact.ts` | 3 | **삭제** | — |

### 6.2 테스트 파일 영향

| 테스트 파일 | Phase | 변경 유형 | 상세 |
|---|---|---|---|
| `src/compiler/gildash-provider.spec.ts` | 0 | **신규 생성** | GildashProvider unit test |
| `test/cli-build.test.ts` | 0 | **신규 생성** | build 커맨드 integration test |
| `test/cli-dev.test.ts` | 0 | **신규 생성** | dev 커맨드 integration test |
| `src/bin/dev-incremental-impact.spec.ts` | 1 | **재작성** | 새 시그니처에 맞게 재작성 |
| `src/bin/mcp.command.spec.ts` | 1 | 수정 | rebuildProjectIndex mock 업데이트 |
| `test/cli-mcp-serve.test.ts` | 1 | 확인 필요 | rebuildProjectIndex mock → DI 변경 시 업데이트 |
| `src/watcher/project-watcher.spec.ts` | 3 | **삭제** | — |
| `src/watcher/owner-election.spec.ts` | 3 | **삭제** | — |
| `src/watcher/changeset.spec.ts` | 3 | **삭제** | — |
| `src/watcher/reindex-signal.spec.ts` | 3 | **삭제** | — |
| `src/compiler/analyzer/incremental/module-impact.spec.ts` | 3 | **삭제** | — |
| `test/incremental-impact.spec.ts` | 3 | **삭제** | buildModuleImpact integration test |
| `src/compiler/analyzer/adapter-spec-resolver.spec.ts` | 4 | 수정 | gildash mock 추가 |

### 6.3 영향 없는 파일 (변경 사유 없음)

| 카테고리 | 파일 |
|---|---|
| 도메인 파서 | `ast-parser.ts`, `ast-parser.spec.ts`, `ast-type-resolver.ts` |
| 모듈 그래프 | `graph/module-graph.ts`, `graph/module-graph.spec.ts`, `graph/module-node.ts` |
| 모듈 발견 | `module-discovery.ts`, `module-discovery.spec.ts` |
| 검증 | `validation.ts` |
| 코드 생성 | `compiler/generator/*` 전체 |
| 코드 추출 | `compiler/extractors/*` 전체 |
| 설정 | `config/*` 전체 |
| 진단 | `diagnostics/*` 전체 |
| MCP 서버 | `mcp/*` 전체 (mcp.command.ts는 bin/ 아래, 별개) |
| 데이터 저장소 | `store/*` 전체 |
| 공통 유틸리티 | `common/*` 전체 |
| 기존 integration test | `test/mcp-index.test.ts`, `test/compiler-code-relations.test.ts`, `test/store.test.ts`, `test/verify-aot.ts` |

## 7. 에러 핸들링

### 7.1 진단 코드 매핑

기존 `PARSE_FAILED`는 AstParser 파싱 에러에 사용 중이므로, gildash 에러는 `GILDASH_` 접두어로 구분.

| gildash Error | CLI 진단 코드 | 심각도 | 처리 알고리즘 |
|---|---|---|---|
| `ParseError` | `GILDASH_PARSE_FAILED` (신규) | warning | `reportDiagnostics()` 후 빌드 계속. gildash 인덱스에서 해당 파일이 누락되지만 AstParser 파싱은 별도이므로 도메인 분석에는 영향 없음. |
| `WatcherError` | `GILDASH_WATCHER_FAILED` (신규) | error | `reportDiagnostics()` 후 dev watch 중단. 사용자에게 재시작 안내. gildash watcher 실패 시 `onIndexed` 콜백이 더 이상 호출되지 않으므로 fallback 불가. |
| `IndexError` | `GILDASH_INDEX_FAILED` (신규) | fatal | `reportDiagnostics()` 후 빌드 중단. |
| `StoreError` | `GILDASH_STORE_FAILED` (신규) | fatal | SQLite DB 손상 가능. `reportDiagnostics()` 후 빌드 중단. 사용자 안내: `.zipbul/cache` 삭제 후 재시작으로 DB 재생성 가능. |
| `SearchError` | `GILDASH_SEARCH_FAILED` (신규) | warning | `reportDiagnostics()` 후 빌드 계속. `hasCycle()` 등 gildash 보강 기능이 비활성. 기존 빌드 로직(ModuleGraph 등)은 gildash 독립적으로 정상 동작. |
| `GildashError` (기타) | `GILDASH_ERROR` (신규) | fatal | 원인 로깅 후 빌드 중단. |

### 7.2 에러 핸들링 패턴

GildashProvider는 gildash 에러를 **그대로 throw**한다 (변환하지 않음). 에러 처리는 호출자(커맨드)에서 수행.

```typescript
// 커맨드에서의 처리 패턴
try {
  const ledger = await GildashProvider.open({ ... });
  // ... 사용 ...
} catch (error) {
  if (error instanceof ParseError) {
    reportDiagnostics({ diagnostics: [buildDiagnostic({ code: 'GILDASH_PARSE_FAILED', ... })] });
    // warning: 빌드 계속
  } else if (error instanceof WatcherError) {
    reportDiagnostics({ diagnostics: [buildDiagnostic({ code: 'GILDASH_WATCHER_FAILED', ... })] });
    // error: watch 중단
  } else if (error instanceof GildashError) {
    reportDiagnostics({ diagnostics: [buildDiagnostic({ code: 'GILDASH_ERROR', ... })] });
    throw error;  // fatal: 빌드 중단
  }
}
```

## 8. 성능 분석

### 8.1 성능 기대치

| 지표 | AS-IS | TO-BE | 분석 |
|---|---|---|---|
| 초기 빌드 (최초) | Glob + AstParser 전파일 파싱 | Glob + AstParser 전파일 파싱 + **gildash 백그라운드 인덱싱** | **NOT 개선**: build는 기존 로직 유지 + gildash 추가. 다만 gildash 인덱싱은 SQLite 캐싱이므로 2회차부터 캐시 히트. |
| 초기 빌드 (2회차+) | 동일 | gildash SQLite 캐시 히트 → hasCycle() 즉시 응답 | 약간 개선 (hasCycle 캐시) |
| dev 초기 분석 | Glob + AstParser 전파일 | Glob + AstParser 전파일 + gildash 백그라운드 | 동일 (gildash는 백그라운드) |
| dev 증분 (owner) | 단일 파일 AstParser 재파싱 + buildModuleImpact(JS BFS) | `getAffected()`(SQLite 그래프 쿼리) + 영향 파일만 AstParser 재파싱 | **개선**: JS BFS 대신 SQLite 쿼리. 영향 범위 파일만 재파싱. |
| dev 증분 (reader) | 전파일 re-scan (Glob + AstParser 전부) | gildash reader 자동 동기 | **대폭 개선**: reader의 전파일 재스캔이 제거 가능 (onIndexed 검증 조건부) |
| 파일 변경 감지 | @parcel/watcher + OwnerElection | gildash 내장 @parcel/watcher | 동등 (동일 라이브러리) |
| 순환 감지 | ModuleGraph.detectCycles() (JS) | hasCycle()(SQLite) + ModuleGraph | hasCycle()는 빠름. ModuleGraph 동일. |

### 8.2 이중 파싱 리스크

TO-BE에서 **동일 파일이 두 번 파싱**된다:
1. **gildash 인덱싱**: oxc-parser로 심볼/관계 추출 → SQLite 저장
2. **AstParser**: oxc-parser로 도메인 메타데이터(ClassMetadata, ModuleDefinition 등) 추출

이 이중 파싱은 의도적 트레이드오프:
- gildash는 범용 심볼/관계만 추출. zipbul 도메인 구조체를 추출할 수 없음.
- AstParser 제거는 불가능. gildash가 AstParser를 대체하지 못함.
- gildash 인덱싱은 **백그라운드/incremental**이므로 사용자 체감 지연은 적음.
- 최초 빌드 시에만 양쪽 모두 전파일 파싱. 이후 gildash는 변경 파일만 재인덱싱.

## 9. 롤백 전략

각 Phase를 독립 커밋으로 관리. 롤백은 `git revert`로 수행.

| Phase | 롤백 영향 |
|---|---|
| Phase 0 | 안전. 팩토리 추가 + 디폴트 export 유지. revert 시 기존 직접 호출로 복원. |
| Phase 1 | revert 시 dev/mcp의 Watch 인프라가 기존(OwnerElection+ProjectWatcher)으로 복원. Phase 0 팩토리의 디폴트 deps가 기존 구현을 사용하므로 정상 동작. |
| Phase 2 | 안전. hasCycle() 경고 제거만. 기존 빌드 로직에 영향 없음. |
| Phase 3 | revert하면 삭제 파일 복원. Phase 1/2에서 이미 import하지 않으므로 컴파일 에러 없음. 단, 데드 코드 상태로 존재. |
| Phase 4 | 안전. AdapterSpecResolver 최적화 제거. 기존 on-demand 파싱으로 복원. |

## 10. 미확인 사항 및 검증 필요 항목

### 10.1 reader에서 `onIndexed()` 콜백 트리거 여부

**상태**: gildash v0.0.2 공식 문서에 reader의 `onIndexed` 동작이 명시되지 않음.

**검증 방법** (Phase 1 구현 전 수행):
1. 두 프로세스에서 같은 `projectRoot`로 `Gildash.open()` 호출
2. 첫 번째 프로세스(owner)에서 파일 변경 → 인덱싱
3. 두 번째 프로세스(reader)에서 `onIndexed()` 콜백 호출 여부 확인

**결과에 따른 분기**:

| 결과 | 전략 |
|---|---|
| reader에서 `onIndexed` 트리거됨 | 이상적. dev reader mode에서 `onIndexed` 사용. |
| reader에서 `onIndexed` 트리거 안 됨 | **fallback 필요**: reader는 polling 방식으로 `ledger.getStats()`를 주기적 호출하여 `fileCount`/`symbolCount` 변화 감지 → 변화 시 전파일 재분석 + rebuild. 이 경우 dev-incremental-impact의 영향 분석은 reader에서 불가. |

**이 검증은 Phase 1 첫 단계에서 수행하며, 결과에 따라 Phase 1 구현 방향이 달라짐.**

### 10.2 `reindex()` reader 호출 시 에러 타입

**상태**: gildash 문서 "Only available when the instance holds the owner role"이라고만 기술. reader에서 호출 시 어떤 에러가 throw되는지 (GildashError? IndexError?) 불명확.

**검증 방법**: reader 인스턴스에서 `ledger.reindex()` 호출 → catch한 에러의 `constructor.name` 확인.

**영향**: mcp rebuild의 reader 분기에서 catch 조건에 영향.

### 10.3 gildash 인덱싱 완료 타이밍

**상태**: `Gildash.open()` 반환 시점에 최초 인덱싱이 완료된 상태인지, 아니면 백그라운드에서 진행 중인지 불명확.

**검증 방법**: `Gildash.open()` 직후 `ledger.getStats()` 호출 → `fileCount > 0` 확인.

**영향**: build에서 `hasCycle()`를 `open()` 직후에 호출할 경우, 인덱싱 미완료 시 빈 그래프에서 false 반환 가능.

## 11. 실행 순서

```
Phase 0  →  Phase 1  →  Phase 3
             ↓
Phase 0  →  Phase 2  →  Phase 3

Phase 4는 Phase 2 이후 언제든 가능 (독립)
```

**실행 순서**: Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 (순차)

- Phase 0 완료 후 Phase 1 시작기 (dev/mcp Watch 인프라 교체가 가장 복잡하고 영향 범위 큼)
- Phase 1 완료 후 Phase 2 시작 (build 변경은 Phase 1보다 단순하지만, 둘 다 GildashProvider에 의존하므로 순차)
- Phase 3은 Phase 1 + Phase 2 **모두 완료 후** (삭제 대상이 실제 미사용인 것을 확인)
- Phase 4는 Phase 2 이후 언제든 가능 (AdapterSpecResolver는 Phase 1/3과 독립)

**각 Phase는 독립 커밋. Test-First Flow (OVERFLOW→PRUNE→RED→GREEN) 적용.**
