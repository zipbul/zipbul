import { describe, it, expect, afterEach } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createCard, syncCardFromFile, removeCardByFile, serializeCardMarkdown, listCards } from '../../index';
import { createTestContext, type TestContext } from '../helpers';

async function writeTestCardFile(cardsDir: string, slug: string, summary: string, body = '') {
  const content = serializeCardMarkdown(
    { key: slug, summary, status: 'draft' },
    body,
  );
  const filePath = join(cardsDir, `${slug}.card.md`);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('syncCardFromFile', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should create DB card row when syncing a new file', async () => {
    // Arrange
    tc = await createTestContext();
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-new', 'New sync card');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const row = tc.ctx.cardRepo.findByKey('sync-new');
    expect(row).not.toBeNull();
    expect(row?.summary).toBe('New sync card');
  });

  it('should update existing DB card row when syncing changed file', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'sync-upd', summary: 'Original' });
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-upd', 'Updated by sync');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const row = tc.ctx.cardRepo.findByKey('sync-upd');
    expect(row?.summary).toBe('Updated by sync');
  });

  it('should update DB relations when syncing file that has relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'sync-rel-dst', summary: 'Dst' });
    const content = serializeCardMarkdown(
      {
        key: 'sync-rel-src',
        summary: 'Rel src',
        status: 'draft',
        relations: [{ type: 'depends-on', target: 'sync-rel-dst' }],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-rel-src.card.md');
    await writeFile(filePath, content, 'utf-8');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const rows = tc.ctx.relationRepo.findByCardKey('sync-rel-src');
    expect(rows.some((r) => !r.isReverse && r.dstCardKey === 'sync-rel-dst')).toBe(true);
  });

  it('should update DB keywords and tags when syncing file with classification', async () => {
    // Arrange
    tc = await createTestContext();
    const content = serializeCardMarkdown(
      {
        key: 'sync-cls',
        summary: 'Cls',
        status: 'draft',
        keywords: ['kw1'],
        tags: ['tag1'],
      },
      '',
    );
    const filePath = join(tc.cardsDir, 'sync-cls.card.md');
    await writeFile(filePath, content, 'utf-8');
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('sync-cls')).toContain('kw1');
    expect(tc.ctx.classificationRepo.findTagsByCard('sync-cls')).toContain('tag1');
  });

  it('should replace relations with empty array when syncing file with no relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'sync-norel-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'sync-norel-dst', summary: 'Dst' });
    const filePathWithRel = join(tc.cardsDir, 'sync-norel-src.card.md');
    const contentWith = serializeCardMarkdown(
      {
        key: 'sync-norel-src',
        summary: 'Src',
        status: 'draft',
        relations: [{ type: 'depends-on', target: 'sync-norel-dst' }],
      },
      '',
    );
    await writeFile(filePathWithRel, contentWith, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    // Act: now sync file without relations
    const contentWithout = serializeCardMarkdown(
      { key: 'sync-norel-src', summary: 'Src', status: 'draft' },
      '',
    );
    await writeFile(filePathWithRel, contentWithout, 'utf-8');
    await syncCardFromFile(tc.ctx, filePathWithRel);
    // Assert
    expect(tc.ctx.relationRepo.findByCardKey('sync-norel-src')).toHaveLength(0);
  });

  it('should reflect latest values after syncing same file twice', async () => {
    // Arrange
    tc = await createTestContext();
    const fp1 = await writeTestCardFile(tc.cardsDir, 'sync-twice', 'First sync');
    await syncCardFromFile(tc.ctx, fp1);
    const fp2 = await writeTestCardFile(tc.cardsDir, 'sync-twice', 'Second sync');
    // Act
    await syncCardFromFile(tc.ctx, fp2);
    // Assert
    const row = tc.ctx.cardRepo.findByKey('sync-twice');
    expect(row?.summary).toBe('Second sync');
  });

  it('should keep exactly one DB row after syncing same file twice', async () => {
    // Arrange
    tc = await createTestContext();
    const filePath = await writeTestCardFile(tc.cardsDir, 'sync-idp', 'Idempotent');
    await syncCardFromFile(tc.ctx, filePath);
    // Act
    await syncCardFromFile(tc.ctx, filePath);
    // Assert
    const rows = listCards(tc.ctx);
    expect(rows.filter((r) => r.key === 'sync-idp')).toHaveLength(1);
  });

  it('should propagate error when card file has invalid YAML frontmatter', async () => {
    // Arrange
    tc = await createTestContext();
    const filePath = join(tc.cardsDir, 'bad-yaml.card.md');
    await writeFile(filePath, '---\nNOT VALID YAML: [[\n---\nbody', 'utf-8');
    // Act & Assert
    expect(syncCardFromFile(tc.ctx, filePath)).rejects.toThrow();
  });
});

describe('removeCardByFile', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should delete DB card row when card with matching filePath exists', async () => {
    // Arrange
    tc = await createTestContext();
    const { filePath } = await createCard(tc.ctx, { slug: 'rm-exists', summary: 'Remove' });
    // Act
    removeCardByFile(tc.ctx, filePath);
    // Assert
    expect(tc.ctx.cardRepo.findByKey('rm-exists')).toBeNull();
  });

  it('should do nothing when no card matches the given filePath', async () => {
    // Arrange
    tc = await createTestContext();
    const unknownPath = join(tc.cardsDir, 'unknown.card.md');
    // Act (should not throw)
    expect(() => removeCardByFile(tc.ctx, unknownPath)).not.toThrow();
  });
});

