# gildash 0.4.0 CLI 마이그레이션 실행 계획

> **목적**: gildash 0.4.0 출시 시 CLI 패키지에서 수행할 작업의 실행 순서, 대상 파일, 삭제/수정 범위, 테스트 전략을 정의한다.
> AS-IS 분석은 `CLI.md`를 참조.

## 전제 조건

- gildash 0.4.0이 npm에 퍼블리시된 상태
- gildash 0.4.0 확정 API:
  1. `listIndexedFiles(project?)` — 인덱싱된 모든 파일 목록 (심볼 없는 파일 포함)
  2. `getCyclePaths(project?)` — 순환 의존 경로 배열 반환
  3. `SymbolSearchQuery.decorator` — 데코레이터 이름 기반 심볼 필터
  4. `CodeRelation.meta` — 파싱된 객체 필드 (JSON.parse 불필요)
  5. `DependencyGraph` 내부 캐싱 — `getAffected()` 반복 호출 성능 향상
  6. re-export relation의 `meta.specifiers` — named specifier 기록

## 아키텍처 결정 사항

| 결정 | 근거 |
|---|---|
| dev.command.ts가 gildash **owner**로 동작 | 파일 감시 + 인덱싱 주체 |
| MCP 서버는 gildash **reader**로 동작 | SQLite WAL 모드로 owner와 동시 접근 안전 |
| MCP ↔ dev 간 IPC 없음 | reader가 호출 시점에 DB를 직접 쿼리 (query-at-call-time) |
| `onIndexed`는 cross-process 불가 | MCP는 reader이므로 해당 없음. 최신 데이터는 쿼리 시점에 WAL에서 읽힘 |
| `CodeRelation.meta`는 Option A (파싱된 객체 필드) | 메인테이너 확정 |

---

## Phase 0 — 사전 작업 (gildash 0.3.1 bump)

> gildash 0.4.0 마이그레이션 전에 먼저 0.3.1로 올려 oxc-parser peerDep 구조를 확보한다.

### 수정 대상

| 파일 | 변경 내용 |
|---|---|
| `package.json` | `@zipbul/gildash`: `"0.2.0"` → `"0.3.1"` |
| `package.json` | `dependencies`에 `"oxc-parser": ">=0.114.0"` 추가 |

### 검증

```bash
bun install
bun test --filter "gildash"
```

### 커밋 단위

```
deps(cli): bump @zipbul/gildash 0.2.0 → 0.3.1, add oxc-parser peer
```

---

## Phase 1 — MCP 인프라 교체

> 가장 큰 규모의 변경. store/, watcher/, mcp/index/ 전체 삭제 후 mcp-server.ts를 gildash reader API 기반으로 재작성한다.

### 1-A. 삭제 대상 (17파일, ~1,700줄)

#### `src/store/` — 커스텀 drizzle DB 레이어 (8파일, 614줄)

| 파일 | 줄 수 | 역할 |
|---|---|---|
| `connection.ts` | 85 | SQLite 연결 생성/종료 |
| `connection.spec.ts` | 141 | connection 테스트 |
| `schema.ts` | 78 | codeEntity, codeRelation, codeFts 테이블 정의 |
| `store-ops.ts` | 76 | upsert/delete/search 연산 |
| `store-ops.spec.ts` | 221 | store-ops 테스트 |
| `index.ts` | 5 | barrel export |
| `interfaces.ts` | 7 | StoreDb 타입 |
| `types.ts` | 1 | 타입 re-export |

#### `src/watcher/` — 커스텀 OwnerElection (4파일, 362줄)

| 파일 | 줄 수 | 역할 |
|---|---|---|
| `owner-election.ts` | 131 | 프로세스 간 owner 선출 (lock file 기반) |
| `owner-election.spec.ts` | 229 | owner-election 테스트 |
| `index.ts` | 1 | barrel export |
| `test/types.ts` | 1 | 테스트 타입 |

#### `src/mcp/index/` — 커스텀 인덱싱 파이프라인 (2파일, 716줄)

| 파일 | 줄 수 | 역할 |
|---|---|---|
| `index-project.ts` | 635 | parseSync → 심볼 추출 → drizzle DB upsert → fingerprint move tracking |
| `index-project.spec.ts` | 81 | index-project 테스트 |

