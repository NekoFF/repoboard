import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Heading, List, ListItem, Root, RootContent } from "mdast";
import { parseTaskLine } from "@/lib/markdown/parser";
import { parseItemMeta, STATE_CHAR, type ItemState } from "@/lib/markdown/format";
import type { DocSnapshot } from "@/db/schema";

/**
 * A markdown file read as a checklist: every `- [ ]` anywhere in the file is an
 * item, grouped under the nearest heading above it.
 *
 * The board parser (parser.ts) only cares about top-level headings that name
 * columns. A policy document or a release checklist is shaped differently —
 * nested headings, nested lists, prose in between — and every checkbox in it
 * matters, so this reads all of them.
 */

export interface DocItem {
  /** 0-based line in the file. */
  line: number;
  /** The item's text as written (minus the rb: marker) — what edits match on. */
  text: string;
  /** The text with metadata tokens (!high, @name, due:, #tag) taken out. */
  title: string;
  state: ItemState;
  done: boolean;
  priority: number;
  due: string | null;
  owners: string[];
  tags: string[];
  cards: number[];
  links: string[];
  /** Stable `rb:` id when the line carries one. */
  id: string | null;
  /** Nesting level inside lists, 0 for a top-level item. */
  indent: number;
  /** Index into `sections`. */
  section: number;
}

export interface DocSection {
  heading: string;
  /** 0 for the implicit section before the first heading. */
  depth: number;
  line: number;
  /** Open plus done; cancelled items do not count towards progress. */
  total: number;
  done: number;
  doing: number;
  cancelled: number;
}

export interface ParsedDocument {
  title: string;
  sections: DocSection[];
  items: DocItem[];
  total: number;
  done: number;
  doing: number;
  cancelled: number;
}

function count(target: { total: number; done: number; doing: number; cancelled: number }, state: ItemState) {
  if (state === "cancelled") {
    target.cancelled += 1;
    return;
  }
  target.total += 1;
  if (state === "done") target.done += 1;
  if (state === "doing") target.doing += 1;
}

const QUOTE_PREFIX = /^(\s*>\s?)+/;

