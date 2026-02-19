import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmberdeckContext } from '../config';
import type { CardRelation, CardFile } from '../card/types';
import type { CardRow } from '../db/repository';
import { normalizeSlug, buildCardPath } from '../card/card-key';
import { CardAlreadyExistsError, RelationTypeError } from '../card/errors';
import { writeCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import type { EmberdeckDb } from '../db/connection';

export interface CreateCardInput {
  slug: string;
  summary: string;
  body?: string;
  keywords?: string[];
  tags?: string[];
  relations?: CardRelation[];
}

export interface CreateCardResult {
  filePath: string;
  fullKey: string;
  card: CardFile;
}

export async function createCard(
  ctx: EmberdeckContext,
  input: CreateCardInput,
): Promise<CreateCardResult> {
  const slug = normalizeSlug(input.slug);
  const fullKey = slug;
  const filePath = buildCardPath(ctx.cardsDir, slug);

  if (input.relations) {
    for (const rel of input.relations) {
      if (!ctx.allowedRelationTypes.includes(rel.type)) {
        throw new RelationTypeError(rel.type, ctx.allowedRelationTypes);
      }
    }
  }

  const exists = await Bun.file(filePath).exists();
  if (exists) {
    throw new CardAlreadyExistsError(fullKey);
  }

  const frontmatter = {
    key: fullKey,
    summary: input.summary,
    status: 'draft' as const,
    ...(input.keywords && input.keywords.length > 0 ? { keywords: input.keywords } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.relations && input.relations.length > 0 ? { relations: input.relations } : {}),
  };

  const body = input.body ?? '';
  const card: CardFile = { filePath, frontmatter, body };

  await mkdir(dirname(filePath), { recursive: true });
  await writeCardFile(filePath, card);

  const now = new Date().toISOString();
  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as EmberdeckDb);

    const row: CardRow = {
      key: fullKey,
      summary: input.summary,
      status: 'draft',
      constraintsJson: null,
      body,
      filePath,
      updatedAt: now,
    };

    cardRepo.upsert(row);
    if (input.relations && input.relations.length > 0) {
      relationRepo.replaceForCard(fullKey, input.relations);
    }
    if (input.keywords && input.keywords.length > 0) {
      classRepo.replaceKeywords(fullKey, input.keywords);
    }
    if (input.tags && input.tags.length > 0) {
      classRepo.replaceTags(fullKey, input.tags);
    }
  });

  return { filePath, fullKey, card };
}
