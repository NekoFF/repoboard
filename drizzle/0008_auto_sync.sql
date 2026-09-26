ALTER TABLE `repositories` ADD `auto_sync` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `synced_at` integer;
