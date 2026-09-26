import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  activityEvents,
  boards,
  columns,
  markdownSources,
  markdownTaskMappings,
  milestones,
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
import { currentActor, type Actor } from "@/lib/actor";
import { locate, normalise, progress, setDone, type ChecklistItem } from "@/lib/checklist";
import { getConfiguredRepo } from "@/lib/github/auth-provider";
import {
  DEFAULT_COLUMN_HEADINGS,
  DONE_HEADING,
  ensureTaskIds,
  moveTask as moveTaskInMarkdown,
  parseMarkdown,
} from "@/lib/markdown/parser";
import {
  BOARD_STATE_PATH,
  describeFileChanges,
  mergeBoardFile,
  parseBoardState,
  serialiseBoardState,
  type BoardState,
  type BoardStateCard,
  type BoardStateMeta,
  type BoardStateMilestone,
} from "@/lib/board-state";
import {
  buildDiff,
  checkWriteSafety,
  commitMessageForMove,
  type DiffLine,
} from "@/lib/markdown/sync";

const WORKSPACE_ID = "ws_local";

export function configuredRepositoryId(): string | null {
  const repo = getConfiguredRepo();
  return repo ? `repo_${repo.owner}_${repo.name}`.toLowerCase() : null;
}

export function activeRepository() {
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
  getFile(path: string, ref?: string): Promise<{ path: string; content: string; sha: string }>;
  putFile(args: {
    path: string;
    content: string;
    expectedSha?: string;
    message: string;
    branch?: string;
  }): Promise<{ commitSha: string; contentSha: string }>;
  ensureBranch?(name: string): Promise<void>;
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
  /** 0 none · 1 urgent · 2 high · 3 medium · 4 low. */
  priority: number;
  milestoneId: string | null;
  updatedAt: number;
  checklist: ChecklistItem[];
  markdownTaskId: string | null;
  labels: string[];
  branches: string[];
  commits: string[];
  pullRequests: number[];
  issues: number[];
}

export interface BoardMilestone {
  id: string;
  name: string;
  description: string | null;
  dueDate: number | null;
  position: number;
}

export interface BoardInfo {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  /** The tile's picture (components/BoardArt.tsx); null picks one from the id. */
  art: string | null;
  owner: string | null;
  /** The primary board follows the markdown file and board.json. */
  primary: boolean;
}

export interface BoardSummary extends BoardInfo {
  open: number;
  done: number;
  /** Items in the cards' checklists, at every depth. */
  items: { done: number; total: number };
  updatedAt: number | null;
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
  /** The board being shown; null only before a repository is connected. */
  board: BoardInfo | null;
  columns: { id: string; name: string; position: number }[];
  tasks: BoardTask[];
  milestones: BoardMilestone[];
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
  actor?: Actor | null;
}) {
  const actor = args.actor === undefined ? currentActor() : args.actor;
  db.insert(activityEvents)
    .values({
      id: randomUUID(),
      repositoryId: args.repositoryId,
      taskId: args.taskId ?? null,
      type: args.type,
      message: args.message,
      actor: actor?.name ?? null,
      actorKind: actor?.kind ?? null,
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
      .values({ id: boardId, repositoryId, name: "Main board", position: 0, createdAt: now() })
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
      message: `created the board for ${repo.owner}/${repo.name}`,
    });
  }

  return { repositoryId, boardId };
}

function group<T>(rows: T[], key: (row: T) => string, value: (row: T) => unknown) {
  const map = new Map<string, never[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    (list as unknown[]).push(value(row));
    map.set(k, list);
  }
  return map;
}

/** Labels and links for the given cards only — never the whole database. */
function linksFor(taskIds: string[]) {
  const ids = taskIds.length ? taskIds : ["\u0000"];
  return {
    labels: group(
      db.select().from(taskLabels).where(inArray(taskLabels.taskId, ids)).all(),
      (r) => r.taskId,
      (r) => r.label,
    ) as Map<string, string[]>,
    branches: group(
      db.select().from(taskBranchLinks).where(inArray(taskBranchLinks.taskId, ids)).all(),
      (r) => r.taskId,
      (r) => r.branchName,
    ) as Map<string, string[]>,
    commits: group(
      db.select().from(taskCommitLinks).where(inArray(taskCommitLinks.taskId, ids)).all(),
      (r) => r.taskId,
      (r) => r.commitSha,
    ) as Map<string, string[]>,
    pullRequests: group(
      db.select().from(taskPullRequestLinks).where(inArray(taskPullRequestLinks.taskId, ids)).all(),
      (r) => r.taskId,
      (r) => r.prNumber,
    ) as Map<string, number[]>,
    issues: group(
      db.select().from(taskIssueLinks).where(inArray(taskIssueLinks.taskId, ids)).all(),
      (r) => r.taskId,
      (r) => r.issueNumber,
    ) as Map<string, number[]>,
  };
}

/** The one markdown file whose headings drive the board's columns. */
export function boardSource(repositoryId: string) {
  return db
    .select()
    .from(markdownSources)
    .where(and(eq(markdownSources.repositoryId, repositoryId), eq(markdownSources.role, "board")))
    .get();
}

export const primaryBoardId = (repositoryId: string) => `board_${repositoryId}`;

function boardInfo(board: typeof boards.$inferSelect): BoardInfo {
  return {
    id: board.id,
    name: board.name,
    description: board.description ?? null,
    color: board.color ?? null,
    art: board.art ?? null,
    owner: board.owner ?? null,
    primary: board.id === primaryBoardId(board.repositoryId),
  };
}

