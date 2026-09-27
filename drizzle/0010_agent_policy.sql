ALTER TABLE `repositories` ADD `agent_policy` text DEFAULT 'reason' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `done_by` text;
