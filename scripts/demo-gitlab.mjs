#!/usr/bin/env node
/**
 * A tiny stand-in for the GitLab REST API (v4), in memory — for testing
 * RepoBoard's GitLab path end to end without a GitLab account.
 *
 * It answers only what lib/gitlab/client.ts asks and keeps GitLab's rules
 * where RepoBoard depends on them: a commit's actions fail together (create
 * when the file exists, update or delete with an older last_commit_id),
 * an empty project has no default branch until its first commit, private
 * projects are invisible to non-members, and a new project is private.
 *
 *   node scripts/demo-gitlab.mjs [port]       (default 4012)
 *
 * Keys: any → alex (owner of lumen/browser); …member-sam_… → sam (Developer);
 * …noplan… → alex, but the key opens only lumen/browser.
 * Test helper: POST /__test/projects/:group/:name/members {username, level}.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "..", "demo", "repository");
const PORT = Number(process.argv[2] ?? 4012);
const BASE = `http://127.0.0.1:${PORT}`;

const blobSha = (bytes) => crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const fakeSha = () => crypto.randomBytes(20).toString("hex");
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const notFound = (res, what = "404 Project Not Found") => send(res, 404, { message: what });
const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data ? JSON.parse(data) : {}));
  });

function readFolder(dir, files = new Map(), root = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readFolder(full, files, root);
    else files.set(path.relative(root, full).split(path.sep).join("/"), fs.readFileSync(full));
  }
  return files;
}

let nextId = 1;
const namespaces = new Map([
  ["alex", { id: 100, kind: "user", full_path: "alex" }],
  ["sam", { id: 101, kind: "user", full_path: "sam" }],
  ["lumen", { id: 200, kind: "group", full_path: "lumen" }],
]);

class Project {
  constructor({ group, name, visibility = "private", description = "" }) {
    Object.assign(this, { id: nextId++, group, name, visibility, description });
    this.branches = new Map(); // name → commit id
    this.commits = new Map(); // id → { id, title, message, author, parents, date, files: Map(path → { bytes, last }) }
    this.members = new Map(); // username → access level
  }
  get slug() {
    return `${this.group}/${this.name}`;
  }
  get defaultBranch() {
    return this.branches.size ? "main" : null;
  }
  head(ref) {
    if (!ref) return this.branches.get("main") ?? null;
    return this.branches.get(ref) ?? (this.commits.has(ref) ? ref : null);
  }
  files(ref) {
    const id = this.head(ref);
    return id ? this.commits.get(id).files : null;
  }
  commit({ branch, message, files, author, parents }) {
    const id = fakeSha();
    this.commits.set(id, { id, title: message.split("\n")[0], message, author, parents, date: new Date().toISOString(), files });
    this.branches.set(branch, id);
    return id;
  }
  history(ref) {
    const out = [];
    let id = this.head(ref);
    const seen = new Set();
    const queue = id ? [id] : [];
    while (queue.length) {
      id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const c = this.commits.get(id);
      if (!c) continue;
      out.push(c);
      queue.push(...c.parents);
    }
    return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }
}

const projects = new Map();
const add = (p) => (projects.set(p.slug.toLowerCase(), p), p);
const code = add(new Project({ group: "lumen", name: "browser", visibility: "public", description: "A calm, private web browser" }));
code.members.set("alex", 50);
code.members.set("sam", 30);
{
  const files = new Map();
  const id0 = fakeSha();
  for (const [p, bytes] of readFolder(SOURCE)) files.set(p, { bytes, last: id0 });
  code.commits.set(id0, { id: id0, title: "Lumen: first version", message: "Lumen: first version", author: "alex", parents: [], date: new Date(Date.now() - 86_400_000).toISOString(), files });
  code.branches.set("main", id0);
}

function whoIs(key) {
  if (/revoked/.test(key)) return null;
  const sam = /member-sam_/.test(key);
  return { username: sam ? "sam" : "alex", only: /noplan/.test(key) ? code.slug.toLowerCase() : null };
}
function level(project, who) {
  if (who.only && project.slug.toLowerCase() !== who.only) return null;
  const l = project.members.get(who.username);
  if (l) return l;
  return project.visibility === "public" ? 10 : null;
}
function projectJson(p, lvl) {
  const head = p.history()[0];
  return {
    id: p.id,
    path: p.name,
    path_with_namespace: p.slug,
    namespace: { full_path: p.group },
    default_branch: p.defaultBranch,
    visibility: p.visibility,
    web_url: `${BASE}/${p.slug}`,
    last_activity_at: head?.date ?? null,
    description: p.description,
    empty_repo: !p.branches.size,
    permissions: { project_access: lvl >= 20 ? { access_level: lvl } : null, group_access: null },
  };
}
const commitJson = (p, c) => ({
  id: c.id,
  short_id: c.id.slice(0, 8),
  title: c.title,
  message: c.message,
  author_name: c.author,
  committed_date: c.date,
  authored_date: c.date,
  parent_ids: c.parents,
  web_url: `${BASE}/${p.slug}/-/commit/${c.id}`,
});

async function handleProject(p, lvl, who, rest, req, res, url) {
  const write = lvl >= 30;
  if (req.method !== "GET" && !write) return send(res, 403, { message: "403 Forbidden" });
  if (rest === "") return send(res, 200, projectJson(p, lvl));

  if (rest === "/repository/branches" && req.method === "GET") {
    return send(res, 200, [...p.branches].map(([name, id]) => ({ name, protected: name === "main", commit: commitJson(p, p.commits.get(id)) })));
  }
  if (rest === "/repository/branches" && req.method === "POST") {
    const branch = url.searchParams.get("branch");
    const ref = url.searchParams.get("ref");
    if (p.branches.has(branch)) return send(res, 400, { message: "Branch already exists" });
    const id = p.head(ref);
    if (!id) return send(res, 400, { message: "Invalid reference name" });
    p.branches.set(branch, id);
    return send(res, 201, { name: branch, commit: commitJson(p, p.commits.get(id)) });
  }
  const oneBranch = rest.match(/^\/repository\/branches\/(.+)$/);
  if (oneBranch) {
    const id = p.branches.get(decodeURIComponent(oneBranch[1]));
    return id ? send(res, 200, { name: decodeURIComponent(oneBranch[1]), commit: commitJson(p, p.commits.get(id)) }) : notFound(res, "404 Branch Not Found");
  }
  if (rest === "/repository/tree") {
    const files = p.files(url.searchParams.get("ref") ?? undefined);
    if (!files) return notFound(res, "404 Tree Not Found");
    return send(res, 200, [...files.keys()].map((path) => ({ path, type: "blob", name: path.split("/").pop() })));
  }
  const file = rest.match(/^\/repository\/files\/(.+)$/);
  if (file) {
    const filePath = decodeURIComponent(file[1]);
    if (req.method === "GET") {
      const files = p.files(url.searchParams.get("ref") ?? undefined);
      const f = files?.get(filePath);
      if (!f) return notFound(res, "404 File Not Found");
      return send(res, 200, { file_path: filePath, content: f.bytes.toString("base64"), encoding: "base64", blob_id: blobSha(f.bytes), last_commit_id: f.last });
    }
    const body = await readBody(req);
    return commitActions(p, who, res, {
      branch: body.branch,
      commit_message: body.commit_message,
      actions: [{ action: req.method === "POST" ? "create" : "update", file_path: filePath, content: body.content, encoding: body.encoding, last_commit_id: body.last_commit_id }],
    }, true);
  }
  if (rest === "/repository/commits" && req.method === "POST") return commitActions(p, who, res, await readBody(req));
  if (rest === "/repository/commits") {
    const list = p.history(url.searchParams.get("ref_name") ?? undefined);
    if (!list.length) return notFound(res, "404 Commits Not Found");
    return send(res, 200, list.slice(0, Number(url.searchParams.get("per_page") ?? 20)).map((c) => commitJson(p, c)));
  }
  const oneCommit = rest.match(/^\/repository\/commits\/([^/]+)(\/diff)?$/);
  if (oneCommit) {
    const c = p.commits.get(p.head(decodeURIComponent(oneCommit[1])));
    if (!c) return notFound(res, "404 Commit Not Found");
    return oneCommit[2] ? send(res, 200, []) : send(res, 200, { ...commitJson(p, c), stats: { additions: 1, deletions: 0 } });
  }
  if (rest === "/repository/compare") return send(res, 200, { commits: [] });
  if (rest === "/merge_requests" || rest === "/issues") return send(res, 200, []);
  if (rest === "/members/all") return send(res, 200, [...p.members].map(([username]) => ({ username, avatar_url: null })));
  return notFound(res, "404 Not Found");
}

/** One commit of several actions — all or nothing, as GitLab does. */
function commitActions(p, who, res, body, single = false) {
  const branch = body.branch;
  let base = p.head(branch);
  if (!base && body.start_branch) base = p.head(body.start_branch);
  if (!base && p.branches.size) return send(res, 400, { message: "You can only create or edit files when you are on a branch" });
  const files = new Map(base ? p.commits.get(base).files : []);
  const id = fakeSha();
  for (const a of body.actions ?? []) {
    const current = files.get(a.file_path);
    const bytes = () => Buffer.from(a.content ?? "", a.encoding === "base64" ? "base64" : "utf8");
    if (a.action === "create") {
      if (current) return send(res, 400, { message: single ? "A file with this name already exists" : `A file with this name already exists: ${a.file_path}` });
      files.set(a.file_path, { bytes: bytes(), last: id });
    } else if (a.action === "update" || a.action === "delete") {
      if (!current) return send(res, 400, { message: `A file with this name doesn't exist: ${a.file_path}` });
      if (a.last_commit_id && a.last_commit_id !== current.last) return send(res, 400, { message: "You are attempting to update a file that has changed since you started editing it." });
      if (a.action === "delete") files.delete(a.file_path);
      else files.set(a.file_path, { bytes: bytes(), last: id });
    } else return send(res, 400, { message: `Unknown action ${a.action}` });
  }
  p.commits.set(id, { id, title: String(body.commit_message).split("\n")[0], message: body.commit_message, author: who.username, parents: base ? [base] : [], date: new Date().toISOString(), files });
  p.branches.set(branch, id);
  console.log(`[demo-gitlab] ${p.slug}@${branch} ${id.slice(0, 7)} ${String(body.commit_message).split("\n")[0]}`);
  return send(res, 201, single ? { file_path: body.actions[0].file_path, branch } : commitJson(p, p.commits.get(id)));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const p = url.pathname;
  const helper = p.match(/^\/__test\/projects\/([^/]+)\/([^/]+)\/members$/);
  if (helper && req.method === "POST") {
    const project = projects.get(`${helper[1]}/${helper[2]}`.toLowerCase());
    if (!project) return notFound(res);
    const body = await readBody(req);
    if (body.level) project.members.set(body.username, body.level);
    else project.members.delete(body.username);
    return send(res, 200, { members: Object.fromEntries(project.members) });
  }
  if (!p.startsWith("/api/v4")) return notFound(res);
  const rest = p.slice("/api/v4".length);
  const who = whoIs((req.headers.authorization ?? "").replace(/^bearer\s+/i, ""));
  if (!who) return send(res, 401, { message: "401 Unauthorized" });
  try {
    if (rest === "/user") return send(res, 200, { username: who.username, id: namespaces.get(who.username)?.id ?? 1 });
    const ns = rest.match(/^\/namespaces\/(.+)$/);
    if (ns) {
      const n = namespaces.get(decodeURIComponent(ns[1]).toLowerCase());
      return n ? send(res, 200, n) : notFound(res, "404 Namespace Not Found");
    }
    if (rest === "/projects" && req.method === "GET") {
      const list = [...projects.values()].filter((x) => (x.members.get(who.username) ?? 0) >= 10 && (!who.only || x.slug.toLowerCase() === who.only));
      return send(res, 200, list.map((x) => projectJson(x, x.members.get(who.username))));
    }
    if (rest === "/projects" && req.method === "POST") {
      if (who.only) return send(res, 403, { message: "403 Forbidden" });
      const body = await readBody(req);
      const group = body.namespace_id ? [...namespaces.values()].find((n) => n.id === body.namespace_id)?.full_path : who.username;
      if (!group) return send(res, 404, { message: "404 Namespace Not Found" });
      if (projects.has(`${group}/${body.path ?? body.name}`.toLowerCase())) return send(res, 400, { message: { name: ["has already been taken"] } });
      const project = add(new Project({ group, name: body.path ?? body.name, visibility: body.visibility ?? "private" }));
      project.members.set(who.username, 50);
      console.log(`[demo-gitlab] created ${project.visibility} project ${project.slug}`);
      return send(res, 201, projectJson(project, 50));
    }
    const m = rest.match(/^\/projects\/([^/]+)(\/.*)?$/);
    if (!m) return notFound(res);
    const project = projects.get(decodeURIComponent(m[1]).toLowerCase()) ?? [...projects.values()].find((x) => String(x.id) === m[1]);
    if (!project) return notFound(res);
    const lvl = level(project, who);
    if (!lvl) return notFound(res);
    return await handleProject(project, lvl, who, m[2] ?? "", req, res, url);
  } catch (error) {
    console.error("[demo-gitlab]", error);
    return send(res, 500, { message: String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[demo-gitlab] lumen/browser on ${BASE}`));