function headingText(node: Heading, lines: string[]): string {
  const line = lines[(node.position?.start.line ?? 1) - 1] ?? "";
  return line.replace(/^#+\s*/, "").replace(/\s+#+\s*$/, "").trim();
}

export function parseDocument(content: string, fallbackTitle = "Untitled"): ParsedDocument {
  const lines = content.split("\n");
  const tree = unified().use(remarkParse).use(remarkGfm).parse(content) as Root;

  const sections: DocSection[] = [
    { heading: "", depth: 0, line: 0, total: 0, done: 0, doing: 0, cancelled: 0 },
  ];
  const items: DocItem[] = [];
  let title: string | null = null;

  const visitList = (list: List, indent: number) => {
    for (const item of list.children as ListItem[]) {
      const line = (item.position?.start.line ?? 1) - 1;
      // Items inside a blockquote carry the "> " prefix on their line.
      const parsed = parseTaskLine((lines[line] ?? "").replace(QUOTE_PREFIX, ""));
      if (parsed) {
        const section = sections.length - 1;
        const meta = parseItemMeta(parsed.title);
        items.push({
          line,
          text: parsed.title,
          title: meta.title || parsed.title,
          state: parsed.state,
          done: parsed.state === "done",
          priority: meta.priority,
          due: meta.due,
          owners: meta.owners,
          tags: meta.tags,
          cards: meta.cards,
          links: meta.links,
          id: parsed.id,
          indent,
          section,
        });
        count(sections[section], parsed.state);
      }
      for (const child of item.children) {
        if (child.type === "list") visitList(child as List, indent + 1);
      }
    }
  };

  const visit = (node: RootContent) => {
    if (node.type === "heading") {
      const heading = node as Heading;
      const text = headingText(heading, lines);
      if (heading.depth === 1 && title === null) title = text;
      sections.push({
        heading: text,
        depth: heading.depth,
        line: (heading.position?.start.line ?? 1) - 1,
        total: 0,
        done: 0,
        doing: 0,
        cancelled: 0,
      });
    } else if (node.type === "list") {
      visitList(node as List, 0);
    } else if (node.type === "blockquote") {
      for (const child of node.children) visit(child);
    }
  };

  for (const node of tree.children) visit(node);

  const totals = { total: 0, done: 0, doing: 0, cancelled: 0 };
  for (const item of items) count(totals, item.state);
  return { title: title ?? fallbackTitle, sections, items, ...totals };
}

export function toSnapshot(parsed: ParsedDocument): DocSnapshot {
  return {
    title: parsed.title,
    total: parsed.total,
    done: parsed.done,
    doing: parsed.doing,
    cancelled: parsed.cancelled,
    sections: parsed.sections.map((s) => ({
      heading: s.heading,
      depth: s.depth,
      total: s.total,
      done: s.done,
      doing: s.doing,
    })),
    items: parsed.items.map((i) => ({
      title: i.title,
      text: i.text,
      state: i.state,
      done: i.done,
      section: i.section,
      line: i.line,
      priority: i.priority,
      due: i.due,
      owners: i.owners,
    })),
  };
}

/* ---------------------------------------------------------------- edits -- */

/**
 * Edits are described by what the person saw, not by raw offsets, so they can
 * be re-applied to a newer copy of the file: if someone pushed in the
 * meantime, the tick still lands on the right item.
 */
export type DocEdit =
  /** `title` is the item's text as written (DocItem.text). */
  | { type: "state"; line: number; title: string; id?: string | null; state: ItemState }
  | { type: "toggle"; line: number; title: string; id?: string | null; done: boolean }
  | { type: "add"; section: string | null; title: string }
  | { type: "replace"; content: string };

function findItem(parsed: ParsedDocument, edit: { line: number; title: string; id?: string | null }) {
  if (edit.id) {
    const byId = parsed.items.find((i) => i.id === edit.id);
    if (byId) return byId;
  }
  const atLine = parsed.items.find((i) => i.line === edit.line);
  if (atLine && atLine.text === edit.title) return atLine;
  // The file moved under us: fall back to the same text, nearest to the old line.
  const candidates = parsed.items.filter((i) => i.text === edit.title);
  candidates.sort((a, b) => Math.abs(a.line - edit.line) - Math.abs(b.line - edit.line));
  return candidates[0] ?? null;
}

function setState(raw: string, state: ItemState): string {
  return raw.replace(/^((?:\s*>\s?)*\s*[-*+]\s+)\[( |x|X|\/|-)\]/, `$1[${STATE_CHAR[state]}]`);
}

export interface EditResult {
  content: string;
  applied: number;
  /** Edits that no longer matched anything in the file. */
  missed: string[];
  summary: string;
}

export function applyDocEdits(content: string, edits: DocEdit[]): EditResult {
  const replace = edits.find((e) => e.type === "replace");
  if (replace && replace.type === "replace") {
    return {
      content: replace.content,
      applied: replace.content === content ? 0 : 1,
      missed: [],
      summary: "Edit",
    };
  }

  let lines = content.split("\n");
  let applied = 0;
  const missed: string[] = [];
  const changed: Record<ItemState, number> = { todo: 0, doing: 0, done: 0, cancelled: 0 };
  let added = 0;

  for (const edit of edits) {
    const parsed = parseDocument(lines.join("\n"));
    if (edit.type === "toggle" || edit.type === "state") {
      const target: ItemState =
        edit.type === "state" ? edit.state : edit.done ? "done" : "todo";
      const item = findItem(parsed, edit);
      if (!item) {
        missed.push(edit.title);
        continue;
      }
      if (item.state === target) continue;
      lines[item.line] = setState(lines[item.line], target);
      applied += 1;
      changed[target] += 1;
    } else if (edit.type === "add") {
      const text = edit.title.trim().replace(/\s+/g, " ");
      if (!text) continue;
      const index = edit.section
        ? parsed.sections.findIndex((s) => s.heading === edit.section)
        : -1;
      const item = `- [ ] ${text}`;
      if (index > 0) {
        const section = parsed.sections[index];
        const nextHeading = parsed.sections[index + 1];
        const end = nextHeading ? nextHeading.line - 1 : lines.length - 1;
        // Only the section's own items: a new item under "Security" must not
        // land inside its "SBOM" subsection.
        const lastItem = [...parsed.items].reverse().find((i) => i.section === index);
        if (lastItem) {
          // After the last item and any indented lines that belong to it.
          let at = lastItem.line + 1;
          while (at <= end && /^\s+\S/.test(lines[at] ?? "")) at += 1;
          lines.splice(at, 0, item);
        } else {
          lines.splice(section.line + 1, 0, "", item);
        }
      } else {
        const hadTrailing = lines[lines.length - 1] === "";
        let end = lines.length;
        while (end > 0 && lines[end - 1].trim() === "") end -= 1;
        const block = parseTaskLine(lines[end - 1] ?? "") ? [item] : ["", item];
        lines = [...lines.slice(0, end), ...block, ...(hadTrailing ? [""] : [])];
      }
      applied += 1;
      added += 1;
    }
  }

  const next = lines.join("\n");

  const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (changed.done) parts.push(`tick ${plural(changed.done)}`);
  if (changed.doing) parts.push(`start ${plural(changed.doing)}`);
  if (changed.todo) parts.push(`reopen ${plural(changed.todo)}`);
  if (changed.cancelled) parts.push(`cancel ${plural(changed.cancelled)}`);
  if (added) parts.push(`add ${plural(added)}`);

  return {
    content: next,
    applied,
    missed,
    summary: parts.length ? capitalise(parts.join(", ")) : "No change",
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
