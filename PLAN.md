# Emberdeck 분리 실행계획

> 상태: 실행 준비 완료
> 작성일: 2026-02-19
> 목표: 카드 시스템을 `emberdeck` 패키지로 완전 분리. Zipbul 내부 의존 0건.

---

## 0. 절대 규칙

| # | 규칙 |
|---|---|
| R1 | 패키지명 `emberdeck` (unscoped) |
| R2 | 범위 = **카드 시스템 로직만** (watcher, MCP 서버, AOT 컴파일러 제외) |
| R3 | Repository 패턴 필수 (인터페이스 → Drizzle 구현) |
| R4 | Drizzle ORM + drizzle-kit migration 필수 |
| R5 | `sql\`\``, `sql.raw`, `sql.unsafe`, `Bun.SQL` 금지 |
| R6 | `@zipbul/*` import 0건 |
| R7 | watcher는 외부 존재 가정. emberdeck은 **sync API만** 제공 |
| R8 | 테스트: `bun:test`, BDD, AAA, RED→GREEN |

---

## 1. 디렉토리 구조

```text
packages/emberdeck/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── index.ts                         ← public API barrel
├── src/
│   ├── config.ts                    ← EmberdeckOptions, DEFAULT_RELATION_TYPES
│   ├── setup.ts                     ← setupEmberdeck(), teardownEmberdeck()
│   ├── card/                        ← 순수 도메인 (I/O 없음)
│   │   ├── types.ts                 ← CardStatus, CardRelation, CardFrontmatter, CardFile
│   │   ├── card-key.ts              ← normalizeSlug, parseFullKey, buildCardPath
│   │   ├── markdown.ts              ← parseCardMarkdown, serializeCardMarkdown
│   │   └── errors.ts               ← CardKeyError, CardNotFoundError, …
│   ├── fs/                          ← 카드 파일 I/O
│   │   ├── reader.ts               ← readCardFile
│   │   └── writer.ts               ← writeCardFile, deleteCardFile
│   ├── db/                          ← 영속성 계층
│   │   ├── schema.ts               ← card, cardRelation, keyword, tag, cardKeyword, cardTag, cardFts
│   │   ├── connection.ts            ← createEmberdeckDb, migrateEmberdeck, closeDb
│   │   ├── repository.ts           ← CardRepository, RelationRepository, ClassificationRepository 인터페이스
│   │   ├── card-repo.ts            ← DrizzleCardRepository
│   │   ├── relation-repo.ts        ← DrizzleRelationRepository
│   │   └── classification-repo.ts  ← DrizzleClassificationRepository
│   └── ops/                         ← CRUD 오케스트레이션 (fs + db 조합)
│       ├── create.ts
│       ├── update.ts
│       ├── delete.ts
│       ├── rename.ts
│       ├── query.ts                 ← getCard, listCards, searchCards
│       └── sync.ts                  ← syncCardFromFile, removeCardByFile
├── drizzle/                          ← drizzle-kit migration 출력
└── test/
    ├── helpers.ts                    ← createTestContext, cleanup
    ├── card/
    │   ├── card-key.spec.ts
    │   └── markdown.spec.ts
    ├── db/
    │   ├── card-repo.spec.ts
    │   ├── relation-repo.spec.ts
    │   └── classification-repo.spec.ts
    ├── ops/
    │   ├── create.spec.ts
    │   ├── update.spec.ts
    │   ├── delete.spec.ts
    │   ├── rename.spec.ts
    │   └── sync.spec.ts
    └── migration.spec.ts
```

---

## 2. 모듈 의존 그래프

```text
config.ts ──┐
card/    ←──┼── fs/ ←──┐
            └── db/ ←──┴── ops/
                            ↑
                         setup.ts ← index.ts
```

**금지 방향** (위반 시 순환 의존):
- `card/` → `fs/`, `db/`, `ops/`
- `fs/` → `ops/`
- `db/` → `ops/`, `fs/`

---

## 3. 파일별 상세 명세

### 3.1 `package.json`

```json
{
  "name": "emberdeck",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "module": "index.ts",
  "scripts": {
    "test": "bun test",
    "drizzle:generate": "bunx drizzle-kit generate --config drizzle.config.ts",
    "drizzle:migrate": "bunx drizzle-kit migrate --config drizzle.config.ts"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.1"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.9",
    "@types/bun": "^1.3.0"
  }
}
```

### 3.2 `tsconfig.json`

```json
{
  "extends": "../../tsconfig.json"
}
```

### 3.3 `drizzle.config.ts`

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'file:./.zipbul/cache/emberdeck.sqlite',
  },
} satisfies Config;
```

---

### 3.4 `src/config.ts`

```ts
import type { EmberdeckDb } from './db/connection';
import type { CardRepository, RelationRepository, ClassificationRepository } from './db/repository';

export const DEFAULT_RELATION_TYPES = [
  'depends-on',
  'references',
  'related',
  'extends',
  'conflicts',
] as const;

export type DefaultRelationType = (typeof DEFAULT_RELATION_TYPES)[number];

export interface EmberdeckOptions {
  /** 카드 .card.md 파일이 저장되는 절대 경로 디렉토리 */
  cardsDir: string;
  /** SQLite DB 파일 절대 경로. ':memory:' 허용 */
  dbPath: string;
  /** 허용 관계 타입. 미지정 시 DEFAULT_RELATION_TYPES 사용 */
  allowedRelationTypes?: readonly string[];
}

export interface EmberdeckContext {
  cardsDir: string;
  db: EmberdeckDb;
  cardRepo: CardRepository;
  relationRepo: RelationRepository;
  classificationRepo: ClassificationRepository;
  allowedRelationTypes: readonly string[];
}
```

---

### 3.5 `src/setup.ts`

```ts
import { createEmberdeckDb, closeDb, type EmberdeckDb } from './db/connection';
import { DrizzleCardRepository } from './db/card-repo';
import { DrizzleRelationRepository } from './db/relation-repo';
import { DrizzleClassificationRepository } from './db/classification-repo';
import { DEFAULT_RELATION_TYPES, type EmberdeckContext, type EmberdeckOptions } from './config';

export function setupEmberdeck(options: EmberdeckOptions): EmberdeckContext {
  const db = createEmberdeckDb(options.dbPath);
  return {
    cardsDir: options.cardsDir,
    db,
    cardRepo: new DrizzleCardRepository(db),
    relationRepo: new DrizzleRelationRepository(db),
    classificationRepo: new DrizzleClassificationRepository(db),
    allowedRelationTypes: options.allowedRelationTypes ?? [...DEFAULT_RELATION_TYPES],
  };
}