/** The repository's boards, primary first, then in the order they were made. */
function repositoryBoards(repositoryId: string) {
  return db
    .select()
    .from(boards)
    .where(and(eq(boards.repositoryId, repositoryId), isNull(boards.archivedAt)))
    .orderBy(asc(boards.position), asc(boards.createdAt))
    .all()
    .sort((a, b) => Number(b.id === primaryBoardId(repositoryId)) - Number(a.id === primaryBoardId(repositoryId)));
}

/**
 * A board of the active repository: the one asked for, or the primary one.
 * A board id from another repository is never returned.
 */
export function getBoardData(boardId?: string | null): BoardData {
  const repository = activeRepository();
  if (!repository) {
    return {
      repository: null,
      boardId: null,
      board: null,
      columns: [],
      tasks: [],
      milestones: [],
      markdownSource: null,
    };
  }

  const all = repositoryBoards(repository.id);
  const board = (boardId ? all.find((b) => b.id === boardId) : undefined) ?? (boardId ? undefined : all[0]);

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
      board: null,
      columns: [],
      tasks: [],
      milestones: [],
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

  const links = linksFor(rows.map((t) => t.id));
  // Only the main board follows the markdown file.
  const source = board.id === primaryBoardId(repository.id) ? boardSource(repository.id) : null;
  const goals = db
    .select()
    .from(milestones)
    .where(eq(milestones.boardId, board.id))
    .orderBy(asc(milestones.position), asc(milestones.createdAt))
    .all();

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
    board: boardInfo(board),
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
      priority: t.priority ?? 0,
      milestoneId: t.milestoneId ?? null,
      updatedAt: t.updatedAt.getTime(),
      checklist: normalise(t.checklist),
      markdownTaskId: t.markdownTaskId,
      labels: links.labels.get(t.id) ?? [],
      branches: links.branches.get(t.id) ?? [],
      commits: links.commits.get(t.id) ?? [],
      pullRequests: links.pullRequests.get(t.id) ?? [],
      issues: links.issues.get(t.id) ?? [],
    })),
    milestones: goals.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      dueDate: m.dueDate?.getTime() ?? null,
      position: m.position,
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
/**
 * The main board's data with the cards and columns of every board of the
 * project added — for places that look cards up by id or number (search,
 * Activity, the Code screen) and must find them on any board. Writes still
 * go to a board by its own id.
 */
export function getProjectData(): BoardData {
  const main = getBoardData();
  if (!main.repository) return main;
  const others = repositoryBoards(main.repository.id)
    .filter((b) => b.id !== main.boardId)
    .map((b) => getBoardData(b.id));
  return {
    ...main,
    columns: [...main.columns, ...others.flatMap((o) => o.columns)],
    tasks: [...main.tasks, ...others.flatMap((o) => o.tasks)],
  };
}

export function taskBelongsToBoard(taskId: string, boardId: string): boolean {
  return Boolean(
    db.select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.boardId, boardId)))
      .get(),
  );
}

/** Next free number on this board; numbers are never reused. */
/**
 * Next free number in the repository — across all its boards, so RB-12 in a
 * commit message always means one card. Numbers are never reused.
 */
function nextCardNumber(boardId: string): number {
  const owner = db.select({ repositoryId: boards.repositoryId }).from(boards).where(eq(boards.id, boardId)).get();
  const ids = owner
    ? db.select({ id: boards.id }).from(boards).where(eq(boards.repositoryId, owner.repositoryId)).all().map((b) => b.id)
    : [boardId];
  const row = db
    .select({ max: sql<number>`coalesce(max(${tasks.cardNumber}), 0)` })
    .from(tasks)
    .where(inArray(tasks.boardId, ids))
    .get();
  return (row?.max ?? 0) + 1;
}

/* ---------------------------------------------------------------- boards -- */

