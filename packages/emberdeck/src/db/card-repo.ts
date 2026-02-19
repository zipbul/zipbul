import { eq } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { CardRepository, CardRow, CardListFilter } from './repository';
import { card } from './schema';

export class DrizzleCardRepository implements CardRepository {
  constructor(private db: EmberdeckDb) {}

  findByKey(key: string): CardRow | null {
    const row = this.db.select().from(card).where(eq(card.key, key)).get();
    return (row as CardRow | undefined) ?? null;
  }

  findByFilePath(filePath: string): CardRow | null {
    const row = this.db.select().from(card).where(eq(card.filePath, filePath)).get();
    return (row as CardRow | undefined) ?? null;
  }

  upsert(row: CardRow): void {
    this.db
      .insert(card)
      .values(row)
      .onConflictDoUpdate({
        target: card.key,
        set: {
          summary: row.summary,
          status: row.status,
          constraintsJson: row.constraintsJson,
          body: row.body,
          filePath: row.filePath,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }

  deleteByKey(key: string): void {
    this.db.delete(card).where(eq(card.key, key)).run();
  }

  existsByKey(key: string): boolean {
    const row = this.db.select({ key: card.key }).from(card).where(eq(card.key, key)).get();
    return row !== undefined;
  }

  list(filter?: CardListFilter): CardRow[] {
    if (filter?.status) {
      return this.db.select().from(card).where(eq(card.status, filter.status)).all() as CardRow[];
    }
    return this.db.select().from(card).all() as CardRow[];
  }

  search(_query: string): CardRow[] {
    // FTS5 MATCH. cardFts 가상 테이블은 수동 마이그레이션 후 사용 가능.
    // 초기 구현: FTS 미설정 시 빈 배열 반환.
    return [];
  }
}
