/**
 * RepoBoard MCP server: the tools, their rules and the board they work on.
 * scripts/mcp-server.mjs is the thin process around it, and loads this file
 * again when it changes, so agents already connected follow a new version.
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
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Agents start this from their own project folder, so everything is resolved
// from where RepoBoard is installed, never from the current directory.
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME_DIR = path.join(os.homedir(), ".repoboard");
// Windows closes a server started from the install folder on every update, and
// clients do not reconnect it; the copy Settings points to survives (desktop/mcp-home.cjs).
const FROM_INSTALL_FOLDER =
  process.platform === "win32" && /[\\/]resources[\\/]server[\\/]mcp[\\/]/i.test(fileURLToPath(import.meta.url));

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
// Set by the process around this file; agentName() reads it once a client has connected.
let clientVersion = () => null;
export function setClient(read) {
  clientVersion = read;
}

/**
 * The repository the agent works in: the `origin` of the folder it was
 * started from, when that repository is connected in RepoBoard. Agents run in
 * their own checkout, so this keeps them on the right project even when the
 * person switches projects in the app. REPOBOARD_REPO names one explicitly.
 */
function checkoutRepo() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i += 1) {
    const config = path.join(dir, ".git", "config");
    if (fs.existsSync(config)) {
      const text = fs.readFileSync(config, "utf8");
      const origin = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
      // github.com or any GitLab server: the last two parts of the remote.
      const slug = origin?.[1].match(/[:/]([^/\s:]+\/[^/\s]+?)(?:\.git)?$/i)?.[1];
      return slug ?? null;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** The agent's checkout: its folder and the branch it has out (a worktree's .git is a file). */
function checkout() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i += 1) {
    const dotGit = path.join(dir, ".git");
    if (fs.existsSync(dotGit)) {
      let gitDir = dotGit;
      try {
        if (fs.statSync(dotGit).isFile()) gitDir = path.resolve(dir, fs.readFileSync(dotGit, "utf8").match(/gitdir:\s*(.+)/)?.[1].trim() ?? "");
        const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
        return { root: dir, branch: head.match(/^ref: refs\/heads\/(.+)$/)?.[1] ?? null };
      } catch {
        return { root: dir, branch: null };
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** The project: from the environment, the agent's checkout, or the app's active one. */
function activeProject() {
  let repo = process.env.REPOBOARD_REPO || process.env.GITHUB_REPO || null;
  let token = process.env.GITHUB_PAT || null;
  let host = null;
  if (!repo || !token) {
    try {
      const raw = JSON.parse(fs.readFileSync(credentialsFile(), "utf8"));
      if (raw?.version === 2) {
        const projects = raw.projects ?? [];
        const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
        const here = repo ? null : checkoutRepo();
        const found =
          projects.find((p) => same(p.repo, repo)) ??
          projects.find((p) => same(p.repo, here)) ??
          projects.find((p) => same(p.repo, raw.active));
        repo = repo ?? found?.repo ?? null;
        // Only the token that belongs to this repository.
        token = token ?? (found && same(found.repo, repo) ? found.token : null);
        host = found && same(found.repo, repo) ? (found.host ?? null) : null;
      } else {
        repo = repo ?? raw?.repo ?? null;
        token = token ?? raw?.token ?? null;
      }
    } catch {
      /* not connected */
    }
  }
  if (typeof repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  return { repo, token, host, id: `repo_${repo.replace("/", "_")}`.toLowerCase() };
}

/** The project's boards, the primary one (board_<repo>) first. */
function boardsOf(repoId) {
  return db
    .prepare("SELECT * FROM boards WHERE repository_id = ? AND archived_at IS NULL ORDER BY position, created_at")
    .all(repoId)
    .sort((a, b) => Number(b.id === `board_${repoId}`) - Number(a.id === `board_${repoId}`));
}

/**
 * The project and one of its boards: the one named (by name or id), or the
 * primary board. A project has a board per person or per area of work.
 */
function requireBoard(boardName) {
  const project = activeProject();
  const repo = project ? db.prepare("SELECT * FROM repositories WHERE id = ?").get(project.id) : null;
  const all = repo ? boardsOf(repo.id) : [];
  if (!repo || all.length === 0) {
    throw new Error("No board yet. Open RepoBoard and connect a GitHub repository first.");
  }
  let board = all[0];
  if (boardName) {
    const wanted = String(boardName).toLowerCase();
    board = all.find((b) => b.id === boardName || b.name.toLowerCase() === wanted || (b.owner ?? "").toLowerCase() === wanted);
    if (!board) {
      const names = all.map((b) => (b.owner ? `${b.name} (owner ${b.owner})` : b.name));
      throw new Error(`No board "${boardName}". Boards: ${names.join(", ")}`);
    }
  }
  return { project, repo, board, boards: all };
}

function columns(boardId) {
  return db.prepare("SELECT * FROM columns WHERE board_id = ? ORDER BY position").all(boardId);
}

function resolveColumn(boardId, name) {
  const all = columns(boardId);
  const available = all.map((c) => c.name).join(", ") || "none";
  // An empty name would match every column by prefix.
  if (typeof name !== "string" || name.trim() === "") throw new Error(`Name a column. Available: ${available}`);
  const wanted = name.trim().toLowerCase();
  const found =
    all.find((c) => c.name.toLowerCase() === wanted) ??
    all.find((c) => c.name.toLowerCase().startsWith(wanted));
  if (!found) throw new Error(`No column "${name}". Available: ${available}`);
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

/**
 * A card of the project by its id or its reference ("RB-12" or 12), deleted
 * ones included; null when there is none.
 */
function findCard(ref, boards = requireBoard().boards) {
  if ((typeof ref !== "string" && typeof ref !== "number") || String(ref).trim() === "") {
    throw new Error('Name a card: RB-12, 12 or the card id.');
  }
  const ids = boards.map((b) => b.id);
  const marks = ids.map(() => "?").join(",");
  const wanted = String(ref).trim();
  const number = wanted.match(/^(?:rb-?)?(\d+)$/i)?.[1];
  return (
    (number
      ? db.prepare(`SELECT * FROM tasks WHERE card_number = ? AND board_id IN (${marks}) ORDER BY deleted_at IS NOT NULL`).get(Number(number), ...ids)
      : db.prepare(`SELECT * FROM tasks WHERE id = ? AND board_id IN (${marks})`).get(wanted, ...ids)) ?? null
  );
}

/** Says what exists when a card reference finds nothing. */
function noCard(ref, boards) {
  const ids = boards.map((b) => b.id);
  const range = db
    .prepare(
      `SELECT MIN(card_number) AS lo, MAX(card_number) AS hi FROM tasks WHERE deleted_at IS NULL AND board_id IN (${ids.map(() => "?").join(",")})`,
    )
    .get(...ids);
  const known = range?.hi != null ? `cards here run RB-${range.lo} to RB-${range.hi}` : "the project has no cards yet";
  return new Error(`No card "${ref}" in this project (${known}; find one with search_cards or get_board).`);
}

/** Accepts the card's id or its reference ("RB-12" or 12). */
function cardOf(ref) {
  // Card numbers are unique across the project's boards, so RB-12 needs no board.
  const { boards } = requireBoard();
  const task = findCard(ref, boards);
  if (task?.deleted_at != null) {
    throw new Error(`${task.card_number != null ? `RB-${task.card_number}` : task.id} (${task.title}) is deleted; restore_card brings it back.`);
  }
  if (!task) throw noCard(ref, boards);
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
  const board = db.prepare("SELECT name FROM boards WHERE id = ?").get(task.board_id);
  return {
    id: task.id,
    ref: task.card_number != null ? `RB-${task.card_number}` : null,
    title: task.title,
    board: board?.name ?? null,
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
  const client = clientVersion();
  return client?.name || "AI agent";
}

/**
 * The name an agent goes by in the project — "Claude", "Codex" — the same way
 * the app shows it (components/Actor.tsx agentLabel). Cards and items
 * assigned to that name are this agent's work.
 */
function agentLabel(name = agentName()) {
  const n = String(name).toLowerCase();
  for (const [key, label] of [["claude", "Claude"], ["codex", "Codex"], ["cursor", "Cursor"], ["gemini", "Gemini"], ["copilot", "Copilot"], ["windsurf", "Windsurf"]]) {
    if (n.includes(key)) return label;
  }
  return String(name);
}

// The first time an agent works on a project, the activity feed says it joined —
// so the people on the project see who is at work, not a stranger's edits.
const introduced = new Set();
function introduce(repositoryId) {
  if (introduced.has(repositoryId)) return;
  introduced.add(repositoryId);
  const label = agentLabel();
  const before = db
    .prepare("SELECT actor FROM activity_events WHERE repository_id = ? AND actor_kind = 'agent'")
    .all(repositoryId)
    .some((e) => agentLabel(e.actor ?? "") === label);
  if (!before) {
    db.prepare(
      "INSERT INTO activity_events (id, repository_id, task_id, type, message, actor, actor_kind, created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(randomUUID(), repositoryId, null, "agent_joined", "joined the project", agentName(), "agent", now());
  }
}

function logActivity(repositoryId, taskId, type, message) {
  introduce(repositoryId);
  db.prepare(
    "INSERT INTO activity_events (id, repository_id, task_id, type, message, actor, actor_kind, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(randomUUID(), repositoryId, taskId, type, message, agentName(), "agent", now());
}

function nextCardNumber(boardId) {
  return db
    .prepare(
      "SELECT COALESCE(MAX(card_number), 0) + 1 AS n FROM tasks WHERE board_id IN (SELECT id FROM boards WHERE repository_id = (SELECT repository_id FROM boards WHERE id = ?))",
    )
    .get(boardId).n;
}

function priorityValue(word) {
  if (word == null) return undefined;
  const index = PRIORITY.indexOf(String(word).toLowerCase());
  if (index === -1) throw new Error(`Priority must be one of: ${PRIORITY.join(", ")}`);
  return index;
}

function dueValue(date) {
  if (date === undefined) return undefined;
  if (date === null || date === "") return null;
  const time = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (Number.isNaN(time)) throw new Error(`dueDate must look like 2026-10-01 (got "${date}")`);
  return time;
}

/** Labels as given, without blanks or repeats. */
const cleanLabels = (labels) => [...new Set((labels ?? []).map((l) => String(l).trim()).filter(Boolean))];

/* ------------------------------------------------------ checklist tree -- */

function flattenItems(list) {
  return list.flatMap((i) => [i, ...flattenItems(i.children ?? [])]);
}
/** Items numbered as the app shows them: 1, 1.1, 1.1.2. */
function numbered(list, prefix = "") {
  return list.flatMap((item, i) => {
    const number = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    return [{ number, item }, ...numbered(item.children ?? [], number)];
  });
}
/** An item by its number ("1.2") or its text; a number is never ambiguous. */
function findItem(list, text) {
  if (typeof text !== "string" && typeof text !== "number") return null;
  const wanted = String(text).trim();
  if (wanted === "") return null;
  if (/^\d+(\.\d+)*$/.test(wanted)) return numbered(list).find((n) => n.number === wanted)?.item ?? null;
  const lower = wanted.toLowerCase();
  return flattenItems(list).find((i) => i.text.trim().toLowerCase() === lower) ?? null;
}
function ancestorsOf(list, target, trail = []) {
  for (const item of list) {
    if (item === target) return trail;
    const found = ancestorsOf(item.children ?? [], target, [...trail, item]);
    if (found) return found;
  }
  return null;
}
const DONE_COLUMN = /^(done|complete|completed|shipped|closed)$/i;
const REVIEW_COLUMN = /review|qa|verify|check/i;

/**
 * Whether agents may close work in this project (Settings → AI agents):
 * "reason" — when they give proof (a reason and a note saying how they
 * know); "propose" — never, a person always does.
 */
function agentPolicy(repoId) {
  try {
    return db.prepare("SELECT agent_policy AS p FROM repositories WHERE id = ?").get(repoId)?.p === "propose" ? "propose" : "reason";
  } catch {
    return "reason"; // A database from before the setting existed.
  }
}

/** Why an agent may close work, and what its note has to show (lib/checklist.ts DONE_REASONS). */
const FINISH_REASONS = ["verified", "person_confirmed", "already_done", "cannot_be_checked"];
const PROOF = {
  verified: "how you checked it and what you saw (the command or test you ran and its result, the screen you opened)",
  person_confirmed: "who confirmed it and where (e.g. 'Dima said in chat on 27 Sept that he tested it on the TV')",
  already_done: "where it was done (commit, pull request or file)",
  cannot_be_checked: "why nobody can check it by looking",
};
const PROOF_TEXT = "verified (you checked it yourself), person_confirmed (a person told you they checked it), already_done (done before) or cannot_be_checked";
const WHY = { verified: "checked", person_confirmed: "a person confirmed", already_done: "done before", cannot_be_checked: "nothing to check" };

/**
 * Closing needs proof: a reason and a note that says how you know. Without
 * a reason the work goes to a person's check. Returns the record to keep, or
 * null (send it to check), or throws when the proof is missing or the
 * project lets only people close.
 */
function closing(repoId, reason, note) {
  if (!reason) return null;
  if (!FINISH_REASONS.includes(reason)) throw new Error(`reason must be one of: ${PROOF_TEXT}.`);
  if (String(note ?? "").trim().length > 4000) {
    throw new Error("note is the proof in short — keep it under 4000 characters; put long output in a comment (comment_on_card) and point to it.");
  }
  if (!note || String(note).trim().length < 12) {
    throw new Error(`Closing with reason "${reason}" needs proof in note: ${PROOF[reason]}. Without proof, leave out reason and the work goes to a person's check.`);
  }
  if (agentPolicy(repoId) === "propose") {
    throw new Error("In this project only people mark work done (Settings → AI agents). Leave out reason to send it for a person's check.");
  }
  return { name: agentLabel(), kind: "agent", reason, note: String(note).trim(), at: now() };
}
/** The card's items as the app numbers them, for "no such item" answers. */
function allTexts(list) {
  return numbered(list).map(({ number, item }) => `${number} ${item.text}`);
}
function noItem(given, list) {
  return new Error(`No checklist item "${given}" on this card. Items (by number or text): ${allTexts(list).join("; ") || "none"}`);
}
/** The record of an agent closing a card (tasks.done_by), or null to clear it. */
function setDoneBy(taskId, doneBy) {
  try {
    db.prepare("UPDATE tasks SET done_by = ? WHERE id = ?").run(doneBy ? JSON.stringify(doneBy) : null, taskId);
  } catch {
    // A database from before closing with a reason existed.
  }
}

/**
 * How the project's work is spread over its boards, in a line for the agent:
 * which boards exist, and when the main board has grown a pile that an area
 * board would hold better (many open cards, or a label shared by several).
 */
function boardAdvice(repoId, board, { placed = true } = {}) {
  const all = boardsOf(repoId);
  const main = all[0];
  if (!main || board.id !== main.id) return undefined;
  const done = columns(main.id).filter((c) => DONE_COLUMN.test(c.name.trim())).map((c) => c.id);
  const open = db.prepare("SELECT id, column_id FROM tasks WHERE board_id = ? AND deleted_at IS NULL").all(main.id).filter((t) => !done.includes(t.column_id));
  const names = new Set(all.map((b) => b.name.toLowerCase()));
  const byLabel = new Map();
  for (const t of open) {
    for (const label of labelsOf(t.id)) {
      const area = label.replace(/^area:/i, "").trim();
      if (!area || /^(worker|blocks|owner|bug|p\d)/i.test(label)) continue;
      byLabel.set(area, (byLabel.get(area) ?? 0) + 1);
    }
  }
  const areas = [...byLabel].filter(([area, n]) => n >= 4 && !names.has(area.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const others = all.slice(1).map((b) => b.name);
  const parts = [];
  if (others.length && placed) parts.push(`This went on the main board. Other boards: ${others.join(", ")} — pass board to put a card on one.`);
  if (areas.length) {
    parts.push(
      `The main board holds ${areas.map(([area, n]) => `${n} open cards labelled ${area}`).join(", ")}: a board per area would keep them together (create_board, then move_card with board).`,
    );
  } else if (open.length >= 15 && !others.length) {
    parts.push(`The main board has ${open.length} open cards and no other board. If they fall into large areas (Design, Security, Release…), give each area a board (create_board) and move its cards there (move_card with board).`);
  }
  return parts.join(" ") || undefined;
}

// Word edges by letters, not \b, which knows no Cyrillic.
const PLAN_WORDS =
  /(?<![\p{L}\p{N}])(day|week|phase|sprint|stage|step|день|неделя|этап|фаза|шаг|спринт)\s*\d|(?<![\p{L}\p{N}])(plan|roadmap|backlog|todo)(?![\p{L}\p{N}])|план|бэклог|задачи/iu;

/**
 * What is already in the wrong place, for an agent to put right: a plan of
 * work kept as a checklist document, cards whose steps sit in the
 * description, a main board that has grown a pile. Made before these rules
 * existed, or by an agent that never saw them.
 */
function tidyUp(repoId) {
  const out = [];
  for (const { row, snap } of documents(repoId)) {
    if (row.role === "board" || !snap || (snap.total ?? 0) < 5) continue;
    const headings = (snap.sections ?? []).map((section) => section.heading).filter(Boolean);
    if (![row.path, snap.title ?? "", ...headings].some((text) => PLAN_WORDS.test(text))) continue;
    out.push(
      `${row.path} ("${snap.title ?? row.path}", ${snap.total} items) is a plan of work kept as a checklist document. Work belongs on boards: make a card per item on the board of its area — its details as the card's items — with a milestone per section (${headings.slice(0, 3).join(", ") || "one per phase"}). Close with proof what you can show is done, leave the rest open or in Review, then remove the file in your checkout and tell the person.`,
    );
  }
  for (const { row, snap } of documents(repoId)) {
    if (row.role === "board" || !snap || (snap.total ?? 0) > 0 || (snap.textLines ?? 0) <= 8) continue;
    if (!row.path.startsWith(".repoboard/checklists/")) continue;
    out.push(
      `${row.path} is a checklist with ${snap.tables ? `${snap.tables} table(s) and ` : ""}${snap.textLines} lines of text but no checks: read it, and turn each requirement into a check (add_check: a statement, Verify, Source), or move it to .repoboard/notes/ if it is knowledge.`,
    );
  }
  const crowded = [];
  for (const board of boardsOf(repoId)) {
    for (const t of db.prepare("SELECT card_number, id, description, checklist FROM tasks WHERE board_id = ? AND deleted_at IS NULL").all(board.id)) {
      const items = t.checklist ? JSON.parse(t.checklist) : [];
      if (!items.length && stepsInDescription(t.description)) crowded.push(t.card_number != null ? `RB-${t.card_number}` : t.id);
    }
  }
  if (crowded.length) {
    out.push(
      `${crowded.slice(0, 10).join(", ")}${crowded.length > 10 ? ` and ${crowded.length - 10} more` : ""} keep their steps in the description: move each step into items (add_checklist_item, sub-items and notes on how to do and check it) and cut the description to a sentence or two (update_card).`,
    );
  }
  const main = boardsOf(repoId)[0];
  const pile = main ? boardAdvice(repoId, main, { placed: false }) : undefined;
  if (pile) out.push(pile);
  const repo = db.prepare("SELECT * FROM repositories WHERE id = ?").get(repoId);
  const unseen = repo ? unseenLocalDocs(repo) : null;
  if (unseen) out.push(unseen);
  return out.length ? out : undefined;
}

/** Where RepoBoard reads documents from: the branch chosen in Documents, else the default one. */
function documentsBranch(repo) {
  try {
    return db.prepare("SELECT docs_branch AS b FROM repositories WHERE id = ?").get(repo.id)?.b || repo.default_branch;
  } catch {
    return repo.default_branch; // A database from before the setting existed.
  }
}

/**
 * Files in the agent's own .repoboard/ that RepoBoard does not know: they are
 * on another branch than the one it reads, or not pushed yet. Said plainly —
 * otherwise the agent believes it is done and the person sees nothing.
 */
function unseenLocalDocs(repo) {
  const here = checkout();
  if (!here || (checkoutRepo() ?? "").toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase()) return null;
  const local = [];
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/${e.name}`);
      else if (e.name.endsWith(".md")) local.push(`${rel}/${e.name}`);
    }
  };
  walk(path.join(here.root, ".repoboard"), ".repoboard");
  const known = new Set(db.prepare("SELECT path FROM markdown_sources WHERE repository_id = ?").all(repo.id).map((r) => r.path));
  const unseen = local.filter((p) => !known.has(p));
  if (!unseen.length) return null;
  const branch = documentsBranch(repo);
  return `${unseen.length} file${unseen.length === 1 ? "" : "s"} in your .repoboard/ ${unseen.length === 1 ? "is" : "are"} not in RepoBoard: ${unseen.slice(0, 8).join(", ")}${unseen.length > 8 ? "…" : ""}. RepoBoard reads documents from the branch ${branch}${here.branch && here.branch !== branch ? `, and you are on ${here.branch}` : ""}; it looks there every minute. Push them to ${branch}${here.branch && here.branch !== branch ? `, or ask the person to read documents from ${here.branch} (Documents → Read from)` : ""} — until then nobody sees them. Do not report them as done before they show in list_documents.`;
}

/** Items as the agent sent them, checked field by field; the app's own shape out. */
function buildItems(raw, where = "items", depth = 0) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`"${where}" must be a list of items like { text, notes, items } — got ${kindOf(raw)}`);
  if (depth > 5) throw new Error(`"${where}" nests too deep: keep items to five levels`);
  return raw.map((entry, i) => {
    const at = `${where}[${i + 1}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${at} must be an item like { text, notes } — got ${kindOf(entry)}`);
    const unknown = Object.keys(entry).filter((k) => !["text", "notes", "assignee", "items"].includes(k));
    if (unknown.length) throw new Error(`${at}: unknown field "${unknown[0]}" — allowed: text, notes, assignee, items`);
    if (typeof entry.text !== "string" || !entry.text.trim()) throw new Error(`${at}.text is required — the step, as a short line`);
    if (entry.text.length > 2000) throw new Error(`${at}.text is longer than 2000 characters — keep the step short and put details in notes`);
    if ((entry.notes?.length ?? 0) > 40_000) throw new Error(`${at}.notes is longer than 40000 characters`);
    for (const field of ["notes", "assignee"]) {
      if (entry[field] != null && typeof entry[field] !== "string") throw new Error(`${at}.${field} must be a string — got ${kindOf(entry[field])}`);
    }
    return {
      id: randomUUID(),
      text: entry.text.trim(),
      done: false,
      notes: entry.notes?.trim() || null,
      assignee: entry.assignee?.trim() || null,
      children: buildItems(entry.items, `${at}.items`, depth + 1),
      comments: [],
    };
  });
}

/**
 * Steps written into a description instead of items: a list of three or more
 * lines, or a sentence of three or more parts split by semicolons.
 */
function stepsInDescription(description) {
  if (typeof description !== "string") return false;
  const listLines = description.split("\n").filter((l) => /^\s*([-*•]|\d+[.)]|\[[ xX?]\])\s+\S/.test(l)).length;
  const clauses = description.split(";").filter((part) => part.trim().length > 3).length;
  return listLines >= 3 || clauses >= 4;
}
const STEPS_BELONG_IN_ITEMS =
  "The description lists steps. Put each step in items instead — create_card(items: [{ text, notes, items: [...] }]) or add_checklist_item — with sub-items for the parts of a step and notes on how to do and how to check it. Keep the description to a sentence or two: what the card is for and why.";

function saveChecklist(taskId, list) {
  db.prepare("UPDATE tasks SET checklist = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(list), now(), taskId);
}

/* ------------------------------------------------------------ documents -- */

/* ------------------------------------------------ document proposals -- */

const DOC_FOLDERS = { checklist: "checklists", note: "notes", decision: "decisions" };
const slugOf = (title) =>
  String(title)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "document";

/** "RB-12", "12" or 12 → 12, for cards that exist in this project. */
function cardNumbers(repoId, refs) {
  return (refs ?? []).map((ref) => {
    const n = Number(String(ref).replace(/^rb-/i, ""));
    const exists =
      Number.isInteger(n) &&
      db.prepare("SELECT 1 FROM tasks WHERE card_number = ? AND board_id IN (SELECT id FROM boards WHERE repository_id = ?)").get(n, repoId);
    if (!exists) throw new Error(`No card ${ref} in this project (cards are RB-n: create_card first, then name it here).`);
    return n;
  });
}

function pendingProposals(repoId) {
  try {
    return db.prepare("SELECT * FROM doc_proposals WHERE repository_id = ? ORDER BY created_at").all(repoId);
  } catch {
    throw new Error("This RepoBoard is too old to take document changes from agents: update the app (0.6.7 or later).");
  }
}

/** A document by path, file name or title — a tracked one, or a new one still waiting for the person. */
function findDocument(repoId, wanted) {
  const w = String(wanted).trim().toLowerCase().replace(/^\/+/, "");
  const tracked = documents(repoId).filter(({ row }) => row.role !== "board");
  const hit =
    tracked.find(({ row }) => row.path.toLowerCase() === w) ??
    tracked.find(({ row }) => path.basename(row.path).toLowerCase() === w || path.basename(row.path, ".md").toLowerCase() === w) ??
    tracked.find(({ snap }) => (snap?.title ?? "").toLowerCase() === w);
  if (hit) return { kind: "tracked", path: hit.row.path, snap: hit.snap };
  const proposed = pendingProposals(repoId).filter((p) => p.content != null);
  const waiting =
    proposed.find((p) => p.path.toLowerCase() === w) ??
    proposed.find((p) => path.basename(p.path, ".md").toLowerCase() === w || (p.content.match(/^# (.+)$/m)?.[1] ?? "").toLowerCase() === w);
  if (waiting) return { kind: "proposed", path: waiting.path, proposal: waiting };
  const names = [...tracked.map(({ row }) => row.path), ...proposed.map((p) => `${p.path} (proposed)`)];
  throw new Error(`No document "${wanted}". Documents: ${names.join(", ") || "none yet — create_document makes one"}.`);
}

function propose(repoId, docPath, { edits = null, content = null, attachments = [] }, summary) {
  pendingProposals(repoId); // says plainly when the database is too old
  if (attachments.length) {
    try {
      db.prepare("SELECT attachments FROM doc_proposals LIMIT 0").all();
    } catch {
      throw new Error("This RepoBoard is too old to take screenshots from agents: update the app (0.6.11 or later).");
    }
  }
  db.prepare(
    `INSERT INTO doc_proposals (id, repository_id, path, edits, content, author, summary, created_at${attachments.length ? ", attachments" : ""}) VALUES (?,?,?,?,?,?,?,?${attachments.length ? ",?" : ""})`,
  ).run(randomUUID(), repoId, docPath, edits ? JSON.stringify(edits) : null, content, agentLabel(), summary, now(), ...(attachments.length ? [JSON.stringify(attachments)] : []));
}

/** A check as markdown lines: the statement with its cards, then Verify and Source. */
function checkLines(check, repoId) {
  const cards = cardNumbers(repoId, check.cards).map((n) => ` RB-${n}`).join("");
  return [
    `- [ ] ${String(check.text).trim().replace(/\s+/g, " ")}${cards}`,
    `  - Verify: ${String(check.verify).trim().replace(/\s+/g, " ")}`,
    ...(check.source ? [`  - Source: ${String(check.source).trim().replace(/\s+/g, " ")}`] : []),
  ];
}

/** Whether the project lets agents' documents be written at once (Settings → AI agents). */
function agentDocsMode(repo) {
  try {
    return db.prepare("SELECT agent_docs AS m FROM repositories WHERE id = ?").get(repo.id)?.m === "direct" ? "direct" : "review";
  } catch {
    return "review";
  }
}

const waitingNote = (repo, docPath) =>
  agentDocsMode(repo) === "direct" && docPath.startsWith(".repoboard/")
    ? `Queued: RepoBoard commits it to ${docPath} on ${documentsBranch(repo)} by itself within seconds, while the app is open. Confirm with list_documents (no "proposed" left) before you report it as done.`
    : `Proposed, not written yet: ${agentLabel()}'s change waits in RepoBoard until the person reviews it and commits it to ${docPath} on ${documentsBranch(repo)} (Documents). Do not report it as done until list_documents shows it without "proposed".`;

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
  if (!project.token) throw new Error("No token available to read the repository.");
  const segments = String(filePath).split("/").filter(Boolean);
  if (segments.some((seg) => seg === "." || seg === "..")) throw new Error("Paths are relative to the repository root, without . or ..");
  if (segments.length === 0) throw new Error("Name a file, e.g. .repoboard/checklists/release.md (list_documents shows the tracked ones).");
  // fetch() fails with a bare TypeError when the network is down; say so plainly.
  const get = async (url, headers, service) => {
    try {
      return await fetch(url, { headers });
    } catch (error) {
      throw new Error(`Could not reach ${service} to read ${filePath} (${error.cause?.code ?? error.message}).`);
    }
  };
  // A project connected from GitLab reads through GitLab's API.
  if (project.host?.kind === "gitlab" && typeof project.host.url === "string") {
    const gitlab = String(project.host.url).replace(/\/+$/, "");
    const url = `${gitlab}/api/v4/projects/${encodeURIComponent(project.repo)}/repository/files/${encodeURIComponent(segments.join("/"))}?ref=HEAD`;
    const response = await get(url, { authorization: `Bearer ${project.token}`, accept: "application/json" }, "GitLab");
    if (response.status === 404) throw new Error(`${filePath} is not in ${project.repo}`);
    if (!response.ok) throw new Error(`GitLab answered ${response.status} for ${filePath}`);
    const data = await response.json();
    if (typeof data?.content !== "string") throw new Error(`${filePath} is not a file GitLab can return as text`);
    return Buffer.from(data.content, "base64").toString("utf8");
  }
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const url = `${base}/repos/${project.repo}/contents/${segments.map(encodeURIComponent).join("/")}`;
  const response = await get(url, { authorization: `Bearer ${project.token}`, accept: "application/vnd.github+json" }, "GitHub");
  if (response.status === 404) throw new Error(`${filePath} is not in ${project.repo}`);
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${filePath}`);
  const data = await response.json();
  if (Array.isArray(data)) {
    throw new Error(`${filePath} is a folder, not a file. In it: ${data.map((entry) => entry.name).join(", ") || "nothing"}`);
  }
  if (typeof data?.content !== "string" || data.encoding !== "base64") {
    throw new Error(`${filePath} is not a file GitHub can return as text (too large, or not a regular file)`);
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}

const FORMAT_HINT =
  "Format: - [ ] todo, - [/] in progress, - [?] needs a person to check, - [x] done (people only), - [-] won't do. " +
  "Details as nested bullets (- Why: / - Do: / - Verify: / - Source:), review notes as a nested quote (> yourname YYYY-MM-DD: text). " +
  "When you set [?], add evidence as - Proof: lines (a link to the file and lines, or the quoted words). " +
  "Edit the file in your working copy and push; never mark items [x] yourself and never write - Checked: (people only).";

/* ---------------------------------------------------------------- tools -- */

const text = { type: "string" };
const itemFields = {
  text: { type: "string", description: "The step, short: what gets done" },
  notes: { type: "string", description: "Markdown: how to do it, how to check it, what to keep in mind" },
  assignee: { type: "string" },
};
const leaf = { type: "object", properties: itemFields, required: ["text"] };
const nested = (inner) => ({
  type: "array",
  description: "Sub-items, the same shape",
  items: { type: "object", properties: { ...itemFields, items: inner }, required: ["text"] },
});
/** A checklist as a tree: the card's steps, their sub-steps, notes on how to do and check each. */
const ITEMS = { ...nested(nested({ type: "array", items: leaf })), description: "The card's steps as items, nested with sub-items: [{ text, notes, items: [...] }]" };

const tools = [
  {
    name: "get_overview",
    description:
      "Start here. Where the project stands: overall progress, every checklist with its progress, what needs a person's check, milestones, the main board's columns and the other boards (per person or area).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_boards",
    description:
      "The project's boards — one per person (owner set) or per area of work — with how many cards are open and done on each.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_board",
    description:
      "Make a board for a large, lasting area of the work — Design, Security, Release, Legal — once it has several cards of its own (or clearly will). Look at list_boards first and use a board that fits; never one board per card. Cards and their steps go on it with create_card(board: …).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, description: "Short, by area: Design, Security, Release" },
        description: { type: "string", description: "What belongs on it" },
        owner: { type: "string", description: "A person's login, for a board of one person's work (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_board",
    description:
      "Every card on a board by column, with labels, priority, milestone, links and checklist. Without `board`, the main board.",
    inputSchema: { type: "object", properties: { board: { type: "string", description: "Board name, owner or id" } } },
  },
  {
    name: "search_cards",
    description: "Find cards by text in the title, description, labels or linked branch name.",
    inputSchema: { type: "object", properties: { query: text }, required: ["query"] },
  },
  {
    name: "create_card",
    description:
      "Add a card: a title, a short description (a sentence or two: what it is for and why), and its steps as items — nested sub-items for the parts of a step, each with notes on how to do and check it. Steps never go in the description. Put it on the board of its area (board); list_boards shows them. Returns its reference (RB-n) — mention it in commit messages to link them.",
    inputSchema: {
      type: "object",
      properties: {
        title: text,
        column: { type: "string", description: "Column name, e.g. Todo" },
        description: { type: "string", description: "A sentence or two: what the card is for and why. Steps go in items." },
        labels: { type: "array", items: text },
        assignee: text,
        priority: { type: "string", enum: PRIORITY },
        milestone: { type: "string", description: "Existing milestone name" },
        dueDate: { type: "string", description: "YYYY-MM-DD" },
        board: { type: "string", description: "Board name, owner or id (default: the main board)" },
        items: ITEMS,
        reason: { type: "string", enum: FINISH_REASONS, description: "Only to create it already done — see move_card" },
        note: { type: "string", description: "With reason: the proof — how you know it is done" },
      },
      required: ["title", "column"],
    },
  },
  {
    name: "move_card",
    description:
      "Move a card to another column, or with board to another board (to sort a crowded main board into area boards). To close it (a done column) give proof: reason and a note that says how you know — verified (you checked it yourself: what you ran and saw), person_confirmed (a person told you they checked it: who, where), already_done (where it was done) or cannot_be_checked (why). Without a reason, moving to Done sends it to Review for a person's check instead; say how to check it with comment_on_card. Writing the code is not proof that it works. The card shows your proof, and a person can reopen it. A card from the markdown file changes on the board only; the commit waits for the person's review in the app.",
    inputSchema: {
      type: "object",
      properties: {
        card: { type: "string", description: "RB-12, 12 or the card id" },
        column: text,
        board: { type: "string", description: "Move it to another board (name, owner or id); column is then that board's" },
        reason: { type: "string", enum: FINISH_REASONS, description: "Only for Done: why you may close it" },
        note: { type: "string", description: "With reason: the proof — how you know it is done" },
      },
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
        title: { type: "string", minLength: 1 },
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
        text: { type: "string", maxLength: 2000 },
        parent: { type: "string", description: "Text of the item to nest under (optional)" },
        notes: { type: "string", maxLength: 40_000, description: "Markdown: what to do, how to check it, what matters" },
        assignee: { type: "string", maxLength: 100 },
        items: ITEMS,
      },
      required: ["card", "text"],
    },
  },
  {
    name: "set_checklist_item",
    description:
      "Finish or reopen a checklist item, found by its number like 1.2 or its text. done: true with proof (reason and note: verified, person_confirmed, already_done or cannot_be_checked) closes it. done: true without a reason marks it 'needs a person's check' — say how to check it (update_checklist_item). done: false reopens it.",
    inputSchema: {
      type: "object",
      properties: {
        card: text,
        text,
        done: { type: "boolean" },
        reason: { type: "string", enum: FINISH_REASONS, description: "To close it outright: why you may" },
        note: { type: "string", description: "With reason: the proof — how you know it is done" },
      },
      required: ["card", "text", "done"],
    },
  },
  {
    name: "get_card",
    description:
      "One card in full: its fields, the numbered item tree (1, 1.1 …) with notes, assignees and comments, linked branches and pull requests, the comments on the card and its recent history.",
    inputSchema: { type: "object", properties: { card: { type: "string", description: "RB-12, 12 or the card id" } }, required: ["card"] },
  },
  {
    name: "update_checklist_item",
    description: "Change a checklist item's text, notes or assignee, or add a comment to it. Found by its current text.",
    inputSchema: {
      type: "object",
      properties: {
        card: text,
        item: { type: "string", description: "Current text of the item" },
        text: { type: "string", minLength: 1, maxLength: 2000, description: "New text" },
        notes: { type: "string", maxLength: 40_000 },
        assignee: { type: "string", maxLength: 100 },
        comment: { type: "string", maxLength: 10_000 },
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
    name: "create_document",
    description:
      "Propose a new document: a checklist of checks (things that must be true and be verified — the privacy policy, a release, store rules), a note, or a decision. For a release use kind checklist and a title like 'Release 1.0' (or 'Release next' until the version is decided). The person reviews and creates it; nothing is written to GitHub by you.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["checklist", "note", "decision"] },
        title: { type: "string", minLength: 1, maxLength: 200 },
        path: { type: "string", description: "Optional; default .repoboard/<checklists|notes|decisions>/<title>.md" },
        checks: {
          type: "array",
          description: "For a checklist: its checks, each a statement with how to verify it",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "What must be true, as a statement" },
              verify: { type: "string", description: "How a person checks it" },
              source: { type: "string", description: "Why it is required: a law, a store rule, a link" },
              cards: { type: "array", items: { type: "string" }, description: "RB-n of the cards doing its work" },
            },
            required: ["text", "verify"],
          },
        },
        text: { type: "string", maxLength: 40_000, description: "For a note or decision: its body, in markdown" },
      },
      required: ["kind", "title"],
    },
  },
  {
    name: "add_check",
    description:
      "Propose a check for a document: a statement that must hold, how to verify it, and why. Name the cards doing its work (RB-n). The person reviews and commits it.",
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Path, file name or title (list_documents)" },
        text: { type: "string", minLength: 1, maxLength: 2000, description: "What must be true, as a statement" },
        verify: { type: "string", minLength: 1, maxLength: 2000, description: "How a person checks it" },
        source: { type: "string", maxLength: 2000, description: "Why it is required" },
        cards: { type: "array", items: { type: "string" }, description: "RB-n of the cards doing its work" },
        section: { type: "string", description: "Heading to put it under (optional)" },
      },
      required: ["document", "text", "verify"],
    },
  },
  {
    name: "mark_check",
    description:
      "Mark a check in a document ready for the person's check ([?]) with evidence they can follow. proof: in plain words for the person, not for a developer — what you checked, how, and what you saw. Add what shows it: screenshots (image files you took, e.g. of the app or the TV — shown in the document), files with lines (they open in the repository), links. Never [x]: the person ticks it after looking.",
    inputSchema: {
      type: "object",
      properties: {
        document: { type: "string", description: "Path, file name or title (list_documents)" },
        check: { type: "string", description: "The check's text, or enough of it to find it" },
        proof: { type: "string", minLength: 12, maxLength: 4000, description: "Plain words for the person: what you checked, how, and what you saw" },
        screenshots: { type: "array", items: { type: "string" }, description: "Image files (png, jpg, webp; up to 5 MB each), a path in your checkout or absolute" },
        files: {
          type: "array",
          description: "Where in the repository it is done",
          items: {
            type: "object",
            properties: { path: { type: "string" }, from: { type: "number" }, to: { type: "number" } },
            required: ["path"],
          },
        },
        links: {
          type: "array",
          items: { type: "object", properties: { url: { type: "string" }, label: { type: "string" } }, required: ["url"] },
        },
      },
      required: ["document", "check", "proof"],
    },
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
      "Everything waiting for a person to verify: document items marked [?], cards in a review column, and card items marked for a check. When a person has told you one works, close it with reason person_confirmed (set_checklist_item, move_card) and say who and where.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "whoami",
    description:
      "How you appear in this project: your name as people see it (assign work to that name), and which project is open. Call it first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "my_work",
    description:
      "Cards and checklist items assigned to you (to your name from whoami), on every board, not done yet. Work on these; hand them over for a person to check when finished.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_activity",
    description: "Recent events on the board and documents, newest first.",
    inputSchema: { type: "object", properties: { limit: { type: "number", minimum: 1, description: "How many, up to 200 (default 30)" } } },
  },
];

const handlers = {
  get_overview() {
    const { repo, board, boards } = requireBoard();
    const cols = columns(board.id);
    const cards = db.prepare("SELECT column_id FROM tasks WHERE board_id = ? AND deleted_at IS NULL").all(board.id);
    // The main board's own source file is already counted as cards.
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
      documentsBranch: documentsBranch(repo),
      tidyUp: tidyUp(repo.id),
      progress: { done, total, percent: total ? Math.round((done / total) * 100) : 0 },
      board: cols.map((c) => ({ column: c.name, cards: cards.filter((t) => t.column_id === c.id).length })),
      // Other boards: one per person or area. Progress above counts the main board.
      boards: boards.length > 1 ? handlers.list_boards() : undefined,
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

  list_boards() {
    const { boards } = requireBoard();
    return boards.map((b) => {
      const cols = columns(b.id);
      const done = cols.filter((c) => /^(done|complete|completed|shipped|closed)$/i.test(c.name)).map((c) => c.id);
      const cards = db.prepare("SELECT column_id FROM tasks WHERE board_id = ? AND deleted_at IS NULL").all(b.id);
      const doneCount = cards.filter((c) => done.includes(c.column_id)).length;
      return {
        name: b.name,
        owner: b.owner ?? null,
        description: b.description ?? null,
        main: b.id === boards[0].id,
        open: cards.length - doneCount,
        done: doneCount,
        columns: cols.map((c) => c.name),
      };
    });
  },

  get_board({ board: boardName } = {}) {
    const { repo, board } = requireBoard(boardName);
    const cols = columns(board.id);
    const cards = db
      .prepare("SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL ORDER BY position")
      .all(board.id);
    return {
      repository: `${repo.owner}/${repo.name}`,
      board: board.name,
      owner: board.owner ?? null,
      defaultBranch: repo.default_branch,
      milestones: db.prepare("SELECT name FROM milestones WHERE board_id = ? ORDER BY position").all(board.id).map((m) => m.name),
      columns: cols.map((c) => ({
        name: c.name,
        cards: cards.filter((t) => t.column_id === c.id).map(serialiseCard),
      })),
    };
  },

  search_cards({ query }) {
    const { boards } = requireBoard();
    const q = String(query).toLowerCase();
    const ids = boards.map((b) => b.id);
    return db
      .prepare(`SELECT * FROM tasks WHERE board_id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL`)
      .all(...ids)
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

  create_card({ title, column, description, labels, assignee, priority, milestone, dueDate, board: boardName, reason, note, items }) {
    const { repo, board } = requireBoard(boardName);
    const checklist = buildItems(items);
    if (!checklist.length && stepsInDescription(description)) throw new Error(STEPS_BELONG_IN_ITEMS);
    let col = resolveColumn(board.id, column);
    // Agents propose, people verify: a card made done needs a reason; without one it waits in review.
    let doneBy = null;
    let sentToCheck = false;
    if (DONE_COLUMN.test(col.name.trim())) {
      doneBy = closing(repo.id, reason, note);
      if (!doneBy) {
        const review = columns(board.id).find((c) => REVIEW_COLUMN.test(c.name));
        if (!review) throw new Error(`Give a reason and a note to create it in ${col.name}, or create it in another column.`);
        col = review;
        sentToCheck = true;
      }
    }
    const id = randomUUID();
    const siblings = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE column_id = ? AND deleted_at IS NULL")
      .get(col.id).n;
    db.prepare(
      `INSERT INTO tasks (id, board_id, column_id, position, title, description, assignee, due_date, checklist,
        markdown_task_id, card_number, priority, milestone_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`,
    ).run(
      id,
      board.id,
      col.id,
      siblings,
      title,
      description ?? null,
      assignee ?? null,
      dueValue(dueDate) ?? null,
      JSON.stringify(checklist),
      nextCardNumber(board.id),
      priorityValue(priority) ?? 0,
      resolveMilestone(board.id, milestone),
      now(),
      now(),
    );
    for (const label of cleanLabels(labels)) {
      db.prepare("INSERT INTO task_labels (id, task_id, label) VALUES (?,?,?)").run(randomUUID(), id, label);
    }
    if (doneBy) setDoneBy(id, doneBy);
    logActivity(
      repo.id,
      id,
      "card_created",
      `created ${serialiseCard(cardOf(id)).ref} ${title} in ${col.name}${doneBy ? ` (${WHY[doneBy.reason]}: ${doneBy.note})` : ""}`,
    );
    return {
      ...serialiseCard(cardOf(id)),
      note:
        [
          sentToCheck ? `Created in ${col.name} for a person's check: give a reason and a note to create it done.` : null,
          checklist.length
            ? null
            : "No items yet: add the card's steps with add_checklist_item — nest the parts of a step under it (parent) and give each notes on how to do and check it.",
          boardName ? null : boardAdvice(repo.id, board),
        ]
          .filter(Boolean)
          .join(" ") || undefined,
    };
  },

  move_card({ card, column, reason, note, board: boardName }) {
    const { repo } = requireBoard();
    const task = cardOf(card);
    // To another board: the column is that board's; card number and links stay.
    const toBoard = boardName ? requireBoard(boardName).board : null;
    const crossing = toBoard && toBoard.id !== task.board_id;
    if (crossing && task.markdown_task_id) {
      throw new Error(`${serialiseCard(task).ref} comes from the markdown board file, so it stays on the main board.`);
    }
    const boardId = crossing ? toBoard.id : task.board_id;
    let target = resolveColumn(boardId, column);
    let doneBy = null;
    let sentToCheck = false;
    if (DONE_COLUMN.test(target.name.trim())) {
      doneBy = closing(repo.id, reason, note);
      if (!doneBy) {
        // The normal way: finished work waits for a person's check.
        const review = columns(boardId).find((c) => REVIEW_COLUMN.test(c.name));
        if (!review) {
          throw new Error(`To close it, give a reason and a note. Otherwise say it is ready and how to check it (comment_on_card).`);
        }
        target = review;
        sentToCheck = true;
      }
    }
    const from = db.prepare("SELECT name FROM columns WHERE id = ?").get(task.column_id);
    const position = db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE column_id = ? AND deleted_at IS NULL")
      .get(target.id).n;
    if (crossing) {
      // Milestones belong to a board: keep one of the same name there, else none.
      const milestone = task.milestone_id ? db.prepare("SELECT name FROM milestones WHERE id = ?").get(task.milestone_id) : null;
      const there = milestone ? db.prepare("SELECT id FROM milestones WHERE board_id = ? AND name = ?").get(boardId, milestone.name) : null;
      db.prepare("UPDATE tasks SET board_id = ?, column_id = ?, position = ?, milestone_id = ?, updated_at = ? WHERE id = ?").run(
        boardId,
        target.id,
        position,
        there?.id ?? null,
        now(),
        task.id,
      );
    } else {
      db.prepare("UPDATE tasks SET column_id = ?, position = ?, updated_at = ? WHERE id = ?").run(target.id, position, now(), task.id);
    }
    // Closed by the agent: say who and why; moved anywhere else, that record goes.
    setDoneBy(task.id, doneBy);
    logActivity(
      repo.id,
      task.id,
      "card_moved",
      crossing
        ? `moved ${task.title} to the board ${toBoard.name}, ${target.name}`
        : `moved ${task.title} from ${from?.name ?? "?"} to ${target.name}${doneBy ? ` (${WHY[doneBy.reason]}: ${doneBy.note})` : ""}`,
    );
    // Closed: the checks in documents this card works for can be verified now.
    const checksToVerify =
      DONE_COLUMN.test(target.name.trim()) && task.card_number != null
        ? documents(repo.id).flatMap(({ row, snap }) =>
            (snap?.items ?? [])
              .filter((i) => (i.cards ?? []).includes(task.card_number) && i.state !== "done" && i.state !== "review")
              .map((i) => ({ document: row.path, line: i.line + 1, check: i.title })),
          )
        : [];
    return {
      ...serialiseCard(cardOf(task.id)),
      ...(checksToVerify.length ? { checksToVerify } : {}),
      note: [
        checksToVerify.length
          ? `This card works for ${checksToVerify.length} check${checksToVerify.length === 1 ? "" : "s"} in documents: verify each against its Verify: line and mark_check with the proof.`
          : null,
        sentToCheck ? `Moved to ${target.name} for a person's check. Say how to check it with comment_on_card.` : null,
        task.markdown_task_id
          ? "Moved on the board. This card comes from the markdown file, so the matching commit is not made here — the person reviews and commits it in RepoBoard."
          : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
    };
  },

  update_card({ card, title, description, assignee, labels, priority, milestone, dueDate }) {
    const { repo } = requireBoard();
    const task = cardOf(card);
    const hasItems = (task.checklist ? JSON.parse(task.checklist) : []).length > 0;
    if (description !== undefined && !hasItems && stepsInDescription(description)) throw new Error(STEPS_BELONG_IN_ITEMS);
    const board = { id: task.board_id };
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
      for (const label of cleanLabels(labels)) {
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
    if (labels) changes.push(`set labels to ${cleanLabels(labels).join(", ") || "none"}`);
    logActivity(
      repo.id,
      task.id,
      "card_updated",
      `${changes.length ? changes.join(", ") : "updated"} on ${serialiseCard(cardOf(task.id)).ref ?? ""} ${title ?? task.title}`.trim(),
    );
    return serialiseCard(cardOf(task.id));
  },

  add_checklist_item({ card, text: itemText, parent, notes, assignee, items }) {
    const task = cardOf(card);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const item = { id: randomUUID(), text: itemText, done: false, notes: notes ?? null, assignee: assignee ?? null, children: buildItems(items), comments: [] };
    if (parent) {
      const host = findItem(list, parent);
      if (!host) throw noItem(parent, list);
      host.children = [...(host.children ?? []), item];
    } else {
      list.push(item);
    }
    saveChecklist(task.id, list);
    const { repo } = requireBoard();
    logActivity(repo.id, task.id, "card_updated", `added item “${itemText}”${parent ? ` under “${parent}”` : ""} to ${task.title}`);
    return { card: serialiseCard(cardOf(task.id)).ref, checklist: list };
  },

  set_checklist_item({ card, text: itemText, done, reason, note }) {
    const task = cardOf(card);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const item = findItem(list, itemText);
    if (!item) throw noItem(itemText, list);
    const { repo } = requireBoard();
    if (done) {
      const doneBy = closing(repo.id, reason, note);
      if (!doneBy) {
        // Finished, waiting for a person: the item shows "needs your check".
        item.review = true;
        saveChecklist(task.id, list);
        logActivity(repo.id, task.id, "card_updated", `marked “${item.text}” on ${task.title} for a check`);
        return { checklist: list, note: "Marked for a person's check. Say how to check it with update_checklist_item's comment." };
      }
      const closeAll = (i) => {
        i.done = true;
        i.review = false;
        i.doneBy = doneBy;
        for (const child of i.children ?? []) closeAll(child);
      };
      closeAll(item);
      saveChecklist(task.id, list);
      logActivity(
        repo.id,
        task.id,
        "card_updated",
        `closed “${item.text}” on ${task.title} (${WHY[doneBy.reason]}: ${doneBy.note})`,
      );
      return { checklist: list };
    }
    // Reopening an item reopens what contains it, as in the app.
    item.done = false;
    item.review = false;
    item.doneBy = null;
    for (const parent of ancestorsOf(list, item) ?? []) {
      parent.done = false;
      parent.doneBy = null;
    }
    saveChecklist(task.id, list);
    logActivity(repo.id, task.id, "card_updated", `reopened “${item.text}” on ${task.title}`);
    return { checklist: list };
  },

  create_board({ name, description, owner }) {
    const { repo, boards } = requireBoard();
    const wanted = String(name).trim();
    const same = boards.find((b) => b.name.toLowerCase() === wanted.toLowerCase());
    if (same) throw new Error(`There is already a board called ${same.name}. Boards: ${boards.map((b) => b.name).join(", ")}.`);
    const id = `board_${randomUUID()}`;
    const position = db.prepare("SELECT COUNT(*) AS n FROM boards WHERE repository_id = ?").get(repo.id).n;
    db.prepare(
      "INSERT INTO boards (id, repository_id, name, description, color, art, owner, position, created_at, updated_at) VALUES (?,?,?,?,NULL,NULL,?,?,?,?)",
    ).run(id, repo.id, wanted, description ?? null, owner ? String(owner).replace(/^@/, "") : null, position, now(), now());
    ["Todo", "In Progress", "Review", "Done"].forEach((column, index) => {
      db.prepare("INSERT INTO columns (id, board_id, name, position) VALUES (?,?,?,?)").run(`col_${id}_${index}`, id, column, index);
    });
    logActivity(repo.id, null, "board_created", `created the board ${wanted}`);
    return { board: wanted, id, columns: ["Todo", "In Progress", "Review", "Done"], next: `Put its cards there with create_card(board: "${wanted}").` };
  },

  update_checklist_item({ card, item: current, text: newText, notes, assignee, comment }) {
    const task = cardOf(card);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const item = findItem(list, current);
    if (!item) throw noItem(current, list);
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
    const { repo, boards } = requireBoard();
    const task = findCard(card, boards);
    if (!task) throw noCard(card, boards);
    if (task.deleted_at == null) return { ...serialiseCard(task), note: "This card was not deleted; nothing to restore." };
    const inColumn = db.prepare("SELECT name FROM columns WHERE id = ?").get(task.column_id);
    if (inColumn && DONE_COLUMN.test(inColumn.name.trim())) {
      throw new Error(`${task.title} was deleted while done; bringing it back would count as finished work. Ask a person to restore it.`);
    }
    db.prepare("UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(now(), task.id);
    logActivity(repo.id, task.id, "card_restored", `restored ${task.title}`);
    return serialiseCard(cardOf(task.id));
  },

  get_card({ card }) {
    const { repo } = requireBoard();
    const task = cardOf(card);
    const list = task.checklist ? JSON.parse(task.checklist) : [];
    const events = db
      .prepare("SELECT type, message, actor, actor_kind, created_at FROM activity_events WHERE repository_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 60")
      .all(repo.id, task.id);
    const who = (e) => (e.actor ? `${e.actor}${e.actor_kind === "agent" ? " (AI)" : ""}` : null);
    return {
      ...serialiseCard(task),
      items: numbered(list).map(({ number, item }) => ({
        number,
        text: item.text,
        done: Boolean(item.done),
        assignee: item.assignee ?? null,
        notes: item.notes ?? null,
        comments: (item.comments ?? []).map((c) => ({ by: c.author ?? null, text: c.text, at: c.at ? new Date(c.at).toISOString() : null })),
      })),
      comments: events
        .filter((e) => e.type === "comment")
        .map((e) => ({ by: who(e), text: e.message, at: new Date(e.created_at).toISOString() })),
      history: events
        .filter((e) => e.type !== "comment")
        .slice(0, 20)
        .map((e) => ({ by: who(e), what: e.message, at: new Date(e.created_at).toISOString() })),
    };
  },

  comment_on_card({ card, message }) {
    const { repo } = requireBoard();
    const task = cardOf(card);
    logActivity(repo.id, task.id, "comment", message);
    return { ok: true, card: task.title, message };
  },

  create_document({ kind, title, path: wanted, checks, text: body }) {
    const { repo } = requireBoard();
    const docPath = String(wanted ?? `.repoboard/${DOC_FOLDERS[kind]}/${slugOf(title)}.md`).trim().replace(/^\/+/, "");
    if (!docPath.endsWith(".md") || docPath.split("/").some((part) => part === ".." || part === "")) {
      throw new Error("path must be a .md file inside the repository, e.g. .repoboard/checklists/release-1.0.md");
    }
    if (documents(repo.id).some(({ row }) => row.path === docPath)) throw new Error(`${docPath} exists already: add_check adds checks to it.`);
    if (pendingProposals(repo.id).some((p) => p.path === docPath && p.content != null)) throw new Error(`${docPath} is proposed already and waits for the person: add_check adds to it.`);
    const lines = [`# ${String(title).trim()}`, ""];
    if (kind === "checklist") {
      for (const check of checks ?? []) lines.push(...checkLines(check, repo.id));
      if (!checks?.length) lines.push("- [ ] First check", "  - Verify: how a person checks it");
    } else if (body) {
      lines.push(String(body).trim());
    }
    propose(repo.id, docPath, { content: `${lines.join("\n")}\n` }, `New ${kind}: ${String(title).trim()}${checks?.length ? ` with ${checks.length} check${checks.length === 1 ? "" : "s"}` : ""}`);
    logActivity(repo.id, null, "doc_proposed", `proposed the ${kind} ${String(title).trim()} (${docPath})`);
    return { proposed: true, document: docPath, note: waitingNote(repo, docPath) };
  },

  add_check({ document, text: checkText, verify, source, cards, section }) {
    const { repo } = requireBoard();
    const doc = findDocument(repo.id, document);
    const check = { text: checkText, verify, source, cards };
    if (doc.kind === "proposed") {
      // Still waiting to be created: the check goes into the new file itself.
      const content = `${doc.proposal.content.replace(/\s*$/, "")}\n${checkLines(check, repo.id).join("\n")}\n`;
      db.prepare("UPDATE doc_proposals SET content = ? WHERE id = ?").run(content, doc.proposal.id);
    } else {
      const heading = section ? doc.snap?.sections?.find((x) => x.heading.toLowerCase() === String(section).toLowerCase())?.heading : null;
      if (section && !heading) {
        throw new Error(`No section "${section}" in ${doc.path}. Sections: ${(doc.snap?.sections ?? []).map((x) => x.heading).filter(Boolean).join(", ") || "none"}`);
      }
      const details = [`Verify: ${verify}`, ...(source ? [`Source: ${source}`] : [])];
      propose(repo.id, doc.path, { edits: [{ type: "add", section: heading ?? null, title: checkText, details, cards: cardNumbers(repo.id, cards) }] }, `Add the check “${checkText}”`);
    }
    logActivity(repo.id, null, "doc_proposed", `proposed the check “${checkText}” for ${doc.path}`);
    return { proposed: true, document: doc.path, note: waitingNote(repo, doc.path) };
  },

  mark_check({ document, check, proof, screenshots, files, links }) {
    const { repo } = requireBoard();
    const doc = findDocument(repo.id, document);
    if (doc.kind === "proposed") throw new Error(`${doc.path} is not created yet: the person creates it first.`);
    const w = String(check).trim().toLowerCase();
    const items = doc.snap?.items ?? [];
    const item = items.find((i) => (i.text ?? i.title).toLowerCase() === w) ?? items.find((i) => (i.text ?? i.title).toLowerCase().includes(w));
    if (!item) throw new Error(`No check "${check}" in ${doc.path}. Checks: ${items.map((i) => i.title).slice(0, 30).join("; ") || "none"}`);
    if (item.state === "done") throw new Error(`“${item.title}” is ticked already.`);
    const line = item.line;
    const title = item.text ?? item.title;
    // Evidence the person can open: screenshots committed beside the document, files, links.
    const attachments = [];
    const proofs = [];
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    (screenshots ?? []).forEach((given, index) => {
      const here = checkout();
      const file = path.isAbsolute(given) ? given : path.resolve(here?.root ?? process.cwd(), given);
      const ext = path.extname(file).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error(`screenshots[${index + 1}]: ${given} is not a png, jpg or webp picture`);
      let bytes;
      try {
        bytes = fs.readFileSync(file);
      } catch {
        throw new Error(`screenshots[${index + 1}]: no file ${file}`);
      }
      if (bytes.length > 5 * 1024 * 1024) throw new Error(`screenshots[${index + 1}]: ${given} is over 5 MB — make it smaller`);
      const where = `.repoboard/evidence/${slugOf(path.basename(doc.path, ".md"))}-${slugOf(item.title).slice(0, 40)}-${stamp}-${index + 1}${ext === ".jpeg" ? ".jpg" : ext}`;
      attachments.push({ path: where, base64: bytes.toString("base64") });
      proofs.push({ kind: "image", path: path.posix.relative(path.posix.dirname(doc.path), where), alt: `Screenshot by ${agentLabel()}` });
    });
    for (const f of files ?? []) {
      if (typeof f.path !== "string" || f.path.includes("..")) throw new Error("files: each needs a path inside the repository");
      // Named from the agent's checkout: a file that is not there would stop the person's commit.
      const here = checkout();
      if (here && (checkoutRepo() ?? "").toLowerCase() === `${repo.owner}/${repo.name}`.toLowerCase() && !fs.existsSync(path.join(here.root, f.path))) {
        throw new Error(`files: ${f.path} is not in your checkout — name files as they are in the repository, from its root.`);
      }
      proofs.push({ kind: "place", path: f.path.replace(/^\/+/, ""), from: f.from ?? null, to: f.to ?? null });
    }
    for (const l of links ?? []) {
      if (!/^https:\/\//.test(String(l.url))) throw new Error("links: each url must start with https://");
      proofs.push({ kind: "link", url: String(l.url), label: String(l.label ?? l.url) });
    }
    const said = { type: "note", line, title, author: agentLabel(), text: String(proof).trim() };
    const edits = proofs.length
      ? [said, { type: "proof", line, title, state: "review", proofs, by: agentLabel(), checked: false }]
      : [{ type: "state", line, title, state: "review" }, { ...said, text: `Proof: ${said.text}` }];
    propose(
      repo.id,
      doc.path,
      { edits, attachments },
      `“${item.title}” ready to check${proofs.length ? `, with ${proofs.length} proof${proofs.length === 1 ? "" : "s"}` : ""}: ${String(proof).trim().slice(0, 120)}`,
    );
    logActivity(repo.id, null, "doc_proposed", `marked “${item.title}” in ${doc.path} for a check`);
    return { proposed: true, document: doc.path, check: item.title, note: waitingNote(repo, doc.path) };
  },

  list_documents() {
    const { repo } = requireBoard();
    let proposals = [];
    try {
      proposals = pendingProposals(repo.id);
    } catch {
      proposals = [];
    }
    const waitingFor = (p) => proposals.filter((x) => x.path === p && x.edits).length;
    const newOnes = proposals
      .filter((p) => p.content != null)
      .map((p) => ({ path: p.path, title: p.content.match(/^# (.+)$/m)?.[1] ?? p.path, proposed: "new document, waiting for the person to create it" }));
    return [...newOnes, ...documents(repo.id).map(({ row, snap }) => ({
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
      ...(waitingFor(row.path) ? { proposed: `${waitingFor(row.path)} change(s) waiting for the person` } : {}),
      // Content without checkbox items reads as empty — it is not.
      ...((snap?.total ?? 0) === 0 && (snap?.textLines ?? 0) > 8
        ? {
            hint: `${snap?.tables ? `${snap.tables} table(s) and ` : ""}${snap?.textLines} lines of text, but no checkbox items: its requirements are not checks yet. Read it (read_document) before assuming it is empty; to track them, add each as a check (add_check) or leave it as a note.`,
          }
        : {}),
    }))];
  },

  async read_document({ path: filePath }) {
    const { project } = requireBoard();
    const content = await readFromGitHub(project, String(filePath).replace(/^\/+/, ""));
    return { path: filePath, format: FORMAT_HINT, content };
  },

  whoami() {
    const { project, repo } = requireBoard();
    introduce(repo.id);
    return {
      name: agentLabel(),
      reportedAs: agentName(),
      project: project.repo ?? `${repo.owner}/${repo.name}`,
      boards: boardsOf(repo.id).map((b) => b.name),
      // Documents live on this branch: files elsewhere are not seen (tidyUp says which).
      documentsBranch: documentsBranch(repo),
      // Put these right as part of your work, and tell the person what you moved.
      tidyUp: tidyUp(repo.id),
      note: `People assign work to you as "${agentLabel()}". Everything you change is shown under that name, marked AI.`,
      // Some clients never show the server's instructions: they come with the first answer too.
      rules: INSTRUCTIONS,
      setup: FROM_INSTALL_FOLDER
        ? "You are connected through RepoBoard's install folder, so every RepoBoard update will cut you off until the person reconnects you. Ask them once to set RepoBoard up again with the command in Settings → AI agents: it now runs from a copy that updates do not close."
        : undefined,
    };
  },

  my_work() {
    const { repo, boards } = requireBoard();
    introduce(repo.id);
    const me = agentLabel().toLowerCase();
    const mine = (who) => Boolean(who) && (String(who).toLowerCase() === me || agentLabel(String(who)).toLowerCase() === me);
    return boards.flatMap((board) => {
      const cols = new Map(columns(board.id).map((c) => [c.id, c.name]));
      return db
        .prepare("SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL")
        .all(board.id)
        .filter((t) => !DONE_COLUMN.test(cols.get(t.column_id) ?? ""))
        .flatMap((t) => {
          const card = t.card_number != null ? `RB-${t.card_number}` : t.id;
          const items = numbered(t.checklist ? JSON.parse(t.checklist) : [])
            .filter(({ item }) => mine(item.assignee) && !item.done)
            .map(({ number, item }) => ({ board: board.name, card, cardTitle: t.title, item: number, text: item.text }));
          const whole = mine(t.assignee) ? [{ board: board.name, card, cardTitle: t.title, column: cols.get(t.column_id) }] : [];
          return [...whole, ...items];
        });
    });
  },

  needs_check() {
    const { repo, boards } = requireBoard();
    const fromDocs = documents(repo.id).filter(({ row }) => row.role !== "board").flatMap(({ row, snap }) =>
      (snap?.items ?? [])
        .filter((i) => i.state === "review")
        .map((i) => ({ source: row.path, line: i.line + 1, item: i.title })),
    );
    const fromBoard = boards.flatMap((board) => {
      const review = columns(board.id).filter((c) => /review|qa|verify/i.test(c.name)).map((c) => c.id);
      return review.length
        ? db
            .prepare(
              `SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL AND column_id IN (${review.map(() => "?").join(",")})`,
            )
            .all(board.id, ...review)
            .map((t) => ({ source: `board ${board.name}`, card: t.card_number != null ? `RB-${t.card_number}` : t.id, item: t.title }))
        : [];
    });
    // Checks whose cards are all done while the check is still open: mark them [?] with proof.
    const doneCards = new Set();
    for (const board of boards) {
      const done = columns(board.id).filter((c) => DONE_COLUMN.test(c.name.trim())).map((c) => c.id);
      for (const t of db.prepare("SELECT card_number, column_id FROM tasks WHERE board_id = ? AND deleted_at IS NULL").all(board.id)) {
        if (t.card_number != null && done.includes(t.column_id)) doneCards.add(t.card_number);
      }
    }
    const workDone = documents(repo.id)
      .filter(({ row }) => row.role !== "board")
      .flatMap(({ row, snap }) =>
        (snap?.items ?? [])
          .filter((i) => (i.state === "todo" || i.state === "doing") && (i.cards ?? []).length > 0 && i.cards.every((n) => doneCards.has(n)))
          .map((i) => ({
            source: row.path,
            line: i.line + 1,
            item: i.title,
            workDone: i.cards.map((n) => `RB-${n}`).join(", "),
            next: "The work is done: check the item against its Verify: line, then set it to [?] with Proof: lines in your checkout.",
          })),
      );
    // Card items an agent marked for a check: close them with person_confirmed once a person says they work.
    const fromItems = boards.flatMap((board) =>
      db
        .prepare("SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL")
        .all(board.id)
        .flatMap((t) =>
          numbered(t.checklist ? JSON.parse(t.checklist) : [])
            .filter(({ item }) => item.review && !item.done)
            .map(({ number, item }) => ({
              source: `board ${board.name}`,
              card: t.card_number != null ? `RB-${t.card_number}` : t.id,
              itemNumber: number,
              item: item.text,
            })),
        ),
    );
    return [...fromDocs, ...workDone, ...fromBoard, ...fromItems];
  },

  get_activity({ limit = 30 } = {}) {
    const { repo } = requireBoard();
    return db
      .prepare(
        "SELECT type, message, task_id, actor, actor_kind, created_at FROM activity_events WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(repo.id, Math.min(Math.max(Math.floor(Number(limit)) || 30, 1), 200))
      .map((e) => ({
        by: e.actor ? `${e.actor}${e.actor_kind === "agent" ? " (AI)" : ""}` : null,
        type: e.type,
        message: e.message,
        cardId: e.task_id,
        at: new Date(e.created_at).toISOString(),
      }));
  },
};

/* ------------------------------------------------------------ arguments -- */

// Agents get arguments wrong — a missing column, an object where a string
// goes, "ten" for a limit. Each call is checked against its tool's
// inputSchema first, so the agent hears what was wrong and what is expected,
// never a database error.

const kindOf = (value) =>
  value === null ? "null" : Array.isArray(value) ? "a list" : typeof value === "object" ? "an object" : `a ${typeof value}`;

/** What the agent can pass for these, read from the project; null when unknown. */
function choicesFor(name, args) {
  try {
    const board = typeof args.board === "string" && args.board.trim() ? args.board : undefined;
    if (name === "board") return requireBoard().boards.map((b) => b.name);
    if (name === "column") {
      const card = typeof args.card === "string" && args.card.trim() ? findCard(args.card) : null;
      const boardId = card?.board_id ?? requireBoard(board).board.id;
      // Agents never put a card in a done column, so those are not offered.
      return columns(boardId).map((c) => c.name).filter((n) => !DONE_COLUMN.test(n.trim()));
    }
    if (name === "milestone") {
      const card = typeof args.card === "string" && args.card.trim() ? findCard(args.card) : null;
      const boardId = card?.board_id ?? requireBoard(board).board.id;
      return db.prepare("SELECT name FROM milestones WHERE board_id = ? ORDER BY position").all(boardId).map((m) => m.name);
    }
  } catch {
    /* no project, or the card itself is wrong — the handler says so */
  }
  return null;
}

function expectedOf(name, schema, args) {
  const choices = schema.enum ?? choicesFor(name, args);
  if (choices) return choices.length ? `one of: ${choices.join(", ")}` : `${schema.type} (there are none yet)`;
  const what = schema.type === "array" ? `a list of ${schema.items?.type ?? "value"}s` : `a ${schema.type}`;
  return schema.description ? `${what}: ${schema.description}` : what;
}

/** One line per argument, for answers that must say what the tool takes. */
function schemaSummary(tool) {
  const { properties = {}, required = [] } = tool.inputSchema;
  const parts = Object.entries(properties).map(([name, schema]) => {
    const type = schema.enum ? schema.enum.join("|") : schema.type === "array" ? `${schema.items?.type ?? "value"}[]` : schema.type;
    return `${name}${required.includes(name) ? "" : "?"}: ${type}`;
  });
  return `${tool.name}(${parts.join(", ")})`;
}

/**
 * Checks the arguments against the tool's inputSchema. Returns the arguments
 * to call the handler with (nulls on optional fields dropped, numbers given
 * as text read as numbers) or the problems found.
 */
function checkArguments(tool, raw) {
  const { properties = {}, required = [] } = tool.inputSchema;
  const allowed = Object.keys(properties);
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { problems: [`arguments must be an object with ${allowed.length ? allowed.join(", ") : "no fields"}, not ${kindOf(raw)}`] };
  }
  const args = {};
  const problems = [];
  for (const [name, value] of Object.entries(raw)) {
    if (!Object.hasOwn(properties, name)) {
      problems.push(
        allowed.length
          ? `unknown argument "${name}" — allowed: ${allowed.join(", ")}`
          : `unknown argument "${name}" — this tool takes no arguments`,
      );
    } else if (value !== null) {
      args[name] = value;
    }
  }
  for (const name of required) {
    const value = args[name];
    if (value === undefined || (typeof value === "string" && value.trim() === "")) {
      problems.push(`"${name}" is required — ${expectedOf(name, properties[name], args)}`);
    }
  }
  for (const [name, value] of Object.entries(args)) {
    const schema = properties[name];
    if (required.includes(name) && typeof value === "string" && value.trim() === "") continue;
    const wrong = () => problems.push(`"${name}" must be ${expectedOf(name, schema, args)} — got ${kindOf(value)}`);
    if (schema.type === "string") {
      if (typeof value !== "string") wrong();
      else if (schema.minLength && value.trim().length < schema.minLength) problems.push(`"${name}" must not be empty`);
      else if (schema.maxLength && value.length > schema.maxLength) problems.push(`"${name}" is longer than ${schema.maxLength} characters`);
      else if (schema.enum && !schema.enum.includes(value.toLowerCase())) {
        problems.push(`"${name}" must be one of: ${schema.enum.join(", ")} — got "${value}"`);
      }
    } else if (schema.type === "number") {
      const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof number !== "number" || !Number.isFinite(number)) problems.push(`"${name}" must be a number — got ${kindOf(value)}`);
      else if (schema.minimum != null && number < schema.minimum) problems.push(`"${name}" must be at least ${schema.minimum}`);
      else args[name] = number;
    } else if (schema.type === "boolean") {
      if (typeof value !== "boolean") problems.push(`"${name}" must be true or false — got ${kindOf(value)}`);
    } else if (schema.type === "array") {
      if (!Array.isArray(value)) wrong();
      else if (schema.items?.type) {
        const bad = value.findIndex((v) => typeof v !== schema.items.type);
        if (bad !== -1) problems.push(`"${name}" must be a list of ${schema.items.type}s — item ${bad + 1} is ${kindOf(value[bad])}`);
      }
    }
  }
  return problems.length ? { problems } : { args };
}

/**
 * better-sqlite3 and the JavaScript runtime speak about bindings and
 * constraints, not about cards. These errors mean the arguments reached a
 * place they should not have; the agent gets a plain answer instead.
 */
function internalReason(error) {
  const message = String(error?.message ?? "");
  const code = String(error?.code ?? "");
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return "the board database is busy — try again in a moment";
  if (code.startsWith("SQLITE_CONSTRAINT") || /constraint failed/i.test(message)) return "a value is missing or not allowed";
  if (/can only bind|parameter values|bind parameters|named parameters/i.test(message)) return "a value has the wrong type";
  if (code.startsWith("SQLITE_") || error?.name === "SqliteError") return "the board database refused it";
  if (error instanceof TypeError || error instanceof RangeError) return "a value is missing or has the wrong shape";
  return null;
}

/* --------------------------------------------------------------- server -- */

const INSTRUCTIONS = `RepoBoard: this project's work and the checks it has to pass, kept next to the code, shared by the people and every agent on it.

Start with whoami, then get_overview. If they list tidyUp, those are things already in the wrong place: put them right as part of your work and tell the person what you moved.

Two kinds of things — choose by what it is, not by habit:
- Work, something to do → a card on a board. It has an owner, a column and an end; the person watches the boards to see what is happening.
  Title; a sentence or two on what it is for; every step as an item (create_card items, add_checklist_item), sub-items for the parts of a step, and notes on how to do and how to check each. Never the steps in the description.
  A board per large area (Design, Security, Release…) once it has several cards: create_board, and move_card(board) to sort a crowded main board. Not a board per card.
- A check, something that must be true and be verified — often again, before every release → an item in a document under .repoboard/checklists/: privacy and legal requirements, a release gate, store rules, licences. Write it as a statement ("Impressum reachable in two taps"), with Verify: (how to check) and Source: (why it is required). It stays after the work is done: that is its point. Knowledge goes in .repoboard/notes/, decisions and their reasons in .repoboard/decisions/.
  Use the tools for documents: create_document, add_check, mark_check. They show in the app at once; depending on the project RepoBoard commits them itself or they wait for the person's review — the answer says which. Editing .repoboard/ files in your checkout works too, but RepoBoard only sees them once they are on its documents branch.
- Join them. When a check needs work, make the card and name it on the check (add_check cards: ["RB-12"]). The card page then shows which check it serves, the document shows the card and its state, and when the card is done the check appears in needs_check as "work done — check it".
  If you would write "Day 1" or "Step 3" into a document, it is work: cards, a milestone per phase.
- A release is a document too: .repoboard/checklists/release-<version>.md — everything that must be true before that version ships (tests pass, store listing, privacy policy current, licences, what changed). When you learn of something important for a release — a requirement, a risk, a thing not to forget — add it there as a check, not only in a card or a chat.

Finishing work — close it when you can prove it is done, send it to a person when you cannot:
- Close it (move_card to Done, set_checklist_item done: true) with a reason and the proof in note:
  verified — you checked it yourself: ran the tests or the app and saw it work (say what you ran and what you saw);
  person_confirmed — a person told you they checked it, now or earlier in the conversation (say who and where);
  already_done — it was done before (the commit, pull request or file);
  cannot_be_checked — there is nothing to look at (say why).
- Writing the code is not proof. Without proof, leave out reason: the card goes to Review (the item is marked for a check) — say in a comment how to check it.
- A check in a document is never ticked [x] by you: when its work is done, check it against Verify:, then mark_check. Write the proof for the person, in plain words (what you checked, how, what you saw), and attach what shows it: a screenshot when there is something to see (the app, the TV, a page), the files and lines where it is done, links. A person ticks it after looking. Closing a card tells you which checks it works for.
- Look at needs_check now and then: close with person_confirmed what a person has since said works, and take up checks whose work is done.
- Your proof shows on the card; a person can reopen it.

You cannot commit to GitHub from here. Documents change through the tools above (the person commits them), or through .repoboard/ files you commit yourself — RepoBoard reads documents from one branch, documentsBranch in whoami, and only sees them once they are there. A proposed change is not done until list_documents shows it without "proposed". A document with text but no checks is not empty: read it.`;

/** Changes whenever the rules change: the process around this tells connected agents. */
export const RULES_VERSION = createHash("sha1").update(INSTRUCTIONS).digest("hex").slice(0, 12);
export { INSTRUCTIONS, tools, dbFile };

const refuse = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

/** One tool call, checked against its schema, in one transaction; errors in plain words. */
export async function callTool(name, rawArgs) {
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
  const tool = tools.find((t) => t.name === name);
  if (!handler || !tool) return refuse(`Unknown tool ${name}. Tools: ${tools.map((t) => t.name).join(", ")}`);
  const checked = checkArguments(tool, rawArgs);
  if (checked.problems) return refuse(`${name}: ${checked.problems.join("; ")}`);
  try {
    // A call that writes several rows writes all of them or none, so a
    // failure halfway never leaves half a card behind. read_document is the
    // one async handler and only reads.
    const result =
      handler.constructor.name === "AsyncFunction" ? await handler(checked.args) : db.transaction(() => handler(checked.args))();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    // A rolled-back call may have taken the "joined the project" event with it;
    // the next call looks in the database again.
    introduced.clear();
    const reason = internalReason(error);
    if (!reason) return refuse(error.message);
    console.error(`[repoboard-mcp] ${name} failed:`, error);
    return refuse(`${name}: RepoBoard could not do that with these arguments (${reason}). Check the arguments: ${schemaSummary(tool)}`);
  }
}

/** A newer copy of this file took over: let go of the database. */
export function close() {
  try {
    db.close();
  } catch {
    // Already closed.
  }
}
