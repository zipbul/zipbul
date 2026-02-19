import type { EmberdeckContext } from '../config';
import type { CardFile, CardFrontmatter, CardRelation, CardStatus } from '../card/types';
import type { CardRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError, RelationTypeError } from '../card/errors';
import { readCardFile } from '../fs/reader';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import type { EmberdeckDb } from '../db/connection';

export interface UpdateCardFields {
  summary?: string;
  body?: string;
  keywords?: string[] | null;
  tags?: string[] | null;
  constraints?: unknown;
  relations?: CardRelation[] | null;
}

export interface UpdateCardResult {
  filePath: string;
  card: CardFile;
}

export async function updateCard(
  ctx: EmberdeckContext,
  fullKey: string,
  fields: UpdateCardFields,
): Promise<UpdateCardResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  if (!(await Bun.file(filePath).exists())) {
    throw new CardNotFoundError(key);
  }

  const current = await readCardFile(filePath);
  if (current.frontmatter.key !== key) {
    throw new CardNotFoundError(key);
  }

  if (fields.relations && fields.relations !== null) {
    for (const rel of fields.relations) {
      if (!ctx.allowedRelationTypes.includes(rel.type)) {
        throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
      }
    }
  }

  const next: CardFrontmatter = { ...current.frontmatter };
  if (fields.summary !== undefined) next.summary = fields.summary;
  if (fields.keywords !== undefined) {
    if (fields.keywords === null || fields.keywords.length === 0) delete next.keywords;
    else next.keywords = fields.keywords;
  }
  if (fields.tags !== undefined) {
    if (fields.tags === null || fields.tags.length === 0) delete next.tags;
    else next.tags = fields.tags;
  }
  if (fields.constraints !== undefined) next.constraints = fields.constraints;
  if (fields.relations !== undefined) {
    if (fields.relations === null || fields.relations.length === 0) delete next.relations;
    else next.relations = fields.relations;
  }

  const nextBody = fields.body !== undefined ? fields.body : current.body;
  const card: CardFile = { filePath, frontmatter: next, body: nextBody };

  await writeCardFile(filePath, card);

  const now = new Date().toISOString();
  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as EmberdeckDb);

    const row: CardRow = {
      key,
      summary: next.summary,
      status: next.status,
      constraintsJson: next.constraints ? JSON.stringify(next.constraints) : null,
      body: nextBody,
      filePath,
      updatedAt: now,
    };
    cardRepo.upsert(row);

    if (fields.relations !== undefined) relationRepo.replaceForCard(key, next.relations ?? []);
    if (fields.keywords !== undefined) classRepo.replaceKeywords(key, next.keywords ?? []);
    if (fields.tags !== undefined) classRepo.replaceTags(key, next.tags ?? []);
  });

  return { filePath, card };
}

export async function updateCardStatus(
  ctx: EmberdeckContext,
  fullKey: string,
  status: CardStatus,
): Promise<UpdateCardResult> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  if (!(await Bun.file(filePath).exists())) {
    throw new CardNotFoundError(key);
  }

  const current = await readCardFile(filePath);
  if (current.frontmatter.key !== key) {
    throw new CardNotFoundError(key);
  }

  const card: CardFile = {
    filePath,
    frontmatter: { ...current.frontmatter, status },
    body: current.body,
  };
  await writeCardFile(filePath, card);

  const now = new Date().toISOString();
  const cardRepo = new DrizzleCardRepository(ctx.db);
  const existing = cardRepo.findByKey(key);
  if (existing) {
    cardRepo.upsert({ ...existing, status, updatedAt: now });
  }

  return { filePath, card };
}