export function listBoards(): BoardSummary[] {
  const repository = activeRepository();
  if (!repository) return [];
  return repositoryBoards(repository.id).map((board) => {
    const done = db
      .select({ id: columns.id, name: columns.name })
      .from(columns)
      .where(eq(columns.boardId, board.id))
      .all()
      .filter((c) => /^(done|complete|completed|shipped|closed)$/i.test(c.name.trim()))
      .map((c) => c.id);
    const rows = db
      .select({ columnId: tasks.columnId, checklist: tasks.checklist, updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(and(eq(tasks.boardId, board.id), isNull(tasks.deletedAt)))
      .all();
    const doneCount = rows.filter((r) => done.includes(r.columnId)).length;
    const items = rows.reduce(
      (acc, r) => {
        const p = progress(normalise(r.checklist));
        return { done: acc.done + p.done, total: acc.total + p.total };
      },
      { done: 0, total: 0 },
    );
    const updatedAt = rows.reduce((m, r) => Math.max(m, r.updatedAt.getTime()), 0);
    return {
      ...boardInfo(board),
      open: rows.length - doneCount,
      done: doneCount,
      items,
      updatedAt: updatedAt || null,
    };
  });
}

export function createBoard(args: {
  name: string;
  description?: string | null;
  color?: string | null;
  art?: string | null;
  owner?: string | null;
}): string {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const id = `board_${randomUUID()}`;
  const position = repositoryBoards(repository.id).length;
  db.insert(boards)
    .values({
      id,
      repositoryId: repository.id,
      name: args.name,
      description: args.description ?? null,
      color: args.color ?? null,
      art: args.art ?? null,
      owner: args.owner ?? null,
      position,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  DEFAULT_COLUMN_HEADINGS.forEach((name, index) => {
    db.insert(columns).values({ id: `col_${id}_${index}`, boardId: id, name, position: index }).run();
  });
  logActivity({ repositoryId: repository.id, type: "board_created", message: `created the board ${args.name}` });
  return id;
}

function ownBoard(boardId: string) {
  const repository = activeRepository();
  const board = repository
    ? db.select().from(boards).where(and(eq(boards.id, boardId), eq(boards.repositoryId, repository.id))).get()
    : undefined;
  if (!repository || !board) throw new Error("That board is not in this project");
  return { repository, board };
}

export function updateBoard(
  boardId: string,
  patch: { name?: string; description?: string | null; color?: string | null; art?: string | null; owner?: string | null },
): void {
  const { repository, board } = ownBoard(boardId);
  const values: Record<string, unknown> = {};
  for (const key of ["name", "description", "color", "art", "owner"] as const) {
    if (patch[key] !== undefined) values[key] = patch[key];
  }
  if (Object.keys(values).length === 0) return;
  db.update(boards).set({ ...values, updatedAt: now() }).where(eq(boards.id, boardId)).run();
  if (patch.name && patch.name !== board.name) {
    logActivity({ repositoryId: repository.id, type: "board_updated", message: `renamed the board ${board.name} to ${patch.name}` });
  }
}

/** Archived, not deleted: its cards stay in the database and it can come back. */
export function archiveBoard(boardId: string): void {
  const { repository, board } = ownBoard(boardId);
  if (board.id === primaryBoardId(repository.id)) throw new Error("The primary board cannot be archived");
  db.update(boards).set({ archivedAt: now(), updatedAt: now() }).where(eq(boards.id, boardId)).run();
  logActivity({ repositoryId: repository.id, type: "board_archived", message: `archived the board ${board.name}` });
}

/** Brings an archived board back, with its cards. */
export function restoreBoard(boardId: string): void {
  const { repository, board } = ownBoard(boardId);
  db.update(boards).set({ archivedAt: null, updatedAt: now() }).where(eq(boards.id, boardId)).run();
  logActivity({ repositoryId: repository.id, type: "board_restored", message: `brought back the board ${board.name}` });
}

/** Archived boards of the active repository, newest first. */
export function listArchivedBoards(): { id: string; name: string; owner: string | null; archivedAt: number; cards: number }[] {
  const repository = activeRepository();
  if (!repository) return [];
  return db
    .select()
    .from(boards)
    .where(eq(boards.repositoryId, repository.id))
    .all()
    .filter((b) => b.archivedAt)
    .sort((a, b) => b.archivedAt!.getTime() - a.archivedAt!.getTime())
    .map((b) => ({
      id: b.id,
      name: b.name,
      owner: b.owner ?? null,
      archivedAt: b.archivedAt!.getTime(),
      cards: db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.boardId, b.id), isNull(tasks.deletedAt))).all().length,
    }));
}

/** Which board of the active repository a card (id or number) is on. */
export function findCardBoard(ref: string): { boardId: string; taskId: string } | null {
  const repository = activeRepository();
  if (!repository) return null;
  const ids = repositoryBoards(repository.id).map((b) => b.id);
  if (ids.length === 0) return null;
  const number = ref.match(/^(?:rb-)?(\d+)$/i)?.[1];
  const row = db
    .select({ id: tasks.id, boardId: tasks.boardId })
    .from(tasks)
    .where(
      and(
        inArray(tasks.boardId, ids),
        isNull(tasks.deletedAt),
        number ? eq(tasks.cardNumber, Number(number)) : eq(tasks.id, ref),
      ),
    )
    .get();
  return row ? { boardId: row.boardId, taskId: row.id } : null;
}

export function createTask(args: {
  boardId: string;
  columnId: string;
  title: string;
  description?: string | null;
  assignee?: string | null;
  labels?: string[];
  priority?: number;
  milestoneId?: string | null;
  dueDate?: number | null;
  repositoryId: string;
}): string {
  const id = randomUUID();
  const siblings = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.columnId, args.columnId), isNull(tasks.deletedAt)))
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
      dueDate: args.dueDate ? new Date(args.dueDate) : null,
      priority: args.priority ?? 0,
      milestoneId: args.milestoneId ?? null,
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
    message: `created ${args.title}`,
  });

  return id;
}

/**
 * Tick or untick one item on the card as it is now in the database — not on
 * a copy the page had, so two quick ticks on the same card both land.
 */
export function setItemDone(taskId: string, itemId: string, done: boolean): ChecklistItem[] {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw new Error("No such card");
  const list = normalise(task.checklist);
  const found = locate(list, itemId);
  if (!found) throw new Error("That item is no longer on the card");
  const next = setDone(list, itemId, done);
  db.update(tasks).set({ checklist: next, updatedAt: now() }).where(eq(tasks.id, taskId)).run();
  logActivity({
    repositoryId: db.select({ r: boards.repositoryId }).from(boards).where(eq(boards.id, task.boardId)).get()?.r ?? "",
    taskId,
    type: "card_updated",
    message: `${done ? "ticked" : "reopened"} item ${found.number} “${found.item.text}” on ${task.title}`,
  });
  return next;
}