export function teardownEmberdeck(ctx: EmberdeckContext): void {
  closeDb(ctx.db);
}
```

---

### 3.6 `src/card/types.ts`

기존 `packages/cli/src/mcp/card/types.ts` **그대로 복사**. 변경 0건.

```ts
export type CardStatus =
  | 'draft'
  | 'accepted'
  | 'implementing'
  | 'implemented'
  | 'deprecated';

export interface CardRelation {
  type: string;
  target: string;
}

export interface CardFrontmatter {
  key: string;
  summary: string;
  status: CardStatus;
  tags?: string[];
  keywords?: string[];
  constraints?: unknown;
  relations?: CardRelation[];
}

export interface CardFile {
  frontmatter: CardFrontmatter;
  body: string;
  filePath?: string;
}
```

---

### 3.7 `src/card/card-key.ts`

기존 `packages/cli/src/mcp/card/card-key.ts`에서 복사.

**변경 2건:**
1. `import { zipbulCardMarkdownPath }` 삭제 → `buildCardPath(cardsDir, slug)` 신규 함수로 대체
2. `throw new Error(...)` → `throw new CardKeyError(...)` 로 에러 클래스 변경

```ts
import { join } from 'node:path';

const CARD_SLUG_RE =
  /^(?![A-Za-z]:)(?!.*::)(?!.*:)(?!.*\/\/)(?!\.{1,2}$)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export class CardKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardKeyError';
  }
}

function assertValidSlug(slug: string): void {
  if (!CARD_SLUG_RE.test(slug)) {
    throw new CardKeyError(`Invalid card slug: ${slug}`);
  }
}

export function normalizeSlug(slug: string): string {
  const normalized = slug.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  assertValidSlug(normalized);
  return normalized;
}

export function parseFullKey(fullKey: string): string {
  if (typeof fullKey !== 'string' || fullKey.length === 0) {
    throw new CardKeyError('Invalid card key: empty');
  }
  return normalizeSlug(fullKey);
}

/**
 * cardsDir + slug → 카드 파일 절대 경로.
 * 기존 cardPathFromFullKey(projectRoot, fullKey) 대체.
 * projectRoot → cardsDir 변환은 CLI 어댑터 책임.
 */
export function buildCardPath(cardsDir: string, slug: string): string {
  return join(cardsDir, `${slug}.card.md`);
}
```

---

### 3.8 `src/card/markdown.ts`

기존 `packages/cli/src/mcp/card/card-markdown.ts` **전체 복사**.

**변경 1건:** `throw new Error(...)` → `throw new CardValidationError(...)` (import 추가)

```ts
import type { CardFile, CardFrontmatter, CardRelation, CardStatus } from './types';
import { CardValidationError } from './errors';
```

**구현 지시**: `packages/cli/src/mcp/card/card-markdown.ts`의 모든 내부 함수(`normalizeNewlines`, `isCardStatus`, `asString`, `normalizeKeywords`, `normalizeTags`, `normalizeRelations`, `coerceFrontmatter`)를 그대로 복사. 각 `throw new Error(...)` → `throw new CardValidationError(...)` 치환. export 함수 `parseCardMarkdown`, `serializeCardMarkdown` 동일 시그니처 유지. `Bun.YAML.parse`, `Bun.YAML.stringify` 사용 유지.

---

### 3.9 `src/card/errors.ts`

```ts
export { CardKeyError } from './card-key';

export class CardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardValidationError';
  }
}

export class CardNotFoundError extends Error {
  constructor(key: string) {
    super(`Card not found: ${key}`);
    this.name = 'CardNotFoundError';
  }
}

export class CardAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`Card already exists: ${key}`);
    this.name = 'CardAlreadyExistsError';
  }
}

export class CardRenameSamePathError extends Error {
  constructor() {
    super('No-op rename: source and target paths are identical');
    this.name = 'CardRenameSamePathError';
  }
}

export class RelationTypeError extends Error {
  constructor(type: string, allowed: readonly string[]) {
    super(`Invalid relation type "${type}". Allowed: ${allowed.join(', ')}`);
    this.name = 'RelationTypeError';
  }
}
```

---

### 3.10 `src/fs/reader.ts`

```ts
import type { CardFile } from '../card/types';
import { parseCardMarkdown } from '../card/markdown';

export async function readCardFile(filePath: string): Promise<CardFile> {
  const text = await Bun.file(filePath).text();
  const parsed = parseCardMarkdown(text);
  return { ...parsed, filePath };
}
```

### 3.11 `src/fs/writer.ts`

```ts
import type { CardFile } from '../card/types';
import { serializeCardMarkdown } from '../card/markdown';

export async function writeCardFile(filePath: string, card: CardFile): Promise<void> {
  const text = serializeCardMarkdown(card.frontmatter, card.body);
  await Bun.write(filePath, text);
}

export async function deleteCardFile(filePath: string): Promise<void> {
  const file = Bun.file(filePath);
  if (await file.exists()) {
    await file.delete();
  }
}
```

---

### 3.12 `src/db/schema.ts`

기존 `packages/cli/src/store/schema.ts`에서 **카드 관련 테이블만** 추출.

**포함**: `card`, `cardRelation`, `keyword`, `tag`, `cardKeyword`, `cardTag`, `cardFts`

**제외** (CLI 잔류): `metadata`, `codeEntity`, `codeRelation`, `cardCodeLink`, `fileState`, `codeFts`

**변경**: FK에 `onDelete: 'cascade'`, `onUpdate: 'cascade'` 추가 (기존 CLI는 `no action`).

```ts
import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

export const card = sqliteTable(
  'card',
  {
    rowid: integer('rowid'),
    key: text('key').primaryKey(),
    summary: text('summary').notNull(),
    status: text('status').notNull(),
    constraintsJson: text('constraints_json'),
    body: text('body'),
    filePath: text('file_path').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_card_status').on(table.status),
    index('idx_card_file_path').on(table.filePath),
  ],
);

export const keyword = sqliteTable('keyword', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const tag = sqliteTable('tag', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const cardKeyword = sqliteTable(
  'card_keyword',
  {
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keyword.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardKey, table.keywordId] }),
    index('idx_card_keyword_card').on(table.cardKey),
    index('idx_card_keyword_keyword').on(table.keywordId),
  ],
);

export const cardTag = sqliteTable(
  'card_tag',
  {
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardKey, table.tagId] }),
    index('idx_card_tag_card').on(table.cardKey),
    index('idx_card_tag_tag').on(table.tagId),
  ],
);

export const cardRelation = sqliteTable(
  'card_relation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    srcCardKey: text('src_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dstCardKey: text('dst_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    isReverse: integer('is_reverse', { mode: 'boolean' }).notNull().default(false),
    metaJson: text('meta_json'),
  },
  (table) => [
    index('idx_card_relation_src').on(table.srcCardKey),
    index('idx_card_relation_dst').on(table.dstCardKey),
    index('idx_card_relation_type').on(table.type),
  ],
);

