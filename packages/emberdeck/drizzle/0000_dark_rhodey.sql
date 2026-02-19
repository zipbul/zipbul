CREATE TABLE `card` (
	`rowid` integer,
	`key` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`constraints_json` text,
	`body` text,
	`file_path` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_card_status` ON `card` (`status`);--> statement-breakpoint
CREATE INDEX `idx_card_file_path` ON `card` (`file_path`);--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `card_fts` USING fts5(
	`key`,
	`summary`,
	`body`,
	content=`card`,
	content_rowid=`rowid`
);
--> statement-breakpoint
CREATE TABLE `card_keyword` (
	`card_key` text NOT NULL,
	`keyword_id` integer NOT NULL,
	PRIMARY KEY(`card_key`, `keyword_id`),
	FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`keyword_id`) REFERENCES `keyword`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_card_keyword_card` ON `card_keyword` (`card_key`);--> statement-breakpoint
CREATE INDEX `idx_card_keyword_keyword` ON `card_keyword` (`keyword_id`);--> statement-breakpoint
CREATE TABLE `card_relation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`src_card_key` text NOT NULL,
	`dst_card_key` text NOT NULL,
	`is_reverse` integer DEFAULT false NOT NULL,
	`meta_json` text,
	FOREIGN KEY (`src_card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`dst_card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_card_relation_src` ON `card_relation` (`src_card_key`);--> statement-breakpoint
CREATE INDEX `idx_card_relation_dst` ON `card_relation` (`dst_card_key`);--> statement-breakpoint
CREATE INDEX `idx_card_relation_type` ON `card_relation` (`type`);--> statement-breakpoint
CREATE TABLE `card_tag` (
	`card_key` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`card_key`, `tag_id`),
	FOREIGN KEY (`card_key`) REFERENCES `card`(`key`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_card_tag_card` ON `card_tag` (`card_key`);--> statement-breakpoint
CREATE INDEX `idx_card_tag_tag` ON `card_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `keyword` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_name_unique` ON `keyword` (`name`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);