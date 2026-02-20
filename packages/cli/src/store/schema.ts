import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ---------------------------------------------------------------------------
// code_entity
// ---------------------------------------------------------------------------
export const codeEntity = sqliteTable(
  'code_entity',
  {
    entityKey: text('entity_key').primaryKey(),
    filePath: text('file_path').notNull(),
    symbolName: text('symbol_name'),
    kind: text('kind').notNull(),
    signature: text('signature'),
    fingerprint: text('fingerprint'),
    contentHash: text('content_hash').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_code_entity_file_path').on(table.filePath),
    index('idx_code_entity_kind').on(table.kind),
  ],
);

// ---------------------------------------------------------------------------
// code_relation
// ---------------------------------------------------------------------------
export const codeRelation = sqliteTable(
  'code_relation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    srcEntityKey: text('src_entity_key')
      .notNull()
      .references(() => codeEntity.entityKey),
    dstEntityKey: text('dst_entity_key')
      .notNull()
      .references(() => codeEntity.entityKey),
    metaJson: text('meta_json'),
  },
  (table) => [
    index('idx_code_relation_src').on(table.srcEntityKey),
    index('idx_code_relation_dst').on(table.dstEntityKey),
    index('idx_code_relation_type').on(table.type),
  ],
);

// ---------------------------------------------------------------------------
// file_state
// ---------------------------------------------------------------------------
export const fileState = sqliteTable('file_state', {
  path: text('path').primaryKey(),
  contentHash: text('content_hash').notNull(),
  mtime: text('mtime').notNull(),
  lastIndexedAt: text('last_indexed_at').notNull(),
});

// ---------------------------------------------------------------------------
// FTS5 (virtual tables; created by SQL migrations)
// ---------------------------------------------------------------------------

export const codeFts = sqliteTable('code_fts', {
  rowid: integer('rowid'),
  entityKey: text('entity_key'),
  symbolName: text('symbol_name'),
});
