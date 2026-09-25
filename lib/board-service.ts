import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  activityEvents,
  boards,
  columns,
  markdownSources,
  markdownTaskMappings,
  repositories,
  syncState,
  taskBranchLinks,
  taskCommitLinks,
  taskIssueLinks,
  taskLabels,
  taskPullRequestLinks,
  tasks,
  workspaces,
} from "@/db/schema";
import { GitHubClient, type RepoSummary } from "@/lib/github/client";
import { getConfiguredRepo } from "@/lib/github/auth-provider";
import {
  DEFAULT_COLUMN_HEADINGS,
  ensureTaskIds,
  moveTask as moveTaskInMarkdown,
  parseMarkdown,
} from "@/lib/markdown/parser";
import {
  BOARD_STATE_PATH,
  describeChanges,
  mergeBoardState,
  parseBoardState,
  serialiseBoardState,
  type BoardState,
  type BoardStateCard,
} from "@/lib/board-state";
import {
  buildDiff,
  checkWriteSafety,
  commitMessageForMove,
  type DiffLine,
} from "@/lib/markdown/sync";

const WORKSPACE_ID = "ws_local";

function configuredRepositoryId(): string | null {
  const repo = getConfiguredRepo();
  return repo ? `repo_${repo.owner}_${repo.name}`.toLowerCase() : null;
}

function activeRepository() {
  const id = configuredRepositoryId();
  return id
    ? db.select().from(repositories).where(eq(repositories.id, id)).get()
    : null;
}

/**
 * Minimal surface the sync pipeline needs from GitHub. Injecting it keeps the
 * conflict/write path testable without network access or a live repository.
 */
export interface MarkdownGitHub {
  getFile(path: string): Promise<{ path: string; content: string; sha: string }>;
  putFile(args: {
    path: string;
    content: string;
    expectedSha?: string;
    message: string;
  }): Promise<{ commitSha: string; contentSha: string }>;
}

type ClientFactory = () => Promise<MarkdownGitHub>;

const defaultClientFactory: ClientFactory = () => GitHubClient.create();

export interface BoardTask {
  id: string;
  /** Short reference like 12, shown as RB-12 and usable in commit messages. */
  number: number | null;
  columnId: string;
  title: string;
  description: string | null;
  assignee: string | null;
  dueDate: number | null;
  position: number;
  checklist: { id: string; text: string; done: boolean }[];
  markdownTaskId: string | null;
  labels: string[];
  branches: string[];
  commits: string[];
  pullRequests: number[];
  issues: number[];
}

export interface BoardData {
  repository: {
    id: string;
    owner: string;
    name: string;
    defaultBranch: string;
    visibility: string;
    lastSyncAt: number | null;
  } | null;
  boardId: string | null;
  columns: { id: string; name: string; position: number }[];
  tasks: BoardTask[];
  markdownSource: {
    id: string;
    path: string;
    lastKnownSha: string | null;
    autoSync: boolean;
  } | null;
}

function now() {
  return new Date();
}

export function logActivity(args: {
  repositoryId: string;
  taskId?: string | null;
  type: string;
  message: string;
}) {
  db.insert(activityEvents)
    .values({
      id: randomUUID(),
      repositoryId: args.repositoryId,
      taskId: args.taskId ?? null,
      type: args.type,
      message: args.message,
      createdAt: now(),
    })
    .run();
}

/** Creates the local workspace/board/columns the first time a repo is connected. */
export function ensureBootstrap(repo: {
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: "public" | "private";
}): { repositoryId: string; boardId: string } {
  const existingWorkspace = db.select().from(workspaces).all();
  if (existingWorkspace.length === 0) {
    db.insert(workspaces)
      .values({ id: WORKSPACE_ID, name: "Local", createdAt: now() })
      .run();
  }

  const repositoryId = `repo_${repo.owner}_${repo.name}`.toLowerCase();
  const existingRepo = db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();

  if (!existingRepo) {
    db.insert(repositories)
      .values({
        id: repositoryId,
        workspaceId: WORKSPACE_ID,
        owner: repo.owner,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
        visibility: repo.visibility,
        lastSyncAt: null,
      })
      .run();
  } else {
    db.update(repositories)
      .set({ defaultBranch: repo.defaultBranch, visibility: repo.visibility })
      .where(eq(repositories.id, repositoryId))
      .run();
  }

  const boardId = `board_${repositoryId}`;
  const existingBoard = db
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
    .get();

  if (!existingBoard) {
    db.insert(boards)
      .values({ id: boardId, repositoryId, name: "Project board" })
      .run();
    DEFAULT_COLUMN_HEADINGS.forEach((name, index) => {
      db.insert(columns)
        .values({
          id: `col_${boardId}_${index}`,
          boardId,
          name,
          position: index,
        })
        .run();
    });
    logActivity({
      repositoryId,
      type: "board_created",
      message: `Board created for ${repo.owner}/${repo.name}`,
    });
  }

  return { repositoryId, boardId };
}

