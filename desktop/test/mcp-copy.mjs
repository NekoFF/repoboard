/**
 * The agents' MCP server on Windows, end to end, against a built app
 * (desktop/dist/win-unpacked): the app makes its copy, an agent connects to
 * the copy, an update replaces the app's files while the agent is connected
 * (the running executable included), the installer closes everything that
 * runs from the install folder — and the agent is still there, on the new
 * tools, told the rules changed.
 *
 *   node desktop/test/mcp-copy.mjs desktop/dist/win-unpacked
 *
 * Run by .github/workflows/windows-mcp.yml. Uses a throwaway database and
 * home folder; nothing leaves the machine.
 */
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const require = createRequire(path.join(root, "package.json"));
const { prepareMcpHome } = require(path.join(root, "desktop", "mcp-home.cjs"));
const Database = require("better-sqlite3");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { migrate } = require("drizzle-orm/better-sqlite3/migrator");

const install = path.resolve(process.argv[2] ?? path.join(root, "desktop", "dist", "win-unpacked"));
const exeName = fs.readdirSync(install).find((f) => /^RepoBoard(\.exe)?$/i.test(f));
if (!exeName) throw new Error(`No RepoBoard executable in ${install}`);
const serverDir = path.join(install, "resources", "server");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-mcp-copy-"));
const home = path.join(scratch, "LocalAppData", "NekoFF", "RepoBoard", "mcp");

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const step = (message) => console.log(`· ${message}`);

// A board to talk about.
const databaseFile = path.join(scratch, "board.db");
const sqlite = new Database(databaseFile);
migrate(drizzle(sqlite), { migrationsFolder: path.join(root, "drizzle") });
sqlite.prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('ws', 'Local', ?)").run(Date.now());
sqlite.prepare("INSERT INTO repositories (id, workspace_id, owner, name, default_branch, visibility) VALUES ('repo_acme_alpha', 'ws', 'acme', 'alpha', 'main', 'private')").run();
sqlite.prepare("INSERT INTO boards (id, repository_id, name, owner, position, created_at) VALUES ('board_repo_acme_alpha', 'repo_acme_alpha', 'Alpha', NULL, 0, ?)").run(Date.now());
["Todo", "In Progress", "Review", "Done"].forEach((name, i) => sqlite.prepare("INSERT INTO columns (id, board_id, name, position) VALUES (?, 'board_repo_acme_alpha', ?, ?)").run(`c${i}`, name, i));
sqlite.close();

step("the app makes the copy");
const first = await prepareMcpHome({ installDir: install, exeName, serverDir, home });
if (!first.node.startsWith(home) || !fs.existsSync(first.node) || !fs.existsSync(first.server)) fail("the copy is not where it should be");

// An agent connects to the copy.
const child = spawn(first.node, [first.server], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    HOME: scratch,
    USERPROFILE: scratch,
    DATABASE_URL: `file:${databaseFile}`,
    REPOBOARD_REPO: "acme/alpha",
    GITHUB_PAT: "test-token",
    GITHUB_API_URL: "http://127.0.0.1:9",
    REPOBOARD_AGENT: "ci-agent",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
let buffer = "";
let stderr = "";
const waiting = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => (stderr += chunk));
let exited = null;
child.on("exit", (code) => (exited = code ?? "signal"));
let nextId = 1;
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`No answer to ${method}. stderr: ${stderr}`)), 20_000);
    waiting.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

try {
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "1" } });
  if (!init.result) fail(`initialize: ${JSON.stringify(init)}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = await request("tools/list", {});
  step(`connected to the copy: ${tools.result.tools.length} tools`);
  const boards = await request("tools/call", { name: "list_boards", arguments: {} });
  if (boards.result?.isError || !boards.result.content[0].text.includes("Alpha")) fail(`list_boards: ${JSON.stringify(boards)}`);

  step("an update replaces the app's files while the agent is connected");
  const core = path.join(serverDir, "mcp", "mcp-core.mjs");
  fs.writeFileSync(core, fs.readFileSync(core, "utf8").replace("Start with whoami", "Always greet the owner first.\n\nStart with whoami"));
  const later = new Date(Date.now() + 60_000);
  for (const file of [core, path.join(install, exeName)]) fs.utimesSync(file, later, later);
  const second = await prepareMcpHome({ installDir: install, exeName, serverDir, home });
  step(`the copy follows: ${second.changed} files replaced (the running executable moved aside)`);
  if (second.changed < 2) fail("the update did not reach the copy");

  step("the installer closes everything started from the install folder");
  if (process.platform === "win32") {
    const script = `Get-CimInstance Win32_Process | ? { $_.Path -and $_.Path.StartsWith('${install.replace(/'/g, "''")}', 'CurrentCultureIgnoreCase') } | % { Stop-Process -Id $_.ProcessId -Force }`;
    execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "inherit" });
  }
  await new Promise((r) => setTimeout(r, 1500));
  if (exited !== null) fail(`the agent's server was closed (${exited})`);

  const after = await request("tools/call", { name: "list_boards", arguments: {} });
  const texts = (after.result?.content ?? []).map((c) => c.text);
  if (!texts[0]?.includes("RepoBoard was updated while you were connected") || !texts[0].includes("Always greet the owner first.")) {
    fail(`no word of the new rules: ${JSON.stringify(after).slice(0, 400)}`);
  }
  step("still connected, on the new tools, told the rules changed");

  // Starting again: what was moved aside goes once nothing uses it.
  child.kill();
  await new Promise((r) => setTimeout(r, 1500));
  await prepareMcpHome({ installDir: install, exeName, serverDir, home });
  const leftovers = fs.readdirSync(home).filter((f) => /\.old-\d+$/.test(f));
  if (leftovers.length) fail(`left behind: ${leftovers.join(", ")}`);
  step("the files moved aside are gone after the next start");
  console.log("OK");
} finally {
  if (exited === null) child.kill();
}
