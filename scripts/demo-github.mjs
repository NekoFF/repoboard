#!/usr/bin/env node
/**
 * A tiny stand-in for the GitHub REST API.
 *
 * It exists so RepoBoard can be tried — and tested, and screenshotted —
 * without a token and without touching anyone's real repository. It answers
 * only the endpoints RepoBoard uses, keeps everything in memory, and
 * enforces GitHub's rules where RepoBoard depends on them: the "expected
 * SHA" of every write, fast-forward-only branch updates, empty repositories,
 * branches without history, and who may open which repository.
 *
 * The demo project (demo/repository, demo/github.json) is one repository.
 * More appear the way they do on GitHub — someone creates one (POST
 * /user/repos), and its owner adds people — so a project can keep its plan
 * in a repository of its own, and two people can be tried against it.
 *
 *   node scripts/demo-github.mjs [port]    (npm run demo starts it for you)
 *
 * Keys act out who is asking and what goes wrong:
 *   any key           alex, the demo project's owner
 *   member-sam_…      sam, with Write on the demo project
 *   viewer-kim_…      kim, with Read
 *   admin-max_…       max, an admin
 *   revoked…          refused everywhere (401)
 *   noaccess…         opens no repository
 *   noplan…           alex, but the key opens only the demo project
 * DEMO_GITHUB_PRIVATE=1 makes the demo project private.
 *
 * Test helpers (not GitHub): POST /__test/repos {owner,name,private},
 * POST /__test/repos/:owner/:name/people {login, role} — someone adds a person.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "..", "demo", "repository");
const META = JSON.parse(fs.readFileSync(path.join(here, "..", "demo", "github.json"), "utf8"));
const PORT = Number(process.argv[2] ?? process.env.DEMO_GITHUB_PORT ?? 4010);
const OWNER = META.owner;
const REPO = META.name;

const blobSha = (bytes) => crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const fakeSha = () => crypto.randomBytes(20).toString("hex");
const started = Date.now();
const iso = (hoursAgo) => new Date(started - hoursAgo * 3_600_000).toISOString();

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
const notFound = (res) => send(res, 404, { message: "Not Found", documentation_url: "https://docs.github.com/rest" });

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data ? JSON.parse(data) : {}));
  });
}

function readFolder(dir, files = new Map(), root = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readFolder(full, files, root);
    else files.set(path.relative(root, full).split(path.sep).join("/"), fs.readFileSync(full));
  }
  return files;
}

/* ------------------------------------------------------------- repositories -- */

/**
 * A repository: branches pointing at commits, each commit with the whole
 * set of files it has. The demo project's own history comes from
 * demo/github.json; its commits all share the folder's files.
 */
class Repo {
  constructor({ owner, name, isPrivate, description = "", defaultBranch = "main" }) {
    Object.assign(this, { owner, name, isPrivate, description, defaultBranch });
    this.branches = new Map();
    this.commits = new Map();
    this.snapshots = new Map();
    this.base = null;
    /** login → "admin" | "write" | "read" */
    this.people = new Map([[owner, "admin"]]);
    this.pulls = [];
    this.issues = [];
  }
  get slug() {
    return `${this.owner}/${this.name}`;
  }
  get empty() {
    return this.branches.size === 0;
  }
  head(ref) {
    if (!ref) return this.branches.get(this.defaultBranch) ?? null;
    if (this.branches.has(ref)) return this.branches.get(ref);
    if (this.commits.has(ref)) return ref;
    const byTree = String(ref).startsWith("tree-") ? String(ref).slice(5) : null;
    if (byTree && this.commits.has(byTree)) return byTree;
    return null;
  }
  files(sha) {
    if (!sha) return null;
    return this.snapshots.get(sha) ?? (this.commits.has(sha) ? this.base : null);
  }
  commit({ message, files, parents, author, changed }) {
    const sha = fakeSha();
    this.commits.set(sha, { sha, message, author, parents, date: new Date().toISOString(), files: changed });
    this.snapshots.set(sha, files);
    return sha;
  }
  history(head) {
    const out = [];
    const seen = new Set();
    const queue = [head];
    while (queue.length) {
      const sha = queue.shift();
      if (!sha || seen.has(sha)) continue;
      seen.add(sha);
      const c = this.commits.get(sha);
      if (!c) continue;
      out.push(c);
      queue.push(...(c.parents ?? []));
    }
    return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }
  role(login) {
    const r = this.people.get(login);
    if (r) return r;
    return this.isPrivate ? null : "public";
  }
}

