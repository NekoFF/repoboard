ALTER TABLE `boards` ADD `description` text;--> statement-breakpoint
ALTER TABLE `boards` ADD `color` text;--> statement-breakpoint
ALTER TABLE `boards` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `boards` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `created_at` integer;--> statement-breakpoint
ALTER TABLE `boards` ADD `archived_at` integer;