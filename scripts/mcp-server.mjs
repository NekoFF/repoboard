#!/usr/bin/env node
/**
 * RepoBoard MCP server.
 *
 * Lets an AI client read and change the board directly, which is the point of
 * this app: several agents working the same board without the human relaying
 * card titles by hand.
 *
 * It talks to the same SQLite file the app uses, so changes show up on the
 * board immediately and survive whether or not the web app is running.
 *
 * Deliberately not exposed: anything that writes to the GitHub repository.
 * Markdown writes go through the app's preview-and-confirm flow, and an agent
 * silently committing to someone's repository is exactly what that flow exists
 * to prevent. Moving a markdown-backed card here changes the board and says so.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ------------------------------------------------------------- database -- */

function databasePath() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.replace(/^file:/, "");
  }
  const legacy = path.join(process.cwd(), "repoboard.db");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(os.homedir(), ".repoboard", "repoboard.db");
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

const now = () => Date.now();

function board() {
  const repo = db.prepare("SELECT * FROM repositories LIMIT 1").get();
  const b = repo
    ? db.prepare("SELECT * FROM boards WHERE repository_id = ?").get(repo.id)
    : null;
  return { repo, board: b };
}

function requireBoard() {
  const { repo, board: b } = board();
  if (!repo || !b) {
    throw new Error(
      "No board yet. Open RepoBoard and connect a GitHub repository first.",
    );
  }
  return { repo, board: b };
}

function columns(boardId) {
  return db
    .prepare("SELECT * FROM columns WHERE board_id = ? ORDER BY position")
    .all(boardId);
}

function resolveColumn(boardId, name) {
  const all = columns(boardId);
  const wanted = String(name).toLowerCase();
  const found =
    all.find((c) => c.name.toLowerCase() === wanted) ??
    all.find((c) => c.name.toLowerCase().startsWith(wanted));
  if (!found) {
    throw new Error(
      `No column "${name}". Available: ${all.map((c) => c.name).join(", ")}`,
    );
  }
  return found;
}

function cardOf(taskId) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`No card with id ${taskId}`);
  return task;
}

function labelsOf(taskId) {
  return db
    .prepare("SELECT label FROM task_labels WHERE task_id = ?")
    .all(taskId)
    .map((r) => r.label);
}

function linksOf(taskId) {
  const one = (table, column) =>
    db
      .prepare(`SELECT ${column} AS v FROM ${table} WHERE task_id = ?`)
      .all(taskId)
      .map((r) => r.v);
  return {
    branches: one("task_branch_links", "branch_name"),
    pullRequests: one("task_pull_request_links", "pr_number"),
    issues: one("task_issue_links", "issue_number"),
  };
}

function serialiseCard(task, columnName) {
  return {
    id: task.id,
    title: task.title,
    column: columnName,
    description: task.description ?? null,
    assignee: task.assignee ?? null,
    dueDate: task.due_date ? new Date(task.due_date).toISOString() : null,
    labels: labelsOf(task.id),
    checklist: task.checklist ? JSON.parse(task.checklist) : [],
    markdownTaskId: task.markdown_task_id ?? null,
    ...linksOf(task.id),
  };
}

function logActivity(repositoryId, taskId, type, message) {
  db.prepare(
    "INSERT INTO activity_events (id, repository_id, task_id, type, message, created_at) VALUES (?,?,?,?,?,?)",
  ).run(randomUUID(), repositoryId, taskId, type, message, now());
}

/* ---------------------------------------------------------------- tools -- */

const tools = [
  {
    name: "get_board",
    description:
      "The whole board: repository, columns and every card with its labels, links and checklist. Start here.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_cards",
    description:
      "Find cards by text in the title, labels or linked branch name.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "create_card",
    description: "Add a card to a column.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        column: { type: "string", description: "Column name, e.g. Todo" },
        description: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignee: { type: "string" },
      },
      required: ["title", "column"],
    },
  },
  {
    name: "move_card",
    description:
      "Move a card to another column. A card that came from the markdown file changes on the board only — the commit to GitHub still needs the human to approve the diff in the app.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        column: { type: "string" },
      },
      required: ["cardId", "column"],
    },
  },
  {
    name: "update_card",
    description: "Change a card's title, description, assignee or labels.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        assignee: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["cardId"],
    },
  },
  {
    name: "add_checklist_item",
    description: "Append an item to a card's checklist.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        text: { type: "string" },
      },
      required: ["cardId", "text"],
    },
  },
  {
    name: "set_checklist_item",
    description: "Tick or untick a checklist item by its text.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        text: { type: "string" },
        done: { type: "boolean" },
      },
      required: ["cardId", "text", "done"],
    },
  },
  {
    name: "comment_on_card",
    description:
      "Leave a note on a card. It appears in the activity feed, which is how agents tell each other and the human what they did.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        message: { type: "string" },
      },
      required: ["cardId", "message"],
    },
  },
  {
    name: "get_activity",
    description: "Recent board events, newest first.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
];