export function getBoardData(): BoardData {
  const repository = activeRepository();
  if (!repository) {
    return {
      repository: null,
      boardId: null,
      columns: [],
      tasks: [],
      markdownSource: null,
    };
  }

  const board = db
    .select()
    .from(boards)
    .where(eq(boards.repositoryId, repository.id))
    .get();

  if (!board) {
    return {
      repository: {
        id: repository.id,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        visibility: repository.visibility,
        lastSyncAt: repository.lastSyncAt?.getTime() ?? null,
      },
      boardId: null,
      columns: [],
      tasks: [],
      markdownSource: null,
    };
  }

  const cols = db
    .select()
    .from(columns)
    .where(eq(columns.boardId, board.id))
    .orderBy(asc(columns.position))
    .all();

  const rows = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.boardId, board.id), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.position))
    .all();

  const labels = db.select().from(taskLabels).all();
  const branches = db.select().from(taskBranchLinks).all();
  const commits = db.select().from(taskCommitLinks).all();
  const prs = db.select().from(taskPullRequestLinks).all();
  const issues = db.select().from(taskIssueLinks).all();

  const source = db
    .select()
    .from(markdownSources)
    .where(eq(markdownSources.repositoryId, repository.id))
    .get();

  return {
    repository: {
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      visibility: repository.visibility,
      lastSyncAt: repository.lastSyncAt?.getTime() ?? null,
    },
    boardId: board.id,
    columns: cols.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
    })),
    tasks: rows.map((t) => ({
      id: t.id,
      number: t.cardNumber,
      columnId: t.columnId,
      title: t.title,
      description: t.description,
      assignee: t.assignee,
      dueDate: t.dueDate?.getTime() ?? null,
      position: t.position,
      checklist: t.checklist ?? [],
      markdownTaskId: t.markdownTaskId,
      labels: labels.filter((l) => l.taskId === t.id).map((l) => l.label),
      branches: branches
        .filter((b) => b.taskId === t.id)
        .map((b) => b.branchName),
      commits: commits.filter((c) => c.taskId === t.id).map((c) => c.commitSha),
      pullRequests: prs.filter((p) => p.taskId === t.id).map((p) => p.prNumber),
      issues: issues.filter((i) => i.taskId === t.id).map((i) => i.issueNumber),
    })),
    markdownSource: source
      ? {
          id: source.id,
          path: source.path,
          lastKnownSha: source.lastKnownSha,
          autoSync: source.autoSync,
        }
      : null,
  };
}

/** Used by route handlers for actions on cards that are not in the visible list (undo). */
export function taskBelongsToBoard(taskId: string, boardId: string): boolean {
  return Boolean(
    db.select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.boardId, boardId)))
      .get(),
  );
}

/** Next free number on this board; numbers are never reused. */
function nextCardNumber(boardId: string): number {
  const row = db
    .select({ max: sql<number>`coalesce(max(${tasks.cardNumber}), 0)` })
    .from(tasks)
    .where(eq(tasks.boardId, boardId))
    .get();
  return (row?.max ?? 0) + 1;
}

export function createTask(args: {
  boardId: string;
  columnId: string;
  title: string;
  description?: string | null;
  assignee?: string | null;
  labels?: string[];
  repositoryId: string;
}): string {
  const id = randomUUID();
  const siblings = db
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, args.columnId))
    .all();

  db.insert(tasks)
    .values({
      id,
      boardId: args.boardId,
      columnId: args.columnId,
      position: siblings.length,
      title: args.title,
      description: args.description ?? null,
      assignee: args.assignee ?? null,
      dueDate: null,
      checklist: [],
      markdownTaskId: null,
      cardNumber: nextCardNumber(args.boardId),
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  for (const label of args.labels ?? []) {
    db.insert(taskLabels)
      .values({ id: randomUUID(), taskId: id, label })
      .run();
  }

  logActivity({
    repositoryId: args.repositoryId,
    taskId: id,
    type: "card_created",
    message: `Card created: ${args.title}`,
  });

  return id;
}

export function updateTask(
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    assignee?: string | null;
    dueDate?: number | null;
    checklist?: { id: string; text: string; done: boolean }[];
    labels?: string[];
  },
): void {
  const values: Record<string, unknown> = { updatedAt: now() };
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.assignee !== undefined) values.assignee = patch.assignee;
  if (patch.dueDate !== undefined) {
    values.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  }
  if (patch.checklist !== undefined) values.checklist = patch.checklist;

  db.update(tasks).set(values).where(eq(tasks.id, taskId)).run();

  if (patch.labels) {
    db.delete(taskLabels).where(eq(taskLabels.taskId, taskId)).run();
    for (const label of patch.labels) {
      db.insert(taskLabels)
        .values({ id: randomUUID(), taskId, label })
        .run();
    }
  }
}