export function updateTask(
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    assignee?: string | null;
    dueDate?: number | null;
    checklist?: ChecklistItem[];
    labels?: string[];
    priority?: number;
    milestoneId?: string | null;
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
  if (patch.priority !== undefined) values.priority = patch.priority;
  if (patch.milestoneId !== undefined) values.milestoneId = patch.milestoneId;

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

  // The card goes in at `position` among the live cards of the column; the
  // others keep their order around it. Deleted cards take no place.
  const siblings = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.columnId, targetColumnId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.position))
    .all()
    .filter((t) => t.id !== taskId);
  siblings.splice(Math.max(0, Math.min(position, siblings.length)), 0, { ...task, columnId: targetColumnId });
  db.transaction(() => {
    siblings.forEach((sibling, index) => {
      if (sibling.id === taskId) {
        db.update(tasks).set({ columnId: targetColumnId, position: index, updatedAt: now() }).where(eq(tasks.id, taskId)).run();
      } else if (sibling.position !== index) {
        db.update(tasks).set({ position: index }).where(eq(tasks.id, sibling.id)).run();
      }
    });
  });

  return {
    fromColumn: fromColumn?.name ?? "",
    toColumn: toColumn?.name ?? "",
  };
}

/** Reorders a column after a drag, keeping positions dense and stable. */
/**
 * Only cards whose place actually changes are touched — and only they get a
 * new updatedAt. Bumping every card in the column would make a drag "win"
 * every board.json merge and silently undo a teammate's edits to those cards.
 */
export function reorderColumn(columnId: string, orderedIds: string[]): void {
  const current = new Map(
    db
      .select({ id: tasks.id, position: tasks.position, columnId: tasks.columnId })
      .from(tasks)
      .where(inArray(tasks.id, orderedIds.length ? orderedIds : [""]))
      .all()
      .map((t) => [t.id, t]),
  );
  db.transaction(() => {
    orderedIds.forEach((taskId, index) => {
      const row = current.get(taskId);
      if (row && row.position === index && row.columnId === columnId) return;
      db.update(tasks).set({ columnId, position: index, updatedAt: now() }).where(eq(tasks.id, taskId)).run();
    });
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
      message: `imported ${created} GitHub issue${created === 1 ? "" : "s"} as cards`,
    });
  }

  return { created, skipped };
}

