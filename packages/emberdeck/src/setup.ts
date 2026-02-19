import { createEmberdeckDb, closeDb } from './db/connection';
import { DrizzleCardRepository } from './db/card-repo';
import { DrizzleRelationRepository } from './db/relation-repo';
import { DrizzleClassificationRepository } from './db/classification-repo';
import { DEFAULT_RELATION_TYPES, type EmberdeckContext, type EmberdeckOptions } from './config';

export function setupEmberdeck(options: EmberdeckOptions): EmberdeckContext {
  const db = createEmberdeckDb(options.dbPath);
  return {
    cardsDir: options.cardsDir,
    db,
    cardRepo: new DrizzleCardRepository(db),
    relationRepo: new DrizzleRelationRepository(db),
    classificationRepo: new DrizzleClassificationRepository(db),
    allowedRelationTypes: options.allowedRelationTypes ?? [...DEFAULT_RELATION_TYPES],
  };
}

export function teardownEmberdeck(ctx: EmberdeckContext): void {
  closeDb(ctx.db);
}
