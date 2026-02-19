import type { EmberdeckContext } from '../config';
import type { CardRow } from '../db/repository';
import { parseFullKey } from '../card/card-key';
import { readCardFile } from '../fs/reader';
import { DrizzleCardRepository } from '../db/card-repo';
import { DrizzleRelationRepository } from '../db/relation-repo';
import { DrizzleClassificationRepository } from '../db/classification-repo';
import type { EmberdeckDb } from '../db/connection';

/**
 * 외부 변경된 카드 파일 → DB 동기화.
 * watcher 이벤트(생성/변경) 수신 시 CLI가 호출.
 */
export async function syncCardFromFile(ctx: EmberdeckContext, filePath: string): Promise<void> {
  const cardFile = await readCardFile(filePath);
  const key = parseFullKey(cardFile.frontmatter.key);
  const now = new Date().toISOString();

  const row: CardRow = {
    key,
    summary: cardFile.frontmatter.summary,
    status: cardFile.frontmatter.status,
    constraintsJson: cardFile.frontmatter.constraints
      ? JSON.stringify(cardFile.frontmatter.constraints)
      : null,
    body: cardFile.body,
    filePath,
    updatedAt: now,
  };

  ctx.db.transaction((tx) => {
    const cardRepo = new DrizzleCardRepository(tx as EmberdeckDb);
    const relationRepo = new DrizzleRelationRepository(tx as EmberdeckDb);
    const classRepo = new DrizzleClassificationRepository(tx as EmberdeckDb);

    cardRepo.upsert(row);
    relationRepo.replaceForCard(key, cardFile.frontmatter.relations ?? []);
    classRepo.replaceKeywords(key, cardFile.frontmatter.keywords ?? []);
    classRepo.replaceTags(key, cardFile.frontmatter.tags ?? []);
  });
}

/**
 * 외부 삭제된 카드 파일 → DB에서 제거.
 * watcher 이벤트(삭제) 수신 시 CLI가 호출.
 */
export function removeCardByFile(ctx: EmberdeckContext, filePath: string): void {
  const existing = ctx.cardRepo.findByFilePath(filePath);
  if (existing) {
    ctx.cardRepo.deleteByKey(existing.key);
  }
}
