import { describe, it, expect, afterEach } from 'bun:test';

import { createCard, updateCard, updateCardStatus, getCard, listCards, searchCards, listCardRelations } from '../../index';
import { CardKeyError, CardNotFoundError } from '../../index';
import { createTestContext, type TestContext } from '../helpers';

describe('getCard', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return CardFile when card exists', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'q-exists', summary: 'Exists', body: 'My body' });
    // Act
    const card = await getCard(tc.ctx, 'q-exists');
    // Assert
    expect(card.frontmatter.key).toBe('q-exists');
    expect(card.frontmatter.summary).toBe('Exists');
    expect(card.body).toBe('My body');
  });

  it('should throw CardNotFoundError when card does not exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(getCard(tc.ctx, 'nonexistent')).rejects.toBeInstanceOf(CardNotFoundError);
  });

  it('should return correct frontmatter contents matching what was created', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, {
      slug: 'q-frontmatter',
      summary: 'Frontmatter test',
      keywords: ['kw1'],
      tags: ['tag1'],
    });
    // Act
    const card = await getCard(tc.ctx, 'q-frontmatter');
    // Assert
    expect(card.frontmatter.status).toBe('draft');
    expect(card.frontmatter.keywords).toContain('kw1');
    expect(card.frontmatter.tags).toContain('tag1');
  });
});

describe('listCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return all cards when no filter is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'list-a', summary: 'A' });
    await createCard(tc.ctx, { slug: 'list-b', summary: 'B' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('should return only cards with matching status when filter.status is provided', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'flt-draft', summary: 'Draft' });
    await createCard(tc.ctx, { slug: 'flt-acc', summary: 'Accepted' });
    await updateCardStatus(tc.ctx, 'flt-acc', 'accepted');
    // Act
    const rows = listCards(tc.ctx, { status: 'accepted' });
    // Assert
    expect(rows.every((r) => r.status === 'accepted')).toBe(true);
    expect(rows.some((r) => r.key === 'flt-acc')).toBe(true);
  });

  it('should return empty array when no cards exist', async () => {
    // Arrange
    tc = await createTestContext();
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows).toHaveLength(0);
  });

  it('should return empty array when filter status has no matching cards', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'flt-none', summary: 'None' });
    // Act
    const rows = listCards(tc.ctx, { status: 'deprecated' });
    // Assert
    expect(rows).toHaveLength(0);
  });

  it('should reflect updated values after updateCard when listing', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'lst-upd', summary: 'Old summary' });
    await updateCard(tc.ctx, 'lst-upd', { summary: 'New summary' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    const row = rows.find((r) => r.key === 'lst-upd');
    expect(row?.summary).toBe('New summary');
  });

  it('should return exactly one card after creating one card', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'one-card', summary: 'One' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows).toHaveLength(1);
  });

  it('should return correct count after creating multiple cards', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'mc-1', summary: 'MC1' });
    await createCard(tc.ctx, { slug: 'mc-2', summary: 'MC2' });
    await createCard(tc.ctx, { slug: 'mc-3', summary: 'MC3' });
    // Act
    const rows = listCards(tc.ctx);
    // Assert
    expect(rows).toHaveLength(3);
  });

  it('should return identical results on repeated calls to listCards', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'idp-lst', summary: 'Idp' });
    // Act
    const rows1 = listCards(tc.ctx);
    const rows2 = listCards(tc.ctx);
    // Assert
    expect(rows1.length).toBe(rows2.length);
    expect(rows1[0]?.key).toBe(rows2[0]?.key);
  });
});

describe('searchCards', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return empty array since FTS5 is not configured', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'srch-card', summary: 'Search me' });
    // Act
    const rows = searchCards(tc.ctx, 'Search');
    // Assert
    expect(rows).toHaveLength(0);
  });
});

describe('listCardRelations', () => {
  let tc: TestContext;

  afterEach(async () => {
    await tc?.cleanup();
  });

  it('should return relation list when card has relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'lrel-src', summary: 'Src' });
    await createCard(tc.ctx, { slug: 'lrel-dst', summary: 'Dst' });
    await updateCard(tc.ctx, 'lrel-src', {
      relations: [{ type: 'depends-on', target: 'lrel-dst' }],
    });
    // Act
    const rows = listCardRelations(tc.ctx, 'lrel-src');
    // Assert
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.dstCardKey === 'lrel-dst')).toBe(true);
  });

  it('should return empty array when card has no relations', async () => {
    // Arrange
    tc = await createTestContext();
    await createCard(tc.ctx, { slug: 'lrel-none', summary: 'No rel' });
    // Act
    const rows = listCardRelations(tc.ctx, 'lrel-none');
    // Assert
    expect(rows).toHaveLength(0);
  });

  it('should throw CardKeyError when key is invalid', async () => {
    // Arrange
    tc = await createTestContext();
    // Act & Assert
    expect(() => listCardRelations(tc.ctx, '')).toThrow(CardKeyError);
  });
});