/** Reversible by design — see restoreTask. Links and labels are kept. */
export function deleteTask(taskId: string): void {
  db.update(tasks)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(eq(tasks.id, taskId))
    .run();
}

export function restoreTask(taskId: string): void {
  db.update(tasks)
    .set({ deletedAt: null, updatedAt: now() })
    .where(eq(tasks.id, taskId))
    .run();
}

export function moveTaskLocally(
  taskId: string,
  targetColumnId: string,
  position: number,
): { fromColumn: string; toColumn: string } | null {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return null;

  const fromColumn = db
    .select()
    .from(columns)
    .where(eq(columns.id, task.columnId))
    .get();
  const toColumn = db
    .select()
    .from(columns)
    .where(eq(columns.id, targetColumnId))
    .get();

  db.update(tasks)
    .set({ columnId: targetColumnId, position, updatedAt: now() })
    .where(eq(tasks.id, taskId))
    .run();

  // Re-pack positions in the destination column so ordering stays stable.
  const siblings = db
    .select()
    .from(tasks)
    .where(eq(tasks.columnId, targetColumnId))
    .orderBy(asc(tasks.position))
    .all();
  siblings.forEach((sibling, index) => {
    db.update(tasks)
      .set({ position: index })
      .where(eq(tasks.id, sibling.id))
      .run();
  });

  return {
    fromColumn: fromColumn?.name ?? "",
    toColumn: toColumn?.name ?? "",
  };
}

/** Reorders a column after a drag, keeping positions dense and stable. */
export function reorderColumn(columnId: string, orderedIds: string[]): void {
  orderedIds.forEach((taskId, index) => {
    db.update(tasks)
      .set({ columnId, position: index, updatedAt: now() })
      .where(eq(tasks.id, taskId))
      .run();
  });
}

/**
 * Turns GitHub issues into cards. Read-only against GitHub: the issue stays
 * the source of truth and the card just links to it, so importing twice does
 * not duplicate anything.
 */
export function importIssues(args: {
  boardId: string;
  columnId: string;
  repositoryId: string;
  issues: { number: number; title: string; labels: string[] }[];
}): { created: number; skipped: number } {
  const linked = new Set(
    db
      .select({ issueNumber: taskIssueLinks.issueNumber })
      .from(taskIssueLinks)
      .innerJoin(tasks, eq(taskIssueLinks.taskId, tasks.id))
      .where(eq(tasks.boardId, args.boardId))
      .all()
      .map((link) => link.issueNumber),
  );

  let created = 0;
  let skipped = 0;

  for (const issue of args.issues) {
    if (linked.has(issue.number)) {
      skipped += 1;
      continue;
    }
    const taskId = createTask({
      boardId: args.boardId,
      columnId: args.columnId,
      title: issue.title,
      labels: issue.labels,
      repositoryId: args.repositoryId,
    });
    db.insert(taskIssueLinks)
      .values({ id: randomUUID(), taskId, issueNumber: issue.number })
      .run();
    created += 1;
  }

  if (created) {
    logActivity({
      repositoryId: args.repositoryId,
      type: "issue_linked",
      message: `Imported ${created} GitHub issue(s) as cards`,
    });
  }

  return { created, skipped };
}

export function setMarkdownSource(repositoryId: string, path: string): string {
  const existing = db
    .select()
    .from(markdownSources)
    .where(eq(markdownSources.repositoryId, repositoryId))
    .get();

  if (existing) {
    db.update(markdownSources)
      .set({ path, lastKnownSha: null })
      .where(eq(markdownSources.id, existing.id))
      .run();
    return existing.id;
  }

  const id = randomUUID();
  db.insert(markdownSources)
    .values({ id, repositoryId, path, lastKnownSha: null, autoSync: false })
    .run();
  return id;
}

export interface SyncResult {
  path: string;
  sha: string;
  created: number;
  updated: number;
  idsAssigned: number;
  committedIds: boolean;
}

/**
 * GitHub → board. Fetches the markdown source, backfills missing task ids
 * (committing them back so they are stable from now on) and reconciles cards.
 */
