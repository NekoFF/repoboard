#!/usr/bin/env node
/**
 * RepoBoard MCP server.
 *
 * Lets AI agents read and work the same board and checklists the person sees,
 * so several agents can share one picture of the project without a human
 * relaying it: what is done, what is open, what needs checking.
 *
 * It reads the same SQLite file the app uses (changes to cards show up in the
 * app immediately) and reads documents from GitHub with the stored token.
 *
 * Deliberately not exposed: anything that writes to the repository. Agents
 * edit files in .repoboard/ in their own working copy and push like any other
 * change; RepoBoard never commits on an agent's behalf.
 *
 *   claude mcp add repoboard -- node /path/to/repoboard/scripts/mcp-server.mjs
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Agents start this from their own project folder, so everything is resolved
// from where RepoBoard is installed, never from the current directory.
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME_DIR = path.join(os.homedir(), ".repoboard");

/* ------------------------------------------------------------- database -- */

function databasePath() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.replace(/^file:/, "");
  const legacy = path.join(APP_DIR, "repoboard.db");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(HOME_DIR, "repoboard.db");
}

function credentialsFile() {
  const legacy = path.join(APP_DIR, ".repoboard");
  return path.join(fs.existsSync(legacy) ? legacy : HOME_DIR, "credentials.json");
}

const dbFile = databasePath();
if (!fs.existsSync(dbFile)) {
  console.error(
    `[repoboard-mcp] No board database at ${dbFile}. Start RepoBoard once (npm run dev) and connect a repository first.`,
  );
  process.exit(1);
}

const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 3000");

const now = () => Date.now();
// Assigned at the bottom; agentName() reads it once a client has connected.
let server = null;