/** FTS5 가상 테이블 매핑. 실제 생성은 수동 마이그레이션 SQL. */
export const cardFts = sqliteTable('card_fts', {
  rowid: integer('rowid'),
  key: text('key'),
  summary: text('summary'),
  body: text('body'),
});
```

---

### 3.13 `src/db/connection.ts`

기존 `packages/cli/src/store/store-ops.ts` + `connection.ts` 패턴 참고 신규 작성.

```ts
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Database } from 'bun:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

import * as schema from './schema';

export type EmberdeckDb = ReturnType<typeof drizzle<typeof schema>>;

const __dirname = dirname(fileURLToPath(import.meta.url));

function getMigrationsFolder(): string {
  return resolve(__dirname, '../../drizzle');
}

function configurePragmas(db: EmberdeckDb): void {
  const client = db.$client;
  client.run('PRAGMA journal_mode = WAL');
  client.run('PRAGMA foreign_keys = ON');
  client.run('PRAGMA busy_timeout = 5000');
}

/**
 * 독립 실행: 새 DB 열기 + pragma + migration.
 */
export function createEmberdeckDb(path: string): EmberdeckDb {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = new Database(path);
  const db = drizzle(client, { schema, casing: 'snake_case' });
  configurePragmas(db);
  migrateEmberdeck(db);
  return db;
}

/**
 * 기존 DB에 emberdeck 마이그레이션만 실행 (CLI 통합용).
 */
export function migrateEmberdeck(db: EmberdeckDb): void {
  migrate(db, { migrationsFolder: getMigrationsFolder() });
}

export function closeDb(db: EmberdeckDb): void {
  db.$client.close();
}
```

> **CLI 통합**: CLI가 자체 DB를 열고, `migrateEmberdeck(db)` 호출 → emberdeck 테이블 생성. 이후 CLI 자체 migration(codeEntity, fileState 등) 실행. 동일 `__drizzle_migrations` 테이블에 서로 다른 해시로 기록되므로 충돌 없음.

---

### 3.14 `src/db/repository.ts` — 인터페이스 정의

```ts
import type { CardStatus } from '../card/types';

// ---- 행 타입 ----

export interface CardRow {
  key: string;
  summary: string;
  status: string;
  constraintsJson: string | null;
  body: string | null;
  filePath: string;
  updatedAt: string;
}

export interface RelationRow {
  id: number;
  type: string;
  srcCardKey: string;
  dstCardKey: string;
  isReverse: boolean;
  metaJson: string | null;
}

export interface CardListFilter {
  status?: CardStatus;
}

// ---- Repository 인터페이스 ----

export interface CardRepository {
  findByKey(key: string): CardRow | null;
  findByFilePath(filePath: string): CardRow | null;
  upsert(row: CardRow): void;
  deleteByKey(key: string): void;
  existsByKey(key: string): boolean;
  list(filter?: CardListFilter): CardRow[];
  search(query: string): CardRow[];
}

export interface RelationRepository {
  /** 카드의 관계를 전부 교체. isReverse 양방향 자동 처리. */
  replaceForCard(cardKey: string, relations: { type: string; target: string }[]): void;
  findByCardKey(cardKey: string): RelationRow[];
  deleteByCardKey(cardKey: string): void;
}

