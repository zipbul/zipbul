import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

export const card = sqliteTable(
  'card',
  {
    rowid: integer('rowid'),
    key: text('key').primaryKey(),
    summary: text('summary').notNull(),
    status: text('status').notNull(),
    constraintsJson: text('constraints_json'),
    body: text('body'),
    filePath: text('file_path').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_card_status').on(table.status),
    index('idx_card_file_path').on(table.filePath),
  ],
);

export const keyword = sqliteTable('keyword', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const tag = sqliteTable('tag', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const cardKeyword = sqliteTable(
  'card_keyword',
  {
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keyword.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardKey, table.keywordId] }),
    index('idx_card_keyword_card').on(table.cardKey),
    index('idx_card_keyword_keyword').on(table.keywordId),
  ],
);

export const cardTag = sqliteTable(
  'card_tag',
  {
    cardKey: text('card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardKey, table.tagId] }),
    index('idx_card_tag_card').on(table.cardKey),
    index('idx_card_tag_tag').on(table.tagId),
  ],
);

export const cardRelation = sqliteTable(
  'card_relation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    srcCardKey: text('src_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dstCardKey: text('dst_card_key')
      .notNull()
      .references(() => card.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    isReverse: integer('is_reverse', { mode: 'boolean' }).notNull().default(false),
    metaJson: text('meta_json'),
  },
  (table) => [
    index('idx_card_relation_src').on(table.srcCardKey),
    index('idx_card_relation_dst').on(table.dstCardKey),
    index('idx_card_relation_type').on(table.type),
  ],
);

/** FTS5 가상 테이블 매핑. 실제 생성은 수동 마이그레이션 SQL. */
export const cardFts = sqliteTable('card_fts', {
  rowid: integer('rowid'),
  key: text('key'),
  summary: text('summary'),
  body: text('body'),
});
