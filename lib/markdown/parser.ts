import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Heading, List, ListItem, Root } from "mdast";
import { lineEnding, stateFromChar, toLF, withLineEnding, type ItemState } from "@/lib/markdown/format";

/**
 * Markdown ↔ board parsing.
 *
 * Parsing uses remark (real AST, so fenced code blocks and nested lists are not
 * mistaken for tasks). Editing is deliberately line-based instead of
 * remark-stringify: stringifying would reformat the user's whole file on every
 * sync, producing enormous diffs for a one-line change.
 */

export const DEFAULT_COLUMN_HEADINGS = [
  "Todo",
  "In Progress",
  "Review",
  "Done",
] as const;

export const DONE_HEADING = "Done";

const TASK_ID_PATTERN = /<!--\s*rb:(task_[A-Za-z0-9_-]+)\s*-->/;
// See format.ts: " " todo, "/" in progress, "?" needs checking, "x" done, "-" cancelled.
const CHECKBOX_LINE = /^(\s*)([-*+])\s+\[( |x|X|\/|-|\?)\]\s+(.*)$/;

export interface ParsedTask {
  /** Stable id from the `<!-- rb:task_x -->` marker, or null when absent. */
  id: string | null;
  title: string;
  done: boolean;
  heading: string;
  /** 0-based index into the file's lines. */
  line: number;
  raw: string;
}

export interface ParsedMarkdown {
  tasks: ParsedTask[];
  headings: { text: string; line: number; depth: number }[];
  lines: string[];
}

export function generateTaskId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const stamp = Date.now().toString(36).slice(-4);
  return `task_${random}${stamp}`;
}

function headingText(node: Heading, lines: string[]): string {
  const line = lines[(node.position?.start.line ?? 1) - 1] ?? "";
  return line.replace(/^#+\s*/, "").trim();
}

/** Splits a checkbox line into its parts, or null when it is not a task. */
export function parseTaskLine(
  raw: string,
): { done: boolean; state: ItemState; title: string; id: string | null } | null {
  const match = raw.match(CHECKBOX_LINE);
  if (!match) return null;
  const [, , , checkChar, rest] = match;
  const idMatch = rest.match(TASK_ID_PATTERN);
  return {
    done: checkChar.toLowerCase() === "x",
    state: stateFromChar(checkChar),
    title: rest.replace(TASK_ID_PATTERN, "").trim(),
    id: idMatch ? idMatch[1] : null,
  };
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const content = toLF(raw);
  const lines = content.split("\n");
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(content) as Root;

  const headings: ParsedMarkdown["headings"] = [];
  const tasks: ParsedTask[] = [];

  // Walk only top-level nodes: headings define sections, lists hold tasks.
  // Nested lists are visited through their parent list item so indentation
  // does not create phantom sections.
  let currentHeading = "";

  const visitList = (list: List) => {
    for (const item of list.children as ListItem[]) {
      const startLine = (item.position?.start.line ?? 1) - 1;
      const raw = lines[startLine] ?? "";
      const parsed = parseTaskLine(raw);
      if (parsed && currentHeading) {
        tasks.push({
          id: parsed.id,
          title: parsed.title,
          done: parsed.done,
          heading: currentHeading,
          line: startLine,
          raw,
        });
      }
      for (const child of item.children) {
        if (child.type === "list") visitList(child as List);
      }
    }
  };

  for (const node of tree.children) {
    if (node.type === "heading") {
      const heading = node as Heading;
      const text = headingText(heading, lines);
      currentHeading = text;
      headings.push({
        text,
        line: (heading.position?.start.line ?? 1) - 1,
        depth: heading.depth,
      });
    } else if (node.type === "list") {
      visitList(node as List);
    }
  }

  return { tasks, headings, lines };
}

/**
 * Adds `<!-- rb:task_x -->` markers to any task that lacks one. GitHub renders
 * HTML comments invisibly, so the file still reads normally on github.com while
 * RepoBoard gains an identity that survives retitling and reordering.
 */
export function ensureTaskIds(raw: string): {
  content: string;
  changed: boolean;
  assigned: { line: number; id: string; title: string }[];
} {
  const eol = lineEnding(raw);
  const result = ensureTaskIdsLF(toLF(raw));
  return { ...result, content: withLineEnding(result.content, eol) };
}

function ensureTaskIdsLF(content: string): {
  content: string;
  changed: boolean;
  assigned: { line: number; id: string; title: string }[];
} {
  const parsed = parseMarkdown(content);
  const lines = [...parsed.lines];
  const assigned: { line: number; id: string; title: string }[] = [];

  for (const task of parsed.tasks) {
    if (task.id) continue;
    const id = generateTaskId();
    lines[task.line] = `${lines[task.line].trimEnd()} <!-- rb:${id} -->`;
    assigned.push({ line: task.line, id, title: task.title });
  }

  return {
    content: assigned.length ? lines.join("\n") : content,
    changed: assigned.length > 0,
    assigned,
  };
}

function sectionBounds(
  parsed: ParsedMarkdown,
  heading: string,
): { headingLine: number; endLine: number } | null {
  const index = parsed.headings.findIndex((h) => h.text === heading);
  if (index === -1) return null;
  const current = parsed.headings[index];
  const next = parsed.headings.find(
    (h, i) => i > index && h.depth <= current.depth,
  );
  return {
    headingLine: current.line,
    endLine: next ? next.line - 1 : parsed.lines.length - 1,
  };
}

function rewriteCheckbox(raw: string, done: boolean): string {
  return raw.replace(CHECKBOX_LINE, (_m, indent, bullet, _check, rest) => {
    return `${indent}${bullet} [${done ? "x" : " "}] ${rest}`;
  });
}

export interface MoveResult {
  content: string;
  changed: boolean;
  /** Human-readable summary used for the GitHub commit message. */
  summary: string;
}

/**
 * Moves a task under a different heading and flips its checkbox to match
 * (Done ⇒ `[x]`, anything else ⇒ `[ ]`). Returns the full new file content;
 * nothing is written to GitHub here.
 */
export function moveTask(
  raw: string,
  taskId: string,
  targetHeading: string,
  doneHeading: string = DONE_HEADING,
): MoveResult {
  const eol = lineEnding(raw);
  const result = moveTaskLF(toLF(raw), taskId, targetHeading, doneHeading);
  return { ...result, content: withLineEnding(result.content, eol) };
}

/** The task's line and everything indented under it: sub-items, details, notes. */
function blockEnd(lines: string[], start: number): number {
  const indent = (lines[start].match(/^\s*/)?.[0] ?? "").length;
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if ((line.match(/^\s*/)?.[0] ?? "").length > indent) end = i;
    else break;
  }
  return end;
}