const demo = new Repo({ owner: OWNER, name: REPO, isPrivate: process.env.DEMO_GITHUB_PRIVATE === "1", description: "A calm, private web browser", defaultBranch: META.defaultBranch });
demo.base = readFolder(SOURCE);
for (const c of META.commits) demo.commits.set(c.sha, { ...c, date: iso(c.hoursAgo) });
for (const b of META.branches) demo.branches.set(b.name, b.head);
demo.pulls = META.pulls;
demo.issues = META.issues;
demo.people.set(META.viewer, "admin");
demo.people.set("sam", "write");
demo.people.set("kim", "read");
demo.people.set("max", "admin");

const repos = new Map([[demo.slug.toLowerCase(), demo]]);
const findRepo = (owner, name) => repos.get(`${owner}/${name}`.toLowerCase()) ?? null;

function createRepo({ owner, name, isPrivate, description }) {
  if (!name || !/^[\w.-]+$/.test(name)) return { error: [422, { message: "Repository creation failed: name is invalid" }] };
  if (findRepo(owner, name)) return { error: [422, { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] }] };
  const repo = new Repo({ owner, name, isPrivate, description });
  repos.set(repo.slug.toLowerCase(), repo);
  console.log(`[demo-github] created ${isPrivate ? "private" : "public"} repository ${repo.slug}`);
  return { repo };
}

/* -------------------------------------------------------------------- people -- */

function whoIs(key) {
  if (key.startsWith("revoked")) return { refused: true };
  if (key.startsWith("noaccess")) return { login: META.viewer, nothing: true };
  if (key.startsWith("noplan")) return { login: META.viewer, only: demo.slug.toLowerCase() };
  const person = key.match(/^(admin|member|viewer)-([a-z]+)_/);
  // Someone named by a key has that role on the demo project, as if its owner had added them.
  if (person && !demo.people.has(person[2])) demo.people.set(person[2], { admin: "admin", member: "write", viewer: "read" }[person[1]]);
  return { login: person?.[2] ?? META.viewer };
}

/** What this person may do in this repository, or null when it is invisible to them. */
function access(repo, who) {
  if (who.nothing) return null;
  if (who.only && repo.slug.toLowerCase() !== who.only) return null;
  return repo.role(who.login);
}

function permissions(role) {
  return {
    admin: role === "admin",
    maintain: role === "admin",
    push: role === "admin" || role === "write",
    triage: role === "admin" || role === "write",
    pull: true,
  };
}

function repoJson(repo, role) {
  return {
    name: repo.name,
    full_name: repo.slug,
    owner: { login: repo.owner },
    default_branch: repo.defaultBranch,
    private: repo.isPrivate,
    description: repo.description,
    html_url: `https://github.com/${repo.slug}`,
    pushed_at: repo.history(repo.head())[0]?.date ?? null,
    permissions: permissions(role),
  };
}

/* ---------------------------------------------------------------- git data -- */

const blobs = new Map();
const trees = new Map();

function commitJson(repo, c) {
  return {
    sha: c.sha,
    html_url: `https://github.com/${repo.slug}/commit/${c.sha}`,
    commit: { message: c.message, author: { name: c.author, date: c.date } },
    author: { login: c.author },
    parents: (c.parents ?? []).map((sha) => ({ sha })),
    stats: { additions: c.additions ?? 12, deletions: c.deletions ?? 3 },
    files: (c.files ?? ["src/app.ts"]).map((filename) => ({
      filename,
      status: "modified",
      additions: 8,
      deletions: 2,
      patch: "@@ -1,3 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
    })),
  };
}

const emptyRepo = (res) => send(res, 409, { message: "Git Repository is empty.", documentation_url: "https://docs.github.com/rest" });

