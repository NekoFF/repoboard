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

    // Finished work without a reason goes to a person's check, not to Done.
    const toCheck = JSON.parse((await client.call("move_card", { card: "RB-1", column: "Done" })).text);
    expect(toCheck).toMatchObject({ column: "Review" });
    // Closing needs a reason with a real note, and the project has to allow it.
    await refused("move_card", { card: "RB-1", column: "Done", reason: "verified", note: "works" }, "needs proof", "what you saw");
    const closed = await client.call("move_card", { card: "RB-1", column: "Done", reason: "already_done", note: "Landed in commit abc123 last week" });
    expect(JSON.parse(closed.text)).toMatchObject({ column: "Done" });
    const doneBy = sqlite.prepare("SELECT done_by FROM tasks WHERE card_number = 1").get() as { done_by: string };
    expect(JSON.parse(doneBy.done_by)).toMatchObject({ name: "Claude", kind: "agent", reason: "already_done" });
    sqlite.prepare("UPDATE repositories SET agent_policy = 'propose'").run();
    await refused("move_card", { card: "RB-1", column: "Done", reason: "already_done", note: "Landed in commit abc123" }, "only people mark work done");
    await refused("create_card", { title: "x", column: "Done", reason: "cannot_be_checked", note: "Nobody can see it" }, "only people mark work done");
    sqlite.prepare("UPDATE repositories SET agent_policy = 'reason'").run();
    await client.call("move_card", { card: "RB-1", column: "Todo" });
    expect((sqlite.prepare("SELECT done_by FROM tasks WHERE card_number = 1").get() as { done_by: string | null }).done_by).toBeNull();

    await client.call("add_checklist_item", { card: "RB-1", text: "Write notes" });
    const ticked = await client.call("set_checklist_item", { card: "RB-1", text: "1", done: true });
    expect(ticked.isError, ticked.text).toBe(false);
    const list = JSON.parse((sqlite.prepare("SELECT checklist FROM tasks WHERE card_number = 1").get() as { checklist: string }).checklist);
    expect(list[0]).toMatchObject({ done: false, review: true });
    const waiting = JSON.parse((await client.call("needs_check", {})).text);
    expect(waiting).toContainEqual(expect.objectContaining({ card: "RB-1", itemNumber: "1", item: "Write notes" }));
    // A person said it works: the agent closes it with that as proof.
    const confirmed = await client.call("set_checklist_item", {
      card: "RB-1",
      text: "1",
      done: true,
      reason: "person_confirmed",
      note: "Dima said in chat that he read the notes",
    });
    expect(confirmed.isError, confirmed.text).toBe(false);
    const after = JSON.parse((sqlite.prepare("SELECT checklist FROM tasks WHERE card_number = 1").get() as { checklist: string }).checklist);
    expect(after[0]).toMatchObject({ done: true, doneBy: { reason: "person_confirmed" } });
    await client.call("set_checklist_item", { card: "RB-1", text: "1", done: false });
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

  it("keeps steps in items, not in the description", async () => {
    await refused(
      "create_card",
      { title: "Launch", column: "Todo", description: "Add the repo; pick a domain; rent a server; write the Impressum" },
      "The description lists steps",
      "items",
    );
    await refused("create_card", { title: "Launch", column: "Todo", description: "Plan:\n- one\n- two\n- three" }, "The description lists steps");
    await refused("create_card", { title: "Launch", column: "Todo", items: [{ notes: "no text" }] }, "items[1].text is required");
    const made = await client.call("create_card", {
      title: "Launch",
      column: "Todo",
      description: "What has to happen before the site goes live.",
      items: [
        { text: "Domain", notes: "Pick and buy it", items: [{ text: "Pick a name" }, { text: "Point DNS at the server", notes: "Check with dig" }] },
        { text: "Impressum" },
      ],
    });
    expect(made.isError, made.text).toBe(false);
    const { ref } = JSON.parse(made.text);
    const list = JSON.parse((sqlite.prepare("SELECT checklist FROM tasks WHERE card_number = ?").get(Number(ref.slice(3))) as { checklist: string }).checklist);
    expect(list.map((i: { text: string }) => i.text)).toEqual(["Domain", "Impressum"]);
    expect(list[0].children[1]).toMatchObject({ text: "Point DNS at the server", notes: "Check with dig", done: false });
    // Without items, the answer says to add them.
    const bare = JSON.parse((await client.call("create_card", { title: "Bare", column: "Todo" })).text);
    expect(bare.note).toContain("No items yet");
  });

  it("moves a card to another board, and gives the rules with whoami", async () => {
    const moved = await client.call("move_card", { card: "RB-1", board: "Design", column: "Ideas" });
    expect(moved.isError, moved.text).toBe(false);
    expect(JSON.parse(moved.text)).toMatchObject({ board: "Design", column: "Ideas" });
    expect(sqlite.prepare("SELECT board_id, milestone_id FROM tasks WHERE card_number = 1").get()).toEqual({ board_id: "board_design", milestone_id: null });
    await refused("move_card", { card: "RB-1", board: "Design", column: "Todo" }, 'No column "Todo". Available: Ideas');
    // A pile of one area on the main board: the answer suggests a board for it.
    let answer = "";
    for (const n of [1, 2, 3, 4]) {
      answer = JSON.parse((await client.call("create_card", { title: `Audit ${n}`, column: "Todo", labels: ["security"], items: [{ text: "Look" }] })).text).note ?? "";
    }
    expect(answer).toContain("4 open cards labelled security");
    expect(answer).toContain("Other boards: Design");
    const me = JSON.parse((await client.call("whoami", {})).text);
    expect(me.boards).toEqual(["Alpha", "Design"]);
    expect(me.rules).toContain("A board is a large, lasting area");
  });

  it("points out what is already in the wrong place", async () => {
    const snapshot = {
      version: 1,
      title: "План сборки",
      total: 6,
      done: 0,
      review: 5,
      sections: [{ heading: "День 1 — скелет", depth: 2, total: 6, done: 0, doing: 0, review: 5 }],
      items: [],
      links: [],
    };
    sqlite
      .prepare("INSERT INTO markdown_sources (id, repository_id, path, role, snapshot) VALUES ('doc_plan', ?, '.repoboard/checklists/build-plan.md', 'checklist', ?)")
      .run(REPO, JSON.stringify(snapshot));
    sqlite.prepare("UPDATE tasks SET description = 'Add the repo; pick a domain; rent a server; write the Impressum', checklist = '[]' WHERE card_number = 1").run();
    const me = JSON.parse((await client.call("whoami", {})).text);
    expect(me.tidyUp.join("\n")).toContain(".repoboard/checklists/build-plan.md");
    expect(me.tidyUp.join("\n")).toContain("День 1 — скелет");
    expect(me.tidyUp.join("\n")).toContain("RB-1 keep their steps in the description");
    sqlite.prepare("DELETE FROM markdown_sources WHERE id = 'doc_plan'").run();
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

// What agents rely on: every tool, its parameters and their types, what is
// required, the values an enum accepts. Adding is fine; removing, renaming,
// changing a type, dropping an enum value or requiring more breaks agents
// already written against it. UPDATE_MCP_CONTRACT=1 records additions.
type Contract = Record<string, { params: Record<string, { type?: string; enum?: string[] }>; required: string[] }>;
const CONTRACT_FILE = path.join("tests", "mcp-contract.json");

describe("MCP contract", () => {
  it("keeps every tool and parameter agents may already use", async () => {
    const listed = (await client.request("tools/list", {})).result as unknown as {
      tools: { name: string; inputSchema: { properties?: Record<string, { type?: string; enum?: string[] }>; required?: string[] } }[];
    };
    const now: Contract = Object.fromEntries(
      listed.tools.map((t) => [
        t.name,
        {
          params: Object.fromEntries(
            Object.entries(t.inputSchema.properties ?? {}).map(([k, v]) => [k, { type: v.type, ...(v.enum ? { enum: v.enum } : {}) }]),
          ),
          required: t.inputSchema.required ?? [],
        },
      ]),
    );
    if (process.env.UPDATE_MCP_CONTRACT) fs.writeFileSync(CONTRACT_FILE, `${JSON.stringify(now, null, 2)}\n`);
    const recorded: Contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, "utf8"));
    for (const [tool, was] of Object.entries(recorded)) {
      const is = now[tool];
      expect(is, `tool ${tool} was removed or renamed`).toBeTruthy();
      for (const [param, spec] of Object.entries(was.params)) {
        expect(is.params[param], `${tool}.${param} was removed or renamed`).toBeTruthy();
        expect(is.params[param].type, `${tool}.${param} changed type`).toBe(spec.type);
        for (const value of spec.enum ?? []) expect(is.params[param].enum ?? [], `${tool}.${param} no longer accepts ${value}`).toContain(value);
      }
      for (const param of is.required) expect(was.required, `${tool} now requires ${param}`).toContain(param);
    }
  });
});