#### `drizzle/` — 마이그레이션 파일 (2파일)

| 파일 | 역할 |
|---|---|
| `drizzle/0000_init.sql` | 초기 스키마 SQL |
| `drizzle/meta/_journal.json` | drizzle 마이그레이션 저널 |

#### 루트 설정 (1파일)

| 파일 | 역할 |
|---|---|
| `drizzle.config.ts` | drizzle-kit 설정 |

### 1-B. 의존성 제거

| 패키지 | 위치 | 비고 |
|---|---|---|
| `drizzle-orm` | `dependencies` | store/ 삭제로 불필요 |
| `drizzle-kit` | `devDependencies` | 마이그레이션 툴 불필요 |
| `@parcel/watcher` | `dependencies` | gildash owner가 내부 사용 |
| `@libsql/client` | `devDependencies` | drizzle 연동용, 불필요 |

`package.json`의 `scripts`에서도 `drizzle:generate`, `drizzle:migrate` 제거.

### 1-C. 수정 대상

#### `src/mcp/server/mcp-server.ts` (454줄 → 전면 리팩터링)

**현재 import 제거:**
```typescript
// 삭제
import { indexProject } from '../index/index-project';
import { closeDb, createDb } from '../../store/connection';
import { OwnerElection } from '../../watcher/owner-election';
import { eq, sql } from 'drizzle-orm';
import { codeEntity, codeFts } from '../../store/schema';
```

**신규 import:**
```typescript
import { Gildash } from '@zipbul/gildash';
```

**주요 변경:**

| 현재 로직 | 0.4.0 대체 |
|---|---|
| `createDb()` → drizzle SQLite 연결 | `Gildash.open({ mode: 'reader' })` |
| `OwnerElection.acquire()` | 제거 (reader 모드는 election 불필요) |
| `indexProject()` → 커스텀 파이프라인 | 제거 (owner가 인덱싱 담당) |
| `@parcel/watcher` → dynamic import 감시 | 제거 |
| drizzle FTS5 쿼리 (`codeFts`, `codeEntity`) | `gildash.searchSymbols(query)` |
| `eq(codeEntity.entityKey, ...)` 조회 | `gildash.getSymbolsByFile(filePath)` |
| 수동 `closeDb()` | `gildash.close()` |

#### `src/mcp/server/mcp-server.spec.ts` (495줄 → 전면 재작성)

store/watcher mock 기반 테스트를 gildash reader API mock 기반으로 교체.

### 1-D. 검증

```bash
# 삭제 후 import 오류 없는지 확인
bun typecheck

# MCP 서버 테스트
bun test --filter "mcp-server"

# 전체 테스트
bun test
```

### 1-E. 커밋 단위

```
refactor(cli/mcp): replace custom store/watcher/indexer with gildash reader API

BREAKING CHANGE: drizzle-orm, @parcel/watcher no longer used by MCP server.
Gildash owner provides indexing; MCP opens as reader with WAL isolation.

Removed:
- src/store/ (8 files, 614 lines)
- src/watcher/ (4 files, 362 lines)
- src/mcp/index/ (2 files, 716 lines)
- drizzle/ (2 files)
- drizzle.config.ts
```

---

## Phase 2 — build.command.ts: getCyclePaths()

> `hasCycle()` → `getCyclePaths()`로 교체하여 순환 경로를 diagnostic에 포함시킨다.

### 수정 대상

| 파일 | 현재 | 변경 후 |
|---|---|---|
| `src/bin/build.command.ts` L222 | `const hasFileCycle = await ledger.hasCycle()` | `const cyclePaths = await ledger.getCyclePaths()` |
| 같은 파일 L223-231 | `if (hasFileCycle)` → 일반 경고 메시지 | `if (cyclePaths.length > 0)` → 각 cycle 경로를 diagnostic에 포함 |
| `src/compiler/gildash-provider.ts` | `hasCycle(): Promise<boolean>` | `getCyclePaths(): Promise<string[][]>` 추가 (hasCycle은 유지 또는 제거) |

### 기대 효과

