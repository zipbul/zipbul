import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';

import { createCard, deleteCard, updateCard } from '../../index';
import { CardNotFoundError } from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('deleteCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should delete file and DB card row when card exists', async () => {
    // Arrange
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { slug: 'del-card', summary: 'Del' });
    // Act
    await deleteCard(tc.ctx, 'del-card');
    // Assert
    expect(existsSync(filePath)).toBe(false);
    expect(tc.ctx.cardRepo.findByKey('del-card')).toBeNull();
  });

  it('should cascade-delete card_relation rows via FK when card with relations is deleted', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'del-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'del-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'del-src', {
      relations: [{ type: 'depends-on', target: 'del-dst' }],
    });
    // Act
    await deleteCard(tc.ctx, 'del-src');
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('del-src')).toHaveLength(0);
  });

  it('should cascade-delete card_keyword and card_tag rows via FK when card is deleted', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'del-cls',
      summary: 'Cls',
      keywords: ['kw1'],
      tags: ['tag1'],
    });
    // Act
    await deleteCard(tc.ctx, 'del-cls');
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('del-cls')).toHaveLength(0);
    expect(tc.ctx.classificationRepo.findTagsByCard('del-cls')).toHaveLength(0);
  });

  it('should return { filePath } that matches the deleted file path', async () => {
    // Arrange
    tc = await createTestContext();
    const { filePath: createdPath } = await createCard(tc.ctx, {
      slug: 'del-ret',
      summary: 'Return',
    });
    // Act
    const result = await deleteCard(tc.ctx, 'del-ret');
    // Assert
    expect(result.filePath).toBe(createdPath);
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardNotFoundError when key does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(deleteCard(tc.ctx, 'ghost-del')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should delete nested slug card and keep parent directory', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'nested/del', summary: 'Nested del' });
    // Act
    await deleteCard(tc.ctx, 'nested/del');
    // Assert
    const { join } = await import('node:path');
    const dir = join(tc.cardsDir, 'nested');
    expect(existsSync(dir)).toBe(true);
  });

  it('should skip cascade implicitly since FK on_delete handles it', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'rel-del-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'rel-del-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'rel-del-src', {
      relations: [{ type: 'depends-on', target: 'rel-del-dst' }],
    });
    // Act
    await deleteCard(tc.ctx, 'rel-del-dst');
    // Assert: Forward relation where dst was deleted should be cascade-removed
    const rows = tc.ctx.relationRepo.findByCardKey('rel-del-src');
    expect(rows.filter((r) => r.dstCardKey === 'rel-del-dst')).toHaveLength(0);
  });

  // ── State Transition ───────────────────────────────────────────────────

  it('should return false from existsByKey after card is deleted', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'exists-del', summary: 'Exists del' });
    // Act
    await deleteCard(tc.ctx, 'exists-del');
    // Assert
    expect(tc.ctx.cardRepo.existsByKey('exists-del')).toBe(false);
  });

  it('should have zero relation rows after deleting card with relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'st-del-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'st-del-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'st-del-src', {
      relations: [{ type: 'depends-on', target: 'st-del-dst' }],
    });
    // Act
    await deleteCard(tc.ctx, 'st-del-src');
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('st-del-src')).toHaveLength(0);
  });
});
