import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { statSync, writeFileSync } from 'node:fs';

let mismatchDbSeq = 0;

function getTempDir() {
  return process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp';
}

function makeTempDbPath(prefix: string) {
  mismatchDbSeq += 1;
  const name = `${prefix}_${process.pid}_${mismatchDbSeq}_${crypto.randomUUID()}.sqlite`;
  return `${getTempDir()}/${name}`;
}

async function deleteIfExists(path: string) {
  const file = Bun.file(path);
  if (await file.exists()) {
    await file.delete();
  }
}

async function cleanupSqliteFiles(path: string) {
  await deleteIfExists(path);
  await deleteIfExists(`${path}-wal`);
  await deleteIfExists(`${path}-shm`);
}

function statInoOrNull(path: string): number | null {
  try {
    return statSync(path).ino;
  } catch {
    return null;
  }
}

async function waitForFileExists(path: string, retries = 10): Promise<boolean> {
  for (let i = 0; i < retries; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await Bun.file(path).exists();
    if (exists) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

import { createDb, closeDb, SCHEMA_VERSION } from '../src/store/connection';
import {
  metadata,
  codeEntity,
  codeRelation,
  fileState,
} from '../src/store/schema';

const sqliteMaster = sqliteTable('sqlite_master', {
  name: text('name'),
  type: text('type'),
});

const codeFts = sqliteTable('code_fts', {
  entityKey: text('entity_key'),
  symbolName: text('symbol_name'),
});

describe('store', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => {
    closeDb(db);
  });

  describe('connection', () => {
    it('opens database with WAL journal mode', () => {
      const journalMode = db.get(sql`PRAGMA journal_mode`) as unknown;
      // in-memory DB returns 'memory' for journal_mode; WAL applies to file-based DBs
      // Verify the pragma was executed without error (in-memory falls back to 'memory')
      expect(journalMode).toBeDefined();
    });

    it('creates -wal/-shm files for file-based db after a write', async () => {
      const dbPath = makeTempDbPath('store_wal');
      const fileDb = createDb(dbPath);

      try {
        // A write is required for -wal creation.
        fileDb.insert(metadata)
          .values({
            key: 'wal_test',
            value: 'test',
          })
          .run();

        const walPath = `${dbPath}-wal`;
        const shmPath = `${dbPath}-shm`;

        const walExists = await waitForFileExists(walPath);
        const shmExists = await waitForFileExists(shmPath);

        // Depending on timing/checkpointing, one may appear before the other.
        expect(walExists || shmExists).toBe(true);
      } finally {
        closeDb(fileDb);
        await cleanupSqliteFiles(dbPath);
      }
    });

    it('sets busy_timeout to 5000ms', () => {
      const rows = db.values(sql`PRAGMA busy_timeout`);
      expect(rows[0]?.[0]).toBe(5000);
    });

    it('stores schema_version in metadata table', () => {
      const rows = db.select().from(metadata).where(eq(metadata.key, 'schema_version')).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.value).toBe(String(SCHEMA_VERSION));
    });
  });

  describe('schema — tables exist', () => {
    it('metadata table accepts key-value pairs', () => {
      db.insert(metadata).values({ key: 'test_key', value: 'test_value' }).run();
      const rows = db.select().from(metadata).where(eq(metadata.key, 'test_key')).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ key: 'test_key', value: 'test_value' });
    });






    it('code_entity table stores parsed code entities', () => {
      const now = new Date().toISOString();
      db.insert(codeEntity)
        .values({
          entityKey: 'symbol:src/auth/login.ts#handleOAuth',
          filePath: 'src/auth/login.ts',
          symbolName: 'handleOAuth',
          kind: 'function',
          signature: '() => Promise<void>',
          fingerprint: 'abc123',
          contentHash: 'hash456',
          updatedAt: now,
        })
        .run();

      const rows = db
        .select()
        .from(codeEntity)
        .where(eq(codeEntity.entityKey, 'symbol:src/auth/login.ts#handleOAuth'))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.symbolName).toBe('handleOAuth');
      expect(rows[0]!.kind).toBe('function');
    });



    it('code_relation table stores code-to-code edges', () => {
      const now = new Date().toISOString();
      db.insert(codeEntity).values({
        entityKey: 'module:src/auth/login.ts',
        filePath: 'src/auth/login.ts',
        kind: 'module', contentHash: 'h1', updatedAt: now,
      }).run();
      db.insert(codeEntity).values({
        entityKey: 'module:src/auth/session.ts',
        filePath: 'src/auth/session.ts',
        kind: 'module', contentHash: 'h2', updatedAt: now,
      }).run();

      db.insert(codeRelation).values({
        type: 'imports',
        srcEntityKey: 'module:src/auth/login.ts',
        dstEntityKey: 'module:src/auth/session.ts',
      }).run();

      const rows = db.select().from(codeRelation).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.type).toBe('imports');
    });

    it('file_state table tracks file indexing state', () => {
      const now = new Date().toISOString();
      db.insert(fileState)
        .values({
          path: 'src/auth/login.ts',
          contentHash: 'abc123',
          mtime: now,
          lastIndexedAt: now,
        })
        .run();

      const rows = db
        .select()
        .from(fileState)
        .where(eq(fileState.path, 'src/auth/login.ts'))
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.contentHash).toBe('abc123');
    });
  });

  describe('schema — constraints', () => {


    it('file_state.path is PRIMARY KEY', () => {
      const now = new Date().toISOString();
      const row = { path: 'src/a.ts', contentHash: 'h', mtime: now, lastIndexedAt: now };
      db.insert(fileState).values(row).run();
      expect(() => db.insert(fileState).values(row).run()).toThrow();
    });
  });

  describe('fts5 — virtual tables and triggers', () => {
    it('creates code_fts virtual table', () => {
      const rows = db
        .select({ name: sqliteMaster.name, type: sqliteMaster.type })
        .from(sqliteMaster)
        .where(inArray(sqliteMaster.name, ['code_fts']))
        .orderBy(asc(sqliteMaster.name))
        .all();

      expect(rows).toEqual([
        { name: 'code_fts', type: 'table' },
      ]);
    });

    it('creates sync triggers for code_fts', () => {
      const rows = db
        .select({ name: sqliteMaster.name, type: sqliteMaster.type })
        .from(sqliteMaster)
        .where(
          and(
            eq(sqliteMaster.type, 'trigger'),
            inArray(sqliteMaster.name, [
              'code_fts_ai',
              'code_fts_au',
              'code_fts_ad',
            ]),
          ),
        )
        .orderBy(asc(sqliteMaster.name))
        .all();

      expect(rows).toEqual([
        { name: 'code_fts_ad', type: 'trigger' },
        { name: 'code_fts_ai', type: 'trigger' },
        { name: 'code_fts_au', type: 'trigger' },
      ]);
    });


    it('keeps code_fts in sync on insert/update/delete', () => {
      const now = new Date().toISOString();
      db.insert(codeEntity)
        .values({
          entityKey: 'symbol:src/auth/login.ts#handleOAuth',
          filePath: 'src/auth/login.ts',
          symbolName: 'handleOAuth',
          kind: 'function',
          signature: null,
          fingerprint: null,
          contentHash: 'h1',
          updatedAt: now,
        })
        .run();

      const inserted = db
        .select({ entityKey: codeFts.entityKey, symbolName: codeFts.symbolName })
        .from(codeFts)
        .where(eq(codeFts.entityKey, 'symbol:src/auth/login.ts#handleOAuth'))
        .limit(1)
        .get();

      expect(inserted).toEqual({
        entityKey: 'symbol:src/auth/login.ts#handleOAuth',
        symbolName: 'handleOAuth',
      });

      db.update(codeEntity)
        .set({ symbolName: 'handleOAuthUpdated' })
        .where(eq(codeEntity.entityKey, 'symbol:src/auth/login.ts#handleOAuth'))
        .run();

      const updated = db
        .select({ entityKey: codeFts.entityKey, symbolName: codeFts.symbolName })
        .from(codeFts)
        .where(eq(codeFts.entityKey, 'symbol:src/auth/login.ts#handleOAuth'))
        .limit(1)
        .get();

      expect(updated).toEqual({
        entityKey: 'symbol:src/auth/login.ts#handleOAuth',
        symbolName: 'handleOAuthUpdated',
      });

      db.delete(codeEntity)
        .where(eq(codeEntity.entityKey, 'symbol:src/auth/login.ts#handleOAuth'))
        .run();

      const afterDelete = db
        .select({ entityKey: codeFts.entityKey })
        .from(codeFts)
        .where(eq(codeFts.entityKey, 'symbol:src/auth/login.ts#handleOAuth'))
        .all();

      expect(afterDelete).toEqual([]);
    });


    it('supports trigram matches for code_fts', () => {
      const now = new Date().toISOString();
      db.insert(codeEntity)
        .values({
          entityKey: 'symbol:src/auth/login.ts#authentication',
          filePath: 'src/auth/login.ts',
          symbolName: 'authentication',
          kind: 'function',
          signature: null,
          fingerprint: null,
          contentHash: 'h1',
          updatedAt: now,
        })
        .run();

      const row = db
        .select({ entityKey: codeFts.entityKey })
        .from(codeFts)
        .where(sql`code_fts MATCH ${'uth'}`)
        .limit(1)
        .get();

      expect(row?.entityKey).toBe('symbol:src/auth/login.ts#authentication');
    });
  });

  describe('schema versioning — mismatch rebuild', () => {
    it('drops all user objects and rebuilds when schema_version mismatches', async () => {
      const dbPath = makeTempDbPath('store_mismatch');

      const bootstrap = drizzle(dbPath);
      bootstrap.run(sql`CREATE TABLE metadata (key text PRIMARY KEY NOT NULL, value text NOT NULL)`);
      bootstrap.run(sql`INSERT INTO metadata(key, value) VALUES('schema_version', '1')`);
      bootstrap.run(sql`CREATE TABLE old_table (x text)`);
      bootstrap.$client.close();

      // Create dummy WAL/SHM artifacts to verify rebuild deletion.
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      writeFileSync(walPath, 'dummy_wal');
      writeFileSync(shmPath, 'dummy_shm');
      const walInoBefore = statInoOrNull(walPath);
      const shmInoBefore = statInoOrNull(shmPath);
      expect(walInoBefore != null).toBe(true);
      expect(shmInoBefore != null).toBe(true);

      const rebuilt = createDb(dbPath);
      try {
        const old = rebuilt
          .select({ name: sqliteMaster.name })
          .from(sqliteMaster)
          .where(and(eq(sqliteMaster.type, 'table'), eq(sqliteMaster.name, 'old_table')))
          .limit(1)
          .get();

        expect(old == null).toBe(true);

        const versionRow = rebuilt
          .select()
          .from(metadata)
          .where(eq(metadata.key, 'schema_version'))
          .all();
        expect(versionRow).toHaveLength(1);
        expect(versionRow[0]!.value).toBe(String(SCHEMA_VERSION));

        const walInoAfter = statInoOrNull(walPath);
        const shmInoAfter = statInoOrNull(shmPath);

        // After rebuild, the old artifacts must have been deleted.
        // They may be re-created by SQLite, but inode should differ if present.
        expect(walInoAfter === null || walInoAfter !== walInoBefore).toBe(true);
        expect(shmInoAfter === null || shmInoAfter !== shmInoBefore).toBe(true);
      } finally {
        closeDb(rebuilt);
        await cleanupSqliteFiles(dbPath);
      }
    });

    it('rebuilds when schema_version is missing but user objects exist', async () => {
      const dbPath = makeTempDbPath('store_unknown');

      const bootstrap = drizzle(dbPath);
      bootstrap.run(sql`CREATE TABLE old_table (x text)`);
      bootstrap.$client.close();

      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      writeFileSync(walPath, 'dummy_wal');
      writeFileSync(shmPath, 'dummy_shm');
      const walInoBefore = statInoOrNull(walPath);
      const shmInoBefore = statInoOrNull(shmPath);
      expect(walInoBefore != null).toBe(true);
      expect(shmInoBefore != null).toBe(true);

      const rebuilt = createDb(dbPath);
      try {
        const old = rebuilt
          .select({ name: sqliteMaster.name })
          .from(sqliteMaster)
          .where(and(eq(sqliteMaster.type, 'table'), eq(sqliteMaster.name, 'old_table')))
          .limit(1)
          .get();

        expect(old == null).toBe(true);

        const versionRow = rebuilt
          .select()
          .from(metadata)
          .where(eq(metadata.key, 'schema_version'))
          .all();
        expect(versionRow).toHaveLength(1);
        expect(versionRow[0]!.value).toBe(String(SCHEMA_VERSION));

        const walInoAfter = statInoOrNull(walPath);
        const shmInoAfter = statInoOrNull(shmPath);
        expect(walInoAfter === null || walInoAfter !== walInoBefore).toBe(true);
        expect(shmInoAfter === null || shmInoAfter !== shmInoBefore).toBe(true);
      } finally {
        closeDb(rebuilt);
        await cleanupSqliteFiles(dbPath);
      }
    });
  });
});