export function setMarkdownSource(repositoryId: string, path: string): string {
  const existing = boardSource(repositoryId);
  // The same file tracked as a checklist becomes the board source instead of
  // appearing twice.
  db.delete(markdownSources)
    .where(
      and(
        eq(markdownSources.repositoryId, repositoryId),
        eq(markdownSources.path, path),
        eq(markdownSources.role, "checklist"),
      ),
    )
    .run();

  if (existing) {
    db.update(markdownSources)
      .set({ path, lastKnownSha: null })
      .where(eq(markdownSources.id, existing.id))
      .run();
    return existing.id;
  }

  const id = randomUUID();
  db.insert(markdownSources)
    .values({ id, repositoryId, path, lastKnownSha: null, autoSync: false, role: "board" })
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
  options: { writeIds?: boolean } = {},
): Promise<SyncResult> {
  const { writeIds = true } = options;
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
  if (withIds.changed && !writeIds) {
    // Adding ids is a write to the user's file: hand it back so it goes
    // through the same reviewed diff as every other write.
    const error = new Error(
      `${withIds.assigned.length} task(s) in ${data.markdownSource.path} need a stable id first`,
    ) as Error & { code?: string; payload?: unknown };
    error.code = "NEEDS_IDS";
    error.payload = {
      path: data.markdownSource.path,
      content: withIds.content,
      baseSha: sha,
      count: withIds.assigned.length,
    };
    throw error;
  }
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
      message: `added ${withIds.assigned.length} task id${withIds.assigned.length === 1 ? "" : "s"} to ${data.markdownSource.path}`,
    });
  }

  const parsed = parseMarkdown(content);
  const columnByName = new Map(data.columns.map((c) => [c.name, c.id]));
  // Deleted cards count too: a card someone deleted must not come back as a
  // new one (with a new number) on the next sync.
  const existingByMarkdownId = new Map(
    db
      .select({ id: tasks.id, title: tasks.title, columnId: tasks.columnId, markdownTaskId: tasks.markdownTaskId, deletedAt: tasks.deletedAt })
      .from(tasks)
      .where(eq(tasks.boardId, data.boardId!))
      .all()
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
      if (existing.deletedAt) return;
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
    message: `synced ${data.markdownSource.path}: ${created} new, ${updated} updated`,
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
      message: `was stopped: ${data.markdownSource.path} changed on GitHub meanwhile (${args.expectedSha.slice(0, 7)} → ${file.sha.slice(0, 7)})`,
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
      message: `was stopped: ${data.markdownSource.path} changed on GitHub meanwhile (${args.expectedSha.slice(0, 7)} → ${file.sha.slice(0, 7)})`,
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

function boardColumnsOf(boardId: string) {
  return db.select().from(columns).where(eq(columns.boardId, boardId)).orderBy(asc(columns.position)).all();
}

function boardMilestonesOf(boardId: string) {
  return db.select().from(milestones).where(eq(milestones.boardId, boardId)).orderBy(asc(milestones.position)).all();
}

function metaOf(board: typeof boards.$inferSelect): BoardStateMeta {
  return {
    name: board.name,
    description: board.description ?? null,
    color: board.color ?? null,
    art: board.art ?? null,
    owner: board.owner ?? null,
    // A board nobody has edited is 0, so the name in the repository wins.
    updatedAt: board.updatedAt?.getTime() ?? 0,
  };
}

/** One board's cards as the file stores them. Deleted cards travel too; the board filters them. */
function cardsOf(boardId: string): BoardStateCard[] {
  const columnById = new Map(boardColumnsOf(boardId).map((c) => [c.id, c.name]));
  const firstColumn = boardColumnsOf(boardId)[0]?.name ?? "Todo";
  const milestoneName = new Map(boardMilestonesOf(boardId).map((m) => [m.id, m.name]));
  const rows = db.select().from(tasks).where(eq(tasks.boardId, boardId)).all();
  const links = linksFor(rows.map((t) => t.id));
  return rows.map((t) => ({
    id: t.id,
    number: t.cardNumber,
    column: columnById.get(t.columnId) ?? firstColumn,
    position: t.position,
    title: t.title,
    description: t.description,
    assignee: t.assignee,
    dueDate: t.dueDate?.getTime() ?? null,
    checklist: t.checklist ?? [],
    labels: links.labels.get(t.id) ?? [],
    branches: links.branches.get(t.id) ?? [],
    pullRequests: links.pullRequests.get(t.id) ?? [],
    issues: links.issues.get(t.id) ?? [],
    priority: t.priority ?? 0,
    milestone: t.milestoneId ? (milestoneName.get(t.milestoneId) ?? null) : null,
    markdownTaskId: t.markdownTaskId,
    updatedAt: t.updatedAt.getTime(),
    deletedAt: t.deletedAt?.getTime() ?? null,
  }));
}

const milestonesOfState = (boardId: string) =>
  boardMilestonesOf(boardId).map((m) => ({
    name: m.name,
    description: m.description,
    dueDate: m.dueDate?.getTime() ?? null,
  }));

/**
 * The whole project as `.repoboard/board.json`: the main board at the top
 * level (as the file always had it), every other board — archived ones too,
 * so archiving travels — under `boards`.
 */
function localBoardState(): BoardState {
  const repository = activeRepository();
  if (!repository) return { version: 1, columns: [], cards: [] };
  const mainId = primaryBoardId(repository.id);
  const all = db.select().from(boards).where(eq(boards.repositoryId, repository.id)).all();
  const main = all.find((b) => b.id === mainId);
  return {
    version: 1,
    columns: boardColumnsOf(mainId).map((c) => c.name),
    milestones: milestonesOfState(mainId),
    cards: cardsOf(mainId),
    ...(main ? { board: metaOf(main) } : {}),
    boards: all
      .filter((b) => b.id !== mainId)
      .sort((a, b) => a.position - b.position)
      .map((b) => ({
        id: b.id,
        ...metaOf(b),
        position: b.position,
        archivedAt: b.archivedAt?.getTime() ?? null,
        columns: boardColumnsOf(b.id).map((c) => c.name),
        milestones: milestonesOfState(b.id),
        cards: cardsOf(b.id),
      })),
  };
}

function writeCards(boardId: string, cards: BoardStateCard[]): void {
  const cols = boardColumnsOf(boardId);
  const columnByName = new Map(cols.map((c) => [c.name, c.id]));
  const milestoneByName = new Map(boardMilestonesOf(boardId).map((m) => [m.name, m.id]));

  // A remote board file must never move a card that lives on another board.
  for (const card of cards) {
    const existing = db.select({ boardId: tasks.boardId }).from(tasks).where(eq(tasks.id, card.id)).get();
    if (existing && existing.boardId !== boardId) {
      throw new Error("A card from another board has the same ID");
    }
  }

  for (const card of cards) {
    const columnId = columnByName.get(card.column) ?? cols[0]?.id;
    if (!columnId) continue;

    const existing = db.select().from(tasks).where(eq(tasks.id, card.id)).get();
    const values = {
      boardId,
      columnId,
      position: card.position,
      title: card.title,
      description: card.description,
      assignee: card.assignee,
      dueDate: card.dueDate ? new Date(card.dueDate) : null,
      checklist: card.checklist,
      markdownTaskId: card.markdownTaskId,
      cardNumber: card.number,
      priority: card.priority ?? 0,
      milestoneId: card.milestone ? (milestoneByName.get(card.milestone) ?? null) : null,
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

/** Milestones and columns travel by name; create the ones this machine has not seen. */
function ensureNamed(repositoryId: string, boardId: string, columnNames: string[], ms: BoardStateMilestone[] = []): void {
  const cols = boardColumnsOf(boardId);
  const haveColumns = new Set(cols.map((c) => c.name));
  columnNames.forEach((name, index) => {
    if (haveColumns.has(name)) return;
    db.insert(columns).values({ id: `col_${boardId}_${randomUUID().slice(0, 8)}`, boardId, name, position: cols.length + index }).run();
  });
  const haveMilestones = new Set(boardMilestonesOf(boardId).map((m) => m.name));
  for (const m of ms) {
    if (haveMilestones.has(m.name)) continue;
    createMilestone({ boardId, repositoryId, name: m.name, description: m.description, dueDate: m.dueDate });
  }
}

/** Make this machine match a merged board file — all of it, or nothing. */
function applyBoardFile(repositoryId: string, state: BoardState): void {
  db.transaction(() => applyBoardFileNow(repositoryId, state));
}

function applyBoardFileNow(repositoryId: string, state: BoardState): void {
  const mainId = primaryBoardId(repositoryId);
  const main = db.select().from(boards).where(eq(boards.id, mainId)).get();
  const sameMeta = (a: BoardStateMeta, b: BoardStateMeta) =>
    a.name === b.name && a.description === b.description && a.color === b.color && a.art === b.art && a.owner === b.owner;
  if (main && state.board && state.board.updatedAt >= metaOf(main).updatedAt && !sameMeta(state.board, metaOf(main))) {
    const { name, description, color, art, owner, updatedAt } = state.board;
    db.update(boards).set({ name, description, color, art, owner, updatedAt: new Date(updatedAt) }).where(eq(boards.id, mainId)).run();
  }
  ensureNamed(repositoryId, mainId, [], state.milestones);
  writeCards(mainId, state.cards);

  for (const incoming of state.boards ?? []) {
    // The main board is the top level of the file; a "board" with its id is not.
    if (incoming.id === mainId) continue;
    const row = db.select().from(boards).where(eq(boards.id, incoming.id)).get();
    if (row && row.repositoryId !== repositoryId) throw new Error("A board from another project has the same ID");
    const meta = {
      name: incoming.name,
      description: incoming.description,
      color: incoming.color,
      art: incoming.art,
      owner: incoming.owner,
      position: incoming.position,
      updatedAt: new Date(incoming.updatedAt),
      archivedAt: incoming.archivedAt ? new Date(incoming.archivedAt) : null,
    };
    if (!row) {
      db.insert(boards).values({ id: incoming.id, repositoryId, createdAt: new Date(incoming.updatedAt), ...meta }).run();
      const names = incoming.columns.length ? incoming.columns : DEFAULT_COLUMN_HEADINGS;
      names.forEach((name, index) => {
        db.insert(columns).values({ id: `col_${incoming.id}_${index}`, boardId: incoming.id, name, position: index }).run();
      });
    } else if (
      incoming.updatedAt >= metaOf(row).updatedAt &&
      (!sameMeta(incoming, metaOf(row)) || (incoming.archivedAt ?? null) !== (row.archivedAt?.getTime() ?? null))
    ) {
      db.update(boards).set(meta).where(eq(boards.id, row.id)).run();
    }
    ensureNamed(repositoryId, incoming.id, incoming.columns, incoming.milestones);
    writeCards(incoming.id, incoming.cards);
  }
  renumberDuplicates(repositoryId);
}

/**
 * The repository's board.json. Missing is fine — the first push creates it.
 * Present but unreadable (a merge conflict left in it, a newer format) is not:
 * saving over it would throw away everything only the file has, so both
 * directions refuse until someone fixes it.
 */
async function readBoardFile(
  gh: Awaited<ReturnType<ClientFactory>>,
  ref?: string,
): Promise<{ state: BoardState | null; sha: string | null }> {
  let file: { content: string; sha: string };
  try {
    file = await gh.getFile(BOARD_STATE_PATH, ref);
  } catch (error) {
    if ((error as { status?: number }).status === 404 || /not found|is not a file/i.test((error as Error).message)) {
      return { state: null, sha: null };
    }
    throw error;
  }
  const state = parseBoardState(file.content);
  if (!state) {
    throw new Error(
      `${BOARD_STATE_PATH} on GitHub could not be read (a merge conflict or a newer format?). Fix or remove it there; nothing was changed.`,
    );
  }
  return { state, sha: file.sha };
}

/**
 * Two machines can give different cards the same RB number before they
 * sync. The older card keeps it; the newer one gets the next free number,
 * and a new updatedAt so the change travels back.
 */
function renumberDuplicates(repositoryId: string): void {
  const ids = db.select({ id: boards.id }).from(boards).where(eq(boards.repositoryId, repositoryId)).all().map((b) => b.id);
  if (ids.length === 0) return;
  const rows = db
    .select({ id: tasks.id, number: tasks.cardNumber, createdAt: tasks.createdAt, boardId: tasks.boardId, title: tasks.title })
    .from(tasks)
    .where(inArray(tasks.boardId, ids))
    .all()
    .filter((r) => r.number != null)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
  const seen = new Set<number>();
  for (const row of rows) {
    if (!seen.has(row.number!)) {
      seen.add(row.number!);
      continue;
    }
    const next = nextCardNumber(row.boardId);
    db.update(tasks).set({ cardNumber: next, updatedAt: now() }).where(eq(tasks.id, row.id)).run();
    seen.add(next);
    logActivity({
      repositoryId,
      taskId: row.id,
      type: "card_renumbered",
      message: `renumbered ${row.title} from RB-${row.number} to RB-${next}: another card already had that number`,
    });
  }
}

export interface BoardStateStatus {
  tracked: boolean;
  changes: string[];
  sha: string | null;
  /** Kept in step on their own, through SYNC_BRANCH. */
  autoSync: boolean;
  syncedAt: number | null;
}

/**
 * Where the boards travel when they sync on their own: a branch of their
 * own, so the code's history stays the code's. Cut from the default branch
 * the first time, so it starts with whatever board.json was saved there.
 */
export const SYNC_BRANCH = "repoboard";

export function syncSettings(): { autoSync: boolean; syncedAt: number | null } {
  const repository = activeRepository();
  if (!repository) return { autoSync: false, syncedAt: null };
  const row = db
    .select({ autoSync: repositories.autoSync, syncedAt: repositories.syncedAt })
    .from(repositories)
    .where(eq(repositories.id, repository.id))
    .get();
  return { autoSync: Boolean(row?.autoSync), syncedAt: row?.syncedAt?.getTime() ?? null };
}

export function setAutoSync(on: boolean): void {
  const repository = activeRepository();
  if (!repository) throw new Error("Not connected");
  db.update(repositories).set({ autoSync: on }).where(eq(repositories.id, repository.id)).run();
  logActivity({
    repositoryId: repository.id,
    type: "sync_settings",
    message: on ? `turned on automatic sync of the boards (branch ${SYNC_BRANCH})` : "turned off automatic sync of the boards",
  });
}

/** What pushing the boards would change in the repository, in words. */
export async function boardStateStatus(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<BoardStateStatus> {
  const settings = syncSettings();
  const gh = await clientFactory();
  // Before the sync branch exists, what it would start from is the default branch's file.
  const { state, sha } = settings.autoSync
    ? await readBoardFile(gh, SYNC_BRANCH).catch(() => readBoardFile(gh))
    : await readBoardFile(gh);
  return { tracked: sha !== null, sha, changes: describeFileChanges(localBoardState(), state), ...settings };
}

/**
 * Both ways at once, on its own: what others changed comes in, what this
 * computer changed goes out — merged per card and per board, as a pull and
 * a push are. Writes only board.json on SYNC_BRANCH, with the SHA it read,
 * and tries again once if another computer wrote in between.
 */
export async function syncBoards(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ pulled: number; pushed: number; syncedAt: number }> {
  const repository = activeRepository();
  if (!repository) throw new Error("Not connected");
  if (!syncSettings().autoSync) throw new Error("Automatic sync is off for this project");
  const gh = await clientFactory();
  if (!gh.ensureBranch) throw new Error("This GitHub client cannot make branches");
  await gh.ensureBranch(SYNC_BRANCH);

  let pulled = 0;
  let pushed = 0;
  for (let attempt = 0; ; attempt += 1) {
    const { state: remote, sha } = await readBoardFile(gh, SYNC_BRANCH);
    if (remote) {
      const merged = mergeBoardFile(localBoardState(), remote);
      applyBoardFile(repository.id, merged.state);
      const arrived = merged.added + merged.updated + merged.newBoards.length;
      if (arrived) {
        pulled += arrived;
        logActivity({
          repositoryId: repository.id,
          type: "board_pulled",
          message: `synced the boards from GitHub: ${merged.added} new, ${merged.updated} updated${
            merged.newBoards.length ? `, new board${merged.newBoards.length === 1 ? "" : "s"} ${merged.newBoards.join(", ")}` : ""
          }`,
        });
      }
    }
    const changes = describeFileChanges(localBoardState(), remote);
    if (changes.length === 0) break;
    try {
      await gh.putFile({
        path: BOARD_STATE_PATH,
        content: serialiseBoardState(localBoardState()),
        expectedSha: sha ?? undefined,
        branch: SYNC_BRANCH,
        message: `RepoBoard: sync boards (${changes.length} change${changes.length === 1 ? "" : "s"})`,
      });
      pushed = changes.length;
      break;
    } catch (error) {
      const status = (error as { status?: number }).status;
      // Someone else wrote first: read theirs, merge, try once more.
      if (attempt === 0 && (status === 409 || status === 422)) continue;
      throw error;
    }
  }
  const syncedAt = Date.now();
  db.update(repositories).set({ syncedAt: new Date(syncedAt) }).where(eq(repositories.id, repository.id)).run();
  return { pulled, pushed, syncedAt };
}

/** Repository → this machine, every board. Newer edits win per card and per board. */
export async function pullBoardState(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ added: number; updated: number } | null> {
  const repository = activeRepository();
  if (!repository) return null;
  const { state: remote } = await readBoardFile(await clientFactory());
  if (!remote) return null;

  const merged = mergeBoardFile(localBoardState(), remote);
  applyBoardFile(repository.id, merged.state);

  if (merged.added || merged.updated || merged.newBoards.length) {
    logActivity({
      repositoryId: repository.id,
      type: "board_pulled",
      message: `pulled the boards from GitHub: ${merged.added} new, ${merged.updated} updated${
        merged.newBoards.length ? `, new board${merged.newBoards.length === 1 ? "" : "s"} ${merged.newBoards.join(", ")}` : ""
      }`,
    });
  }
  return { added: merged.added, updated: merged.updated };
}

/** This machine → repository, merging first so a colleague's newer edit survives. */
export async function pushBoardState(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ commitSha: string; changes: string[] }> {
  const repository = activeRepository();
  if (!repository) throw new Error("Not connected");

  const gh = await clientFactory();
  const { state: remote, sha } = await readBoardFile(gh);
  const local = localBoardState();
  const changes = describeFileChanges(local, remote);
  if (changes.length === 0) return { commitSha: "", changes: [] };

  const merged = mergeBoardFile(local, remote);
  applyBoardFile(repository.id, merged.state);

  const written = await gh.putFile({
    path: BOARD_STATE_PATH,
    // What this machine now has — merged, and with duplicate numbers resolved.
    content: serialiseBoardState(localBoardState()),
    expectedSha: sha ?? undefined,
    message: `RepoBoard: update boards (${changes.length} change${changes.length === 1 ? "" : "s"})`,
  });

  logActivity({
    repositoryId: repository.id,
    type: "board_pushed",
    message: `saved the boards to the repository: ${changes.slice(0, 3).join("; ")}${changes.length > 3 ? "…" : ""}`,
  });

  return { commitSha: written.commitSha, changes };
}

/* ------------------------------------------------------------ milestones -- */

export function createMilestone(args: {
  boardId: string;
  repositoryId: string;
  name: string;
  description?: string | null;
  dueDate?: number | null;
}): string {
  const id = randomUUID();
  const count = db
    .select({ n: sql<number>`count(*)` })
    .from(milestones)
    .where(eq(milestones.boardId, args.boardId))
    .get();
  db.insert(milestones)
    .values({
      id,
      boardId: args.boardId,
      name: args.name,
      description: args.description ?? null,
      dueDate: args.dueDate ? new Date(args.dueDate) : null,
      position: count?.n ?? 0,
      createdAt: now(),
    })
    .run();
  logActivity({
    repositoryId: args.repositoryId,
    type: "milestone_created",
    message: `created milestone ${args.name}`,
  });
  return id;
}

export function updateMilestone(
  id: string,
  patch: { name?: string; description?: string | null; dueDate?: number | null },
): void {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.dueDate !== undefined) values.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
  if (Object.keys(values).length === 0) return;
  db.update(milestones).set(values).where(eq(milestones.id, id)).run();
}

/** Cards keep existing; they just stop pointing at the milestone. */
export function deleteMilestone(id: string): void {
  db.update(tasks).set({ milestoneId: null, updatedAt: now() }).where(eq(tasks.milestoneId, id)).run();
  db.delete(milestones).where(eq(milestones.id, id)).run();
}

/** The project's history, newest first; `taskId` narrows it to one card. */
export function getActivity(limit = 50, taskId?: string | null) {
  const repositoryId = configuredRepositoryId();
  if (!repositoryId) return [];
  return db
    .select()
    .from(activityEvents)
    .where(
      taskId
        ? and(eq(activityEvents.repositoryId, repositoryId), eq(activityEvents.taskId, taskId))
        : eq(activityEvents.repositoryId, repositoryId),
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit)
    .all()
    .map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      taskId: e.taskId,
      actor: e.actor,
      actorKind: e.actorKind,
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
  // A link is part of the card: its updatedAt moves, so board.json carries it.
  db.update(tasks).set({ updatedAt: now() }).where(eq(tasks.id, args.taskId)).run();
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
      message: `linked branch ${args.branch}`,
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
      message: `linked pull request #${args.pullRequest}`,
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
      message: `linked issue #${args.issue}`,
    });
  }
}

export function unlinkTask(args: {
  taskId: string;
  branch?: string;
  pullRequest?: number;
  issue?: number;
}) {
  db.update(tasks).set({ updatedAt: now() }).where(eq(tasks.id, args.taskId)).run();
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

const repositoryIdOf = (slug: string) => {
  const [owner, name] = slug.split("/");
  return `repo_${owner}_${name}`.toLowerCase();
};

/** Each project's cover, as chosen (null: picked from the name). Not board data — shown even when a key fails. */
export function projectLooks(repos: string[]): Map<string, { art: string | null; hue: number | null }> {
  const result = new Map<string, { art: string | null; hue: number | null }>();
  for (const slug of repos) {
    const row = db
      .select({ art: repositories.art, hue: repositories.hue })
      .from(repositories)
      .where(eq(repositories.id, repositoryIdOf(slug)))
      .get();
    if (row) result.set(slug.toLowerCase(), { art: row.art ?? null, hue: row.hue ?? null });
  }
  return result;
}

export function setProjectLook(slug: string, look: { art: string | null; hue: number | null }): void {
  const updated = db
    .update(repositories)
    .set({ art: look.art, hue: look.hue })
    .where(eq(repositories.id, repositoryIdOf(slug)))
    .run();
  if (updated.changes === 0) throw new Error(`${slug} has no board on this computer yet`);
}

/** Card counts per connected repository (every board of it), for the project switcher. */
export function projectSummaries(
  repos: string[],
): Map<string, { open: number; done: number; lastSyncAt: number | null }> {
  const result = new Map<string, { open: number; done: number; lastSyncAt: number | null }>();
  for (const slug of repos) {
    const repositoryId = repositoryIdOf(slug);
    const repository = db.select().from(repositories).where(eq(repositories.id, repositoryId)).get();
    if (!repository) continue;
    const boardIds = db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.repositoryId, repositoryId))
      .all()
      .map((b) => b.id);
    if (!boardIds.length) continue;
    const doneColumns = new Set(
      db
        .select({ id: columns.id })
        .from(columns)
        .where(and(inArray(columns.boardId, boardIds), eq(columns.name, DONE_HEADING)))
        .all()
        .map((c) => c.id),
    );
    const rows = db
      .select({ columnId: tasks.columnId })
      .from(tasks)
      .where(and(inArray(tasks.boardId, boardIds), isNull(tasks.deletedAt)))
      .all();
    const doneCount = rows.filter((r) => doneColumns.has(r.columnId)).length;
    result.set(slug.toLowerCase(), {
      open: rows.length - doneCount,
      done: doneCount,
      lastSyncAt: repository.lastSyncAt?.getTime() ?? null,
    });
  }
  return result;
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
    message: `connected ${summary.owner}/${summary.name}`,
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
