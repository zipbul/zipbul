import { describe, it, expect } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createEmberdeckDb, closeDb } from '../src/db/connection';
import type { EmberdeckDb } from '../src/db/connection';

// ---- Tests ----

describe('migration', () => {
  // HP — in-memory
  it('should return an EmberdeckDb instance when createEmberdeckDb is called with :memory:', () => {
    // Arrange / Act
    const db = createEmberdeckDb(':memory:');
    // Assert
    expect(db).toBeDefined();
    closeDb(db);
  });

  it('should create card table when createEmberdeckDb is called with :memory:', () => {
    // Arrange
    const db = createEmberdeckDb(':memory:');
    // Act: query sqlite_master for card table
    const row = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='card'")
      .get() as { name: string } | null;
    // Assert
    expect(row?.name).toBe('card');
    closeDb(db);
  });

  it('should create all 7 emberdeck tables after migration when createEmberdeckDb is called with :memory:', () => {
    // Arrange
    const db = createEmberdeckDb(':memory:');
    const expected = ['card', 'keyword', 'tag', 'card_keyword', 'card_tag', 'card_relation', 'card_fts'];
    // Act
    const rows = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='shadow' OR type='virtual'")
      .all() as { name: string }[];
    const tableNames = rows.map((r) => r.name);
    // Assert
    for (const name of expected) {
      expect(tableNames).toContain(name);
    }
    closeDb(db);
  });

  // NE — file path: mkdirSync 분기 (path !== ':memory:')
  it('should create the DB file and directory when createEmberdeckDb is called with a real file path', async () => {
    // Arrange
    const tmpDir = join(tmpdir(), `emberdeck_migrate_test_${Date.now()}`);
    const dbPath = join(tmpDir, 'sub', 'emberdeck.sqlite');
    let db: EmberdeckDb | undefined;
    try {
      // Act — path !== ':memory:' → mkdirSync called
      db = createEmberdeckDb(dbPath);
      // Assert: DB accessible
      const row = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='card'")
        .get() as { name: string } | null;
      expect(row?.name).toBe('card');
    } finally {
      if (db) closeDb(db);
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // HP — closeDb
  it('should throw when a query is attempted after closeDb is called', () => {
    // Arrange
    const db = createEmberdeckDb(':memory:');
    // Act
    closeDb(db);
    // Assert: closed DB throws on query
    expect(() => db.$client.query('SELECT 1').get()).toThrow('closed database');
  });
});