export async function syncFromMarkdown(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<SyncResult> {
  const data = getBoardData();
  if (!data.repository || !data.boardId || !data.markdownSource) {
    throw new Error("Connect a repository and pick a markdown file first");
  }

  const gh = await clientFactory();
  const file = await gh.getFile(data.markdownSource.path);

  let content = file.content;
  let sha = file.sha;
  let committedIds = false;

  const withIds = ensureTaskIds(content);
  if (withIds.changed) {
    const written = await gh.putFile({
      path: data.markdownSource.path,
      content: withIds.content,
      expectedSha: sha,
      message: `RepoBoard: add stable task ids to ${data.markdownSource.path}`,
    });
    content = withIds.content;
    sha = written.contentSha;
    committedIds = true;
    logActivity({
      repositoryId: data.repository.id,
      type: "markdown_changed",
      message: `Assigned ${withIds.assigned.length} task id(s) in ${data.markdownSource.path}`,
    });
  }

  const parsed = parseMarkdown(content);
  const columnByName = new Map(data.columns.map((c) => [c.name, c.id]));
  const existingByMarkdownId = new Map(
    data.tasks
      .filter((t) => t.markdownTaskId)
      .map((t) => [t.markdownTaskId!, t]),
  );

  let created = 0;
  let updated = 0;

  parsed.tasks.forEach((mdTask, index) => {
    if (!mdTask.id) return;
    const columnId = columnByName.get(mdTask.heading);
    if (!columnId) return;

    const existing = existingByMarkdownId.get(mdTask.id);
    if (existing) {
      if (existing.title !== mdTask.title || existing.columnId !== columnId) {
        db.update(tasks)
          .set({ title: mdTask.title, columnId, updatedAt: now() })
          .where(eq(tasks.id, existing.id))
          .run();
        updated += 1;
      }
    } else {
      const id = randomUUID();
      db.insert(tasks)
        .values({
          id,
          boardId: data.boardId!,
          columnId,
          position: index,
          title: mdTask.title,
          description: null,
          assignee: null,
          dueDate: null,
          checklist: [],
          markdownTaskId: mdTask.id,
          cardNumber: nextCardNumber(data.boardId!),
          createdAt: now(),
          updatedAt: now(),
        })
        .run();
      db.insert(markdownTaskMappings)
        .values({
          id: randomUUID(),
          markdownSourceId: data.markdownSource!.id,
          markdownTaskId: mdTask.id,
          taskId: id,
          headingPath: mdTask.heading,
        })
        .run();
      created += 1;
    }
  });

  db.update(markdownSources)
    .set({ lastKnownSha: sha })
    .where(eq(markdownSources.id, data.markdownSource.id))
    .run();

  db.update(repositories)
    .set({ lastSyncAt: now() })
    .where(eq(repositories.id, data.repository.id))
    .run();

  logActivity({
    repositoryId: data.repository.id,
    type: "github_synced",
    message: `Synced ${data.markdownSource.path} (${created} new, ${updated} updated)`,
  });

  return {
    path: data.markdownSource.path,
    sha,
    created,
    updated,
    idsAssigned: withIds.assigned.length,
    committedIds,
  };
}

export interface PendingChange {
  taskId: string;
  markdownTaskId: string;
  targetHeading: string;
  summary: string;
  /** False when the move is a no-op, so the UI can disable the commit button. */
  changedSomething: boolean;
  diff: DiffLine[];
  before: string;
  after: string;
  baseSha: string;
  conflict: null | {
    expectedSha: string | null;
    currentSha: string;
    remoteContent: string;
  };
}

export interface PendingMove {
  taskId: string;
  markdownTaskId: string;
  title: string;
  from: string;
  to: string;
}

/**
 * Everything the board says that the markdown file does not say yet.
 *
 * Moves accumulate instead of committing one at a time: dragging five cards
 * should be one commit a human reviewed once, not five interruptions and five
 * lines of history.
 */
export async function pendingMarkdownMoves(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ moves: PendingMove[]; baseSha: string; conflict: boolean } | null> {
  const data = getBoardData();
  if (!data.repository || !data.markdownSource) return null;

  const linked = data.tasks.filter((t) => t.markdownTaskId);
  if (linked.length === 0) {
    return { moves: [], baseSha: "", conflict: false };
  }

  const gh = await clientFactory();
  const file = await gh.getFile(data.markdownSource.path);
  const parsed = parseMarkdown(file.content);
  const columnById = new Map(data.columns.map((c) => [c.id, c.name]));

  const moves: PendingMove[] = [];
  for (const task of linked) {
    const inFile = parsed.tasks.find((t) => t.id === task.markdownTaskId);
    if (!inFile) continue;
    const boardColumn = columnById.get(task.columnId);
    if (boardColumn && boardColumn !== inFile.heading) {
      moves.push({
        taskId: task.id,
        markdownTaskId: task.markdownTaskId!,
        title: task.title,
        from: inFile.heading,
        to: boardColumn,
      });
    }
  }

  const safety = checkWriteSafety(data.markdownSource.lastKnownSha, file.sha);
  return { moves, baseSha: file.sha, conflict: !safety.ok };
}

/** One preview and one commit for every pending move at once. */
export async function previewAllPending(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<PendingChange | null> {
  const data = getBoardData();
  if (!data.repository || !data.markdownSource) return null;

  const pending = await pendingMarkdownMoves(clientFactory);
  if (!pending || pending.moves.length === 0) return null;

  const gh = await clientFactory();
  const file = await gh.getFile(data.markdownSource.path);

  let content = file.content;
  const summaries: string[] = [];
  for (const move of pending.moves) {
    const result = moveTaskInMarkdown(content, move.markdownTaskId, move.to);
    if (result.changed) {
      content = result.content;
      summaries.push(`${move.title} → ${move.to}`);
    }
  }

  const summary =
    pending.moves.length === 1
      ? `Move "${pending.moves[0].title}" to ${pending.moves[0].to}`
      : `Update ${data.markdownSource.path}: ${summaries.length} task(s) moved`;

  return {
    taskId: "",
    markdownTaskId: "",
    targetHeading: "",
    summary,
    changedSomething: summaries.length > 0,
    diff: buildDiff(file.content, content),
    before: file.content,
    after: content,
    baseSha: file.sha,
    conflict: pending.conflict
      ? {
          expectedSha: data.markdownSource.lastKnownSha,
          currentSha: file.sha,
          remoteContent: file.content,
        }
      : null,
  };
}

export async function commitAllPending(
  args: { expectedSha: string; force?: boolean },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ commitSha: string; contentSha: string; summary: string }> {
  const data = getBoardData();
  if (!data.repository || !data.markdownSource) {
    throw new Error("No markdown source configured");
  }

  const gh = await clientFactory();
  const file = await gh.getFile(data.markdownSource.path);

  if (!args.force && file.sha !== args.expectedSha) {
    logActivity({
      repositoryId: data.repository.id,
      type: "conflict_detected",
      message: `Remote ${data.markdownSource.path} changed (${args.expectedSha} → ${file.sha})`,
    });
    const error = new Error("Remote file changed since preview");
    (error as Error & { code?: string }).code = "CONFLICT";
    throw error;
  }

  const preview = await previewAllPending(clientFactory);
  if (!preview || !preview.changedSomething) {
    return { commitSha: "", contentSha: file.sha, summary: "Nothing to commit" };
  }

  const written = await gh.putFile({
    path: data.markdownSource.path,
    content: preview.after,
    expectedSha: file.sha,
    message: commitMessageForMove(preview.summary),
  });

  db.update(markdownSources)
    .set({ lastKnownSha: written.contentSha })
    .where(eq(markdownSources.id, data.markdownSource.id))
    .run();

  logActivity({
    repositoryId: data.repository.id,
    type: "markdown_changed",
    message: commitMessageForMove(preview.summary),
  });

  return { ...written, summary: preview.summary };
}

/**
 * Board → GitHub, step 1: fetch the file fresh, verify the SHA we based our
 * edit on, and return a preview. Nothing is written here.
 */
export async function previewMarkdownMove(
  taskId: string,
  targetHeading: string,
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<PendingChange> {
  const data = getBoardData();
  if (!data.repository || !data.markdownSource) {
    throw new Error("No markdown source configured");
  }

  const task = data.tasks.find((t) => t.id === taskId);
  if (!task?.markdownTaskId) {
    throw new Error("This card is not linked to a markdown task");
  }

  const gh = await clientFactory();
  const file = await gh.getFile(data.markdownSource.path);

  const safety = checkWriteSafety(data.markdownSource.lastKnownSha, file.sha);
  const moved = moveTaskInMarkdown(
    file.content,
    task.markdownTaskId,
    targetHeading,
  );

  return {
    taskId,
    markdownTaskId: task.markdownTaskId,
    targetHeading,
    summary: moved.summary,
    changedSomething: moved.changed,
    diff: buildDiff(file.content, moved.content),
    before: file.content,
    after: moved.content,
    baseSha: file.sha,
    conflict: safety.ok
      ? null
      : {
          expectedSha: data.markdownSource.lastKnownSha,
          currentSha: file.sha,
          remoteContent: file.content,
        },
  };
}

/**
 * Board → GitHub, step 2: commit. Refuses when the remote SHA moved between
 * preview and commit unless the caller explicitly resolved the conflict.
 */
export async function commitMarkdownMove(
  args: {
    taskId: string;
    targetHeading: string;
    expectedSha: string;
    force?: boolean;
  },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ commitSha: string; contentSha: string; summary: string }> {
  const data = getBoardData();
  if (!data.repository || !data.markdownSource) {
    throw new Error("No markdown source configured");
  }

  const task = data.tasks.find((t) => t.id === args.taskId);
  if (!task?.markdownTaskId) throw new Error("Card has no markdown task");

  const gh = await clientFactory();
  const file = await gh.getFile(data.markdownSource.path);

  if (!args.force && file.sha !== args.expectedSha) {
    logActivity({
      repositoryId: data.repository.id,
      taskId: args.taskId,
      type: "conflict_detected",
      message: `Remote ${data.markdownSource.path} changed (${args.expectedSha} → ${file.sha})`,
    });
    const error = new Error("Remote file changed since preview");
    (error as Error & { code?: string }).code = "CONFLICT";
    throw error;
  }

  const moved = moveTaskInMarkdown(
    file.content,
    task.markdownTaskId,
    args.targetHeading,
  );
  if (!moved.changed) {
    return { commitSha: "", contentSha: file.sha, summary: moved.summary };
  }

  const written = await gh.putFile({
    path: data.markdownSource.path,
    content: moved.content,
    expectedSha: file.sha,
    message: commitMessageForMove(moved.summary),
  });

  db.update(markdownSources)
    .set({ lastKnownSha: written.contentSha })
    .where(eq(markdownSources.id, data.markdownSource.id))
    .run();

  logActivity({
    repositoryId: data.repository.id,
    taskId: args.taskId,
    type: "markdown_changed",
    message: commitMessageForMove(moved.summary),
  });

  return { ...written, summary: moved.summary };
}

/* ------------------------------------------- the board as a repository file -- */

function localBoardState(): BoardState {
  const data = getBoardData();
  const columnById = new Map(data.columns.map((c) => [c.id, c.name]));

  // Deleted cards are included so the deletion travels; the board filters them.
  const rows = db
    .select()
    .from(tasks)
    .where(eq(tasks.boardId, data.boardId ?? ""))
    .all();

  const labels = db.select().from(taskLabels).all();
  const branches = db.select().from(taskBranchLinks).all();
  const prs = db.select().from(taskPullRequestLinks).all();
  const issues = db.select().from(taskIssueLinks).all();

  return {
    version: 1,
    columns: data.columns.map((c) => c.name),
    cards: rows.map((t) => ({
      id: t.id,
      number: t.cardNumber,
      column: columnById.get(t.columnId) ?? data.columns[0]?.name ?? "Todo",
      position: t.position,
      title: t.title,
      description: t.description,
      assignee: t.assignee,
      dueDate: t.dueDate?.getTime() ?? null,
      checklist: t.checklist ?? [],
      labels: labels.filter((l) => l.taskId === t.id).map((l) => l.label),
      branches: branches.filter((b) => b.taskId === t.id).map((b) => b.branchName),
      pullRequests: prs.filter((p) => p.taskId === t.id).map((p) => p.prNumber),
      issues: issues.filter((i) => i.taskId === t.id).map((i) => i.issueNumber),
      markdownTaskId: t.markdownTaskId,
      updatedAt: t.updatedAt.getTime(),
      deletedAt: t.deletedAt?.getTime() ?? null,
    })),
  };
}

function writeCards(cards: BoardStateCard[]): void {
  const data = getBoardData();
  if (!data.boardId) return;
  const columnByName = new Map(data.columns.map((c) => [c.name, c.id]));

  // A remote board file must never reassign a card that belongs to another repo.
  for (const card of cards) {
    const existing = db.select({ boardId: tasks.boardId }).from(tasks).where(eq(tasks.id, card.id)).get();
    if (existing && existing.boardId !== data.boardId) {
      throw new Error("A card from another board has the same ID");
    }
  }

  for (const card of cards) {
    const columnId = columnByName.get(card.column) ?? data.columns[0]?.id;
    if (!columnId) continue;

    const existing = db.select().from(tasks).where(eq(tasks.id, card.id)).get();
    const values = {
      boardId: data.boardId,
      columnId,
      position: card.position,
      title: card.title,
      description: card.description,
      assignee: card.assignee,
      dueDate: card.dueDate ? new Date(card.dueDate) : null,
      checklist: card.checklist,
      markdownTaskId: card.markdownTaskId,
      cardNumber: card.number,
      updatedAt: new Date(card.updatedAt),
      deletedAt: card.deletedAt ? new Date(card.deletedAt) : null,
    };

    if (existing) {
      db.update(tasks).set(values).where(eq(tasks.id, card.id)).run();
    } else {
      db.insert(tasks)
        .values({ id: card.id, createdAt: new Date(card.updatedAt), ...values })
        .run();
    }

    db.delete(taskLabels).where(eq(taskLabels.taskId, card.id)).run();
    for (const label of card.labels) {
      db.insert(taskLabels).values({ id: randomUUID(), taskId: card.id, label }).run();
    }
    db.delete(taskBranchLinks).where(eq(taskBranchLinks.taskId, card.id)).run();
    for (const branch of card.branches) {
      db.insert(taskBranchLinks)
        .values({ id: randomUUID(), taskId: card.id, branchName: branch })
        .run();
    }
    db.delete(taskPullRequestLinks)
      .where(eq(taskPullRequestLinks.taskId, card.id))
      .run();
    for (const pr of card.pullRequests) {
      db.insert(taskPullRequestLinks)
        .values({ id: randomUUID(), taskId: card.id, prNumber: pr })
        .run();
    }
    db.delete(taskIssueLinks).where(eq(taskIssueLinks.taskId, card.id)).run();
    for (const issue of card.issues) {
      db.insert(taskIssueLinks)
        .values({ id: randomUUID(), taskId: card.id, issueNumber: issue })
        .run();
    }
  }
}

export interface BoardStateStatus {
  tracked: boolean;
  changes: string[];
  sha: string | null;
}

/** What pushing the board would change in the repository, in words. */
export async function boardStateStatus(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<BoardStateStatus> {
  const gh = await clientFactory();
  let remoteCards: BoardStateCard[] = [];
  let sha: string | null = null;
  let tracked = false;

  try {
    const file = await gh.getFile(BOARD_STATE_PATH);
    sha = file.sha;
    tracked = true;
    remoteCards = parseBoardState(file.content)?.cards ?? [];
  } catch {
    // Not in the repository yet — the first push creates it.
  }

  return {
    tracked,
    sha,
    changes: describeChanges(localBoardState().cards, remoteCards),
  };
}

/** Repository → this machine. Newer edits win per card. */
export async function pullBoardState(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ added: number; updated: number } | null> {
  const data = getBoardData();
  if (!data.repository) return null;

  const gh = await clientFactory();
  let remote: BoardState | null = null;
  try {
    remote = parseBoardState((await gh.getFile(BOARD_STATE_PATH)).content);
  } catch {
    return null;
  }
  if (!remote) return null;

  const merged = mergeBoardState(localBoardState().cards, remote.cards);
  writeCards(merged.cards);

  if (merged.added || merged.updated) {
    logActivity({
      repositoryId: data.repository.id,
      type: "board_pulled",
      message: `Board pulled from GitHub: ${merged.added} new, ${merged.updated} updated`,
    });
  }
  return { added: merged.added, updated: merged.updated };
}

/** This machine → repository, merging first so a colleague's newer edit survives. */
export async function pushBoardState(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ commitSha: string; changes: string[] }> {
  const data = getBoardData();
  if (!data.repository) throw new Error("Not connected");

  const gh = await clientFactory();
  let remoteCards: BoardStateCard[] = [];
  let sha: string | undefined;
  try {
    const file = await gh.getFile(BOARD_STATE_PATH);
    sha = file.sha;
    remoteCards = parseBoardState(file.content)?.cards ?? [];
  } catch {
    /* first push creates the file */
  }

  const local = localBoardState();
  const changes = describeChanges(local.cards, remoteCards);
  if (changes.length === 0) return { commitSha: "", changes: [] };

  const merged = mergeBoardState(local.cards, remoteCards);
  writeCards(merged.cards);

  const written = await gh.putFile({
    path: BOARD_STATE_PATH,
    content: serialiseBoardState({ ...local, cards: merged.cards }),
    expectedSha: sha,
    message: `RepoBoard: update board (${changes.length} change${changes.length === 1 ? "" : "s"})`,
  });

  logActivity({
    repositoryId: data.repository.id,
    type: "board_pushed",
    message: `Board pushed: ${changes.slice(0, 3).join("; ")}${changes.length > 3 ? "…" : ""}`,
  });

  return { commitSha: written.commitSha, changes };
}

export function getActivity(limit = 50) {
  const repositoryId = configuredRepositoryId();
  if (!repositoryId) return [];
  return db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.repositoryId, repositoryId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit)
    .all()
    .map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      taskId: e.taskId,
      createdAt: e.createdAt.getTime(),
    }));
}

