import type { ChecklistItem } from "@/lib/checklist";

/**
 * The board as a file in the repository.
 *
 * Card order, checklists, labels and links used to live only in the local
 * SQLite file, so a colleague who connected the same repository saw the
 * GitHub data and the markdown tasks but none of the planning around them.
 * Keeping that state in `.repoboard/board.json` makes it shared, and keeps
 * permissions where they already are: whoever GitHub lets write to the
 * repository can change the board, and nobody else.
 *
 * Merging is per card and last-write-wins on `updatedAt`, so two people
 * working at once lose at most the older of two edits to the *same* card
 * rather than everything one of them did.
 */

export interface BoardStateCard {
  id: string;
  number: number | null;
  column: string;
  position: number;
  title: string;
  description: string | null;
  assignee: string | null;
  dueDate: number | null;
  checklist: ChecklistItem[];
  labels: string[];
  branches: string[];
  pullRequests: number[];
  issues: number[];
  markdownTaskId: string | null;
  /** Optional so board files written before these existed still parse. */
  priority?: number;
  milestone?: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

export interface BoardStateMilestone {
  name: string;
  description: string | null;
  dueDate: number | null;
}

/** How a board looks and whose it is — everything but its cards. */
export interface BoardStateMeta {
  name: string;
  description: string | null;
  color: string | null;
  art: string | null;
  owner: string | null;
  updatedAt: number;
}

/**
 * A board besides the main one: one per person or per area. Archived boards
 * are kept (with `archivedAt`) so archiving travels like any other edit.
 */
export interface BoardStateBoard extends BoardStateMeta {
  id: string;
  position: number;
  archivedAt: number | null;
  columns: string[];
  milestones?: BoardStateMilestone[];
  cards: BoardStateCard[];
}

/**
 * The top level is the main board, as it always was, so files written before
 * there were several boards still read the same — and a version of RepoBoard
 * that knows only one board still reads this one. The other boards follow in
 * `boards`.
 */
export interface BoardState {
  version: 1;
  columns: string[];
  cards: BoardStateCard[];
  milestones?: BoardStateMilestone[];
  board?: BoardStateMeta;
  boards?: BoardStateBoard[];
}

export const BOARD_STATE_PATH = ".repoboard/board.json";

export function serialiseBoardState(state: BoardState): string {
  // Stable key order and sorted cards so an unchanged board produces a
  // byte-identical file — otherwise every push would look like a change.
  const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  const boards = state.boards?.map((b) => ({ ...b, cards: byId(b.cards) }));
  return `${JSON.stringify({ ...state, cards: byId(state.cards), ...(boards ? { boards: byId(boards) } : {}) }, null, 2)}\n`;
}

export function parseBoardState(content: string): BoardState | null {
  try {
    const parsed = JSON.parse(content) as BoardState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface MergeResult {
  cards: BoardStateCard[];
  added: number;
  updated: number;
  /** Cards where the remote copy was newer and replaced ours. */
  overriddenLocally: string[];
}

/**
 * Merge what the repository says with what this machine says.
 * Neither side is trusted wholesale: each card is decided on its own.
 */
export function mergeBoardState(
  local: BoardStateCard[],
  remote: BoardStateCard[],
): MergeResult {
  const byId = new Map<string, BoardStateCard>();
  for (const card of local) byId.set(card.id, card);

  let added = 0;
  let updated = 0;
  const overriddenLocally: string[] = [];

  for (const incoming of remote) {
    const mine = byId.get(incoming.id);
    if (!mine) {
      byId.set(incoming.id, incoming);
      added += 1;
      continue;
    }
    if (incoming.updatedAt > mine.updatedAt) {
      byId.set(incoming.id, incoming);
      updated += 1;
      overriddenLocally.push(incoming.id);
    }
  }

  return { cards: [...byId.values()], added, updated, overriddenLocally };
}

/** A short, readable description of what pushing would change. */
export function describeChanges(
  local: BoardStateCard[],
  remote: BoardStateCard[],
): string[] {
  const remoteById = new Map(remote.map((c) => [c.id, c]));
  const localById = new Map(local.map((c) => [c.id, c]));
  const lines: string[] = [];

  for (const card of local) {
    const there = remoteById.get(card.id);
    if (!there) {
      if (!card.deletedAt) lines.push(`added: ${card.title}`);
      continue;
    }
    if (card.deletedAt && !there.deletedAt) {
      lines.push(`deleted: ${card.title}`);
    } else if (card.column !== there.column) {
      lines.push(`${card.title}: ${there.column} → ${card.column}`);
    } else if (card.title !== there.title) {
      lines.push(`renamed: ${there.title} → ${card.title}`);
    } else if (JSON.stringify(card) !== JSON.stringify(there)) {
      lines.push(`edited: ${card.title}`);
    }
  }

  for (const card of remote) {
    if (!localById.has(card.id) && !card.deletedAt) {
      lines.push(`only on GitHub: ${card.title}`);
    }
  }

  return lines;
}

/**
 * The newer of two descriptions of the same board, by `updatedAt`. On a tie
 * the repository wins: a board nobody has edited (0) takes the shared name.
 */
function newerMeta<T extends BoardStateMeta>(mine: T, theirs: T): T {
  return theirs.updatedAt >= mine.updatedAt ? theirs : mine;
}

/** Milestones travel by name: everything either side has. */
function unionMilestones(mine: BoardStateMilestone[] = [], theirs: BoardStateMilestone[] = []): BoardStateMilestone[] {
  const names = new Set(mine.map((m) => m.name));
  return [...mine, ...theirs.filter((m) => !names.has(m.name))];
}

export interface FileMergeResult {
  state: BoardState;
  added: number;
  updated: number;
  /** Boards that exist in the repository but were new to this machine. */
  newBoards: string[];
}

/**
 * Merge the whole file: the main board's cards, then every other board — its
 * description by `updatedAt`, its cards one by one as `mergeBoardState` does.
 * A board only one side knows is kept.
 */
export function mergeBoardFile(local: BoardState, remote: BoardState | null): FileMergeResult {
  if (!remote) return { state: local, added: 0, updated: 0, newBoards: [] };
  const main = mergeBoardState(local.cards, remote.cards);
  let added = main.added;
  let updated = main.updated;
  const newBoards: string[] = [];

  const byId = new Map((local.boards ?? []).map((b) => [b.id, b]));
  for (const incoming of remote.boards ?? []) {
    const mine = byId.get(incoming.id);
    if (!mine) {
      byId.set(incoming.id, incoming);
      newBoards.push(incoming.name);
      added += incoming.cards.length;
      continue;
    }
    const cards = mergeBoardState(mine.cards, incoming.cards);
    added += cards.added;
    updated += cards.updated;
    const meta = newerMeta(mine, incoming);
    if (incoming.updatedAt > mine.updatedAt) updated += 1;
    byId.set(mine.id, {
      ...meta,
      columns: meta === incoming ? incoming.columns : mine.columns,
      milestones: unionMilestones(mine.milestones, incoming.milestones),
      cards: cards.cards,
    });
  }

  const board = local.board && remote.board ? newerMeta(local.board, remote.board) : (local.board ?? remote.board);
  if (local.board && remote.board && remote.board.updatedAt > local.board.updatedAt) updated += 1;
  return {
    state: {
      ...local,
      milestones: unionMilestones(local.milestones, remote.milestones),
      cards: main.cards,
      ...(board ? { board } : {}),
      boards: [...byId.values()],
    },
    added,
    updated,
    newBoards,
  };
}

/** What pushing the whole file would change, in words; other boards are named. */
export function describeFileChanges(local: BoardState, remote: BoardState | null): string[] {
  const lines = describeChanges(local.cards, remote?.cards ?? []);
  if (local.board && remote?.board && local.board.updatedAt > remote.board.updatedAt) {
    lines.push(`edited the board ${local.board.name}`);
  }
  const theirs = new Map((remote?.boards ?? []).map((b) => [b.id, b]));
  for (const board of local.boards ?? []) {
    const there = theirs.get(board.id);
    if (!there) {
      if (!board.archivedAt) lines.push(`new board: ${board.name}`);
    } else if (board.archivedAt && !there.archivedAt) {
      lines.push(`archived the board ${board.name}`);
    } else if (board.updatedAt > there.updatedAt) {
      lines.push(there.name !== board.name ? `renamed the board ${there.name} to ${board.name}` : `edited the board ${board.name}`);
    }
    for (const line of describeChanges(board.cards, there?.cards ?? [])) lines.push(`${board.name}: ${line}`);
  }
  for (const board of remote?.boards ?? []) {
    if (!(local.boards ?? []).some((b) => b.id === board.id) && !board.archivedAt) lines.push(`only on GitHub: board ${board.name}`);
  }
  return lines;
}
