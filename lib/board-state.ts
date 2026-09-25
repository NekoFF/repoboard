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

export interface BoardState {
  version: 1;
  columns: string[];
  cards: BoardStateCard[];
  milestones?: BoardStateMilestone[];
}

export const BOARD_STATE_PATH = ".repoboard/board.json";

export function serialiseBoardState(state: BoardState): string {
  // Stable key order and sorted cards so an unchanged board produces a
  // byte-identical file — otherwise every push would look like a change.
  const cards = [...state.cards].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ ...state, cards }, null, 2)}\n`;
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
