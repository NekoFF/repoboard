import type { BoardData, BoardTask } from "@/lib/board-service";
import { PRIORITY_WORDS } from "@/lib/markdown/format";
import { statusOfColumn, type Status } from "@/lib/status";

/**
 * The board filter is one line of text, like a search engine's: plain words
 * match titles, and a few operators narrow things down.
 *
 *   label:bug  @neko  !high  milestone:beta  due:overdue  is:open  is:done
 *
 * Quoting works for values with spaces: milestone:"Public beta".
 * Everything the chips in the UI do round-trips through this text, so what you
 * see in the box is always exactly what is being applied.
 */

export interface BoardFilter {
  text: string[];
  labels: string[];
  assignees: string[];
  priorities: number[];
  milestones: string[];
  statuses: Status[];
  open: boolean | null;
  due: "overdue" | "week" | "none" | "any" | null;
}

export const EMPTY_FILTER: BoardFilter = {
  text: [],
  labels: [],
  assignees: [],
  priorities: [],
  milestones: [],
  statuses: [],
  open: null,
  due: null,
};

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /(\S+?:"[^"]*"|"[^"]*"|\S+)/g;
  for (const match of input.matchAll(pattern)) tokens.push(match[1]);
  return tokens;
}

const unquote = (value: string) => value.replace(/^"(.*)"$/, "$1");

const STATUS_WORDS: Record<string, Status> = {
  todo: "todo",
  doing: "doing",
  progress: "doing",
  "in-progress": "doing",
  review: "review",
  done: "done",
  cancelled: "cancelled",
};

export function parseFilter(input: string): BoardFilter {
  const filter: BoardFilter = {
    ...EMPTY_FILTER,
    text: [],
    labels: [],
    assignees: [],
    priorities: [],
    milestones: [],
    statuses: [],
  };
  for (const token of tokenize(input)) {
    const lower = token.toLowerCase();
    if (lower.startsWith("label:")) filter.labels.push(unquote(token.slice(6)));
    else if (lower.startsWith("assignee:")) filter.assignees.push(unquote(token.slice(9)));
    else if (token.startsWith("@") && token.length > 1) filter.assignees.push(token.slice(1));
    else if (lower.startsWith("milestone:")) filter.milestones.push(unquote(token.slice(10)));
    else if (lower.startsWith("priority:") || (token.startsWith("!") && token.length > 1)) {
      const word = lower.replace(/^priority:|^!/, "");
      const value = word === "none" ? 0 : PRIORITY_WORDS[word];
      if (value !== undefined) filter.priorities.push(value);
      else filter.text.push(token);
    } else if (lower.startsWith("due:")) {
      const value = lower.slice(4);
      if (value === "overdue" || value === "week" || value === "none" || value === "any") filter.due = value;
      else filter.text.push(token);
    } else if (lower === "is:open") filter.open = true;
    else if (lower === "is:closed") filter.open = false;
    else if (lower.startsWith("is:") || lower.startsWith("status:")) {
      const word = lower.replace(/^is:|^status:/, "");
      const status = STATUS_WORDS[word];
      if (status) filter.statuses.push(status);
      else filter.text.push(token);
    } else filter.text.push(unquote(token));
  }
  return filter;
}

const quoteIfNeeded = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

/** Adds `key:value` to the query unless it is already there. */
export function addToken(query: string, token: string): string {
  const tokens = tokenize(query);
  if (tokens.some((t) => t.toLowerCase() === token.toLowerCase())) return query;
  return [...tokens, token].join(" ");
}

export function removeToken(query: string, token: string): string {
  return tokenize(query)
    .filter((t) => t.toLowerCase() !== token.toLowerCase())
    .join(" ");
}

export const token = {
  label: (v: string) => `label:${quoteIfNeeded(v)}`,
  assignee: (v: string) => `@${v}`,
  milestone: (v: string) => `milestone:${quoteIfNeeded(v)}`,
  priority: (p: number) => (p === 0 ? "priority:none" : `!${["", "urgent", "high", "medium", "low"][p]}`),
  status: (s: Status) => `is:${s}`,
  due: (d: "overdue" | "week" | "none") => `due:${d}`,
};

