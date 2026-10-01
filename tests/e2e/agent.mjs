// An agent connected to A while the plan is kept in its own repository:
// it reads documents from there, proposes a check, and the person's save
// commits it to the plan's repository — never to the code.
import { spawn } from "node:child_process";
const E = process.env.E2E_DIR ?? `${(await import("node:os")).tmpdir()}/repoboard-e2e`;
const A = "http://127.0.0.1:3107";
const GH = "http://127.0.0.1:4011";
const ALEX = "github_pat_11ALEXTEST000000000000_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab";
let failures = 0;
const ok = (c, w, x) => (c ? console.log(`  ✓ ${w}`) : (failures++, console.log(`  ✗ ${w}${x !== undefined ? ` — ${JSON.stringify(x).slice(0, 400)}` : ""}`)));
const call = async (path, body) => {
  const res = await fetch(A + path, body ? { method: "POST", headers: { "content-type": "application/json", "x-repoboard": "1" }, body: JSON.stringify(body) } : {});
  return res.json().catch(() => ({}));
};
const file = async (repo, p) => {
  const r = await fetch(`${GH}/repos/${repo}/contents/${p}`, { headers: { authorization: `token ${ALEX}` } });
  return r.status === 200 ? Buffer.from((await r.json()).content, "base64").toString("utf8") : null;
};

console.log("Agent, plan in lumen/browser-plan");
let r = await call("/api/plan", { action: "move", to: { mode: "repo", repo: "lumen/browser-plan" }, leaveNote: true, removeOld: false });
ok(typeof r.copied === "number", "A keeps the plan in lumen/browser-plan again", r.error ?? r.place);

const mcp = spawn(process.execPath, ["scripts/mcp-server.mjs"], {
  cwd: new URL("../..", import.meta.url).pathname,
  env: { ...process.env, HOME: `${E}/a/home`, DATABASE_URL: `${E}/a/rb.db`, GITHUB_API_URL: GH, REPOBOARD_AGENT: "Claude" },
  stdio: ["pipe", "pipe", "pipe"],
});
let buffer = "";
const waiting = new Map();
mcp.stdout.on("data", (d) => {
  buffer += d;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    try {
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    } catch {}
  }
});
let id = 0;
const rpc = (method, params) =>
  new Promise((resolve) => {
    id += 1;
    waiting.set(id, resolve);
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const tool = async (name, args = {}) => {
  const res = await rpc("tools/call", { name, arguments: args });
  const text = res.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(res.error);
  try {
    return JSON.parse(res.result.content.at(-1).text);
  } catch {
    return { text };
  }
};
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });

const who = await tool("whoami");
ok(who.plan?.mode === "repo" && who.plan.repo === "lumen/browser-plan", "whoami says where the plan is kept", who.plan ?? who);
const doc = await tool("read_document", { path: ".repoboard/checklists/privacy-policy.md" });
ok((doc.content ?? "").includes("Заметка после переезда"), "read_document reads it from the plan's repository", doc.text ?? Object.keys(doc));
const code = await tool("read_document", { path: "README.md" });
ok(typeof code.content === "string" && code.content.length > 0, "a code file is still read from the code", code.text);
const add = await tool("add_check", { document: ".repoboard/checklists/release-1.0.md", text: "Агент: проверить подпись сборки", verify: "Открыть свойства файла и увидеть подпись" });
ok(!add.error && !/error/i.test(add.text ?? ""), "add_check proposed a check", add);
mcp.kill();

r = await call("/api/docs", { action: "save-all", yours: [], seen: {} });
ok(r.documents >= 1, "the person's save-all takes the agent's check", r);
ok((await file("lumen/browser-plan", ".repoboard/checklists/release-1.0.md"))?.includes("проверить подпись сборки"), "it is committed to the plan's repository");
ok(!(await file("lumen/browser", ".repoboard/checklists/release-1.0.md"))?.includes("проверить подпись сборки"), "and not to the code");
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
