import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';

import { createCard, renameCard, updateCard } from '../../index';
import {
  CardAlreadyExistsError,
  CardKeyError,
  CardNotFoundError,
  CardRenameSamePathError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('renameCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should move file and update frontmatter key when rename succeeds', async () => {
    // Arrange
    tc = await createTestContext();
    const { filePath: oldPath } = await createCard(tc.ctx, {
      slug: 'old-name',
      summary: 'Old',
    });
    // Act
    const result = await renameCard(tc.ctx, 'old-name', 'new-name');
    // Assert
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(result.newFilePath)).toBe(true);
    expect(result.card.frontmatter.key).toBe('new-name');
  });

  it('should update DB key and filePath when rename succeeds', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'db-old', summary: 'DB old' });
    // Act
    await renameCard(tc.ctx, 'db-old', 'db-new');
    // Assert
    expect(tc.ctx.cardRepo.findByKey('db-old')).toBeNull();
    const newRow = tc.ctx.cardRepo.findByKey('db-new');
    expect(newRow).not.toBeNull();
    expect(newRow?.filePath).toContain('db-new.card.md');
  });

  it('should restore forward relations under new key after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'rnm-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'rnm-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'rnm-src', {
      relations: [{ type: 'depends-on', target: 'rnm-dst' }],
    });
    // Act
    await renameCard(tc.ctx, 'rnm-src', 'rnm-src-new');
    // Assert
    const rows = tc.ctx.relationRepo.findByCardKey('rnm-src-new');
    expect(rows.some((r) => !r.isReverse && r.dstCardKey === 'rnm-dst')).toBe(true);
  });

  it('should restore keywords under new key after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'rnm-kw', summary: 'KW', keywords: ['a', 'b'] });
    // Act
    await renameCard(tc.ctx, 'rnm-kw', 'rnm-kw-new');
    // Assert
    const kws = tc.ctx.classificationRepo.findKeywordsByCard('rnm-kw-new');
    expect(kws).toContain('a');
    expect(kws).toContain('b');
  });

  it('should restore tags under new key after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'rnm-tag', summary: 'Tag', tags: ['t1'] });
    // Act
    await renameCard(tc.ctx, 'rnm-tag', 'rnm-tag-new');
    // Assert
    const tags = tc.ctx.classificationRepo.findTagsByCard('rnm-tag-new');
    expect(tags).toContain('t1');
  });

  it('should return { oldFilePath, newFilePath, newFullKey, card } with correct shape', async () => {
    // Arrange
    tc = await createTestContext();
    const { filePath: oldPath } = await createCard(tc.ctx, {
      slug: 'rnm-shape',
      summary: 'Shape',
    });
    // Act
    const result = await renameCard(tc.ctx, 'rnm-shape', 'rnm-shape-new');
    // Assert
    expect(result.oldFilePath).toBe(oldPath);
    expect(result.newFullKey).toBe('rnm-shape-new');
    expect(result.newFilePath).toContain('rnm-shape-new.card.md');
  });

  it('should create nested subdirectory automatically when renaming to nested slug', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'flat-slug', summary: 'Flat' });
    // Act
    const result = await renameCard(tc.ctx, 'flat-slug', 'nested/renamed');
    // Assert
    expect(existsSync(result.newFilePath)).toBe(true);
    expect(result.newFilePath).toContain('nested/renamed.card.md');
  });

  it('should create bidirectional reverse relation entries under new key after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'bidi-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'bidi-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'bidi-src', {
      relations: [{ type: 'related', target: 'bidi-dst' }],
    });
    // Act
    await renameCard(tc.ctx, 'bidi-src', 'bidi-src-new');
    // Assert: reverse entry from dst→new-src
    const reverseRows = tc.ctx.relationRepo.findByCardKey('bidi-dst');
    expect(reverseRows.some((r) => r.isReverse && r.dstCardKey === 'bidi-src-new')).toBe(true);
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardRenameSamePathError when old and new paths are identical', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'same-slug', summary: 'Same' });
    // Act & Assert
    expect(renameCard(tc.ctx, 'same-slug', 'same-slug')).rejects.toBeInstanceOf(
      CardRenameSamePathError,
    );
  });

  it('should throw CardNotFoundError when source card does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(renameCard(tc.ctx, 'ghost', 'target')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should throw CardAlreadyExistsError when target card already exists', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'src-conflict', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'dst-conflict', summary: 'Dst' });
    // Act & Assert
    expect(renameCard(tc.ctx, 'src-conflict', 'dst-conflict')).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });

  it('should throw CardKeyError when newSlug is invalid', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'valid-src', summary: 'Valid' });
    // Act & Assert
    expect(renameCard(tc.ctx, 'valid-src', '')).rejects.toBeInstanceOf(CardKeyError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should rename card without errors when it has no relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-rel-rnm', summary: 'No rel' });
    // Act
    const result = await renameCard(tc.ctx, 'no-rel-rnm', 'no-rel-rnm-new');
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('no-rel-rnm-new')).toHaveLength(0);
    expect(existsSync(result.newFilePath)).toBe(true);
  });

  it('should rename card without errors when it has no keywords', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'no-kw-rnm', summary: 'No kw' });
    // Act
    const result = await renameCard(tc.ctx, 'no-kw-rnm', 'no-kw-rnm-new');
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('no-kw-rnm-new')).toHaveLength(0);
    expect(existsSync(result.newFilePath)).toBe(true);
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should throw CardNotFoundError when source missing even if target exists', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'co-dst', summary: 'Dst exists' });
    // Act & Assert (source check happens before dest check)
    expect(renameCard(tc.ctx, 'co-src-missing', 'co-dst')).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
  });

  it('should preserve relations, keywords, and tags simultaneously after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'all-rnm-src', summary: 'All' });
    await createCard(tc.ctx, { slug: 'all-rnm-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'all-rnm-src', {
      relations: [{ type: 'depends-on', target: 'all-rnm-dst' }],
      keywords: ['kw'],
      tags: ['tg'],
    });
    // Act
    await renameCard(tc.ctx, 'all-rnm-src', 'all-rnm-new');
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('all-rnm-new').length).toBeGreaterThan(0);
    expect(tc.ctx.classificationRepo.findKeywordsByCard('all-rnm-new')).toContain('kw');
    expect(tc.ctx.classificationRepo.findTagsByCard('all-rnm-new')).toContain('tg');
  });

  // ── State Transition ───────────────────────────────────────────────────

  it('should confirm old file path no longer exists after rename', async () => {
    // Arrange
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { slug: 'st-rnm-old', summary: 'Old' });
    // Act
    await renameCard(tc.ctx, 'st-rnm-old', 'st-rnm-new');
    // Assert
    expect(existsSync(filePath)).toBe(false);
  });

  it('should confirm new file path exists after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'st-new-old', summary: 'Old' });
    // Act
    const result = await renameCard(tc.ctx, 'st-new-old', 'st-new-new');
    // Assert
    expect(existsSync(result.newFilePath)).toBe(true);
  });

  it('should succeed on chained renames A then B then C', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'chain-a', summary: 'Chain A' });
    await renameCard(tc.ctx, 'chain-a', 'chain-b');
    // Act
    const result = await renameCard(tc.ctx, 'chain-b', 'chain-c');
    // Assert
    expect(result.newFullKey).toBe('chain-c');
    expect(tc.ctx.cardRepo.findByKey('chain-a')).toBeNull();
    expect(tc.ctx.cardRepo.findByKey('chain-b')).toBeNull();
    expect(tc.ctx.cardRepo.findByKey('chain-c')).not.toBeNull();
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should throw CardNotFoundError when re-renaming from old slug after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'idp-rnm-src', summary: 'Idp' });
    await renameCard(tc.ctx, 'idp-rnm-src', 'idp-rnm-dst');
    // Act & Assert
    expect(renameCard(tc.ctx, 'idp-rnm-src', 'idp-rnm-dst2')).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
  });

  it('should preserve body, status, and summary after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'preserve-all',
      summary: 'Preserved',
      body: 'Body preserved',
    });
    // Act
    const result = await renameCard(tc.ctx, 'preserve-all', 'preserve-all-new');
    // Assert
    expect(result.card.frontmatter.summary).toBe('Preserved');
    expect(result.card.body).toBe('Body preserved');
    expect(result.card.frontmatter.status).toBe('draft');
  });

  it('should have no old DB row and a valid new DB row after rename', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'db-verify-old', summary: 'DB verify' });
    // Act
    await renameCard(tc.ctx, 'db-verify-old', 'db-verify-new');
    // Assert
    expect(tc.ctx.cardRepo.findByKey('db-verify-old')).toBeNull();
    expect(tc.ctx.cardRepo.findByKey('db-verify-new')).not.toBeNull();
  });
});