export function linkTask(args: {
  taskId: string;
  branch?: string;
  commit?: string;
  pullRequest?: number;
  issue?: number;
  repositoryId: string;
}) {
  if (args.branch) {
    db.insert(taskBranchLinks)
      .values({
        id: randomUUID(),
        taskId: args.taskId,
        branchName: args.branch,
      })
      .run();
    logActivity({
      repositoryId: args.repositoryId,
      taskId: args.taskId,
      type: "branch_linked",
      message: `Linked branch ${args.branch}`,
    });
  }
  if (args.commit) {
    db.insert(taskCommitLinks)
      .values({ id: randomUUID(), taskId: args.taskId, commitSha: args.commit })
      .run();
  }
  if (args.pullRequest) {
    db.insert(taskPullRequestLinks)
      .values({
        id: randomUUID(),
        taskId: args.taskId,
        prNumber: args.pullRequest,
      })
      .run();
    logActivity({
      repositoryId: args.repositoryId,
      taskId: args.taskId,
      type: "pr_linked",
      message: `Linked PR #${args.pullRequest}`,
    });
  }
  if (args.issue) {
    db.insert(taskIssueLinks)
      .values({
        id: randomUUID(),
        taskId: args.taskId,
        issueNumber: args.issue,
      })
      .run();
    logActivity({
      repositoryId: args.repositoryId,
      taskId: args.taskId,
      type: "issue_linked",
      message: `Linked issue #${args.issue}`,
    });
  }
}