function moveTaskLF(
  content: string,
  taskId: string,
  targetHeading: string,
  doneHeading: string,
): MoveResult {
  const parsed = parseMarkdown(content);
  const task = parsed.tasks.find((t) => t.id === taskId);
  if (!task) {
    return { content, changed: false, summary: `Task ${taskId} not found` };
  }
  if (task.heading === targetHeading) {
    const desiredDone = targetHeading === doneHeading;
    if (task.done === desiredDone) {
      return { content, changed: false, summary: "No change" };
    }
    const lines = [...parsed.lines];
    lines[task.line] = rewriteCheckbox(lines[task.line], desiredDone);
    return {
      content: lines.join("\n"),
      changed: true,
      summary: `Mark "${task.title}" as ${desiredDone ? "done" : "not done"}`,
    };
  }

  const target = sectionBounds(parsed, targetHeading);
  if (!target) {
    return {
      content,
      changed: false,
      summary: `Heading "${targetHeading}" not found`,
    };
  }

  // The whole item moves — its sub-items, details and notes with it.
  const end = blockEnd(parsed.lines, task.line);
  const block = parsed.lines.slice(task.line, end + 1);
  block[0] = rewriteCheckbox(block[0], targetHeading === doneHeading);

  // Remove first, then recompute the insertion point on the shortened file so
  // the indices cannot drift when moving a task upwards.
  const withoutTask = [...parsed.lines];
  withoutTask.splice(task.line, end - task.line + 1);

  const reparsed = parseMarkdown(withoutTask.join("\n"));
  const targetAfterRemoval = sectionBounds(reparsed, targetHeading);
  if (!targetAfterRemoval) {
    return { content, changed: false, summary: "Target section vanished" };
  }

  // Append after the last non-empty line of the target section so the task
  // lands at the bottom of its new column rather than above trailing blanks.
  let insertAt = targetAfterRemoval.endLine;
  while (
    insertAt > targetAfterRemoval.headingLine &&
    (withoutTask[insertAt] ?? "").trim() === ""
  ) {
    insertAt -= 1;
  }

  withoutTask.splice(insertAt + 1, 0, ...block);

  return {
    content: withoutTask.join("\n"),
    changed: true,
    summary: `Move "${task.title}" to ${targetHeading}`,
  };
}

/** Maps parsed markdown into the board's column structure. */
export function tasksByHeading(
  content: string,
  headings: readonly string[] = DEFAULT_COLUMN_HEADINGS,
): Record<string, ParsedTask[]> {
  const parsed = parseMarkdown(content);
  const result: Record<string, ParsedTask[]> = {};
  for (const heading of headings) result[heading] = [];
  for (const task of parsed.tasks) {
    if (result[task.heading]) result[task.heading].push(task);
  }
  return result;
}