export function isEmptyFilter(filter: BoardFilter): boolean {
  return (
    filter.text.length === 0 &&
    filter.labels.length === 0 &&
    filter.assignees.length === 0 &&
    filter.priorities.length === 0 &&
    filter.milestones.length === 0 &&
    filter.statuses.length === 0 &&
    filter.open === null &&
    filter.due === null
  );
}

export function applyFilter(
  tasks: BoardTask[],
  filter: BoardFilter,
  data: Pick<BoardData, "columns" | "milestones">,
  now = Date.now(),
): BoardTask[] {
  if (isEmptyFilter(filter)) return tasks;
  const columnStatus = new Map(data.columns.map((c) => [c.id, statusOfColumn(c.name)]));
  const milestoneName = new Map(data.milestones.map((m) => [m.id, m.name.toLowerCase()]));
  const today = new Date(now);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const weekEnd = startOfToday + 7 * 86_400_000;
  const lc = (s: string) => s.toLowerCase();

  return tasks.filter((task) => {
    for (const word of filter.text) {
      const w = lc(word);
      const ref = task.number != null ? `rb-${task.number}` : "";
      if (
        !lc(task.title).includes(w) &&
        !(task.description && lc(task.description).includes(w)) &&
        !task.labels.some((l) => lc(l).includes(w)) &&
        !task.branches.some((b) => lc(b).includes(w)) &&
        ref !== w
      ) {
        return false;
      }
    }
    if (filter.labels.length && !filter.labels.some((l) => task.labels.some((t) => lc(t) === lc(l)))) return false;
    if (
      filter.assignees.length &&
      !filter.assignees.some((a) => (a === "none" ? !task.assignee : lc(task.assignee ?? "") === lc(a)))
    ) {
      return false;
    }
    if (filter.priorities.length && !filter.priorities.includes(task.priority)) return false;
    if (filter.milestones.length) {
      const name = task.milestoneId ? milestoneName.get(task.milestoneId) : undefined;
      if (!filter.milestones.some((m) => (m === "none" ? !name : name === lc(m)))) return false;
    }
    const status = columnStatus.get(task.columnId) ?? "todo";
    if (filter.statuses.length && !filter.statuses.includes(status)) return false;
    if (filter.open === true && (status === "done" || status === "cancelled")) return false;
    if (filter.open === false && status !== "done" && status !== "cancelled") return false;
    if (filter.due) {
      const due = task.dueDate;
      if (filter.due === "none" && due != null) return false;
      if (filter.due === "any" && due == null) return false;
      if (filter.due === "overdue" && (due == null || due >= startOfToday || status === "done")) return false;
      if (filter.due === "week" && (due == null || due < startOfToday || due >= weekEnd)) return false;
    }
    return true;
  });
}

const OPERATOR = /^(label|assignee|milestone|priority|due|is|status):|^[@!]\S/i;

/** Splits a query into its operator tokens (shown as chips) and the free text. */
export function splitQuery(query: string): { operators: string[]; text: string } {
  const operators: string[] = [];
  const words: string[] = [];
  for (const t of tokenize(query)) (OPERATOR.test(t) ? operators : words).push(t);
  return { operators, text: words.join(" ") };
}

export function joinQuery(operators: string[], text: string): string {
  return [...operators, text.trim()].filter(Boolean).join(" ");
}

/** A readable label for a chip: "label:bug" → "Label: bug". */
export function describeToken(t: string): { key: string; value: string } {
  if (t.startsWith("@")) return { key: "Assignee", value: t.slice(1) };
  if (t.startsWith("!")) return { key: "Priority", value: t.slice(1) };
  const [key, ...rest] = t.split(":");
  const names: Record<string, string> = {
    label: "Label",
    assignee: "Assignee",
    milestone: "Milestone",
    priority: "Priority",
    due: "Due",
    is: "Status",
    status: "Status",
  };
  return { key: names[key.toLowerCase()] ?? key, value: unquote(rest.join(":")) };
}