export function unlinkTask(args: {
  taskId: string;
  branch?: string;
  pullRequest?: number;
  issue?: number;
}) {
  if (args.branch) {
    db.delete(taskBranchLinks)
      .where(
        and(
          eq(taskBranchLinks.taskId, args.taskId),
          eq(taskBranchLinks.branchName, args.branch),
        ),
      )
      .run();
  }
  if (args.pullRequest) {
    db.delete(taskPullRequestLinks)
      .where(
        and(
          eq(taskPullRequestLinks.taskId, args.taskId),
          eq(taskPullRequestLinks.prNumber, args.pullRequest),
        ),
      )
      .run();
  }
  if (args.issue) {
    db.delete(taskIssueLinks)
      .where(
        and(
          eq(taskIssueLinks.taskId, args.taskId),
          eq(taskIssueLinks.issueNumber, args.issue),
        ),
      )
      .run();
  }
}

export async function connectRepository(token: string, slug: string) {
  const summary = await GitHubClient.probe(token, slug);
  const { repositoryId } = ensureBootstrap({
    owner: summary.owner,
    name: summary.name,
    defaultBranch: summary.defaultBranch,
    visibility: summary.visibility,
  });
  logActivity({
    repositoryId,
    type: "repo_connected",
    message: `Connected ${summary.owner}/${summary.name}`,
  });
  return summary;
}