export interface ClassificationRepository {
  /** 카드의 keyword 매핑을 전부 교체. 미등록 keyword는 자동 생성. */
  replaceKeywords(cardKey: string, names: string[]): void;
  /** 카드의 tag 매핑을 전부 교체. 미등록 tag는 자동 생성. */
  replaceTags(cardKey: string, names: string[]): void;
  findKeywordsByCard(cardKey: string): string[];
  findTagsByCard(cardKey: string): string[];
  deleteByCardKey(cardKey: string): void;
}
```

> **동기 시그니처**: bun-sqlite는 동기 드라이버. 모든 repo 메서드는 동기.

---

### 3.15 `src/db/card-repo.ts`

```ts
import { eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { CardRepository, CardRow, CardListFilter } from './repository';
import { card } from './schema';

export class DrizzleCardRepository implements CardRepository {
  constructor(private db: EmberdeckDb) {}

  findByKey(key: string): CardRow | null {
    const row = this.db.select().from(card).where(eq(card.key, key)).get();
    return (row as CardRow | undefined) ?? null;
  }

  findByFilePath(filePath: string): CardRow | null {
    const row = this.db.select().from(card).where(eq(card.filePath, filePath)).get();
    return (row as CardRow | undefined) ?? null;
  }

  upsert(row: CardRow): void {
    this.db
      .insert(card)
      .values(row)
      .onConflictDoUpdate({
        target: card.key,
        set: {
          summary: row.summary,
          status: row.status,
          constraintsJson: row.constraintsJson,
          body: row.body,
          filePath: row.filePath,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }

  deleteByKey(key: string): void {
    this.db.delete(card).where(eq(card.key, key)).run();
  }

  existsByKey(key: string): boolean {
    const row = this.db.select({ key: card.key }).from(card).where(eq(card.key, key)).get();
    return row !== undefined;
  }

  list(filter?: CardListFilter): CardRow[] {
    if (filter?.status) {
      return this.db.select().from(card).where(eq(card.status, filter.status)).all() as CardRow[];
    }
    return this.db.select().from(card).all() as CardRow[];
  }

  search(query: string): CardRow[] {
    // FTS5 MATCH. cardFts 가상 테이블은 수동 마이그레이션 후 사용 가능.
    // Drizzle에서 FTS5 MATCH를 표현할 수 없으므로 prepared statement 사용.
    // prepared statement는 parameterized query이며 R5 금지 대상(sql``)이 아님.
    //
    // 구현:
    //   const results = this.db.$client
    //     .prepare('SELECT key FROM card_fts WHERE card_fts MATCH ?')
    //     .all(query) as { key: string }[];
    //   const keys = results.map(r => r.key);
    //   if (keys.length === 0) return [];
    //   return this.db.select().from(card).where(inArray(card.key, keys)).all();
    //
    // 초기 구현: FTS 미설정 시 빈 배열 반환.
    // FTS5 마이그레이션 적용 후 위 코드로 교체.
    return [];
  }
}
```

---

### 3.16 `src/db/relation-repo.ts`

```ts
import { eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { RelationRepository, RelationRow } from './repository';
import { cardRelation } from './schema';

export class DrizzleRelationRepository implements RelationRepository {
  constructor(private db: EmberdeckDb) {}

  replaceForCard(cardKey: string, relations: { type: string; target: string }[]): void {
    // 1. 이 카드가 src인 모든 관계 삭제 (정방향 + 역방향에서 이 카드가 src인 것)
    this.db.delete(cardRelation).where(eq(cardRelation.srcCardKey, cardKey)).run();
    // 이 카드가 dst인 reverse 엔트리도 삭제
    this.db.delete(cardRelation).where(eq(cardRelation.dstCardKey, cardKey)).run();

    // 2. 새 관계 삽입 (정방향 + 역방향)
    // FK 방어: PRAGMA foreign_keys = ON 상태에서 대상 카드 미존재 시 FK 위반 → 스킵
    for (const rel of relations) {
      try {
        this.db
          .insert(cardRelation)
          .values({
            type: rel.type,
            srcCardKey: cardKey,
            dstCardKey: rel.target,
            isReverse: false,
          })
          .run();

        this.db
          .insert(cardRelation)
          .values({
            type: rel.type,
            srcCardKey: rel.target,
            dstCardKey: cardKey,
            isReverse: true,
          })
          .run();
      } catch {
        // 대상 카드 미존재 → FK violation → 해당 relation만 스킵 (정상)
      }
    }
  }

  findByCardKey(cardKey: string): RelationRow[] {
    return this.db
      .select()
      .from(cardRelation)
      .where(eq(cardRelation.srcCardKey, cardKey))
      .all() as RelationRow[];
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(cardRelation).where(eq(cardRelation.srcCardKey, cardKey)).run();
    this.db.delete(cardRelation).where(eq(cardRelation.dstCardKey, cardKey)).run();
  }
}
```

> **FK 방어**: `PRAGMA foreign_keys = ON` 상태에서 `rel.target`이 `card` 테이블에 없으면 FK 위반 에러 발생. 이는 정상 상황(아직 인덱싱 안 된 카드 참조)이므로 위 코드블록의 try-catch로 스킵 처리한다.

---

### 3.17 `src/db/classification-repo.ts`

```ts
import { eq, inArray } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { ClassificationRepository } from './repository';
import { keyword, tag, cardKeyword, cardTag } from './schema';

export class DrizzleClassificationRepository implements ClassificationRepository {
  constructor(private db: EmberdeckDb) {}

  replaceKeywords(cardKey: string, names: string[]): void {
    this.db.delete(cardKeyword).where(eq(cardKeyword.cardKey, cardKey)).run();
    if (names.length === 0) return;

    for (const name of names) {
      this.db.insert(keyword).values({ name }).onConflictDoNothing().run();
    }

    const rows = this.db
      .select({ id: keyword.id, name: keyword.name })
      .from(keyword)
      .where(inArray(keyword.name, names))
      .all();

    for (const row of rows) {
      this.db.insert(cardKeyword).values({ cardKey, keywordId: row.id }).run();
    }
  }

  replaceTags(cardKey: string, names: string[]): void {
    this.db.delete(cardTag).where(eq(cardTag.cardKey, cardKey)).run();
    if (names.length === 0) return;

    for (const name of names) {
      this.db.insert(tag).values({ name }).onConflictDoNothing().run();
    }

    const rows = this.db
      .select({ id: tag.id, name: tag.name })
      .from(tag)
      .where(inArray(tag.name, names))
      .all();

    for (const row of rows) {
      this.db.insert(cardTag).values({ cardKey, tagId: row.id }).run();
    }
  }

  findKeywordsByCard(cardKey: string): string[] {
    const rows = this.db
      .select({ name: keyword.name })
      .from(cardKeyword)
      .innerJoin(keyword, eq(cardKeyword.keywordId, keyword.id))
      .where(eq(cardKeyword.cardKey, cardKey))
      .all();
    return rows.map((r) => r.name);
  }

  findTagsByCard(cardKey: string): string[] {
    const rows = this.db
      .select({ name: tag.name })
      .from(cardTag)
      .innerJoin(tag, eq(cardTag.tagId, tag.id))
      .where(eq(cardTag.cardKey, cardKey))
      .all();
    return rows.map((r) => r.name);
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(cardKeyword).where(eq(cardKeyword.cardKey, cardKey)).run();
    this.db.delete(cardTag).where(eq(cardTag.cardKey, cardKey)).run();
  }
}
```

---

### 3.18 `src/ops/create.ts`

```ts
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRelation, CardFile } from '../card/types';
import type { CardRow } from '../db/repository';
import { normalizeSlug, buildCardPath } from '../card/card-key';
import { CardAlreadyExistsError, RelationTypeError } from '../card/errors';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import type { EmberdeckDb } from '../db/connection';

export interface CreateCardInput {
  slug: string;
  summary: string;
  body?: string;
  keywords?: string[];
  tags?: string[];
  relations?: CardRelation[];
}

export interface CreateCardResult {
  filePath: string;
  fullKey: string;
  card: CardFile;
}

export async function createCard(
  ctx: EmberdeckContext,
  input: CreateCardInput,
): Promise<CreateCardResult> {
  const slug = normalizeSlug(input.slug);
  const fullKey = slug;
  const filePath = buildCardPath(ctx.cardsDir, slug);

  if (input.relations) {
    for (const rel of input.relations) {
      if (!ctx.allowedRelationTypes.includes(rel.type)) {
        throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
      }
    }
  }

  const exists = await Bun.file(filePath).exists();
  if (exists) {
    throw new CardAlreadyExistsError(fullKey);
  }

  const frontmatter = {
    key: fullKey,
    summary: input.summary,
    status: 'draft' as const,
    ...(input.keywords && input.keywords.length > 0 ? { keywords: input.keywords } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.relations && input.relations.length > 0 ? { relations: input.relations } : {}),
  };

  const body = input.body ?? '';
  const card: CardFile = { filePath, frontmatter, body };

  await mkdir(dirname(filePath), { recursive: true });
  await writeCardFile(filePath, card);

  const now = new Date().toISOString();
  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as EmberdeckDb);

    const row: CardRow = {
      key: fullKey,
      summary: input.summary,
      status: 'draft',
      constraintsJson: null,
      body,
      filePath,
      updatedAt: now,
    };

    cardRepo.upsert(row);
    if (input.relations && input.relations.length > 0) {
      relationRepo.replaceForCard(fullKey, input.relations);
    }
    if (input.keywords && input.keywords.length > 0) {
      classRepo.replaceKeywords(fullKey, input.keywords);
    }
    if (input.tags && input.tags.length > 0) {
      classRepo.replaceTags(fullKey, input.tags);
    }
  });

  return { filePath, fullKey, card };
}
```

> **트랜잭션 패턴**: `ctx.db.transaction((tx) => { ... })` — 동기 콜백. `tx`로 repo 인스턴스 생성하여 동일 트랜잭션 내에서 실행. 파일 I/O는 트랜잭션 밖(async). DB 실패 시 자동 롤백되지만 이미 쓰인 파일은 남음 → `syncCardFromFile`로 재동기화 가능하므로 문제 없음.

> **tx 타입**: `db.transaction((tx) => {...})`의 `tx`는 `BunSQLiteTransaction` 타입이며, repo 생성자의 `EmberdeckDb`(`BunSQLiteDatabase`) 타입과 정확히 일치하지 않는다. API 표면은 동일(select/insert/delete/update)하므로 `tx as EmberdeckDb` 캐스트로 해결. 위 코드블록에 이미 반영됨.

---

### 3.19 `src/ops/update.ts`

```ts
import type { EmberdeckContext } from '../config';
import type { CardFile, CardFrontmatter, CardRelation, CardStatus } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError, RelationTypeError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import type { EmberdeckDb } from '../db/connection';

export interface UpdateCardFields {
  summary?: string;
  body?: string;
  keywords?: string[] | null;
  tags?: string[] | null;
  constraints?: unknown;
  relations?: CardRelation[] | null;
}

export interface UpdateCardResult {
  filePath: string;
  card: CardFile;
}

export async function updateCard(
  ctx: EmberdeckContext,
  fullKey: string,
  fields: UpdateCardFields,
): Promise<UpdateCardResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  const current = await readCardFile(filePath);
  if (current.frontmatter.key !== key) {
    throw new CardNotFoundError(key);
  }

  if (fields.relations && fields.relations !== null) {
    for (const rel of fields.relations) {
      if (!ctx.allowedRelationTypes.includes(rel.type)) {
        throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
      }
    }
  }

  // 필드 머지 (기존 card-crud.ts 로직 동일)
  const next: CardFrontmatter = { ...current.frontmatter };
  if (fields.summary !== undefined) next.summary = fields.summary;
  if (fields.keywords !== undefined) {
    if (fields.keywords === null || fields.keywords.length === 0) delete next.keywords;
    else next.keywords = fields.keywords;
  }
  if (fields.tags !== undefined) {
    if (fields.tags === null || fields.tags.length === 0) delete next.tags;
    else next.tags = fields.tags;
  }
  if (fields.constraints !== undefined) next.constraints = fields.constraints;
  if (fields.relations !== undefined) {
    if (fields.relations === null || fields.relations.length === 0) delete next.relations;
    else next.relations = fields.relations;
  }

  const nextBody = fields.body !== undefined ? fields.body : current.body;
  const card: CardFile = { filePath, frontmatter: next, body: nextBody };

  await writeCardFile(filePath, card);

  const now = new Date().toISOString();
  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as EmberdeckDb);

    const row: CardRow = {
      key,
      summary: next.summary,
      status: next.status,
      constraintsJson: next.constraints ? JSON.stringify(next.constraints) : null,
      body: nextBody,
      filePath,
      updatedAt: now,
    };
    cardRepo.upsert(row);

    if (fields.relations !== undefined) relationRepo.replaceForCard(key, next.relations ?? []);
    if (fields.keywords !== undefined) classRepo.replaceKeywords(key, next.keywords ?? []);
    if (fields.tags !== undefined) classRepo.replaceTags(key, next.tags ?? []);
  });

  return { filePath, card };
}

