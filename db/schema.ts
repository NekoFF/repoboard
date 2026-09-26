import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { ChecklistItem } from "@/lib/checklist";

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
  // The project's cover (components/ProjectArt.tsx); null picks one from the name.
  art: text("art"),
  hue: integer("hue"),
  // Boards kept in step with GitHub on their own, through the repoboard branch.
  autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(false),
  syncedAt: integer("synced_at", { mode: "timestamp_ms" }),
});

// A project (repository) has several boards: one per person ("Dima",
// "Intern") or per area ("Design", "Core"). The first one, board_<repo>, is
// the primary board: the one the markdown file and board.json follow.
export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  /** One of the label hues, by name — see components/labelColor.ts. */
  color: text("color"),
  /** The picture on the board's tile, by name — see components/BoardArt.tsx. */
  art: text("art"),
  /** A person the board belongs to, for per-person boards. */
  owner: text("owner"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  /** Last change to the board itself (name, colour, picture, owner, archive), for board.json merges. */
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
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
  // A tree of ChecklistItem (lib/checklist.ts); older rows hold flat items.
  checklist: text("checklist", { mode: "json" }).$type<ChecklistItem[]>(),
  // stable id embedded in markdown as <!-- rb:task_xxx -->, links a card
  // back to its Markdown line across syncs regardless of position/text edits
  markdownTaskId: text("markdown_task_id"),
  // Short human reference (RB-12). Written in a commit message it lets the
  // card find that commit — the one thing a board wired to git can do that a
  // generic board cannot.
  cardNumber: integer("card_number"),
  // 0 none · 1 urgent · 2 high · 3 medium · 4 low — Linear's order, so sorting
  // ascending (with 0 last) reads most-urgent first.
  priority: integer("priority").notNull().default(0),
  milestoneId: text("milestone_id"),
  // Deleting is reversible: the row stays so the undo toast has something to
  // bring back, and the board filters these out.
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// A goal with a date: "Public beta", "CRA compliance". Cards point at one, and
// its progress is simply how many of those cards are done.
export const milestones = sqliteTable("milestones", {
  id: text("id").primaryKey(),
  boardId: text("board_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
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
  // "board": headings drive the board's columns (at most one per repository).
  // "checklist": a tracked document — its checkboxes are counted, shown and
  // ticked, but they do not become cards.
  role: text("role", { enum: ["board", "checklist"] }).notNull().default("board"),
  // The last parsed copy, so progress shows instantly and offline. GitHub stays
  // the source of truth: this is refreshed whenever the file is read.
  snapshot: text("snapshot", { mode: "json" }).$type<DocSnapshot>(),
  snapshotSha: text("snapshot_sha"),
  snapshotAt: integer("snapshot_at", { mode: "timestamp_ms" }),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(true),
});

export interface DocSnapshot {
  version?: number;
  title: string;
  /** Other documents this one links to with [[…]], as repository paths. */
  links?: string[];
  total: number;
  done: number;
  doing?: number;
  review?: number;
  cancelled?: number;
  sections: { heading: string; depth: number; total: number; done: number; doing?: number; review?: number }[];
  /** Compact per-item state for the overview's item map and "due soon". */
  items: {
    title: string;
    text?: string;
    state?: "todo" | "doing" | "review" | "done" | "cancelled";
    done: boolean;
    section: number;
    line: number;
    priority?: number;
    due?: string | null;
    owners?: string[];
    cards?: number[];
  }[];
}

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
  // Who did it: a GitHub login for people using the app, an agent's name
  // ("Claude Code", "Codex") for changes made through the MCP server.
  actor: text("actor"),
  actorKind: text("actor_kind", { enum: ["person", "agent"] }),
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
