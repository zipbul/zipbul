import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync } from 'node:fs';

import { createCard } from '../../index';
import {
  CardAlreadyExistsError,
  CardKeyError,
  RelationTypeError,
} from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('createCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────

  it('should create file and DB card row when given minimal input', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, { slug: 'my-card', summary: 'My card' });
    // Assert
    expect(existsSync(result.filePath)).toBe(true);
    expect(tc.ctx.cardRepo.findByKey('my-card')).not.toBeNull();
  });

  it('should save provided body to file when body is given', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, {
      slug: 'with-body',
      summary: 'With body',
      body: 'Hello world',
    });
    // Assert
    expect(result.card.body).toBe('Hello world');
  });

  it('should save keywords to DB when keywords are provided', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    await createCard(tc.ctx, { slug: 'kw-card', summary: 'KW', keywords: ['alpha', 'beta'] });
    // Assert
    const kws = tc.ctx.classificationRepo.findKeywordsByCard('kw-card');
    expect(kws).toContain('alpha');
    expect(kws).toContain('beta');
  });

  it('should save tags to DB when tags are provided', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    await createCard(tc.ctx, { slug: 'tag-card', summary: 'TAG', tags: ['foo', 'bar'] });
    // Assert
    const tags = tc.ctx.classificationRepo.findTagsByCard('tag-card');
    expect(tags).toContain('foo');
    expect(tags).toContain('bar');
  });

  it('should create bidirectional DB relations when relations are provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'target-card', summary: 'Target' });
    // Act
    await createCard(tc.ctx, {
      slug: 'src-card',
      summary: 'Source',
      relations: [{ type: 'depends-on', target: 'target-card' }],
    });
    // Assert
    const rows = tc.ctx.relationRepo.findByCardKey('src-card');
    const forwardRow = rows.find((r) => !r.isReverse && r.dstCardKey === 'target-card');
    expect(forwardRow).not.toBeUndefined();
  });

  it('should create subdirectory automatically when slug contains path separator', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, { slug: 'a/b', summary: 'Nested' });
    // Assert
    expect(existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toContain('a/b.card.md');
  });

  it('should return correct { filePath, fullKey, card } shape', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, { slug: 'shape-card', summary: 'Shape' });
    // Assert
    expect(result.fullKey).toBe('shape-card');
    expect(result.filePath).toContain('shape-card.card.md');
    expect(result.card.frontmatter.key).toBe('shape-card');
  });

  it("should set status to 'draft' on newly created card", async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, { slug: 'draft-card', summary: 'Draft' });
    // Assert
    expect(result.card.frontmatter.status).toBe('draft');
  });

  // ── Negative / Error ───────────────────────────────────────────────────

  it('should throw CardAlreadyExistsError when slug already exists', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'dup-card', summary: 'First' });
    // Act & Assert
    expect(createCard(tc.ctx, { slug: 'dup-card', summary: 'Second' })).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });

  it('should throw RelationTypeError when relation type is not allowed', async () => {
    // Arrange
    tc = await createTestContext({ allowedRelationTypes: ['related'] });
    // Act & Assert
    expect(
      createCard(tc.ctx, {
        slug: 'rel-err',
        summary: 'RelErr',
        relations: [{ type: 'depends-on', target: 'other' }],
      }),
    ).rejects.toBeInstanceOf(RelationTypeError);
  });

  it('should throw CardKeyError when slug is empty string', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(createCard(tc.ctx, { slug: '', summary: 'Empty' })).rejects.toBeInstanceOf(
      CardKeyError,
    );
  });

  it('should throw CardKeyError when slug contains path traversal', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(
      createCard(tc.ctx, { slug: '../evil', summary: 'Evil' }),
    ).rejects.toBeInstanceOf(CardKeyError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────

  it("should default body to empty string when body is undefined", async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, { slug: 'no-body', summary: 'No body' });
    // Assert
    expect(result.card.body).toBe('');
  });

  it('should omit keywords field from frontmatter when keywords is empty array', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, {
      slug: 'empty-kw',
      summary: 'Empty KW',
      keywords: [],
    });
    // Assert
    expect(result.card.frontmatter.keywords).toBeUndefined();
  });

  it('should omit tags field from frontmatter when tags is empty array', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, {
      slug: 'empty-tags',
      summary: 'Empty tags',
      tags: [],
    });
    // Assert
    expect(result.card.frontmatter.tags).toBeUndefined();
  });

  it('should omit relations field from frontmatter when relations is empty array', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, {
      slug: 'empty-rels',
      summary: 'Empty rels',
      relations: [],
    });
    // Assert
    expect(result.card.frontmatter.relations).toBeUndefined();
  });

  it('should create card successfully when allowedRelationTypes is empty and no relations given', async () => {
    // Arrange
    tc = await createTestContext({ allowedRelationTypes: [] });
    // Act
    const result = await createCard(tc.ctx, { slug: 'no-rel-types', summary: 'OK' });
    // Assert
    expect(existsSync(result.filePath)).toBe(true);
  });

  it('should use single character slug without error', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const result = await createCard(tc.ctx, { slug: 'a', summary: 'Single' });
    // Assert
    expect(result.fullKey).toBe('a');
  });

  // ── Corner ────────────────────────────────────────────────────────────

  it('should not save any classification when keywords, tags, and relations are all empty arrays', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    await createCard(tc.ctx, {
      slug: 'all-empty',
      summary: 'All empty',
      keywords: [],
      tags: [],
      relations: [],
    });
    // Assert
    expect(tc.ctx.classificationRepo.findKeywordsByCard('all-empty')).toHaveLength(0);
    expect(tc.ctx.classificationRepo.findTagsByCard('all-empty')).toHaveLength(0);
    expect(tc.ctx.relationRepo.findByCardKey('all-empty')).toHaveLength(0);
  });

  it('should throw RelationTypeError when allowedRelationTypes is empty and relations provided', async () => {
    // Arrange
    tc = await createTestContext({ allowedRelationTypes: [] });
    // Act & Assert
    expect(
      createCard(tc.ctx, {
        slug: 'no-allowed',
        summary: 'No allowed',
        relations: [{ type: 'related', target: 'other' }],
      }),
    ).rejects.toBeInstanceOf(RelationTypeError);
  });

  // ── State Transition ──────────────────────────────────────────────────

  it('should succeed on re-create after deleting same slug', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 're-create', summary: 'First' });
    tc.ctx.cardRepo.deleteByKey('re-create');
    const { rm } = await import('node:fs/promises');
    const filePath = `${tc.cardsDir}/re-create.card.md`;
    await rm(filePath, { force: true });
    // Act
    const result = await createCard(tc.ctx, { slug: 're-create', summary: 'Second' });
    // Assert
    expect(existsSync(result.filePath)).toBe(true);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  it('should throw CardAlreadyExistsError on second call with same slug', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'idp-card', summary: 'First' });
    // Act & Assert
    expect(createCard(tc.ctx, { slug: 'idp-card', summary: 'Again' })).rejects.toBeInstanceOf(
      CardAlreadyExistsError,
    );
  });
});