export async function updateCardStatus(
  ctx: EmberdeckContext,
  fullKey: string,
  status: CardStatus,
): Promise<UpdateCardResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  const current = await readCardFile(filePath);
  if (current.frontmatter.key !== key) {
    throw new CardNotFoundError(key);
  }

  const card: CardFile = {
    filePath,
    frontmatter: { ...current.frontmatter, status },
    body: current.body,
  };
  await writeCardFile(filePath, card);

  const now = new Date().toISOString();
  const cardRepo = new DrizzleCardRepository(ctx.db);
  const existing = cardRepo.findByKey(key);
  if (existing) {
    cardRepo.upsert({ ...existing, status, updatedAt: now });
  }

  return { filePath, card };
}
```

---

### 3.20 `src/ops/delete.ts`

```ts
import type { EmberdeckContext } from '../config';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { deleteCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';

export async function deleteCard(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<{ filePath: string }> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  const exists = await Bun.file(filePath).exists();
  if (!exists) {
    throw new CardNotFoundError(key);
  }

  await deleteCardFile(filePath);

  // FK cascade로 relation, keyword, tag 매핑 자동 삭제
  const cardRepo = new DrizzleCardRepository(ctx.db);
  cardRepo.deleteByKey(key);

  return { filePath };
}
```

---

### 3.21 `src/ops/rename.ts`

```ts
import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardFile } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, normalizeSlug, buildCardPath } from '../card/card-key';
import { CardNotFoundError, CardAlreadyExistsError, CardRenameSamePathError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import type { EmberdeckDb } from '../db/connection';

export interface RenameCardResult {
  oldFilePath: string;
  newFilePath: string;
  newFullKey: string;
  card: CardFile;
}

export async function renameCard(
  ctx: EmberdeckContext,
  fullKey: string,
  newSlug: string,
): Promise<RenameCardResult> {
  const oldKey = parseFullKey(fullKey);
  const normalizedNewSlug = normalizeSlug(newSlug);
  const newFullKey = normalizedNewSlug;

  const oldFilePath = buildCardPath(ctx.cardsDir, oldKey);
  const newFilePath = buildCardPath(ctx.cardsDir, newFullKey);

  if (oldFilePath === newFilePath) throw new CardRenameSamePathError();

  if (!(await Bun.file(oldFilePath).exists())) throw new CardNotFoundError(oldKey);
  if (await Bun.file(newFilePath).exists()) throw new CardAlreadyExistsError(newFullKey);

  await mkdir(dirname(newFilePath), { recursive: true });
  await rename(oldFilePath, newFilePath);

  const current = await readCardFile(newFilePath);
  const card: CardFile = {
    filePath: newFilePath,
    frontmatter: { ...current.frontmatter, key: newFullKey },
    body: current.body,
  };
  await writeCardFile(newFilePath, card);

  // DB: old 삭제(cascade) → new 삽입 → 관계/분류 복원
  const now = new Date().toISOString();
  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as EmberdeckDb);

    // 기존 관계/분류 백업
    const oldRelations = relationRepo.findByCardKey(oldKey)
      .filter((r) => !r.isReverse)
      .map((r) => ({ type: r.type, target: r.dstCardKey }));
    const oldKeywords = classRepo.findKeywordsByCard(oldKey);
    const oldTags = classRepo.findTagsByCard(oldKey);

    cardRepo.deleteByKey(oldKey); // cascade 삭제

    const row: CardRow = {
      key: newFullKey,
      summary: card.frontmatter.summary,
      status: card.frontmatter.status,
      constraintsJson: card.frontmatter.constraints ? JSON.stringify(card.frontmatter.constraints) : null,
      body: card.body,
      filePath: newFilePath,
      updatedAt: now,
    };
    cardRepo.upsert(row);

    if (oldRelations.length > 0) relationRepo.replaceForCard(newFullKey, oldRelations);
    if (oldKeywords.length > 0) classRepo.replaceKeywords(newFullKey, oldKeywords);
    if (oldTags.length > 0) classRepo.replaceTags(newFullKey, oldTags);
  });

  return { oldFilePath, newFilePath, newFullKey, card };
}
```

---

### 3.22 `src/ops/query.ts`

```ts
import type { EmberdeckContext } from '../config';
import type { CardFile, CardStatus } from '../card/types';
import type { CardRow, RelationRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';

export async function getCard(ctx: EmberdeckContext, fullKey: string): Promise<CardFile> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(key);
  return readCardFile(filePath);
}

