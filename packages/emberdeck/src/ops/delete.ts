import type { EmberdeckContext } from '../config';
import { parseFullKey, buildCardPath } from '../card/card-key';
import { CardNotFoundError } from '../card/errors';
import { deleteCardFile } from '../fs/writer';
import { DrizzleCardRepository } from '../db/card-repo';

export async function deleteCard(
  ctx: EmberdeckContext,
  fullKey: string,
): Promise<{ filePath: string }> {
  const key = parseFullKey(fullKey);
  const filePath = buildCardPath(ctx.cardsDir, key);

  const exists = await Bun.file(filePath).exists();
  if (!exists) {
    throw new CardNotFoundError(key);
  }

  await deleteCardFile(filePath);

  // FK cascade로 relation, keyword, tag 매핑 자동 삭제
  const cardRepo = new DrizzleCardRepository(ctx.db);
  cardRepo.deleteByKey(key);

  return { filePath };
}
