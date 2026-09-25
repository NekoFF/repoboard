CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`due_date` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `markdown_sources` ADD `role` text DEFAULT 'board' NOT NULL;--> statement-breakpoint
ALTER TABLE `markdown_sources` ADD `snapshot` text;--> statement-breakpoint
ALTER TABLE `markdown_sources` ADD `snapshot_sha` text;--> statement-breakpoint
ALTER TABLE `markdown_sources` ADD `snapshot_at` integer;--> statement-breakpoint
ALTER TABLE `markdown_sources` ADD `pinned` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `milestone_id` text;