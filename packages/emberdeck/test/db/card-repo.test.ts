import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../../src/db/connection';
import { DrizzleCardRepository } from '../../src/db/card-repo';
import type { EmberdeckDb } from '../../src/db/connection';
import type { CardRow } from '../../src/db/repository';

// ---- Fixtures ----

function makeRow(overrides: Partial<CardRow> = {}): CardRow {
  return {
    key: 'test/card',
    summary: 'Test card',
    status: 'draft',
    constraintsJson: null,
    body: 'body content',
    filePath: '/cards/test/card.card.md',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---- Setup ----

let db: EmberdeckDb;
let repo: DrizzleCardRepository;

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  repo = new DrizzleCardRepository(db);
});

afterEach(() => {
  closeDb(db);
});

// ---- Tests ----

describe('DrizzleCardRepository', () => {
  // HP
  it('should return CardRow when findByKey is called with an existing key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'a/b', summary: 'S' }));
    // Act
    const result = repo.findByKey('a/b');
    // Assert
    expect(result).not.toBeNull();
    expect(result?.key).toBe('a/b');
  });

  it('should return only the matching CardRow when two cards exist and second key is queried', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'a/one', summary: 'One', filePath: '/cards/one.card.md' }));
    repo.upsert(makeRow({ key: 'a/two', summary: 'Two', filePath: '/cards/two.card.md' }));
    // Act
    const result = repo.findByKey('a/two');
    // Assert
    expect(result?.key).toBe('a/two');
    expect(result?.summary).toBe('Two');
  });

  it('should return CardRow when findByFilePath is called with an existing filePath', () => {
    // Arrange
    const fp = '/cards/x/y.card.md';
    repo.upsert(makeRow({ key: 'x/y', filePath: fp }));
    // Act
    const result = repo.findByFilePath(fp);
    // Assert
    expect(result?.filePath).toBe(fp);
  });

  it('should insert a new row when upsert is called with a new key', () => {
    // Arrange / Act
    repo.upsert(makeRow({ key: 'new/key' }));
    // Assert
    expect(repo.findByKey('new/key')).not.toBeNull();
  });

  it('should update summary when upsert is called with an existing key and different summary', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'k', summary: 'old', filePath: '/a.card.md' }));
    // Act
    repo.upsert(makeRow({ key: 'k', summary: 'new', filePath: '/a.card.md' }));
    // Assert
    expect(repo.findByKey('k')?.summary).toBe('new');
  });

  it('should preserve null body when upsert stores null body and findByKey is called', () => {
    // Arrange / Act
    repo.upsert(makeRow({ key: 'k2', body: null, filePath: '/b.card.md' }));
    // Assert
    expect(repo.findByKey('k2')?.body).toBeNull();
  });

  it('should return null on findByKey after deleteByKey removes the existing key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'del' }));
    // Act
    repo.deleteByKey('del');
    // Assert
    expect(repo.findByKey('del')).toBeNull();
  });

  it('should return true when existsByKey is called with an existing key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'exists' }));
    // Act / Assert
    expect(repo.existsByKey('exists')).toBe(true);
  });

  it('should return all rows when list is called without filter', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'p/1', status: 'draft', filePath: '/1.card.md' }));
    repo.upsert(makeRow({ key: 'p/2', status: 'accepted', filePath: '/2.card.md' }));
    // Act
    const result = repo.list();
    // Assert
    expect(result).toHaveLength(2);
  });

  it('should return only draft cards when list is called with status draft filter', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'p/d', status: 'draft', filePath: '/d.card.md' }));
    repo.upsert(makeRow({ key: 'p/a', status: 'accepted', filePath: '/a.card.md' }));
    // Act
    const result = repo.list({ status: 'draft' });
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('p/d');
  });

  it('should return empty array when search is called (FTS not configured)', () => {
    // Arrange
    repo.upsert(makeRow({ key: 's/x' }));
    // Act
    const result = repo.search('any query');
    // Assert
    expect(result).toEqual([]);
  });

  // NE
  it('should return null when findByKey is called with a non-existent key', () => {
    // Act / Assert
    expect(repo.findByKey('no/such')).toBeNull();
  });

  it('should return null when findByFilePath is called with a non-existent filePath', () => {
    // Act / Assert
    expect(repo.findByFilePath('/no/such.card.md')).toBeNull();
  });

  it('should return false when existsByKey is called with a non-existent key', () => {
    // Act / Assert
    expect(repo.existsByKey('no/exists')).toBe(false);
  });

  it('should not throw when deleteByKey is called with a non-existent key', () => {
    // Act / Assert
    expect(() => repo.deleteByKey('ghost/key')).not.toThrow();
  });

  it('should return empty array when list is called with status draft but no draft cards exist', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'p/a2', status: 'accepted', filePath: '/a2.card.md' }));
    // Act
    const result = repo.list({ status: 'draft' });
    // Assert
    expect(result).toEqual([]);
  });

  // ED
  it('should return empty array when list is called on empty DB', () => {
    // Act / Assert
    expect(repo.list()).toEqual([]);
  });

  // ST
  it('should succeed re-insert after upsert→deleteByKey→upsert with same key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'cycle' }));
    repo.deleteByKey('cycle');
    // Act
    repo.upsert(makeRow({ key: 'cycle', summary: 'renewed' }));
    // Assert
    expect(repo.findByKey('cycle')?.summary).toBe('renewed');
  });

  it('should return updated summary when upsert is called twice with same key but different summary', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'upd', summary: 'v1', filePath: '/v.card.md' }));
    // Act
    repo.upsert(makeRow({ key: 'upd', summary: 'v2', filePath: '/v.card.md' }));
    // Assert
    expect(repo.findByKey('upd')?.summary).toBe('v2');
  });

  // ID
  it('should return same result on consecutive existsByKey calls with same key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'idem' }));
    // Act
    const first = repo.existsByKey('idem');
    const second = repo.existsByKey('idem');
    // Assert
    expect(first).toBe(second);
  });
});
