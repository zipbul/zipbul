import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createRequire } from 'node:module';

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';

import * as schema from '../../src/store/schema';

const require = createRequire(import.meta.url);

// Pass-through all exports so other tests/modules keep working,
// but override stat() to avoid real FS I/O.
// NOTE: We import from 'fs/promises' (not 'node:fs/promises') to avoid
// self-recursion through the mock.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const actualFsPromises = require('fs/promises') as typeof import('node:fs/promises');

mock.module('node:fs/promises', () => {
  return {
    ...actualFsPromises,
    stat: async (_path: string) => ({ mtimeMs: 1 }),
  };
});

afterAll(() => {
  mock.restore();
  mock.clearAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const mod = require('../../src/mcp/index/index-project.ts') as typeof import('../../src/mcp/index/index-project');

function createTables(db: any) {
  db.run(
    sql.raw(`
      CREATE TABLE card (
        key TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        keywords TEXT,
        constraints_json TEXT,
        body TEXT,
        file_path TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE keyword (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE tag (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE card_keyword (
        card_key TEXT NOT NULL,
        keyword_id INTEGER NOT NULL,
        PRIMARY KEY (card_key, keyword_id)
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE card_tag (
        card_key TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (card_key, tag_id)
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE card_relation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        src_card_key TEXT NOT NULL,
        dst_card_key TEXT NOT NULL,
        is_reverse INTEGER NOT NULL DEFAULT 0,
        meta_json TEXT
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE code_entity (
        entity_key TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        symbol_name TEXT,
        kind TEXT NOT NULL,
        signature TEXT,
        fingerprint TEXT,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE code_relation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        src_entity_key TEXT NOT NULL,
        dst_entity_key TEXT NOT NULL,
        meta_json TEXT
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE card_code_link (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        card_key TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        file_path TEXT NOT NULL,
        symbol_name TEXT,
        meta_json TEXT
      );
    `),
  );

  db.run(
    sql.raw(`
      CREATE TABLE file_state (
        path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        mtime TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL
      );
    `),
  );
}

describe('mcp/index — registry enforcement (integration)', () => {
  const originalGlob = (Bun as any).Glob;
  const originalFile = (Bun as any).file;

  beforeEach(() => {
    // Fake glob: return a single card file and no code files.
    (Bun as any).Glob = class FakeGlob {
      constructor(private readonly pattern: string) {}

      async *scan(_opts: any) {
        if (this.pattern.includes('.zipbul/cards') && this.pattern.includes('.card.md')) {
          yield '.zipbul/cards/auth/login.card.md';
          return;
        }
        // source dir code scan
        if (this.pattern.includes('src') && this.pattern.includes('**/*.ts')) {
          return;
        }
        return;
      }
    };

    const cardAbsPath = '/repo/.zipbul/cards/auth/login.card.md';
    const cardText = [
      '---',
      'key: auth/login',
      'summary: Login',
      'status: draft',
      'tags:',
      '  - core',
      'keywords:',
      '  - authentication',
      '---',
      'Body',
      '',
    ].join('\n');

    (Bun as any).file = (path: string) => {
      if (path === cardAbsPath) {
        const encoder = new TextEncoder();
        const buf = encoder.encode(cardText);
        return {
          text: async () => cardText,
          arrayBuffer: async () => buf.buffer,
        };
      }

      // Default: deterministic empty content.
      const encoder = new TextEncoder();
      const buf = encoder.encode('');
      return {
        text: async () => '',
        arrayBuffer: async () => buf.buffer,
      };
    };
  });

  afterAll(() => {
    (Bun as any).Glob = originalGlob;
    (Bun as any).file = originalFile;
  });

  it('should reject unregistered keywords/tags and NOT auto-register them', async () => {
    // Arrange
    const db = drizzle({ schema, casing: 'snake_case' });
    createTables(db);

    const config = {
      sourceDir: './src',
      entry: './src/main.ts',
      module: { fileName: 'module.ts' },
      mcp: {
        exclude: [],
        card: { relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'] },
      },
    } as any;

    // Act + Assert
    await expect(mod.indexProject({ projectRoot: '/repo', config, db, mode: 'full' })).rejects.toThrow(
      'Unregistered classification',
    );

    const keywords = db.select({ name: schema.keyword.name }).from(schema.keyword).all();
    const tags = db.select({ name: schema.tag.name }).from(schema.tag).all();
    const cards = db.select({ key: schema.card.key }).from(schema.card).all();

    expect(keywords).toHaveLength(0);
    expect(tags).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });

  it('should accept registered keywords/tags and create only mappings', async () => {
    // Arrange
    const db = drizzle({ schema, casing: 'snake_case' });
    createTables(db);

    db.insert(schema.keyword).values({ name: 'authentication' }).onConflictDoNothing().run();
    db.insert(schema.tag).values({ name: 'core' }).onConflictDoNothing().run();

    const config = {
      sourceDir: './src',
      entry: './src/main.ts',
      module: { fileName: 'module.ts' },
      mcp: {
        exclude: [],
        card: { relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'] },
      },
    } as any;

    // Act
    await mod.indexProject({ projectRoot: '/repo', config, db, mode: 'full' });

    // Assert
    const keywords = db.select({ name: schema.keyword.name }).from(schema.keyword).all();
    const tags = db.select({ name: schema.tag.name }).from(schema.tag).all();
    expect(keywords.map((r: any) => r.name)).toEqual(['authentication']);
    expect(tags.map((r: any) => r.name)).toEqual(['core']);

    const cardKeywords = db.select().from(schema.cardKeyword).all();
    const cardTags = db.select().from(schema.cardTag).all();

    expect(cardKeywords).toHaveLength(1);
    expect(cardTags).toHaveLength(1);
  });
});
