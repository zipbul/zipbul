import { eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { RelationRepository, RelationRow } from './repository';
import { cardRelation } from './schema';

export class DrizzleRelationRepository implements RelationRepository {
  constructor(private db: EmberdeckDb) {}

  replaceForCard(cardKey: string, relations: { type: string; target: string }[]): void {
    // 1. 이 카드가 src 또는 dst인 모든 관계 삭제
    this.db.delete(cardRelation).where(eq(cardRelation.srcCardKey, cardKey)).run();
    this.db.delete(cardRelation).where(eq(cardRelation.dstCardKey, cardKey)).run();

    // 2. 새 관계 삽입 (정방향 + 역방향)
    // FK 방어: 대상 카드 미존재 시 FK 위반 → 스킵
    for (const rel of relations) {
      try {
        this.db
          .insert(cardRelation)
          .values({
            type: rel.type,
            srcCardKey: cardKey,
            dstCardKey: rel.target,
            isReverse: false,
          })
          .run();

        this.db
          .insert(cardRelation)
          .values({
            type: rel.type,
            srcCardKey: rel.target,
            dstCardKey: cardKey,
            isReverse: true,
          })
          .run();
      } catch {
        // 대상 카드 미존재 → FK violation → 해당 relation만 스킵 (정상)
      }
    }
  }

  findByCardKey(cardKey: string): RelationRow[] {
    return this.db
      .select()
      .from(cardRelation)
      .where(eq(cardRelation.srcCardKey, cardKey))
      .all() as RelationRow[];
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(cardRelation).where(eq(cardRelation.srcCardKey, cardKey)).run();
    this.db.delete(cardRelation).where(eq(cardRelation.dstCardKey, cardKey)).run();
  }
}