async function handleRepo(repo, role, who, rest, req, res, url) {
  const canWrite = role === "admin" || role === "write";
  const writing = req.method !== "GET";
  if (writing && !canWrite && !(rest === "/pulls" || rest === "/issues")) {
    return send(res, 403, { message: "Resource not accessible by integration" });
  }

  if (rest === "" || rest === "/") return send(res, 200, repoJson(repo, role));

  if (rest.startsWith("/contents/")) {
    const file = decodeURIComponent(rest.slice("/contents/".length));
    if (req.method === "GET") {
      if (repo.empty) return send(res, 404, { message: "This repository is empty." });
      const files = repo.files(repo.head(url.searchParams.get("ref") ?? undefined));
      if (!files) return send(res, 404, { message: `No commit found for the ref ${url.searchParams.get("ref")}` });
      const bytes = files.get(file);
      if (!bytes) {
        // A folder answers with its entries, as GitHub does.
        const inside = [...files.keys()].filter((p) => p.startsWith(`${file}/`));
        if (inside.length) return send(res, 200, inside.map((p) => ({ name: p.slice(file.length + 1).split("/")[0], path: p, type: "file" })));
        return notFound(res);
      }
      return send(res, 200, { type: "file", path: file, sha: blobSha(bytes), size: bytes.length, content: bytes.toString("base64"), encoding: "base64" });
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      const branch = body.branch ?? repo.defaultBranch;
      const head = repo.empty ? null : repo.head(branch);
      if (!repo.empty && !head) return send(res, 404, { message: `Branch ${branch} not found` });
      if (repo.empty && body.branch && body.branch !== repo.defaultBranch) return send(res, 404, { message: `Branch ${branch} not found` });
      const files = new Map(repo.files(head) ?? []);
      const current = files.get(file);
      if (current && body.sha !== blobSha(current)) return send(res, 409, { message: `${file} does not match ${body.sha}` });
      if (!current && body.sha) return send(res, 422, { message: "sha provided for a new file" });
      if (current && !body.sha) return send(res, 422, { message: '"sha" wasn\'t supplied.' });
      const bytes = Buffer.from(body.content, "base64");
      files.set(file, bytes);
      const sha = repo.commit({ message: body.message, files, parents: head ? [head] : [], author: who.login, changed: [file] });
      repo.branches.set(branch, sha);
      console.log(`[demo-github] ${repo.slug}@${branch} ${sha.slice(0, 7)} ${body.message}`);
      return send(res, current ? 200 : 201, { commit: { sha }, content: { sha: blobSha(bytes), path: file } });
    }
  }

  if (rest.startsWith("/git/trees/") && req.method === "GET") {
    if (repo.empty) return emptyRepo(res);
    const ref = decodeURIComponent(rest.slice("/git/trees/".length));
    const files = repo.files(repo.head(ref));
    if (!files) return notFound(res);
    return send(res, 200, { sha: fakeSha(), tree: [...files.keys()].map((p) => ({ path: p, type: "blob", mode: "100644" })), truncated: false });
  }
  if (rest === "/git/trees" && req.method === "POST") {
    const body = await readBody(req);
    let files = new Map();
    if (body.base_tree) {
      const base = repo.files(repo.head(body.base_tree)) ?? trees.get(body.base_tree);
      if (!base) return send(res, 422, { message: "base_tree is not a valid tree" });
      files = new Map(base);
    }
    for (const entry of body.tree ?? []) {
      if (entry.sha === null) {
        if (!files.has(entry.path)) return send(res, 422, { message: `GitRPC::BadObjectState: ${entry.path} is not in the tree` });
        files.delete(entry.path);
      } else if (entry.sha) {
        const bytes = blobs.get(entry.sha);
        if (!bytes) return send(res, 422, { message: "tree.sha is not a valid blob" });
        files.set(entry.path, bytes);
      } else {
        files.set(entry.path, Buffer.from(entry.content ?? "", "utf8"));
      }
    }
    const id = fakeSha();
    trees.set(id, files);
    return send(res, 201, { sha: id });
  }
  if (rest === "/git/blobs" && req.method === "POST") {
    const body = await readBody(req);
    const bytes = Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8");
    const sha = blobSha(bytes);
    blobs.set(sha, bytes);
    return send(res, 201, { sha });
  }
  if (rest.startsWith("/git/blobs/") && req.method === "GET") {
    const sha = rest.split("/").pop();
    let bytes = blobs.get(sha);
    if (!bytes) for (const files of [repo.base, ...repo.snapshots.values()]) for (const b of files?.values() ?? []) if (!bytes && blobSha(b) === sha) bytes = b;
    if (!bytes) return notFound(res);
    return send(res, 200, { content: bytes.toString("base64"), encoding: "base64" });
  }
  if (rest === "/git/commits" && req.method === "POST") {
    const body = await readBody(req);
    const files = trees.get(body.tree);
    if (!files) return send(res, 422, { message: "tree is not a valid tree" });
    for (const p of body.parents ?? []) if (!repo.commits.has(p)) return send(res, 422, { message: "parent is not a valid commit" });
    const sha = repo.commit({ message: body.message, files: new Map(files), parents: body.parents ?? [], author: who.login, changed: [...files.keys()] });
    console.log(`[demo-github] ${repo.slug} commit ${sha.slice(0, 7)} ${body.message}`);
    return send(res, 201, { sha });
  }
  if (rest.startsWith("/git/commits/") && req.method === "GET") {
    const sha = rest.split("/").pop();
    if (!repo.commits.has(sha)) return notFound(res);
    return send(res, 200, { sha, tree: { sha: `tree-${sha}` }, parents: (repo.commits.get(sha).parents ?? []).map((p) => ({ sha: p })) });
  }
  if (rest === "/git/refs" && req.method === "POST") {
    const body = await readBody(req);
    if (repo.empty) return emptyRepo(res);
    const name = String(body.ref ?? "").replace(/^refs\/heads\//, "");
    if (repo.branches.has(name)) return send(res, 422, { message: "Reference already exists" });
    if (!repo.commits.has(body.sha)) return send(res, 422, { message: "Object does not exist" });
    repo.branches.set(name, body.sha);
    console.log(`[demo-github] ${repo.slug} new branch ${name}`);
    return send(res, 201, { ref: `refs/heads/${name}`, object: { sha: body.sha } });
  }
  if (rest.startsWith("/git/ref/heads/") || rest.startsWith("/git/refs/heads/")) {
    if (repo.empty) return emptyRepo(res);
    const name = decodeURIComponent(rest.replace(/^\/git\/refs?\/heads\//, ""));
    const head = repo.branches.get(name);
    if (!head) return notFound(res);
    if (req.method === "PATCH") {
      const body = await readBody(req);
      const next = repo.commits.get(body.sha);
      if (!next) return send(res, 422, { message: "Object does not exist" });
      // Without force a branch only moves forward: a write in between makes the second one fail.
      if (!body.force && !repo.history(body.sha).some((c) => c.sha === head)) return send(res, 422, { message: "Update is not a fast forward" });
      repo.branches.set(name, body.sha);
      return send(res, 200, { ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }
    return send(res, 200, { ref: `refs/heads/${name}`, object: { sha: head } });
  }

  if (rest === "/branches") {
    return send(res, 200, [...repo.branches].map(([name, head]) => ({ name, protected: name === repo.defaultBranch, commit: { sha: head } })));
  }
  if (rest.startsWith("/compare/")) {
    const [base, head] = rest.slice("/compare/".length).split("...");
    const baseSet = new Set(repo.history(repo.head(base)).map((c) => c.sha));
    const headList = repo.history(repo.head(head));
    const headSet = new Set(headList.map((c) => c.sha));
    if (![...headSet].some((s) => baseSet.has(s))) return send(res, 404, { message: "No common ancestor between the two branches" });
    return send(res, 200, {
      ahead_by: headList.filter((c) => !baseSet.has(c.sha)).length,
      behind_by: [...baseSet].filter((sha) => !headSet.has(sha)).length,
    });
  }

  const checkRuns = rest.match(/^\/commits\/([^/]+)\/check-runs$/);
  if (checkRuns) {
    const pr = repo.pulls.find((x) => x.headSha === checkRuns[1]);
    const total = pr?.checks ?? 0;
    const passed = pr?.checksPassed ?? total;
    return send(res, 200, {
      total_count: total,
      check_runs: Array.from({ length: total }, (_, i) => ({ conclusion: i < passed ? "success" : "failure" })),
    });
  }
  const single = rest.match(/^\/commits\/([^/]+)$/);
  if (single) {
    const sha = repo.head(decodeURIComponent(single[1]));
    const c = sha ? repo.commits.get(sha) : null;
    return c ? send(res, 200, commitJson(repo, c)) : notFound(res);
  }
  if (rest === "/commits") {
    if (repo.empty) return emptyRepo(res);
    const sha = url.searchParams.get("sha");
    const perPage = Number(url.searchParams.get("per_page") ?? 30);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const list = repo.history(repo.head(sha ?? undefined));
    return send(res, 200, list.slice((page - 1) * perPage, page * perPage).map((c) => commitJson(repo, c)));
  }

  // People who can be assigned: everyone with Write.
  if (rest === "/assignees") {
    const list = [...repo.people].filter(([, r]) => r === "admin" || r === "write").map(([login]) => ({ login, avatar_url: "" }));
    return send(res, 200, list);
  }
  if (rest === "/collaborators") {
    if (role !== "admin" && role !== "write") return send(res, 403, { message: "Must have push access to view repository collaborators." });
    return send(res, 200, [...repo.people].map(([login, r]) => ({ login, avatar_url: "", permissions: permissions(r) })));
  }

  // New pull requests and issues, as a teammate or an agent opens them (for testing what updates by itself).
  if (rest === "/pulls" && req.method === "POST") {
    const body = await readBody(req);
    const number = Math.max(0, ...repo.pulls.map((x) => x.number), ...repo.issues.map((x) => x.number)) + 1;
    repo.pulls.unshift({ number, title: String(body.title ?? "Untitled"), body: body.body ?? "", state: "open", author: "maya", head: body.head, base: body.base ?? repo.defaultBranch, hoursAgo: 0, updatedAt: new Date().toISOString() });
    return send(res, 201, { number, html_url: `https://github.com/${repo.slug}/pull/${number}` });
  }
  if (rest === "/issues" && req.method === "POST") {
    const body = await readBody(req);
    const number = Math.max(0, ...repo.pulls.map((x) => x.number), ...repo.issues.map((x) => x.number)) + 1;
    repo.issues.unshift({ number, title: String(body.title ?? "Untitled"), state: "open", labels: body.labels ?? [], updatedAt: new Date().toISOString() });
    return send(res, 201, { number });
  }
  if (rest === "/pulls") {
    return send(
      res,
      200,
      repo.pulls.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        state: pr.state,
        draft: pr.draft ?? false,
        user: { login: pr.author },
        head: { ref: pr.head, sha: pr.headSha ?? repo.head(pr.head) ?? fakeSha() },
        base: { ref: pr.base ?? repo.defaultBranch },
        requested_reviewers: (pr.reviewers ?? []).map((login) => ({ login })),
        merged_at: pr.merged ? iso(pr.hoursAgo ?? 5) : null,
        created_at: iso((pr.hoursAgo ?? 5) + 24),
        updated_at: pr.updatedAt ?? iso(pr.hoursAgo ?? 5),
        html_url: `https://github.com/${repo.slug}/pull/${pr.number}`,
      })),
    );
  }
  if (rest === "/issues") {
    // As GitHub: pull requests are in this list too (marked), each with when it last changed.
    const all = [
      ...repo.issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: (issue.labels ?? []).map((name) => ({ name })),
        assignees: (issue.assignees ?? []).map((login) => ({ login })),
        updated_at: issue.updatedAt ?? iso(48),
      })),
      ...repo.pulls.map((pr) => ({ number: pr.number, title: pr.title, state: pr.state, labels: [], assignees: [], pull_request: {}, updated_at: pr.updatedAt ?? iso(pr.hoursAgo ?? 5) })),
    ];
    if (url.searchParams.get("sort") === "updated") all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const perPage = Number(url.searchParams.get("per_page") ?? 30);
    return send(res, 200, all.slice(0, perPage));
  }
  return notFound(res);
}