/** The active project: from the environment, or the app's credentials file. */
function activeProject() {
  let repo = process.env.GITHUB_REPO || null;
  let token = process.env.GITHUB_PAT || null;
  if (!repo || !token) {
    try {
      const raw = JSON.parse(fs.readFileSync(credentialsFile(), "utf8"));
      if (raw?.version === 2) {
        const found = (raw.projects ?? []).find(
          (p) => raw.active && p.repo.toLowerCase() === raw.active.toLowerCase(),
        );
        repo = repo ?? found?.repo ?? null;
        token = token ?? found?.token ?? null;
      } else {
        repo = repo ?? raw?.repo ?? null;
        token = token ?? raw?.token ?? null;
      }
    } catch {
      /* not connected */
    }
  }
  if (typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  return { repo, token, id: `repo_${repo.replace("/", "_")}`.toLowerCase() };
}

function requireBoard() {
  const project = activeProject();
  const repo = project ? db.prepare("SELECT * FROM repositories WHERE id = ?").get(project.id) : null;
  const board = repo ? db.prepare("SELECT * FROM boards WHERE repository_id = ?").get(repo.id) : null;
  if (!repo || !board) {
    throw new Error("No board yet. Open RepoBoard and connect a GitHub repository first.");
  }
  return { project, repo, board };
}

function columns(boardId) {
  return db.prepare("SELECT * FROM columns WHERE board_id = ? ORDER BY position").all(boardId);
}

function resolveColumn(boardId, name) {
  const all = columns(boardId);
  const wanted = String(name).toLowerCase();
  const found =
    all.find((c) => c.name.toLowerCase() === wanted) ??
    all.find((c) => c.name.toLowerCase().startsWith(wanted));
  if (!found) throw new Error(`No column "${name}". Available: ${all.map((c) => c.name).join(", ")}`);
  return found;
}

function resolveMilestone(boardId, name) {
  if (name == null || name === "") return null;
  const all = db.prepare("SELECT * FROM milestones WHERE board_id = ?").all(boardId);
  const found = all.find((m) => m.name.toLowerCase() === String(name).toLowerCase());
  if (!found) {
    throw new Error(`No milestone "${name}". Available: ${all.map((m) => m.name).join(", ") || "none"}`);
  }
  return found.id;
}

/** Accepts the card's id or its reference ("RB-12" or 12). */
function cardOf(ref) {
  const { board } = requireBoard();
  const number = String(ref).match(/^(?:rb-)?(\d+)$/i)?.[1];
  const task = number
    ? db.prepare("SELECT * FROM tasks WHERE card_number = ? AND board_id = ? AND deleted_at IS NULL").get(Number(number), board.id)
    : db.prepare("SELECT * FROM tasks WHERE id = ? AND board_id = ? AND deleted_at IS NULL").get(ref, board.id);
  if (!task) throw new Error(`No card ${ref} on this board`);
  return task;
}

const labelsOf = (taskId) =>
  db.prepare("SELECT label FROM task_labels WHERE task_id = ?").all(taskId).map((r) => r.label);

function linksOf(taskId) {
  const one = (table, column) =>
    db.prepare(`SELECT ${column} AS v FROM ${table} WHERE task_id = ?`).all(taskId).map((r) => r.v);
  return {
    branches: one("task_branch_links", "branch_name"),
    pullRequests: one("task_pull_request_links", "pr_number"),
    issues: one("task_issue_links", "issue_number"),
  };
}

const PRIORITY = ["none", "urgent", "high", "medium", "low"];

function serialiseCard(task) {
  const column = db.prepare("SELECT name FROM columns WHERE id = ?").get(task.column_id);
  const milestone = task.milestone_id
    ? db.prepare("SELECT name FROM milestones WHERE id = ?").get(task.milestone_id)
    : null;
  return {
    id: task.id,
    ref: task.card_number != null ? `RB-${task.card_number}` : null,
    title: task.title,
    column: column?.name ?? null,
    priority: PRIORITY[task.priority ?? 0],
    milestone: milestone?.name ?? null,
    description: task.description ?? null,
    assignee: task.assignee ?? null,
    dueDate: task.due_date ? new Date(task.due_date).toISOString().slice(0, 10) : null,
    labels: labelsOf(task.id),
    checklist: task.checklist ? JSON.parse(task.checklist) : [],
    fromMarkdown: Boolean(task.markdown_task_id),
    ...linksOf(task.id),
  };
}

/**
 * Who is acting: REPOBOARD_AGENT if set, otherwise the name the MCP client
 * reported when it connected ("claude-code", "codex-mcp-client", "cursor"…).
 * Every event this server writes carries it, so the activity feed says which
 * AI did what.
 */
function agentName() {
  if (process.env.REPOBOARD_AGENT) return process.env.REPOBOARD_AGENT;
  const client = server?.getClientVersion?.();
  return client?.name || "AI agent";
}

function logActivity(repositoryId, taskId, type, message) {
  db.prepare(
    "INSERT INTO activity_events (id, repository_id, task_id, type, message, actor, actor_kind, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(randomUUID(), repositoryId, taskId, type, message, agentName(), "agent", now());
}

function nextCardNumber(boardId) {
  return db.prepare("SELECT COALESCE(MAX(card_number), 0) + 1 AS n FROM tasks WHERE board_id = ?").get(boardId).n;
}

function priorityValue(word) {
  if (word === undefined) return undefined;
  const index = PRIORITY.indexOf(String(word).toLowerCase());
  if (index === -1) throw new Error(`Priority must be one of: ${PRIORITY.join(", ")}`);
  return index;
}

function dueValue(date) {
  if (date === undefined) return undefined;
  if (date === null || date === "") return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) throw new Error("dueDate must look like 2026-10-01");
  return time;
}

/* ------------------------------------------------------ checklist tree -- */

function flattenItems(list) {
  return list.flatMap((i) => [i, ...flattenItems(i.children ?? [])]);
}
function findItem(list, text) {
  const wanted = String(text).trim().toLowerCase();
  return flattenItems(list).find((i) => i.text.trim().toLowerCase() === wanted) ?? null;
}
function allTexts(list) {
  return flattenItems(list).map((i) => i.text);
}
function saveChecklist(taskId, list) {
  db.prepare("UPDATE tasks SET checklist = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(list), now(), taskId);
}

/* ------------------------------------------------------------ documents -- */

function documents(repositoryId) {
  return db
    .prepare("SELECT * FROM markdown_sources WHERE repository_id = ? ORDER BY path")
    .all(repositoryId)
    .map((row) => {
      const snap = row.snapshot ? JSON.parse(row.snapshot) : null;
      return { row, snap };
    });
}

async function readFromGitHub(project, filePath) {
  if (!project.token) throw new Error("No token available to read from GitHub.");
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const url = `${base}/repos/${project.repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${project.token}`, accept: "application/vnd.github+json" },
  });
  if (response.status === 404) throw new Error(`${filePath} is not in ${project.repo}`);
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${filePath}`);
  const data = await response.json();
  return Buffer.from(data.content, "base64").toString("utf8");
}

const FORMAT_HINT =
  "Format: - [ ] todo, - [/] in progress, - [?] needs a person to check, - [x] done (people only), - [-] won't do. " +
  "Details as nested bullets (- Why: / - Do: / - Verify: / - Source:), review notes as a nested quote (> yourname YYYY-MM-DD: text). " +
  "Edit the file in your working copy and push; never mark items [x] yourself.";

/* ---------------------------------------------------------------- tools -- */

const text = { type: "string" };

const tools = [
  {
    name: "get_overview",
    description:
      "Start here. Where the project stands: overall progress, every checklist with its progress, what needs a person's check, milestones and the board's columns.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_board",
    description: "Every card on the board by column, with labels, priority, milestone, links and checklist.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_cards",
    description: "Find cards by text in the title, description, labels or linked branch name.",
    inputSchema: { type: "object", properties: { query: text }, required: ["query"] },
  },
  {
    name: "create_card",
    description: "Add a card. Returns its reference (RB-n) — mention it in commit messages to link them.",
    inputSchema: {
      type: "object",
      properties: {
        title: text,
        column: { type: "string", description: "Column name, e.g. Todo" },
        description: text,
        labels: { type: "array", items: text },
        assignee: text,
        priority: { type: "string", enum: PRIORITY },
        milestone: { type: "string", description: "Existing milestone name" },
        dueDate: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["title", "column"],
    },
  },
  {
    name: "move_card",
    description:
      "Move a card to another column. A card that comes from the markdown file changes on the board only; the commit to GitHub waits for the person to review it in the app.",
    inputSchema: {
      type: "object",
      properties: { card: { type: "string", description: "RB-12, 12 or the card id" }, column: text },
      required: ["card", "column"],
    },
  },
  {
    name: "update_card",
    description: "Change a card's title, description, assignee, labels, priority, milestone or due date.",
    inputSchema: {
      type: "object",
      properties: {
        card: { type: "string", description: "RB-12, 12 or the card id" },
        title: text,
        description: text,
        assignee: text,
        labels: { type: "array", items: text },
        priority: { type: "string", enum: PRIORITY },
        milestone: { type: "string", description: "Milestone name, or empty to clear" },
        dueDate: { type: "string", description: "YYYY-MM-DD, or empty to clear" },
      },
      required: ["card"],
    },
  },
  {
    name: "add_checklist_item",
    description:
      "Add an item to a card's checklist, at the top level or under another item (items nest: 1, 1.1, 1.1.2). Give it notes — what to do, how to check it, what to keep in mind — so the person can verify the work.",
    inputSchema: {
      type: "object",
      properties: {
        card: text,
        text,
        parent: { type: "string", description: "Text of the item to nest under (optional)" },
        notes: { type: "string", description: "Markdown: what to do, how to check it, what matters" },
        assignee: text,
      },
      required: ["card", "text"],
    },
  },
  {
    name: "set_checklist_item",
    description:
      "Tick or untick a checklist item, found by its text at any depth. Prefer leaving ticking to the person unless they asked you to.",
    inputSchema: {
      type: "object",
      properties: { card: text, text, done: { type: "boolean" } },
      required: ["card", "text", "done"],
    },
  },
  {
    name: "update_checklist_item",
    description: "Change a checklist item's text, notes or assignee, or add a comment to it. Found by its current text.",
    inputSchema: {
      type: "object",
      properties: {
        card: text,
        item: { type: "string", description: "Current text of the item" },
        text: { type: "string", description: "New text" },
        notes: text,
        assignee: text,
        comment: text,
      },
      required: ["card", "item"],
    },
  },
  {
    name: "delete_card",
    description:
      "Delete a card. Reversible: the person can undo it in the app, and restore_card brings it back. Say why in a comment first.",
    inputSchema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] },
  },
  {
    name: "restore_card",
    description: "Bring back a deleted card.",
    inputSchema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] },
  },
  {
    name: "comment_on_card",
    description:
      "Leave a note on a card. It appears in the card's history and the activity feed under your name — how agents tell each other and the person what they found or did.",
    inputSchema: { type: "object", properties: { card: text, message: text }, required: ["card", "message"] },
  },
  {
    name: "list_documents",
    description:
      "The tracked markdown documents — checklists, notes, decisions — with their progress as last read from GitHub.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_document",
    description: `The current text of a document, straight from GitHub. ${FORMAT_HINT}`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "e.g. .repoboard/checklists/release.md" } },
      required: ["path"],
    },
  },
  {
    name: "needs_check",
    description:
      "Everything waiting for a person to verify: checklist items marked [?] and cards in a review column. Use it to hand work over, not to tick things off.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_activity",
    description: "Recent events on the board and documents, newest first.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
];

const handlers = {
  get_overview() {
    const { repo, board } = requireBoard();
    const cols = columns(board.id);
    const cards = db.prepare("SELECT column_id FROM tasks WHERE board_id = ? AND deleted_at IS NULL").all(board.id);
    // The board's own source file is already counted as cards.
    const docs = documents(repo.id).filter((d) => d.snap && d.snap.total > 0 && d.row.role !== "board");
    const milestones = db.prepare("SELECT * FROM milestones WHERE board_id = ? ORDER BY position").all(board.id);
    const doneCol = cols.find((c) => /^(done|complete|completed|shipped)$/i.test(c.name));
    const cardsDone = cards.filter((c) => c.column_id === doneCol?.id).length;
    const docTotal = docs.reduce((n, d) => n + d.snap.total, 0);
    const docDone = docs.reduce((n, d) => n + d.snap.done, 0);
    const total = cards.length + docTotal;
    const done = cardsDone + docDone;
    return {
      repository: `${repo.owner}/${repo.name}`,
      progress: { done, total, percent: total ? Math.round((done / total) * 100) : 0 },
      board: cols.map((c) => ({ column: c.name, cards: cards.filter((t) => t.column_id === c.id).length })),
      checklists: docs.map((d) => ({
        path: d.row.path,
        title: d.snap.title,
        done: d.snap.done,
        total: d.snap.total,
        needsCheck: d.snap.review ?? 0,
        readAt: d.row.snapshot_at ? new Date(d.row.snapshot_at).toISOString() : null,
      })),
      milestones: milestones.map((m) => {
        const inIt = db.prepare("SELECT column_id FROM tasks WHERE milestone_id = ? AND deleted_at IS NULL").all(m.id);
        return {
          name: m.name,
          dueDate: m.due_date ? new Date(m.due_date).toISOString().slice(0, 10) : null,
          done: inIt.filter((t) => t.column_id === doneCol?.id).length,
          total: inIt.length,
        };
      }),
      needsCheck: handlers.needs_check().length,
      howToWork: FORMAT_HINT,
    };
  },

  get_board() {
    const { repo, board } = requireBoard();
    const cols = columns(board.id);
    const cards = db
      .prepare("SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL ORDER BY position")
      .all(board.id);
    return {
      repository: `${repo.owner}/${repo.name}`,
      defaultBranch: repo.default_branch,
      milestones: db.prepare("SELECT name FROM milestones WHERE board_id = ? ORDER BY position").all(board.id).map((m) => m.name),
      columns: cols.map((c) => ({
        name: c.name,
        cards: cards.filter((t) => t.column_id === c.id).map(serialiseCard),
      })),
    };
  },

  search_cards({ query }) {
    const { board } = requireBoard();
    const q = String(query).toLowerCase();
    return db
      .prepare("SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL")
      .all(board.id)
      .map(serialiseCard)
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.description ?? "").toLowerCase().includes(q) ||
          c.ref?.toLowerCase() === q ||
          c.labels.some((l) => l.toLowerCase().includes(q)) ||
          c.branches.some((br) => br.toLowerCase().includes(q)),
      );
  },

  create_card({ title, column, description, labels = [], assignee, priority, milestone, dueDate }) {
    const { repo, board } = requireBoard();
    const col = resolveColumn(board.id, column);
    const id = randomUUID();
    const siblings = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE column_id = ? AND deleted_at IS NULL")
      .get(col.id).n;
    db.prepare(
      `INSERT INTO tasks (id, board_id, column_id, position, title, description, assignee, due_date, checklist,
        markdown_task_id, card_number, priority, milestone_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'[]',NULL,?,?,?,?,?)`,
    ).run(
      id,
      board.id,
      col.id,
      siblings,
      title,
      description ?? null,
      assignee ?? null,
      dueValue(dueDate) ?? null,
      nextCardNumber(board.id),
      priorityValue(priority) ?? 0,
      resolveMilestone(board.id, milestone),
      now(),
      now(),
    );
    for (const label of labels) {
      db.prepare("INSERT INTO task_labels (id, task_id, label) VALUES (?,?,?)").run(randomUUID(), id, label);
    }
    logActivity(repo.id, id, "card_created", `created ${serialiseCard(cardOf(id)).ref} ${title} in ${col.name}`);
    return serialiseCard(cardOf(id));
  },

  move_card({ card, column }) {
    const { repo, board } = requireBoard();
    const task = cardOf(card);
    const target = resolveColumn(board.id, column);
    const from = db.prepare("SELECT name FROM columns WHERE id = ?").get(task.column_id);
    const position = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE column_id = ? AND deleted_at IS NULL")
      .get(target.id).n;
    db.prepare("UPDATE tasks SET column_id = ?, position = ?, updated_at = ? WHERE id = ?").run(
      target.id,
      position,
      now(),
      task.id,
    );
    logActivity(repo.id, task.id, "card_moved", `moved ${task.title} from ${from?.name ?? "?"} to ${target.name}`);
    return {
      ...serialiseCard(cardOf(task.id)),
      note: task.markdown_task_id
        ? "Moved on the board. This card comes from the markdown file, so the matching commit is not made here — the person reviews and commits it in RepoBoard."
        : undefined,
    };
  },

  update_card({ card, title, description, assignee, labels, priority, milestone, dueDate }) {
    const { repo, board } = requireBoard();
    const task = cardOf(card);
    db.prepare(
      `UPDATE tasks SET title = ?, description = ?, assignee = ?, priority = ?, milestone_id = ?, due_date = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      title ?? task.title,
      description === undefined ? task.description : description,
      assignee === undefined ? task.assignee : assignee || null,
      priorityValue(priority) ?? task.priority ?? 0,
      milestone === undefined ? task.milestone_id : resolveMilestone(board.id, milestone),
      dueDate === undefined ? task.due_date : dueValue(dueDate),
      now(),
      task.id,
    );
    if (labels) {
      db.prepare("DELETE FROM task_labels WHERE task_id = ?").run(task.id);
      for (const label of labels) {
        db.prepare("INSERT INTO task_labels (id, task_id, label) VALUES (?,?,?)").run(randomUUID(), task.id, label);
      }
    }
    const changes = [];
    if (title !== undefined && title !== task.title) changes.push(`renamed it from “${task.title}”`);
    if (description !== undefined && description !== task.description) changes.push("changed the description");
    if (assignee !== undefined && (assignee || null) !== task.assignee) changes.push(assignee ? `assigned ${assignee}` : "unassigned it");
    if (priority !== undefined && priorityValue(priority) !== (task.priority ?? 0)) changes.push(`set priority to ${priority}`);
    if (milestone !== undefined) changes.push(milestone ? `moved it to milestone ${milestone}` : "removed the milestone");
    if (dueDate !== undefined) changes.push(dueDate ? `set the due date to ${dueDate}` : "cleared the due date");
    if (labels) changes.push(`set labels to ${labels.join(", ") || "none"}`);
    logActivity(
      repo.id,
      task.id,
      "card_updated",
      `${changes.length ? changes.join(", ") : "updated"} on ${serialiseCard(cardOf(task.id)).ref ?? ""} ${title ?? task.title}`.trim(),
    );
    return serialiseCard(cardOf(task.id));
  },

  add_checklist_item({ card, text: itemText, parent, notes, assignee }) {
    const task = cardOf(card);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const item = { id: randomUUID(), text: itemText, done: false, notes: notes ?? null, assignee: assignee ?? null, children: [], comments: [] };
    if (parent) {
      const host = findItem(list, parent);
      if (!host) throw new Error(`No checklist item "${parent}" on this card. Items: ${allTexts(list).join(", ") || "none"}`);
      host.children = [...(host.children ?? []), item];
    } else {
      list.push(item);
    }
    saveChecklist(task.id, list);
    const { repo } = requireBoard();
    logActivity(repo.id, task.id, "card_updated", `added item “${itemText}”${parent ? ` under “${parent}”` : ""} to ${task.title}`);
    return { card: serialiseCard(cardOf(task.id)).ref, checklist: list };
  },

  set_checklist_item({ card, text: itemText, done }) {
    const task = cardOf(card);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const item = findItem(list, itemText);
    if (!item) {
      throw new Error(`No checklist item "${itemText}". Items: ${allTexts(list).join(", ") || "none"}`);
    }
    const setAll = (i) => {
      i.done = Boolean(done);
      if (done) (i.children ?? []).forEach(setAll);
    };
    setAll(item);
    saveChecklist(task.id, list);
    const { repo } = requireBoard();
    logActivity(repo.id, task.id, "card_updated", `${done ? "ticked" : "unticked"} “${item.text}” on ${task.title}`);
    return { checklist: list };
  },

  update_checklist_item({ card, item: current, text: newText, notes, assignee, comment }) {
    const task = cardOf(card);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const item = findItem(list, current);
    if (!item) throw new Error(`No checklist item "${current}". Items: ${allTexts(list).join(", ") || "none"}`);
    const changes = [];
    if (newText !== undefined && newText !== item.text) {
      item.text = newText;
      changes.push(`renamed it to “${newText}”`);
    }
    if (notes !== undefined) {
      item.notes = notes || null;
      changes.push(notes ? "wrote its notes" : "cleared its notes");
    }
    if (assignee !== undefined) {
      item.assignee = assignee || null;
      changes.push(assignee ? `assigned ${assignee}` : "unassigned it");
    }
    if (comment) {
      item.comments = [...(item.comments ?? []), { id: randomUUID(), author: agentName(), kind: "agent", text: comment, at: now() }];
      changes.push("commented");
    }
    saveChecklist(task.id, list);
    const { repo } = requireBoard();
    logActivity(repo.id, task.id, "card_updated", `${changes.join(", ") || "updated"} on item “${current}” of ${task.title}`);
    return { item };
  },

  delete_card({ card }) {
    const { repo } = requireBoard();
    const task = cardOf(card);
    db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), task.id);
    logActivity(repo.id, task.id, "card_deleted", `deleted ${task.title}`);
    return { deleted: task.title, restore: `restore_card with card ${task.id}` };
  },

  restore_card({ card }) {
    const { repo, board } = requireBoard();
    const number = String(card).match(/^(?:rb-)?(\d+)$/i)?.[1];
    const task = number
      ? db.prepare("SELECT * FROM tasks WHERE card_number = ? AND board_id = ?").get(Number(number), board.id)
      : db.prepare("SELECT * FROM tasks WHERE id = ? AND board_id = ?").get(card, board.id);
    if (!task) throw new Error(`No card ${card} on this board`);
    db.prepare("UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(now(), task.id);
    logActivity(repo.id, task.id, "card_restored", `restored ${task.title}`);
    return serialiseCard(cardOf(task.id));
  },

  comment_on_card({ card, message }) {
    const { repo } = requireBoard();
    const task = cardOf(card);
    logActivity(repo.id, task.id, "comment", message);
    return { ok: true, card: task.title, message };
  },

  list_documents() {
    const { repo } = requireBoard();
    return documents(repo.id).map(({ row, snap }) => ({
      path: row.path,
      title: snap?.title ?? path.basename(row.path),
      kind: /^\.repoboard\/[^/]+\.md$/i.test(row.path)
        ? "note"
        : row.path.startsWith(".repoboard/checklists/")
        ? "checklist"
        : row.path.startsWith(".repoboard/notes/")
          ? "note"
          : row.path.startsWith(".repoboard/decisions/")
            ? "decision"
            : row.role === "board"
              ? "board source"
              : "document",
      done: snap?.done ?? 0,
      total: snap?.total ?? 0,
      needsCheck: snap?.review ?? 0,
      readAt: row.snapshot_at ? new Date(row.snapshot_at).toISOString() : null,
    }));
  },

  async read_document({ path: filePath }) {
    const { project } = requireBoard();
    const content = await readFromGitHub(project, String(filePath).replace(/^\/+/, ""));
    return { path: filePath, format: FORMAT_HINT, content };
  },

  needs_check() {
    const { repo, board } = requireBoard();
    const fromDocs = documents(repo.id).filter(({ row }) => row.role !== "board").flatMap(({ row, snap }) =>
      (snap?.items ?? [])
        .filter((i) => i.state === "review")
        .map((i) => ({ source: row.path, line: i.line + 1, item: i.title })),
    );
    const review = columns(board.id).filter((c) => /review|qa|verify/i.test(c.name)).map((c) => c.id);
    const fromBoard = review.length
      ? db
          .prepare(
            `SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL AND column_id IN (${review.map(() => "?").join(",")})`,
          )
          .all(board.id, ...review)
          .map((t) => ({ source: "board", card: t.card_number != null ? `RB-${t.card_number}` : t.id, item: t.title }))
      : [];
    return [...fromDocs, ...fromBoard];
  },

  get_activity({ limit = 30 }) {
    const { repo } = requireBoard();
    return db
      .prepare(
        "SELECT type, message, task_id, actor, actor_kind, created_at FROM activity_events WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(repo.id, Math.min(Number(limit) || 30, 200))
      .map((e) => ({
        by: e.actor ? `${e.actor}${e.actor_kind === "agent" ? " (AI)" : ""}` : null,
        type: e.type,
        message: e.message,
        cardId: e.task_id,
        at: new Date(e.created_at).toISOString(),
      }));
  },
};

/* --------------------------------------------------------------- server -- */

server = new Server({ name: "repoboard", version: "0.3.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name];
  if (!handler) {
    return { isError: true, content: [{ type: "text", text: `Unknown tool ${request.params.name}` }] };
  }
  try {
    const result = await handler(request.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});

await server.connect(new StdioServerTransport());
console.error(`[repoboard-mcp] ready · board at ${dbFile}`);
