import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The MCP server as an agent meets it: spawned over stdio, against a
// throwaway database and an empty home — never the real ~/.repoboard.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-mcp-"));
const databaseFile = path.join(scratch, "board.db");
const REPO = "repo_acme_alpha";
const MAIN = `board_${REPO}`;

function seed() {
  const sqlite = new Database(databaseFile);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  const at = Date.now();
  sqlite.prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('ws', 'Local', ?)").run(at);
  sqlite
    .prepare("INSERT INTO repositories (id, workspace_id, owner, name, default_branch, visibility) VALUES (?, 'ws', 'acme', 'alpha', 'main', 'private')")
    .run(REPO);
  const board = sqlite.prepare("INSERT INTO boards (id, repository_id, name, owner, position, created_at) VALUES (?,?,?,?,?,?)");
  board.run(MAIN, REPO, "Alpha", null, 0, at);
  board.run("board_design", REPO, "Design", "dima", 1, at);
  const column = sqlite.prepare("INSERT INTO columns (id, board_id, name, position) VALUES (?,?,?,?)");
  ["Todo", "In Progress", "Review", "Done"].forEach((name, i) => column.run(`col_${i}`, MAIN, name, i));
  column.run("col_design", "board_design", "Ideas", 0);
  sqlite.prepare("INSERT INTO milestones (id, board_id, name, position, created_at) VALUES ('ms_beta', ?, 'Beta', 0, ?)").run(MAIN, at);
  return sqlite;
}

type Reply = { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };

class McpClient {
  private buffer = "";
  private waiting = new Map<number, (reply: Reply) => void>();
  private nextId = 1;
  stderr = "";

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (this.stderr += chunk));
  }

  request(method: string, params: unknown): Promise<Reply> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No answer to ${method}. stderr: ${this.stderr}`)), 10_000);
      this.waiting.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  async call(name: string, args?: unknown) {
    const reply = await this.request("tools/call", { name, arguments: args });
    if (!reply.result) throw new Error(`Protocol error: ${reply.error?.message}`);
    return { isError: Boolean(reply.result.isError), text: reply.result.content[0].text };
  }
}

let sqlite: Database.Database;
let client: McpClient;

beforeAll(async () => {
  sqlite = seed();
  const child = spawn(process.execPath, ["scripts/mcp-server.mjs"], {
    env: {
      PATH: process.env.PATH,
      HOME: scratch,
      DATABASE_URL: `file:${databaseFile}`,
      REPOBOARD_REPO: "acme/alpha",
      GITHUB_PAT: "test-token",
      // Nothing may leave the machine: document reads go nowhere.
      GITHUB_API_URL: "http://127.0.0.1:9",
      REPOBOARD_AGENT: "claude-test",
    } as unknown as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  client = new McpClient(child);
  const init = await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "1" },
  });
  expect(init.result).toBeTruthy();
  client.notify("notifications/initialized");
});

afterAll(() => {
  client?.child.kill();
  sqlite?.close();
});

async function refused(name: string, args: unknown, ...expected: string[]) {
  const answer = await client.call(name, args);
  expect(answer.isError, answer.text).toBe(true);
  for (const part of expected) expect(answer.text).toContain(part);
  expect(answer.text).not.toMatch(/SQLite3|constraint failed|Cannot read properties|bind/i);
  return answer.text;
}

describe("MCP server arguments", () => {
  it("says what is missing, and which columns exist", async () => {
    await refused("create_card", { title: "No column" }, 'create_card: "column" is required — one of: Todo, In Progress, Review');
    await refused("create_card", { title: "", column: "Todo" }, '"title" is required');
    await refused("get_card", {}, '"card" is required');
    await refused("move_card", { card: "RB-1" }, '"column" is required');
  });

  it("names the wrong type and what is expected", async () => {
    await refused("create_card", { title: { text: "x" }, column: "Todo" }, '"title" must be a string — got an object');
    await refused("create_card", { title: "x", column: 3 }, '"column" must be one of: Todo, In Progress, Review — got a number');
    await refused("get_activity", { limit: "ten" }, 'get_activity: "limit" must be a number — got a string');
    await refused("get_activity", { limit: -5 }, '"limit" must be at least 1');
    await refused("create_card", { title: "x", column: "Todo", labels: ["ok", 2] }, '"labels" must be a list of strings — item 2 is a number');
    await refused("create_card", { title: "x", column: "Todo", labels: "bug" }, '"labels" must be a list of strings');
    await refused("create_card", { title: "x", column: "Todo", priority: "super" }, '"priority" must be one of: none, urgent, high, medium, low');
    await refused("set_checklist_item", { card: "RB-1", text: "1", done: "yes" }, '"done" must be true or false');
    await refused("get_card", { card: 12 }, '"card" must be a string: RB-12, 12 or the card id — got a number');
  });

  it("refuses unknown arguments with the allowed list", async () => {
    await refused("search_cards", { query: "x", colum: "Todo" }, 'unknown argument "colum" — allowed: query');
    await refused("list_boards", { board: "Alpha" }, 'unknown argument "board" — this tool takes no arguments');
  });

  it("says what exists when a board, column, card, milestone or item is not found", async () => {
    await refused("get_board", { board: "Ghost" }, 'No board "Ghost". Boards: Alpha, Design (owner dima)');
    await refused("create_card", { title: "x", column: "Nope" }, 'No column "Nope". Available: Todo, In Progress, Review, Done');
    await refused("create_card", { title: "x", column: "Todo", milestone: "Gamma" }, 'No milestone "Gamma". Available: Beta');
    await refused("create_card", { title: "x", column: "Todo", dueDate: "tomorrow" }, "dueDate must look like 2026-10-01");
    await refused("get_card", { card: "RB-999" }, 'No card "RB-999"', "the project has no cards yet");
    await refused("read_document", { path: "/" }, "Name a file");
  });

  it("stays alive and keeps every refusal after bad calls", async () => {
    const made = await client.call("create_card", { title: "Ship it", column: "todo", labels: ["a", "a", " "], priority: "High", milestone: "Beta" });
    expect(made.isError, made.text).toBe(false);
    const card = JSON.parse(made.text);
    expect(card).toMatchObject({ ref: "RB-1", column: "Todo", labels: ["a"], priority: "high", milestone: "Beta" });

    // null on an optional field means "not given".
    const updated = await client.call("update_card", { card: "RB-1", title: null, assignee: "Claude" });
    expect(JSON.parse(updated.text)).toMatchObject({ title: "Ship it", assignee: "Claude" });

    await refused("move_card", { card: "RB-1", column: "Done" }, "Agents do not move cards to Done", "Move it to Review");
    await refused("create_card", { title: "x", column: "Done" }, "An agent cannot put a card straight into Done");
    await client.call("add_checklist_item", { card: "RB-1", text: "Write notes" });
    await refused("set_checklist_item", { card: "RB-1", text: "1", done: true }, "Agents do not tick items done");
    await refused("set_checklist_item", { card: "RB-1", text: "7", done: false }, 'No checklist item "7"', "1 Write notes");
    await refused("get_card", { card: "RB-2" }, "cards here run RB-1 to RB-1");

    sqlite.prepare("UPDATE tasks SET column_id = 'col_3', deleted_at = ? WHERE card_number = 1").run(Date.now());
    await refused("get_card", { card: "RB-1" }, "is deleted; restore_card brings it back");
    await refused("restore_card", { card: "RB-1" }, "was deleted while done");
    sqlite.prepare("UPDATE tasks SET column_id = 'col_0', deleted_at = NULL WHERE card_number = 1").run();

    expect(client.child.exitCode).toBeNull();
    const board = await client.call("get_board", { board: "alpha" });
    expect(board.isError).toBe(false);
    expect(JSON.parse(board.text).columns[0].cards[0].ref).toBe("RB-1");
  });

  it("turns a database error into a plain answer and writes nothing half-way", async () => {
    sqlite.exec("DROP TABLE task_labels");
    const text = await refused(
      "create_card",
      { title: "Half a card", column: "Todo", labels: ["x"] },
      "create_card: RepoBoard could not do that with these arguments (the board database refused it)",
      "Check the arguments: create_card(title: string, column: string",
    );
    expect(text).not.toContain("no such table");
    expect(client.stderr).toContain("no such table: task_labels");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM tasks WHERE title = 'Half a card'").get()).toEqual({ n: 0 });
    expect(client.child.exitCode).toBeNull();
  });
});