/* -------------------------------------------------------------------- server -- */

let polls = 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);

  // Signing in with GitHub (the device flow on github.com): the code is
  // "approved" on the second poll, as if the person clicked on GitHub.
  if (p === "/login/device/code" && req.method === "POST") {
    return send(res, 200, {
      device_code: "demo-device-code",
      user_code: "WDJB-MJHT",
      verification_uri: `http://127.0.0.1:${PORT}/login/device`,
      expires_in: 900,
      interval: 1,
    });
  }
  if (p === "/login/oauth/access_token" && req.method === "POST") {
    polls += 1;
    return send(res, 200, polls % 2 ? { error: "authorization_pending" } : { access_token: "ghu_demo_sign_in_token_not_a_secret", token_type: "bearer" });
  }
  if (p === "/login/device") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<p>Demo: pretend you entered the code and pressed Authorize.</p>");
  }

  // Test helpers: what people do on github.com.
  if (p === "/__test/repos" && req.method === "POST") {
    const body = await readBody(req);
    const made = createRepo({ owner: body.owner ?? META.viewer, name: body.name, isPrivate: body.private !== false, description: body.description });
    return made.error ? send(res, ...made.error) : send(res, 201, repoJson(made.repo, "admin"));
  }
  const addPerson = p.match(/^\/__test\/repos\/([^/]+)\/([^/]+)\/people$/);
  if (addPerson && req.method === "POST") {
    const repo = findRepo(addPerson[1], addPerson[2]);
    if (!repo) return notFound(res);
    const body = await readBody(req);
    if (body.role) repo.people.set(body.login, body.role);
    else repo.people.delete(body.login);
    return send(res, 200, { people: Object.fromEntries(repo.people) });
  }

  const key = (req.headers.authorization ?? "").replace(/^(token|bearer)\s+/i, "");
  const who = whoIs(key);
  if (who.refused) return send(res, 401, { message: "Bad credentials" });

  const visible = () =>
    [...repos.values()]
      .map((repo) => ({ repo, role: access(repo, who) }))
      .filter((x) => x.role && x.role !== "public");

  if (p === "/user") return send(res, 200, { login: who.login });
  if (p === "/user/installations") return send(res, 200, { total_count: 1, installations: [{ id: 1, account: { login: OWNER } }] });
  if (p === "/user/installations/1/repositories" || (p === "/user/repos" && req.method === "GET")) {
    const list = visible().map(({ repo, role }) => repoJson(repo, role));
    return p === "/user/repos" ? send(res, 200, list) : send(res, 200, { total_count: list.length, repositories: list });
  }
  // Creating a repository — what the person does on github.com/new.
  if ((p === "/user/repos" || /^\/orgs\/[^/]+\/repos$/.test(p)) && req.method === "POST") {
    if (who.nothing || who.only) return send(res, 403, { message: "Resource not accessible by integration" });
    const body = await readBody(req);
    const owner = p.startsWith("/orgs/") ? p.split("/")[2] : who.login;
    const made = createRepo({ owner, name: body.name, isPrivate: body.private !== false, description: body.description });
    return made.error ? send(res, ...made.error) : send(res, 201, repoJson(made.repo, "admin"));
  }

  const match = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!match) return notFound(res);
  const repo = findRepo(match[1], match[2]);
  if (!repo) return notFound(res);
  const role = access(repo, who);
  if (!role) return notFound(res);
  try {
    return await handleRepo(repo, role === "public" ? "read" : role, who, match[3] ?? "", req, res, url);
  } catch (error) {
    console.error("[demo-github]", error);
    return send(res, 500, { message: String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[demo-github] ${OWNER}/${REPO} on http://127.0.0.1:${PORT}${demo.isPrivate ? " (private)" : ""}`);
});
