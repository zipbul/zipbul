import type { EmberdeckContext } from '../config';
import type { CardFile, CardStatus } from '../card/types';
import type { CardRow, RelationRow } from '../db/repository';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { readCardFile } from '../fs/reader';

export async function getCard(ctx: EmberdeckContext, fullKey: string): Promise<CardFile> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);
  if (!(await Bun.file(filePath).exists())) throw new CardNotFoundError(key);
  return readCardFile(filePath);
}

export function listCards(ctx: EmberdeckContext, filter?: { status?: CardStatus }): CardRow[] {
  return ctx.cardRepo.list(filter);
}

export function searchCards(ctx: EmberdeckContext, query: string): CardRow[] {
  return ctx.cardRepo.search(query);
}

export function listCardRelations(ctx: EmberdeckContext, fullKey: string): RelationRow[] {
  const key = parseFullKey(fullKey);
  return ctx.relationRepo.findByCardKey(key);
}
