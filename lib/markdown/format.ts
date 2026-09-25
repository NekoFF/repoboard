/**
 * RepoBoard Markdown — the small set of conventions that turn an ordinary
 * markdown file into something a board can read, without making it any less
 * readable on github.com or in Obsidian. The full description, for people, is
 * in docs/FORMAT.md; keep the two in step.
 *
 *   - [ ] todo          - [/] in progress
 *   - [x] done          - [-] cancelled / won't do
 *
 * Inline, anywhere on the item's line:
 *
 *   !urgent !high !medium !low     priority
 *   @name                          owner
 *   due:2026-10-01                 due date
 *   #privacy #release/1.2          tags
 *   RB-12                          reference to a board card
 *   [[docs/PRIVACY.md]]            link to another document
 *   <!-- rb:task_x -->             stable identity (added by RepoBoard)
 *
 * The state characters match the Obsidian Tasks convention. GitHub only draws
 * `[ ]` and `[x]` as checkboxes; the other two still read naturally as text.
 */

export type ItemState = "todo" | "doing" | "done" | "cancelled";

export const STATE_CHAR: Record<ItemState, string> = {
  todo: " ",
  doing: "/",
  done: "x",
  cancelled: "-",
};

export function stateFromChar(char: string): ItemState {
  if (char === "x" || char === "X") return "done";
  if (char === "/") return "doing";
  if (char === "-") return "cancelled";
  return "todo";
}

/** 0 none · 1 urgent · 2 high · 3 medium · 4 low — the same scale as cards. */
export const PRIORITY_WORDS: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export const PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"] as const;

export interface ItemMeta {
  /** The item's text with the metadata tokens taken out. */
  title: string;
  priority: number;
  /** ISO date, YYYY-MM-DD. */
  due: string | null;
  owners: string[];
  tags: string[];
  cards: number[];
  links: string[];
}

const PRIORITY_TOKEN = /(^|\s)!(urgent|high|medium|low)\b/gi;
const DUE_TOKEN = /(^|\s)due:(\d{4}-\d{2}-\d{2})\b/gi;
// @name but not an e-mail address: must start the text or follow whitespace.
const OWNER_TOKEN = /(^|\s)@([A-Za-z0-9][\w.-]*[A-Za-z0-9_]|[A-Za-z0-9])/g;
// #tag must start with a letter, so "#42" stays an issue reference.
// Dots are allowed inside ("#release/1.2") but not at the end of a sentence.
const TAG_TOKEN = /(^|\s)#([A-Za-z](?:[\w/.-]*[\w/-])?)/g;
const CARD_TOKEN = /\bRB-(\d{1,6})\b/gi;
const LINK_TOKEN = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

export function parseItemMeta(text: string): ItemMeta {
  const owners: string[] = [];
  const tags: string[] = [];
  const cards: number[] = [];
  const links: string[] = [];
  let priority = 0;
  let due: string | null = null;

  let title = text
    .replace(PRIORITY_TOKEN, (_m, lead: string, word: string) => {
      if (!priority) priority = PRIORITY_WORDS[word.toLowerCase()];
      return lead;
    })
    .replace(DUE_TOKEN, (_m, lead: string, date: string) => {
      if (!due) due = date;
      return lead;
    })
    .replace(OWNER_TOKEN, (_m, lead: string, name: string) => {
      if (!owners.includes(name)) owners.push(name);
      return lead;
    })
    .replace(TAG_TOKEN, (_m, lead: string, tag: string) => {
      if (!tags.includes(tag)) tags.push(tag);
      return lead;
    });

  for (const match of title.matchAll(CARD_TOKEN)) {
    const n = Number(match[1]);
    if (!cards.includes(n)) cards.push(n);
  }
  for (const match of title.matchAll(LINK_TOKEN)) {
    const target = match[1].trim();
    if (!links.includes(target)) links.push(target);
  }

  title = title.replace(/\s{2,}/g, " ").trim();
  return { title, priority, due, owners, tags, cards, links };
}
