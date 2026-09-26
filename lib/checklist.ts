/**
 * A card's checklist is a tree: "1. Home screen" can hold "1.1 Bookmarks",
 * which can hold its own steps. Every item can carry notes (what to do, how
 * to check it, what to keep in mind — often written by an AI), an owner, a
 * due date and a comment thread.
 *
 * Stored as JSON on the card, so older flat checklists ({ id, text, done })
 * are simply trees without children. Pure functions only, so it is tested
 * without a database.
 */

export interface ChecklistComment {
  id: string;
  author: string;
  kind: "person" | "agent";
  text: string;
  at: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Markdown: what to do, how to verify it, anything worth knowing. */
  notes?: string | null;
  assignee?: string | null;
  due?: number | null;
  children?: ChecklistItem[];
  comments?: ChecklistComment[];
}

export type Checklist = ChecklistItem[];

export interface Located {
  item: ChecklistItem;
  /** Ancestors from the root down, not including the item. */
  path: ChecklistItem[];
  /** "1.2.3" */
  number: string;
}

/**
 * An id for a new item or comment. crypto.randomUUID exists only in secure
 * contexts (https or localhost); opened over the LAN it is missing.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function locate(items: Checklist, id: string, prefix = "", path: ChecklistItem[] = []): Located | null {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const number = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    if (item.id === id) return { item, path, number };
    const found = locate(item.children ?? [], id, number, [...path, item]);
    if (found) return found;
  }
  return null;
}

/** Returns a new tree with `fn` applied to the item with that id. */
export function updateItem(items: Checklist, id: string, fn: (item: ChecklistItem) => ChecklistItem): Checklist {
  return items.map((item) => {
    if (item.id === id) return fn(item);
    if (item.children?.length) return { ...item, children: updateItem(item.children, id, fn) };
    return item;
  });
}

export function removeItem(items: Checklist, id: string): Checklist {
  return items
    .filter((item) => item.id !== id)
    .map((item) => (item.children?.length ? { ...item, children: removeItem(item.children, id) } : item));
}

/** Adds at the end of the parent's children, or of the top level when parentId is null. */
export function addItem(items: Checklist, parentId: string | null, item: ChecklistItem): Checklist {
  if (!parentId) return [...items, item];
  return updateItem(items, parentId, (parent) => ({ ...parent, children: [...(parent.children ?? []), item] }));
}

/**
 * Ticking an item ticks everything under it; re-opening one re-opens its
 * ancestors, since they cannot be done while part of them is not.
 */
export function setDone(items: Checklist, id: string, done: boolean): Checklist {
  const setAll = (item: ChecklistItem): ChecklistItem => ({
    ...item,
    done,
    children: item.children?.map(setAll),
  });
  let next = updateItem(items, id, (item) => (done ? setAll(item) : { ...item, done: false }));
  if (!done) {
    const found = locate(next, id);
    for (const ancestor of found?.path ?? []) {
      next = updateItem(next, ancestor.id, (a) => ({ ...a, done: false }));
    }
  }
  return next;
}

/** Every item at every depth. */
export function flatten(items: Checklist): ChecklistItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

export function progress(items: Checklist): { done: number; total: number } {
  const all = flatten(items);
  return { done: all.filter((i) => i.done).length, total: all.length };
}

/** Finds an item by its text, case-insensitively, anywhere in the tree (for agents). */
export function findByText(items: Checklist, text: string): ChecklistItem | null {
  const wanted = text.trim().toLowerCase();
  return flatten(items).find((i) => i.text.trim().toLowerCase() === wanted) ?? null;
}

/** Accepts anything that was ever stored as a checklist and returns a clean tree. */
export function normalise(value: unknown): Checklist {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v === "object" && typeof (v as ChecklistItem).text === "string")
    .map((v) => {
      const item = v as ChecklistItem;
      return {
        id: String(item.id ?? Math.random().toString(36).slice(2)),
        text: item.text,
        done: Boolean(item.done),
        notes: item.notes ?? null,
        assignee: item.assignee ?? null,
        due: item.due ?? null,
        children: normalise(item.children),
        comments: Array.isArray(item.comments) ? item.comments : [],
      };
    });
}