export function listCards(ctx: EmberdeckContext, filter?: { status?: CardStatus }): CardRow[] {
  return ctx.cardRepo.list(filter);
}

export function searchCards(ctx: EmberdeckContext, query: string): CardRow[] {
  return ctx.cardRepo.search(query);
}

export function listCardRelations(ctx: EmberdeckContext, fullKey: string): RelationRow[] {
  const key = parseFullKey(fullKey);
  return ctx.relationRepo.findByCardKey(key);
}
```

---

### 3.23 `src/ops/sync.ts`

```ts
import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import type { EmberdeckDb } from '../db/connection';

/**
 * 외부 변경된 카드 파일 → DB 동기화.
 * watcher 이벤트(생성/변경) 수신 시 CLI가 호출.
 */
export async function syncCardFromFile(ctx: EmberdeckContext, filePath: string): Promise<void> {
  const cardFile = await readCardFile(filePath);
  const key = parseFullKey(cardFile.frontmatter.key);
  const now = new Date().toISOString();

  const row: CardRow = {
    key,
    summary: cardFile.frontmatter.summary,
    status: cardFile.frontmatter.status,
    constraintsJson: cardFile.frontmatter.constraints
      ? JSON.stringify(cardFile.frontmatter.constraints)
      : null,
    body: cardFile.body,
    filePath,
    updatedAt: now,
  };

  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as EmberdeckDb);

    cardRepo.upsert(row);
    relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
    classRepo.replaceKeywords(key, cardFile.frontmatter.keywords ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
  });
}

/**
 * 외부 삭제된 카드 파일 → DB에서 제거.
 * watcher 이벤트(삭제) 수신 시 CLI가 호출.
 */
export function removeCardByFile(ctx: EmberdeckContext, filePath: string): void {
  const existing = ctx.cardRepo.findByFilePath(filePath);
  if (existing) {
    ctx.cardRepo.deleteByKey(existing.key);
  }
}
```

---

### 3.24 `index.ts` — public API barrel

```ts
// ---- Setup ----
export { setupEmberdeck, teardownEmberdeck } from './src/setup';
export type { EmberdeckOptions, EmberdeckContext } from './src/config';
export { DEFAULT_RELATION_TYPES } from './src/config';

// ---- Types ----
export type { CardStatus, CardRelation, CardFrontmatter, CardFile } from './src/card/types';
export {
  CardKeyError,
  CardValidationError,
  CardNotFoundError,
  CardAlreadyExistsError,
  CardRenameSamePathError,
  RelationTypeError,
} from './src/card/errors';

// ---- Operations ----
export { createCard, type CreateCardInput, type CreateCardResult } from './src/ops/create';
export { updateCard, updateCardStatus, type UpdateCardFields, type UpdateCardResult } from './src/ops/update';
export { deleteCard } from './src/ops/delete';
export { renameCard, type RenameCardResult } from './src/ops/rename';
export { getCard, listCards, searchCards, listCardRelations } from './src/ops/query';
export { syncCardFromFile, removeCardByFile } from './src/ops/sync';

// ---- Repository interfaces (테스트/목킹용) ----
export type {
  CardRepository, RelationRepository, ClassificationRepository,
  CardRow, RelationRow,
} from './src/db/repository';

// ---- Pure utilities (CLI에서 키 검증만 필요할 때) ----
export { normalizeSlug, parseFullKey, buildCardPath } from './src/card/card-key';
export { parseCardMarkdown, serializeCardMarkdown } from './src/card/markdown';

// ---- DB (CLI 통합용) ----
export { migrateEmberdeck, type EmberdeckDb } from './src/db/connection';
```

---

## 4. 기존 코드 → 새 위치 매핑표

| 기존 파일 | 대상 | 처리 |
|---|---|---|
| `cli/src/mcp/card/types.ts` | `emberdeck/src/card/types.ts` | 그대로 복사 |
| `cli/src/mcp/card/card-key.ts` | `emberdeck/src/card/card-key.ts` | `zipbul-paths` 의존 제거, `cardPathFromFullKey` → `buildCardPath` |
| `cli/src/mcp/card/card-markdown.ts` | `emberdeck/src/card/markdown.ts` | `throw new Error` → `throw new CardValidationError` |
| `cli/src/mcp/card/card-fs.ts` → `readCardFile` | `emberdeck/src/fs/reader.ts` | import 경로만 변경 |
| `cli/src/mcp/card/card-fs.ts` → `writeCardFile`, `deleteCardFile` | `emberdeck/src/fs/writer.ts` | import 경로만 변경 |
| `cli/src/mcp/card/card-crud.ts` → `cardCreate` | `emberdeck/src/ops/create.ts` | `ResolvedZipbulConfig` 제거, ctx 기반, DB 저장 추가 |
| `cli/src/mcp/card/card-crud.ts` → `cardUpdate` | `emberdeck/src/ops/update.ts` | 동일 패턴 변환 |
| `cli/src/mcp/card/card-crud.ts` → `cardUpdateStatus` | `emberdeck/src/ops/update.ts` | 동일 |
| `cli/src/mcp/card/card-crud.ts` → `cardDelete` | `emberdeck/src/ops/delete.ts` | 동일 |
| `cli/src/mcp/card/card-crud.ts` → `cardRename` | `emberdeck/src/ops/rename.ts` | 동일 |
| `cli/src/store/schema.ts` (카드 테이블) | `emberdeck/src/db/schema.ts` | 카드 테이블만 추출, FK cascade 추가 |
| `cli/src/store/store-ops.ts` + `connection.ts` | `emberdeck/src/db/connection.ts` | emberdeck 전용 신규 |
| `cli/src/config/config-loader.ts` → `CARD_RELATION_TYPES` | `emberdeck/src/config.ts` → `DEFAULT_RELATION_TYPES` | 상수 복사 |
| (신규) | `emberdeck/src/db/repository.ts` | 인터페이스 신규 작성 |
| (신규) | `emberdeck/src/db/card-repo.ts` | Drizzle 구현 신규 |
| (신규) | `emberdeck/src/db/relation-repo.ts` | 신규 |
| (신규) | `emberdeck/src/db/classification-repo.ts` | 신규 |
| (신규) | `emberdeck/src/ops/query.ts` | 신규 |
| (신규) | `emberdeck/src/ops/sync.ts` | 신규 |
| (신규) | `emberdeck/src/card/errors.ts` | 신규 |
| (신규) | `emberdeck/src/setup.ts` | 신규 |
| (신규) | `emberdeck/src/config.ts` | 신규 |

---

## 5. DB 마이그레이션 계획

### 5.1 drizzle-kit 워크플로

```bash
cd packages/emberdeck
bunx drizzle-kit generate --config drizzle.config.ts
# → drizzle/0000_*.sql + drizzle/meta/_journal.json 생성
```

### 5.2 예상 DDL (drizzle-kit 자동 생성)

```sql
CREATE TABLE `card` (
  `rowid` integer,
  `key` text PRIMARY KEY NOT NULL,
  `summary` text NOT NULL,
  `status` text NOT NULL,
  `constraints_json` text,
  `body` text,
  `file_path` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `idx_card_status` ON `card` (`status`);
CREATE INDEX `idx_card_file_path` ON `card` (`file_path`);

CREATE TABLE `keyword` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL
);
CREATE UNIQUE INDEX `keyword_name_unique` ON `keyword` (`name`);