**Before:**
```
⚠ File-level circular dependency detected.
  gildash detected a circular import chain. Check import graph.
```

**After:**
```
⚠ File-level circular dependency detected.
  Cycle 1: src/a.ts → src/b.ts → src/c.ts → src/a.ts
  Cycle 2: src/x.ts → src/y.ts → src/x.ts
```

### 검증

```bash
bun test --filter "build.command"
```

### 커밋 단위

```
feat(cli/build): show cycle paths in file-cycle diagnostic
```

---

## Phase 3 — gildash-provider.ts 새 API 위임

> 0.4.0에서 추가되는 API를 GildashProvider에 위임 메서드로 노출한다.

### 수정 대상

| 파일 | 변경 |
|---|---|
| `src/compiler/gildash-provider.ts` (98줄) | 아래 메서드 추가 |

### 추가 메서드

```typescript
// 0.3.0에서 추가된 API
getParsedAst(filePath: string): ParsedFile
getFileInfo(filePath: string): FileRecord
getSymbolsByFile(filePath: string): CodeEntity[]
searchSymbols(query: SymbolSearchQuery): CodeEntity[]

// 0.4.0에서 추가된 API
listIndexedFiles(project?: string): string[]
getCyclePaths(project?: string): string[][]
searchRelations(query: RelationSearchQuery): CodeRelation[]
```

모든 메서드는 기존 패턴 유지: `Result → isErr → throw`.

### 검증

```bash
bun test --filter "gildash-provider"
```

### 커밋 단위

```
feat(cli): expose gildash 0.4.0 APIs in GildashProvider
```

---

## Phase 4 — adapter-spec-resolver.ts 최적화 (선택)

> re-export 체인 추적에서 개별 `parseSync()` 호출을 `searchRelations` + `meta.specifiers`로 대체한다.

### 배경

현재 `adapter-spec-resolver.ts` (970줄) L1에서 `parseSync`를 import하고 L234에서 개별 파일을 파싱하여 re-export specifier를 추적한다. gildash 0.4.0의 `searchRelations`이 relation 레벨에서 `meta.specifiers`를 제공하므로, 개별 파일 파싱 없이 relation 쿼리로 대체 가능하다.

### 수정 대상

| 파일 | 변경 |
|---|---|
| `src/compiler/analyzer/adapter-spec-resolver.ts` | re-export chain tracing 로직에서 `parseSync` → `searchRelations` + `meta.specifiers` |

### 주의사항

- 이 Phase는 **성능 최적화**이며 기능 변경이 아님
- 기존 `parseSync` 기반 로직이 정확히 동작하므로 0.4.0 출시 직후 필수가 아님
- `meta.specifiers`가 현재 parseSync 결과와 동일한 정보를 제공하는지 0.4.0 출시 후 검증 필요

### 검증

```bash
bun test --filter "adapter-spec-resolver"
```

### 커밋 단위

```
perf(cli/analyzer): use searchRelations for re-export chain tracing
```

---

## 실행 순서 요약

```
Phase 0  deps bump (0.3.1 + oxc-parser)
  │
  ▼
Phase 1  MCP 인프라 교체 (~1,700줄 삭제, mcp-server.ts 재작성)
  │
  ▼
Phase 2  build.command getCyclePaths() 교체
  │
  ▼
Phase 3  gildash-provider 새 API 위임
  │
  ▼
Phase 4  adapter-spec-resolver 최적화 (선택)
```

- Phase 0은 0.4.0 대기 중에도 즉시 실행 가능
- Phase 1~3은 gildash 0.4.0 퍼블리시 후 순차 실행
- Phase 4는 Phase 1~3 완료 후 별도 판단

## 총 영향 범위

| 구분 | 파일 수 | 줄 수 (approx) |
|---|---|---|
| 삭제 | 17 | ~1,700 |
| 전면 재작성 | 2 | ~950 (mcp-server.ts + spec) |
| 부분 수정 | 3 | ~50 (build.command, gildash-provider, adapter-spec-resolver) |
| 의존성 제거 | 4 | drizzle-orm, drizzle-kit, @parcel/watcher, @libsql/client |
| **순 코드 감소** | — | **~1,000줄 이상** |
