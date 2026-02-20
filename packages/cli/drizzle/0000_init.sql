CREATE TABLE `metadata` (
        `key` text PRIMARY KEY NOT NULL,
        `value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `code_entity` (
        `entity_key` text PRIMARY KEY NOT NULL,
        `file_path` text NOT NULL,
        `symbol_name` text,
        `kind` text NOT NULL,
        `signature` text,
        `fingerprint` text,
        `content_hash` text NOT NULL,
        `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_code_entity_file_path` ON `code_entity` (`file_path`);
--> statement-breakpoint
CREATE INDEX `idx_code_entity_kind` ON `code_entity` (`kind`);
--> statement-breakpoint
CREATE TABLE `code_relation` (
        `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        `type` text NOT NULL,
        `src_entity_key` text NOT NULL,
        `dst_entity_key` text NOT NULL,
        `meta_json` text,
        FOREIGN KEY (`src_entity_key`) REFERENCES `code_entity`(`entity_key`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (`dst_entity_key`) REFERENCES `code_entity`(`entity_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_code_relation_src` ON `code_relation` (`src_entity_key`);
--> statement-breakpoint
CREATE INDEX `idx_code_relation_dst` ON `code_relation` (`dst_entity_key`);
--> statement-breakpoint
CREATE INDEX `idx_code_relation_type` ON `code_relation` (`type`);
--> statement-breakpoint
CREATE TABLE `file_state` (
        `path` text PRIMARY KEY NOT NULL,
        `content_hash` text NOT NULL,
        `mtime` text NOT NULL,
        `last_indexed_at` text NOT NULL
);
--> statement-breakpoint
-- FTS5 external content virtual table + triggers
DROP TABLE IF EXISTS code_fts;
--> statement-breakpoint
CREATE TABLE `code_fts` (
        `rowid` integer,
        `entity_key` text,
        `symbol_name` text
);
--> statement-breakpoint
DROP TABLE IF EXISTS code_fts;
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
        entity_key,
        symbol_name,
        content='code_entity',
        content_rowid='rowid',
        tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS code_fts_ai AFTER INSERT ON code_entity BEGIN
        INSERT INTO code_fts(rowid, entity_key, symbol_name)
                VALUES (new.rowid, new.entity_key, new.symbol_name);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS code_fts_au AFTER UPDATE ON code_entity BEGIN
        INSERT INTO code_fts(code_fts, rowid, entity_key, symbol_name)
                VALUES('delete', old.rowid, old.entity_key, old.symbol_name);
        INSERT INTO code_fts(rowid, entity_key, symbol_name)
                VALUES (new.rowid, new.entity_key, new.symbol_name);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS code_fts_ad AFTER DELETE ON code_entity BEGIN
        INSERT INTO code_fts(code_fts, rowid, entity_key, symbol_name)
                VALUES('delete', old.rowid, old.entity_key, old.symbol_name);
END;
