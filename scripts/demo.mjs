#!/usr/bin/env node
/**
 * `npm run demo` — RepoBoard with a made-up project, no GitHub account needed.
 *
 * Starts the fake GitHub API (scripts/demo-github.mjs), then the app against
 * it with its own database, and fills the board once. Nothing here touches a
 * real repository or your own board in ~/.repoboard.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = Number(process.env.DEMO_PORT ?? 3100);
const API_PORT = Number(process.env.DEMO_GITHUB_PORT ?? 4010);
const dataDir = path.join(os.tmpdir(), "repoboard-demo-data");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "demo.db");
const fresh = !fs.existsSync(dbFile) || process.argv.includes("--reset");
if (fresh) for (const f of fs.readdirSync(dataDir)) fs.rmSync(path.join(dataDir, f));

const children = [];
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

children.push(
  spawn(process.execPath, [path.join(root, "scripts/demo-github.mjs"), String(API_PORT)], { stdio: "inherit" }),
);

const nextBin = path.join(root, "node_modules/next/dist/bin/next");
children.push(
  spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", String(APP_PORT)], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-demo",
      DATABASE_URL: `file:${dbFile}`,
      GITHUB_API_URL: `http://127.0.0.1:${API_PORT}`,
      GITHUB_REPO: "lumen/browser",
      GITHUB_PAT: "demo-token-not-a-secret",
    },
  }),
);
children[1].stdout.on("data", (chunk) => process.stdout.write(chunk));

const base = `http://127.0.0.1:${APP_PORT}`;
const post = (url, body) =>
  fetch(base + url, { method: "POST", headers: { "content-type": "application/json", "x-repoboard": "1" }, body: JSON.stringify(body) }).then(
    (r) => r.json(),
  );

async function waitForApp() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${base}/board`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The app did not start");
}

async function seed() {
  await post("/api/markdown", { action: "set-source", path: "ROADMAP.md" });
  await post("/api/markdown", { action: "sync" });
  await post("/api/docs", { action: "sync-workspace" });

  const day = 86_400_000;
  const today = Math.floor(Date.now() / day) * day;
  const beta = (await post("/api/board", { action: "milestone-create", name: "Public beta", dueDate: today + 9 * day })).id;
  const store = (await post("/api/board", { action: "milestone-create", name: "Play Store 1.0", dueDate: today + 30 * day })).id;

  const board = await (await fetch(`${base}/api/board`)).json();
  const card = (n) => board.tasks.find((t) => t.number === n);
  const update = (n, patch) => card(n) && post("/api/board", { action: "update", taskId: card(n).id, ...patch });

  await update(1, { priority: 3, labels: ["remote", "ux"], milestoneId: store, assignee: "sam" });
  await update(2, { priority: 4, labels: ["reading"] });
  await update(3, { priority: 0, labels: ["remote"] });
  await update(4, {
    priority: 2,
    labels: ["privacy"],
    milestoneId: beta,
    assignee: "alex",
    dueDate: today + 3 * day,
    description:
      "Each private tab gets its own **cookie jar**; nothing about it is written to disk.\n\nPolicy: [[checklists/privacy-policy]]. Commits: write `RB-4` in the message.",
    checklist: [
      { id: "a", text: "Separate cookie store per private tab", done: true },
      { id: "b", text: "Clear everything when the last private tab closes", done: true },
      { id: "c", text: "Indicator in the address bar", done: false },
      { id: "d", text: "Tests on Android TV 9 and 12", done: false },
    ],
  });
  await update(5, { priority: 3, labels: ["privacy"], milestoneId: beta });
  await update(6, { priority: 1, labels: ["bug"], milestoneId: beta, assignee: "codex", dueDate: today - day });
  await update(7, { labels: ["tv"], milestoneId: beta });
  await update(8, { labels: ["feature"], milestoneId: beta });

  await post("/api/board", {
    action: "create",
    columnId: board.columns[0].id,
    title: "Remote's back button closes the app from settings",
    labels: ["bug", "tv"],
    priority: 2,
    milestoneId: beta,
  });
  await post("/api/board", {
    action: "comment",
    taskId: card(6).id,
    message: "codex: PR #8 is ready. Crash loop protection skips a tab that crashed twice.",
  });
}

try {
  await waitForApp();
  if (fresh) {
    console.log("[demo] filling the board…");
    await seed();
  }
  console.log(`\n  RepoBoard demo is running: ${base}\n  (Ctrl+C to stop; npm run demo -- --reset starts over)\n`);
} catch (error) {
  console.error("[demo]", error.message);
  stop();
}