describe("MCP server updates", () => {
  it("follows a new version without a restart, and tells the agent the rules changed", async () => {
    // A copy inside the project, so it finds node_modules; the original stays untouched.
    const dir = fs.mkdtempSync(path.join(process.cwd(), ".mcp-reload-"));
    try {
      fs.mkdirSync(path.join(dir, "scripts"));
      for (const f of ["mcp-server.mjs", "mcp-core.mjs"]) fs.copyFileSync(path.join("scripts", f), path.join(dir, "scripts", f));
      const agent = new McpClient(
        spawn(process.execPath, [path.join(dir, "scripts", "mcp-server.mjs")], {
          env: {
            PATH: process.env.PATH,
            HOME: scratch,
            DATABASE_URL: `file:${databaseFile}`,
            REPOBOARD_REPO: "acme/alpha",
            GITHUB_PAT: "test-token",
            GITHUB_API_URL: "http://127.0.0.1:9",
            REPOBOARD_AGENT: "claude-test",
          } as unknown as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );
      try {
        await agent.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1" } });
        agent.notify("notifications/initialized");
        const before = await agent.request("tools/call", { name: "list_boards", arguments: {} });
        expect(before.result?.content).toHaveLength(1);

        // RepoBoard is updated under the running server: new rules, a new tool.
        const core = path.join(dir, "scripts", "mcp-core.mjs");
        // Half a file, as an update may leave it for a moment: the old tools keep working.
        const whole = fs.readFileSync(core, "utf8");
        fs.writeFileSync(core, whole.slice(0, whole.length / 2));
        fs.utimesSync(core, new Date(), new Date(Date.now() + 2000));
        const during = await agent.request("tools/call", { name: "list_boards", arguments: {} });
        expect(during.result?.isError ?? false).toBe(false);
        fs.writeFileSync(core, whole);
        const source = fs
          .readFileSync(core, "utf8")
          .replace("Start with whoami", "Always greet the owner first.\n\nStart with whoami")
          .replace("const tools = [", 'const tools = [\n  { name: "hello_update", description: "New in this version", inputSchema: { type: "object", properties: {} } },');
        fs.writeFileSync(core, source.replace("const handlers = {", 'const handlers = {\n  hello_update() { return { fresh: true }; },'));
        fs.utimesSync(core, new Date(), new Date(Date.now() + 5000));

        const listed = await agent.request("tools/list", {});
        expect((listed.result as unknown as { tools: { name: string }[] }).tools.map((t) => t.name)).toContain("hello_update");
        const after = await agent.request("tools/call", { name: "hello_update", arguments: {} });
        const texts = after.result!.content.map((c) => c.text);
        expect(texts[0]).toContain("RepoBoard was updated while you were connected");
        expect(texts[0]).toContain("Always greet the owner first.");
        expect(JSON.parse(texts[1])).toEqual({ fresh: true });
        // Said once.
        const again = await agent.request("tools/call", { name: "list_boards", arguments: {} });
        expect(again.result?.content).toHaveLength(1);
      } finally {
        agent.child.kill();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
