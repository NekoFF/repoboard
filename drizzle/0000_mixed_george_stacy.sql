CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`task_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `columns` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `markdown_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`path` text NOT NULL,
	`last_known_sha` text,
	`auto_sync` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `markdown_task_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`markdown_source_id` text NOT NULL,
	`markdown_task_id` text NOT NULL,
	`task_id` text NOT NULL,
	`heading_path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text NOT NULL,
	`visibility` text NOT NULL,
	`last_sync_at` integer
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`markdown_source_id` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_branch_links` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`branch_name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_commit_links` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`commit_sha` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_issue_links` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`issue_number` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_pull_request_links` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`pr_number` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`column_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`assignee` text,
	`due_date` integer,
	`checklist` text,
	`markdown_task_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
