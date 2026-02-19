import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';

import { createCard, updateCard, updateCardStatus } from '../../index';
import {
  CardNotFoundError,
  RelationTypeError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('updateCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should update summary in file and DB when summary field is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-summary', summary: 'Old' });
    // Act
    await updateCard(tc.ctx, 'upd-summary', { summary: 'New summary' });
    // Assert
    const row = tc.ctx.cardRepo.findByKey('upd-summary');
    expect(row?.summary).toBe('New summary');
  });

  it('should update body in file when body field is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-body', summary: 'Body test', body: 'old body' });
    // Act
    const result = await updateCard(tc.ctx, 'upd-body', { body: 'new body' });
    // Assert
    expect(result.card.body).toBe('new body');
  });

  it('should replace keywords in DB when keywords array is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-kw', summary: 'KW', keywords: ['alpha'] });
    // Act
    await updateCard(tc.ctx, 'upd-kw', { keywords: ['beta', 'gamma'] });
    // Assert
    const kws = tc.ctx.classificationRepo.findKeywordsByCard('upd-kw');
    expect(kws).not.toContain('alpha');
    expect(kws).toContain('beta');
    expect(kws).toContain('gamma');
  });

  it('should replace tags in DB when tags array is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-tag', summary: 'Tag', tags: ['x'] });
    // Act
    await updateCard(tc.ctx, 'upd-tag', { tags: ['y', 'z'] });
    // Assert
    const tags = tc.ctx.classificationRepo.findTagsByCard('upd-tag');
    expect(tags).not.toContain('x');
    expect(tags).toContain('y');
  });

  it('should update constraints in DB when constraints field is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-cstr', summary: 'Cstr' });
    // Act
    await updateCard(tc.ctx, 'upd-cstr', { constraints: { maxSize: 10 } });
    // Assert
    const row = tc.ctx.cardRepo.findByKey('upd-cstr');
    expect(row?.constraintsJson).toContain('maxSize');
  });

  it('should replace relations in DB when relations array is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-rel-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'upd-rel-dst', summary: 'Dst' });
    // Act
    await updateCard(tc.ctx, 'upd-rel-src', {
      relations: [{ type: 'depends-on', target: 'upd-rel-dst' }],
    });
    // Assert
    const rows = tc.ctx.relationRepo.findByCardKey('upd-rel-src');
    expect(rows.some((r) => r.dstCardKey === 'upd-rel-dst' && !r.isReverse)).toBe(true);
  });

  it('should update multiple fields simultaneously when several fields provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-multi', summary: 'Multi', keywords: ['a'] });
    // Act
    const result = await updateCard(tc.ctx, 'upd-multi', {
      summary: 'Updated multi',
      body: 'updated body',
      keywords: ['b'],
    });
    // Assert
    expect(result.card.frontmatter.summary).toBe('Updated multi');
    expect(result.card.body).toBe('updated body');
    const kws = tc.ctx.classificationRepo.findKeywordsByCard('upd-multi');
    expect(kws).toContain('b');
  });

  it('should return { filePath, card } with correct shape', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-shape', summary: 'Shape' });
    // Act
    const result = await updateCard(tc.ctx, 'upd-shape', { summary: 'Updated shape' });
    // Assert
    expect(result.filePath).toContain('upd-shape.card.md');
    expect(result.card.frontmatter.key).toBe('upd-shape');
  });

  it('should preserve existing fields when empty fields object is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-nop', summary: 'No change', body: 'preserved' });
    // Act
    const result = await updateCard(tc.ctx, 'upd-nop', {});
    // Assert
    expect(result.card.frontmatter.summary).toBe('No change');
    expect(result.card.body).toBe('preserved');
  });

  it('should preserve existing body when body field is not in update fields', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'upd-body-prsv', summary: 'Preserve', body: 'keep me' });
    // Act
    const result = await updateCard(tc.ctx, 'upd-body-prsv', { summary: 'Changed' });
    // Assert
    expect(result.card.body).toBe('keep me');
  });

  it('should update status in DB when updateCardStatus is called', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'st-card', summary: 'Status' });
    // Act
    await updateCardStatus(tc.ctx, 'st-card', 'accepted');
    // Assert
    const row = tc.ctx.cardRepo.findByKey('st-card');
    expect(row?.status).toBe('accepted');
  });

  it('should update status in file frontmatter when updateCardStatus is called', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'st-file', summary: 'Status file' });
    // Act
    const result = await updateCardStatus(tc.ctx, 'st-file', 'implementing');
    // Assert
    expect(result.card.frontmatter.status).toBe('implementing');
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardNotFoundError when key does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(updateCard(tc.ctx, 'nonexistent', { summary: 'X' })).rejects.toBeInstanceOf(
      CardNotFoundError,
    );
  });

  it('should throw CardNotFoundError when file exists but frontmatter.key mismatches in updateCard', async () => {
    // Arrange — 파일은 존재하지만 내부 key가 요청 key와 다른 경우
    tc = await createTestContext();
    const wrongPath = join(tc.ctx.cardsDir, 'mismatch-upd.card.md');
    await Bun.write(wrongPath, '---\nkey: different-key\nsummary: s\nstatus: draft\n---\n');
    // Act & Assert
    await expect(
      updateCard(tc.ctx, 'mismatch-upd', { summary: 'X' }),
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should throw CardNotFoundError when file exists but frontmatter.key mismatches in updateCardStatus', async () => {
    // Arrange — 파일은 존재하지만 내부 key가 요청 key와 다른 경우
    tc = await createTestContext();
    const wrongPath = join(tc.ctx.cardsDir, 'mismatch-st.card.md');
    await Bun.write(wrongPath, '---\nkey: different-key\nsummary: s\nstatus: draft\n---\n');
    // Act & Assert
    await expect(
      updateCardStatus(tc.ctx, 'mismatch-st', 'accepted'),
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should throw RelationTypeError when relation type is not allowed', async () => {
    // Arrange
    tc = await createTestContext({ allowedRelationTypes: ['related'] });
    await createCard(tc.ctx, { slug: 'upd-rel-err', summary: 'Rel err' });
    // Act & Assert
    expect(
      updateCard(tc.ctx, 'upd-rel-err', {
        relations: [{ type: 'depends-on', target: 'other' }],
      }),
    ).rejects.toBeInstanceOf(RelationTypeError);
  });

  it('should throw CardNotFoundError when updateCardStatus key does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(
      updateCardStatus(tc.ctx, 'ghost-card', 'accepted'),
    ).rejects.toBeInstanceOf(CardNotFoundError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it('should remove keywords from DB when keywords is null', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'kw-null', summary: 'KW null', keywords: ['x'] });
    // Act
    await updateCard(tc.ctx, 'kw-null', { keywords: null });
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('kw-null')).toHaveLength(0);
  });

  it('should remove keywords from DB when keywords is empty array', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'kw-empty', summary: 'KW empty', keywords: ['x'] });
    // Act
    await updateCard(tc.ctx, 'kw-empty', { keywords: [] });
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('kw-empty')).toHaveLength(0);
  });

  it('should remove tags from DB when tags is null', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'tag-null', summary: 'Tag null', tags: ['y'] });
    // Act
    await updateCard(tc.ctx, 'tag-null', { tags: null });
    // Assert
    expect(tc.ctx.classificationRepo.findTagsByCard('tag-null')).toHaveLength(0);
  });

  it('should remove relations from DB when relations is null', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'rel-null-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'rel-null-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'rel-null-src', {
      relations: [{ type: 'depends-on', target: 'rel-null-dst' }],
    });
    // Act
    await updateCard(tc.ctx, 'rel-null-src', { relations: null });
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('rel-null-src')).toHaveLength(0);
  });

  it('should remove relations from DB when relations is empty array', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'rel-empty-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'rel-empty-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'rel-empty-src', {
      relations: [{ type: 'depends-on', target: 'rel-empty-dst' }],
    });
    // Act
    await updateCard(tc.ctx, 'rel-empty-src', { relations: [] });
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('rel-empty-src')).toHaveLength(0);
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should remove all classifications when keywords, tags, relations are all null', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'all-null-src', summary: 'All null' });
    await createCard(tc.ctx, { slug: 'all-null-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'all-null-src', {
      keywords: ['a'],
      tags: ['b'],
      relations: [{ type: 'depends-on', target: 'all-null-dst' }],
    });
    // Act
    await updateCard(tc.ctx, 'all-null-src', {
      keywords: null,
      tags: null,
      relations: null,
    });
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('all-null-src')).toHaveLength(0);
    expect(tc.ctx.classificationRepo.findTagsByCard('all-null-src')).toHaveLength(0);
    expect(tc.ctx.relationRepo.findByCardKey('all-null-src')).toHaveLength(0);
  });

  it('should update file only when updateCardStatus is called while DB row is missing', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'st-no-db', summary: 'No DB' });
    tc.ctx.cardRepo.deleteByKey('st-no-db');
    // Act (should not throw)
    const result = await updateCardStatus(tc.ctx, 'st-no-db', 'accepted');
    // Assert
    expect(result.card.frontmatter.status).toBe('accepted');
  });

  // ── State Transition ──────────────────────────────────────────────────

  it('should reflect latest value after multiple consecutive updates', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'multi-upd', summary: 'First' });
    await updateCard(tc.ctx, 'multi-upd', { summary: 'Second' });
    // Act
    await updateCard(tc.ctx, 'multi-upd', { summary: 'Third' });
    // Assert
    const row = tc.ctx.cardRepo.findByKey('multi-upd');
    expect(row?.summary).toBe('Third');
  });

  it('should reflect latest status after multiple status transitions', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'multi-st', summary: 'Status' });
    await updateCardStatus(tc.ctx, 'multi-st', 'accepted');
    await updateCardStatus(tc.ctx, 'multi-st', 'implementing');
    // Act
    await updateCardStatus(tc.ctx, 'multi-st', 'implemented');
    // Assert
    const row = tc.ctx.cardRepo.findByKey('multi-st');
    expect(row?.status).toBe('implemented');
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should produce identical result when same update is applied twice', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'idp-upd', summary: 'Idempotent' });
    await updateCard(tc.ctx, 'idp-upd', { summary: 'Same summary' });
    // Act
    const result = await updateCard(tc.ctx, 'idp-upd', { summary: 'Same summary' });
    // Assert
    expect(result.card.frontmatter.summary).toBe('Same summary');
    expect(tc.ctx.cardRepo.findByKey('idp-upd')?.summary).toBe('Same summary');
  });
});
