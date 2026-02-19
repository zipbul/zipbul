import { eq, inArray } from 'drizzle-orm';

import type { EmberdeckDb } from './connection';
import type { ClassificationRepository } from './repository';
import { keyword, tag, cardKeyword, cardTag } from './schema';

export class DrizzleClassificationRepository implements ClassificationRepository {
  constructor(private db: EmberdeckDb) {}

  replaceKeywords(cardKey: string, names: string[]): void {
    this.db.delete(cardKeyword).where(eq(cardKeyword.cardKey, cardKey)).run();
    if (names.length === 0) return;

    for (const name of names) {
      this.db.insert(keyword).values({ name }).onConflictDoNothing().run();
    }

    const rows = this.db
      .select({ id: keyword.id, name: keyword.name })
      .from(keyword)
      .where(inArray(keyword.name, names))
      .all();

    for (const row of rows) {
      this.db.insert(cardKeyword).values({ cardKey, keywordId: row.id }).run();
    }
  }

  replaceTags(cardKey: string, names: string[]): void {
    this.db.delete(cardTag).where(eq(cardTag.cardKey, cardKey)).run();
    if (names.length === 0) return;

    for (const name of names) {
      this.db.insert(tag).values({ name }).onConflictDoNothing().run();
    }

    const rows = this.db
      .select({ id: tag.id, name: tag.name })
      .from(tag)
      .where(inArray(tag.name, names))
      .all();

    for (const row of rows) {
      this.db.insert(cardTag).values({ cardKey, tagId: row.id }).run();
    }
  }

  findKeywordsByCard(cardKey: string): string[] {
    const rows = this.db
      .select({ name: keyword.name })
      .from(cardKeyword)
      .innerJoin(keyword, eq(cardKeyword.keywordId, keyword.id))
      .where(eq(cardKeyword.cardKey, cardKey))
      .all();
    return rows.map((r) => r.name);
  }

  findTagsByCard(cardKey: string): string[] {
    const rows = this.db
      .select({ name: tag.name })
      .from(cardTag)
      .innerJoin(tag, eq(cardTag.tagId, tag.id))
      .where(eq(cardTag.cardKey, cardKey))
      .all();
    return rows.map((r) => r.name);
  }

  deleteByCardKey(cardKey: string): void {
    this.db.delete(cardKeyword).where(eq(cardKeyword.cardKey, cardKey)).run();
    this.db.delete(cardTag).where(eq(cardTag.cardKey, cardKey)).run();
  }
}