const handlers = {
  get_board() {
    const { repo, board: b } = requireBoard();
    const cols = columns(b.id);
    const byId = new Map(cols.map((c) => [c.id, c.name]));
    const cards = db
      .prepare("SELECT * FROM tasks WHERE board_id = ? ORDER BY position")
      .all(b.id);

    return {
      repository: `${repo.owner}/${repo.name}`,
      defaultBranch: repo.default_branch,
      columns: cols.map((c) => ({
        name: c.name,
        cards: cards
          .filter((t) => t.column_id === c.id)
          .map((t) => serialiseCard(t, c.name)),
      })),
    };
  },

  search_cards({ query }) {
    const { board: b } = requireBoard();
    const byId = new Map(columns(b.id).map((c) => [c.id, c.name]));
    const q = String(query).toLowerCase();
    return db
      .prepare("SELECT * FROM tasks WHERE board_id = ?")
      .all(b.id)
      .map((t) => serialiseCard(t, byId.get(t.column_id)))
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.labels.some((l) => l.toLowerCase().includes(q)) ||
          c.branches.some((br) => br.toLowerCase().includes(q)),
      );
  },

  create_card({ title, column, description, labels = [], assignee }) {
    const { repo, board: b } = requireBoard();
    const col = resolveColumn(b.id, column);
    const id = randomUUID();
    const siblings = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE column_id = ?")
      .get(col.id).n;

    db.prepare(
      `INSERT INTO tasks (id, board_id, column_id, position, title, description, assignee, due_date, checklist, markdown_task_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,NULL,'[]',NULL,?,?)`,
    ).run(
      id,
      b.id,
      col.id,
      siblings,
      title,
      description ?? null,
      assignee ?? null,
      now(),
      now(),
    );

    for (const label of labels) {
      db.prepare(
        "INSERT INTO task_labels (id, task_id, label) VALUES (?,?,?)",
      ).run(randomUUID(), id, label);
    }

    logActivity(repo.id, id, "card_created", `Card created: ${title}`);
    return serialiseCard(cardOf(id), col.name);
  },

  move_card({ cardId, column }) {
    const { repo, board: b } = requireBoard();
    const task = cardOf(cardId);
    const target = resolveColumn(b.id, column);
    const from = db
      .prepare("SELECT name FROM columns WHERE id = ?")
      .get(task.column_id);

    const position = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE column_id = ?")
      .get(target.id).n;

    db.prepare(
      "UPDATE tasks SET column_id = ?, position = ?, updated_at = ? WHERE id = ?",
    ).run(target.id, position, now(), cardId);

    logActivity(
      repo.id,
      cardId,
      "card_moved",
      `Card moved ${from?.name ?? "?"} → ${target.name}: ${task.title}`,
    );

    return {
      ...serialiseCard(cardOf(cardId), target.name),
      note: task.markdown_task_id
        ? `Moved on the board. This card comes from the markdown file, so the matching commit is not made here — open RepoBoard and approve the diff to write it to GitHub.`
        : undefined,
    };
  },

  update_card({ cardId, title, description, assignee, labels }) {
    const { repo, board: b } = requireBoard();
    const task = cardOf(cardId);

    db.prepare(
      "UPDATE tasks SET title = ?, description = ?, assignee = ?, updated_at = ? WHERE id = ?",
    ).run(
      title ?? task.title,
      description === undefined ? task.description : description,
      assignee === undefined ? task.assignee : assignee,
      now(),
      cardId,
    );

    if (labels) {
      db.prepare("DELETE FROM task_labels WHERE task_id = ?").run(cardId);
      for (const label of labels) {
        db.prepare(
          "INSERT INTO task_labels (id, task_id, label) VALUES (?,?,?)",
        ).run(randomUUID(), cardId, label);
      }
    }

    logActivity(repo.id, cardId, "card_updated", `Card updated: ${title ?? task.title}`);
    const col = db
      .prepare("SELECT name FROM columns WHERE id = ?")
      .get(cardOf(cardId).column_id);
    return serialiseCard(cardOf(cardId), col.name);
  },

  add_checklist_item({ cardId, text }) {
    const task = cardOf(cardId);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    list.push({ id: randomUUID(), text, done: false });
    db.prepare(
      "UPDATE tasks SET checklist = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(list), now(), cardId);
    return { checklist: list };
  },

  set_checklist_item({ cardId, text, done }) {
    const task = cardOf(cardId);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const item = list.find(
      (i) => i.text.toLowerCase() === String(text).toLowerCase(),
    );
    if (!item) {
      throw new Error(
        `No checklist item matching "${text}". Items: ${list.map((i) => i.text).join(", ") || "none"}`,
      );
    }
    item.done = Boolean(done);
    db.prepare(
      "UPDATE tasks SET checklist = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(list), now(), cardId);
    return { checklist: list };
  },

  comment_on_card({ cardId, message }) {
    const { repo } = requireBoard();
    const task = cardOf(cardId);
    logActivity(repo.id, cardId, "comment", message);
    return { ok: true, card: task.title, message };
  },

  get_activity({ limit = 30 }) {
    const { repo } = requireBoard();
    return db
      .prepare(
        "SELECT type, message, task_id, created_at FROM activity_events WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(repo.id, limit)
      .map((e) => ({
        type: e.type,
        message: e.message,
        cardId: e.task_id,
        at: new Date(e.created_at).toISOString(),
      }));
  },
};

/* --------------------------------------------------------------- server -- */

const server = new Server(
  { name: "repoboard", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name];
  if (!handler) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool ${request.params.name}` }],
    };
  }
  try {
    const result = handler(request.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }],
    };
  }
});

await server.connect(new StdioServerTransport());
console.error(`[repoboard-mcp] ready · board at ${dbFile}`);
