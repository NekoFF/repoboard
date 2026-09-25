import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// RepoBoard's SQLite schema. GitHub stays the source of truth for git data
// (branches, commits, PRs, issues are fetched live, never mirrored here).
// This DB only stores RepoBoard's own metadata: board state, mappings,
// preferences, sync bookkeeping and activity.

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const repositories = sqliteTable("repositories", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  visibility: text("visibility", { enum: ["public", "private"] }).notNull(),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
});

export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  name: text("name").notNull(),
});

export const columns = sqliteTable("columns", {
  id: text("id").primaryKey(),
  boardId: text("board_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  boardId: text("board_id").notNull(),
  columnId: text("column_id").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  assignee: text("assignee"),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  checklist: text("checklist", { mode: "json" }).$type<
    { id: string; text: string; done: boolean }[]
  >(),
  // stable id embedded in markdown as <!-- rb:task_xxx -->, links a card
  // back to its Markdown line across syncs regardless of position/text edits
  markdownTaskId: text("markdown_task_id"),
  // Short human reference (RB-12). Written in a commit message it lets the
  // card find that commit — the one thing a board wired to git can do that a
  // generic board cannot.
  cardNumber: integer("card_number"),
  // Deleting is reversible: the row stays so the undo toast has something to
  // bring back, and the board filters these out.
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const taskLabels = sqliteTable("task_labels", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  label: text("label").notNull(),
});

export const taskBranchLinks = sqliteTable("task_branch_links", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  branchName: text("branch_name").notNull(),
});

export const taskCommitLinks = sqliteTable("task_commit_links", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  commitSha: text("commit_sha").notNull(),
});

export const taskPullRequestLinks = sqliteTable("task_pull_request_links", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  prNumber: integer("pr_number").notNull(),
});

export const taskIssueLinks = sqliteTable("task_issue_links", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  issueNumber: integer("issue_number").notNull(),
});

export const markdownSources = sqliteTable("markdown_sources", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  path: text("path").notNull(), // e.g. ROADMAP.md
  lastKnownSha: text("last_known_sha"),
  autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(false),
});

export const markdownTaskMappings = sqliteTable("markdown_task_mappings", {
  id: text("id").primaryKey(),
  markdownSourceId: text("markdown_source_id").notNull(),
  markdownTaskId: text("markdown_task_id").notNull(), // rb:task_xxx
  taskId: text("task_id").notNull(),
  headingPath: text("heading_path").notNull(), // e.g. "In Progress"
});

export const activityEvents = sqliteTable("activity_events", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  taskId: text("task_id"),
  type: text("type").notNull(), // card_created | card_moved | markdown_changed | ...
  message: text("message").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const syncState = sqliteTable("sync_state", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  markdownSourceId: text("markdown_source_id"),
  status: text("status", {
    enum: ["idle", "syncing", "conflict", "error"],
  })
    .notNull()
    .default("idle"),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
