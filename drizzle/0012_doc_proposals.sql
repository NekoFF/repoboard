CREATE TABLE `doc_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`path` text NOT NULL,
	`edits` text,
	`content` text,
	`author` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL
);
