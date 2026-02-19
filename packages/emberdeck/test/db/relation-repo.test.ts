import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../../src/db/connection';
import { DrizzleCardRepository } from '../../src/db/card-repo';
import { DrizzleRelationRepository } from '../../src/db/relation-repo';
import type { EmberdeckDb } from '../../src/db/connection';
import type { CardRow } from '../../src/db/repository';

// ---- Setup ----

let db: EmberdeckDb;
let cardRepo: DrizzleCardRepository;
let repo: DrizzleRelationRepository;

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  cardRepo = new DrizzleCardRepository(db);
  repo = new DrizzleRelationRepository(db);
});

afterEach(() => {
  closeDb(db);
});

// ---- Helpers ----

function insertCard(key: string, filePath = `/cards/${key}.card.md`): void {
  const row: CardRow = {
    key,
    summary: `Card ${key}`,
    status: 'draft',
    constraintsJson: null,
    body: null,
    filePath,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  cardRepo.upsert(row);
}

// ---- Tests ----

describe('DrizzleRelationRepository', () => {
  // HP
  it('should insert a forward relation (isReverse=false) when replaceForCard is called and target card exists', () => {
    // Arrange
    insertCard('src');
    insertCard('dst');
    // Act
    repo.replaceForCard('src', [{ type: 'depends-on', target: 'dst' }]);
    // Assert
    const rows = repo.findByCardKey('src');
    expect(rows.some((r) => r.isReverse === false && r.type === 'depends-on')).toBe(true);
  });

  it('should insert a reverse relation (isReverse=true) when replaceForCard is called and target card exists', () => {
    // Arrange
    insertCard('src');
    insertCard('dst');
    // Act
    repo.replaceForCard('src', [{ type: 'depends-on', target: 'dst' }]);
    // Assert — reverse row: dst→src isReverse=true
    const rows = repo.findByCardKey('dst');
    expect(rows.some((r) => r.isReverse === true && r.dstCardKey === 'src')).toBe(true);
  });

  it('should insert 4 rows when replaceForCard is called with 2 relations (2 forward + 2 reverse)', () => {
    // Arrange
    insertCard('src');
    insertCard('dst1');
    insertCard('dst2');
    // Act
    repo.replaceForCard('src', [
      { type: 'depends-on', target: 'dst1' },
      { type: 'references', target: 'dst2' },
    ]);
    // Assert
    const srcRows = repo.findByCardKey('src');
    const dst1Rows = repo.findByCardKey('dst1');
    const dst2Rows = repo.findByCardKey('dst2');
    // forward: src→dst1, src→dst2 (2), reverse: dst1→src, dst2→src (2)
    expect(srcRows.length + dst1Rows.length + dst2Rows.length).toBe(4);
  });

  it('should return forward rows when findByCardKey is called with srcCardKey', () => {
    // Arrange
    insertCard('a');
    insertCard('b');
    repo.replaceForCard('a', [{ type: 'related', target: 'b' }]);
    // Act
    const rows = repo.findByCardKey('a');
    // Assert: only forward rows from 'a'
    expect(rows.every((r) => r.srcCardKey === 'a')).toBe(true);
  });

  it('should replace all relations when replaceForCard is called again with different relations', () => {
    // Arrange
    insertCard('x');
    insertCard('y');
    insertCard('z');
    repo.replaceForCard('x', [{ type: 'depends-on', target: 'y' }]);
    // Act
    repo.replaceForCard('x', [{ type: 'references', target: 'z' }]);
    // Assert: old rel gone, new rel present
    const rows = repo.findByCardKey('x');
    expect(rows.every((r) => r.dstCardKey !== 'y')).toBe(true);
    expect(rows.some((r) => r.dstCardKey === 'z')).toBe(true);
  });

  it('should delete existing relations when replaceForCard is called with empty relations array', () => {
    // Arrange
    insertCard('p');
    insertCard('q');
    repo.replaceForCard('p', [{ type: 'related', target: 'q' }]);
    // Act
    repo.replaceForCard('p', []);
    // Assert
    expect(repo.findByCardKey('p')).toEqual([]);
  });

  it('should remove src and dst rows when deleteByCardKey is called', () => {
    // Arrange
    insertCard('m');
    insertCard('n');
    repo.replaceForCard('m', [{ type: 'related', target: 'n' }]);
    // Act
    repo.deleteByCardKey('m');
    // Assert: forward + reverse for 'm' gone
    expect(repo.findByCardKey('m')).toEqual([]);
    expect(repo.findByCardKey('n')).toEqual([]);
  });

  // NE
  it('should not throw and skip the relation when replaceForCard target card does not exist (FK catch)', () => {
    // Arrange
    insertCard('source');
    // 'missing-target' does not exist in card table → FK violation → try-catch スキップ
    // Act / Assert
    expect(() =>
      repo.replaceForCard('source', [{ type: 'depends-on', target: 'missing-target' }]),
    ).not.toThrow();
    // no rows inserted
    expect(repo.findByCardKey('source')).toEqual([]);
  });

  it('should return empty array when findByCardKey is called with non-existent cardKey', () => {
    // Act / Assert
    expect(repo.findByCardKey('no/such')).toEqual([]);
  });

  it('should not throw when deleteByCardKey is called with non-existent cardKey', () => {
    // Act / Assert
    expect(() => repo.deleteByCardKey('ghost')).not.toThrow();
  });

  // ED
  it('should result in empty findByCardKey when replaceForCard is called with empty relations', () => {
    // Arrange
    insertCard('empty-src');
    // Act
    repo.replaceForCard('empty-src', []);
    // Assert
    expect(repo.findByCardKey('empty-src')).toEqual([]);
  });

  // ST
  it('should have only replaced relations when replaceForCard is called twice with different relations', () => {
    // Arrange
    insertCard('s');
    insertCard('t1');
    insertCard('t2');
    // Act
    repo.replaceForCard('s', [{ type: 'depends-on', target: 't1' }]);
    repo.replaceForCard('s', [{ type: 'related', target: 't2' }]);
    // Assert
    const rows = repo.findByCardKey('s');
    expect(rows.every((r) => r.type === 'related')).toBe(true);
  });

  // ID
  it('should not throw when deleteByCardKey is called twice consecutively', () => {
    // Arrange
    insertCard('del2');
    insertCard('del2-dst');
    repo.replaceForCard('del2', [{ type: 'related', target: 'del2-dst' }]);
    // Act / Assert
    expect(() => {
      repo.deleteByCardKey('del2');
      repo.deleteByCardKey('del2');
    }).not.toThrow();
  });

  // CO
  it('should insert only relations where target exists when mixed existing and non-existing targets given', () => {
    // Arrange
    insertCard('src2');
    insertCard('exists-dst');
    // 'no-exists-dst' not inserted
    // Act
    repo.replaceForCard('src2', [
      { type: 'depends-on', target: 'exists-dst' },
      { type: 'references', target: 'no-exists-dst' },
    ]);
    // Assert: only exists-dst relation present
    const rows = repo.findByCardKey('src2');
    expect(rows.some((r) => r.dstCardKey === 'exists-dst')).toBe(true);
    expect(rows.every((r) => r.dstCardKey !== 'no-exists-dst')).toBe(true);
  });
});