/**
 * What the top bar shows. Falls back to the configured repo when the local row
 * does not exist yet, so a token supplied through the environment does not
 * render as "not connected" next to a green connected badge.
 */
export interface RepoHeader {
  owner: string | null;
  name: string | null;
  defaultBranch: string | null;
  lastSyncAt: number | null;
}

export function getRepoHeader(): RepoHeader {
  const stored = activeRepository();
  if (stored) {
    return {
      owner: stored.owner,
      name: stored.name,
      defaultBranch: stored.defaultBranch,
      lastSyncAt: stored.lastSyncAt?.getTime() ?? null,
    };
  }
  const configured = getConfiguredRepo();
  return {
    owner: configured?.owner ?? null,
    name: configured?.name ?? null,
    defaultBranch: null,
    lastSyncAt: null,
  };
}

/**
 * Creates the local board the first time the app runs against a repository that
 * was configured through the environment rather than the Settings form.
 * Safe to call on every request: it is a no-op once the row exists.
 */
export async function ensureRepositoryRow(
  verified?: Pick<RepoSummary, "owner" | "name" | "defaultBranch" | "visibility">,
): Promise<void> {
  if (activeRepository()) return;
  const configured = getConfiguredRepo();
  if (!configured) return;

  const summary = verified ?? await (await GitHubClient.create()).getRepo();
  if (summary.owner.toLowerCase() !== configured.owner.toLowerCase() || summary.name.toLowerCase() !== configured.name.toLowerCase()) {
    throw new Error("The configured repository changed during verification");
  }
  ensureBootstrap({
    owner: summary.owner,
    name: summary.name,
    defaultBranch: summary.defaultBranch,
    visibility: summary.visibility,
  });
}

export function getRepoIdentity() {
  const configured = getConfiguredRepo();
  const stored = activeRepository();
  return {
    configured,
    stored: stored
      ? {
          owner: stored.owner,
          name: stored.name,
          defaultBranch: stored.defaultBranch,
          visibility: stored.visibility,
          lastSyncAt: stored.lastSyncAt?.getTime() ?? null,
        }
      : null,
  };
}

export { syncState };