CREATE TABLE `tag` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL
);
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);

CREATE TABLE `card_keyword` (
  `card_key` text NOT NULL,
  `keyword_id` integer NOT NULL,
  PRIMARY KEY(`card_key`, `keyword_id`),
  FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`keyword_id`) REFERENCES `keyword`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_card_keyword_card` ON `card_keyword` (`card_key`);
CREATE INDEX `idx_card_keyword_keyword` ON `card_keyword` (`keyword_id`);

CREATE TABLE `card_tag` (
  `card_key` text NOT NULL,
  `tag_id` integer NOT NULL,
  PRIMARY KEY(`card_key`, `tag_id`),
  FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_card_tag_card` ON `card_tag` (`card_key`);
CREATE INDEX `idx_card_tag_tag` ON `card_tag` (`tag_id`);

CREATE TABLE `card_relation` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL,
  `src_card_key` text NOT NULL,
  `dst_card_key` text NOT NULL,
  `is_reverse` integer DEFAULT false NOT NULL,
  `meta_json` text,
  FOREIGN KEY (`src_card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`dst_card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade
);
CREATE INDEX `idx_card_relation_src` ON `card_relation` (`src_card_key`);
CREATE INDEX `idx_card_relation_dst` ON `card_relation` (`dst_card_key`);
CREATE INDEX `idx_card_relation_type` ON `card_relation` (`type`);

CREATE TABLE `card_fts` (
  `rowid` integer,
  `key` text,
  `summary` text,
  `body` text
);
```

### 5.3 FTS5 수동 마이그레이션 (Phase C 이후 후속)

```sql
DROP TABLE IF EXISTS `card_fts`;
CREATE VIRTUAL TABLE card_fts USING fts5(key, summary, body, content='card', content_rowid='rowid');

CREATE TRIGGER card_fts_ai AFTER INSERT ON card BEGIN
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
CREATE TRIGGER card_fts_ad AFTER DELETE ON card BEGIN
  INSERT INTO card_fts(card_fts, rowid, key, summary, body) VALUES('delete', old.rowid, old.key, old.summary, old.body);
END;
CREATE TRIGGER card_fts_au AFTER UPDATE ON card BEGIN
  INSERT INTO card_fts(card_fts, rowid, key, summary, body) VALUES('delete', old.rowid, old.key, old.summary, old.body);
  INSERT INTO card_fts(rowid, key, summary, body) VALUES (new.rowid, new.key, new.summary, new.body);
END;
```

---

## 6. Phase 실행 절차

### Phase A — 패키지 골격 + 순수 모듈 (card/, config)

1. `packages/emberdeck/` 디렉토리 생성
2. `package.json`, `tsconfig.json`, `drizzle.config.ts` 생성
3. `src/card/types.ts` 생성
4. `src/card/card-key.ts` 생성
5. `src/card/errors.ts` 생성
6. `src/card/markdown.ts` 생성
7. `src/config.ts` 생성

**검증**: `bun test packages/emberdeck/test/card/` → card-key, markdown 유닛 테스트 통과

### Phase B — 파일 I/O 계층 (fs/)

1. `src/fs/reader.ts` 생성
2. `src/fs/writer.ts` 생성

**검증**: fs 읽기/쓰기/삭제 테스트 통과

### Phase C — 영속성 계층 (db/)

1. `src/db/schema.ts` 생성
2. `bunx drizzle-kit generate` 실행 → `drizzle/` 생성 확인
3. `src/db/connection.ts` 생성
4. `src/db/repository.ts` 생성
5. `src/db/card-repo.ts` 생성
6. `src/db/relation-repo.ts` 생성
7. `src/db/classification-repo.ts` 생성

**검증**: `bun test packages/emberdeck/test/db/` + `test/migration.spec.ts` 통과

### Phase D — 오퍼레이션 계층 (ops/, setup, index)

1. `src/setup.ts` 생성
2. `src/ops/create.ts` 생성
3. `src/ops/update.ts` 생성
4. `src/ops/delete.ts` 생성
5. `src/ops/rename.ts` 생성
6. `src/ops/query.ts` 생성
7. `src/ops/sync.ts` 생성
8. `index.ts` 생성

**검증**: `bun test packages/emberdeck/` → 전체 GREEN

### Phase E — CLI 어댑터 전환

1. `packages/cli/package.json`에 `"emberdeck": "workspace:*"` 추가
2. `mcp-server.ts` import 교체 (아래 §7.1 참조)
3. `index-project.ts` 카드 DB 로직 → `syncCardFromFile()` 교체 (§7.2 참조)
4. CLI 테스트 보정

**검증**: `bun test packages/cli/test/` 통과

### Phase F — 정리

1. `packages/cli/src/mcp/card/` 삭제
2. `packages/cli/src/store/schema.ts`에서 카드 테이블 제거
3. CLI migration 재생성 (codeEntity, fileState 등만)
4. DB schema version bump → 기존 DB 자동 리빌드

**검증**: `bun test` 루트 전체 GREEN

---

## 7. CLI 어댑터 전환 상세

### 7.1 `mcp-server.ts` 변경

```ts
// ---- 삭제 ----
import { cardCreate, cardUpdate, cardUpdateStatus, cardDelete, cardRename } from '../card/card-crud';
import { parseFullKey, cardPathFromFullKey } from '../card/card-key';
import { readCardFile } from '../card/card-fs';

// ---- 추가 ----
import {
  setupEmberdeck,
  createCard,
  updateCard,
  updateCardStatus,
  deleteCard,
  renameCard,
  getCard,
  listCards,
  listCardRelations,
  syncCardFromFile,
  type EmberdeckContext,
} from 'emberdeck';
```

초기화:

```ts
const ctx = setupEmberdeck({
  cardsDir: zipbulCardsDirPath(projectRoot),
  dbPath: zipbulCacheFilePath(projectRoot, 'index.sqlite'),
  allowedRelationTypes: config.mcp.card.relations,
});
```

핸들러 교체 예시:

```ts
// 기존: await cardCreate({ projectRoot, config, slug, summary, body, keywords, tags })
// 변경: await createCard(ctx, { slug, summary, body, keywords, tags })
```

### 7.2 `index-project.ts` 변경

카드 인덱싱 부분:

```ts
// 기존: readCardFile(path) → DB 직접 INSERT
// 변경: syncCardFromFile(ctx, path)
```

카드 삭제 감지:

```ts
// 기존: DB에서 직접 DELETE
// 변경: removeCardByFile(ctx, path)
```

유지하는 것:
- 코드 엔티티 인덱싱 (`codeEntity`, `codeRelation`)
- `cardCodeLink` 관리 (CLI 소유)
- `fileState` 관리

### 7.3 DB 통합

```ts
// CLI connection.ts
import { migrateEmberdeck } from 'emberdeck';

const db = openDb(path);
// EmberdeckDb와 StoreDb는 schema generic이 다르므로 타입 캐스트 필요
migrateEmberdeck(db as any);    // emberdeck 테이블
migrate(db, { migrationsFolder: cliMigrationsDir }); // CLI 테이블
```

> **타입 캐스트 이유**: `EmberdeckDb`는 `drizzle<typeof emberdeckSchema>`, CLI의 StoreDb는 `drizzle<typeof cliSchema>`. schema generic이 달라 직접 할당 불가. `migrate()` 내부는 schema에 무관하게 SQL을 실행하므로 `as any` 캐스트 안전.

---

## 8. 테스트 전략

### 8.1 테스트 파일 + 검증 대상

| 파일 | 종류 | 검증 대상 |
|---|---|---|
| `test/card/card-key.spec.ts` | 유닛 | `normalizeSlug` 정상/에러 케이스, `parseFullKey` 정상/에러, `buildCardPath` 경로 조합 |
| `test/card/markdown.spec.ts` | 유닛 | `parseCardMarkdown` 정상/누락필드/잘못된status, `serializeCardMarkdown` 왕복 동등성 |
| `test/db/card-repo.spec.ts` | 통합 | `upsert`/`findByKey`/`findByFilePath`/`deleteByKey`/`existsByKey`/`list` (in-memory SQLite) |
| `test/db/relation-repo.spec.ts` | 통합 | `replaceForCard` 양방향 생성 확인, `findByCardKey`, `deleteByCardKey` |
| `test/db/classification-repo.spec.ts` | 통합 | `replaceKeywords` get-or-create, `replaceTags`, `findKeywordsByCard`, `findTagsByCard` |
| `test/ops/create.spec.ts` | 통합 | 파일+DB 동시 생성, 중복 시 `CardAlreadyExistsError`, 관계 타입 에러 |
| `test/ops/update.spec.ts` | 통합 | 필드 머지, status 변경, keywords null 처리, DB 동기 |
| `test/ops/delete.spec.ts` | 통합 | 파일+DB 동시 삭제, cascade 검증 |
| `test/ops/rename.spec.ts` | 통합 | 파일 이동, key 업데이트, 관계/분류 보존, 동일 경로 에러 |
| `test/ops/sync.spec.ts` | 통합 | 외부 파일 → DB upsert, `removeCardByFile` → DB 삭제 |
| `test/migration.spec.ts` | 통합 | in-memory DB migration 적용 → 7개 테이블 존재 확인 |

### 8.2 테스트 헬퍼

```ts
// test/helpers.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupEmberdeck, teardownEmberdeck, type EmberdeckContext } from '../index';

export async function createTestContext(): Promise<{
  ctx: EmberdeckContext;
  cardsDir: string;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'emberdeck_test_'));
  const cardsDir = join(tmpDir, 'cards');
  const ctx = setupEmberdeck({ cardsDir, dbPath: ':memory:' });

  return {
    ctx,
    cardsDir,
    cleanup: async () => {
      teardownEmberdeck(ctx);
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}
```

---

## 9. 금지사항 검증 체크리스트

구현 완료 후 전수 grep:

- [ ] `` sql` `` 사용 0건 — `grep -r "sql\`" packages/emberdeck/src/`
- [ ] `sql.raw` 사용 0건 — `grep -r "sql.raw" packages/emberdeck/src/`
- [ ] `sql.unsafe` 사용 0건 — `grep -r "sql.unsafe" packages/emberdeck/src/`
- [ ] `@zipbul/` import 0건 — `grep -r "@zipbul/" packages/emberdeck/`
- [ ] `zipbul-paths` import 0건 — `grep -r "zipbul-paths" packages/emberdeck/`
- [ ] watcher 구현 0건 — `grep -r "parcel/watcher\|chokidar\|fs.watch" packages/emberdeck/`
- [ ] `card/` → `fs/`, `db/`, `ops/` import 0건 (순수성)
- [ ] `fs/` → `db/`, `ops/` import 0건
- [ ] `db/` → `ops/`, `fs/` import 0건

---

## 10. 완료 조건 (Definition of Done)

1. `bun test packages/emberdeck/` 전체 GREEN
2. `bun test packages/cli/test/` 전체 GREEN
3. `bunx drizzle-kit generate` 오류 없음
4. 금지 API 0건 (§9 전수 통과)
5. emberdeck에서 `@zipbul/*` import 0건
6. 카드 CRUD + 상태변경 + 리네임 + 관계조회 + 동기화 기능 동등성 유지
7. `card/` 모듈 순수성 (I/O import 없음) 확인

---

## 11. 롤백 계획

1. CLI에서 emberdeck import → 기존 `card/*` 경로로 revert
2. `packages/emberdeck` 유지하되 미사용
3. DB는 disposable — schema version bump로 자동 재빌드

---

## 12. 구현 순서 요약

```
Phase A → card/ + config (순수 도메인)
Phase B → fs/ (파일 I/O)
Phase C → db/ + migration (영속성)
Phase D → ops/ + setup + index.ts (오케스트레이션)
Phase E → CLI adapter (통합)
Phase F → cleanup (정리)
```

> 이 문서는 설계가 아니라 **실행 지시서**다. 각 phase와 파일은 생략 없이 순서대로 수행한다.
