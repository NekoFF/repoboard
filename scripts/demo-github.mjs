#!/usr/bin/env node
/**
 * A tiny stand-in for the GitHub REST API, serving a repository from a folder.
 *
 * It exists so RepoBoard can be tried — and tested, and screenshotted —
 * without a token and without touching anyone's real repository. It answers
 * only the endpoints RepoBoard uses, keeps writes in a temporary copy, and
 * enforces the same "expected SHA" rule GitHub does, so conflict handling can
 * be exercised for real.
 *
 *   node scripts/demo-github.mjs [port]    (npm run demo starts it for you)
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, "..", "demo", "repository");
const META = JSON.parse(fs.readFileSync(path.join(here, "..", "demo", "github.json"), "utf8"));
const PORT = Number(process.argv[2] ?? process.env.DEMO_GITHUB_PORT ?? 4010);
const OWNER = META.owner;
const REPO = META.name;

// Work on a copy so the demo content in the repository never changes.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-demo-"));
fs.cpSync(SOURCE, ROOT, { recursive: true });

const blobSha = (content) =>
  crypto.createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
const fakeSha = () => crypto.randomBytes(20).toString("hex");

const now = Date.now();
const iso = (hoursAgo) => new Date(now - hoursAgo * 3_600_000).toISOString();

/* The commit history, newest first, with parents so a graph can be drawn. */
const commits = META.commits.map((c) => ({ ...c, date: iso(c.hoursAgo) }));
const bySha = new Map(commits.map((c) => [c.sha, c]));

function walk(files = [], dir = ROOT) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Other branches' files are not in the default branch's tree.
    if (dir === ROOT && entry.name === ".branches") continue;
    if (entry.isDirectory()) walk(files, full);
    else files.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return files;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const notFound = (res) => send(res, 404, { message: "Not Found", documentation_url: "https://docs.github.com/rest" });

function commitJson(c) {
  return {
    sha: c.sha,
    html_url: `https://github.com/${OWNER}/${REPO}/commit/${c.sha}`,
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

/** Commits reachable from a branch head, newest first. */
function history(head) {
  const out = [];
  const seen = new Set();
  const queue = [head];
  while (queue.length) {
    const sha = queue.shift();
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);
    const c = bySha.get(sha);
    if (!c) continue;
    out.push(c);
    queue.push(...(c.parents ?? []));
  }
  return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function branchHead(name) {
  return META.branches.find((b) => b.name === name)?.head;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data ? JSON.parse(data) : {}));
  });
}

function addCommit(message, files, branchName = META.defaultBranch) {
  const branch = META.branches.find((b) => b.name === branchName) ?? META.branches.find((b) => b.name === META.defaultBranch);
  const commit = {
    sha: fakeSha(),
    message,
    author: META.viewer,
    parents: [branch.head],
    date: new Date().toISOString(),
    files,
  };
  commits.unshift(commit);
  bySha.set(commit.sha, commit);
  branch.head = commit.sha;
  return commit;
}

/**
 * Files on a branch other than the default one live in an overlay: what the
 * branch changed, over what the default branch has. Enough for RepoBoard's
 * own sync branch (repoboard), which only ever touches .repoboard/board.json.
 */
const overlay = (branchName, file) =>
  branchName && branchName !== META.defaultBranch ? path.join(ROOT, ".branches", branchName, file) : null;

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
  if (p === "/user/installations") return send(res, 200, { total_count: 1, installations: [{ id: 1, account: { login: OWNER } }] });
  if (p === "/user/installations/1/repositories") {
    return send(res, 200, {
      total_count: 1,
      repositories: [
        {
          name: REPO,
          full_name: `${OWNER}/${REPO}`,
          owner: { login: OWNER },
          private: false,
          description: "A calm, private web browser",
          pushed_at: commits[0].date,
          permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
        },
      ],
    });
  }

  // Keys that act out what goes wrong, for testing the screens that explain it:
  // "revoked…" is refused everywhere, "noaccess…" opens no repository.
  const key = (req.headers.authorization ?? "").replace(/^(token|bearer)\s+/i, "");
  if (key.startsWith("revoked")) return send(res, 401, { message: "Bad credentials" });
  if (key.startsWith("noaccess")) {
    if (p === "/user") return send(res, 200, { login: META.viewer });
    if (p === "/user/repos") return send(res, 200, []);
    return notFound(res);
  }

  // People, for testing roles: "member-sam_…" is sam with Write, "viewer-kim_…" is kim with Read.
  const person = key.match(/^(admin|member|viewer)-([a-z]+)_/);
  if (p === "/user") return send(res, 200, { login: person?.[2] ?? META.viewer });
  if (p === "/user/repos") {
    return send(res, 200, [
      {
        name: REPO,
        full_name: `${OWNER}/${REPO}`,
        owner: { login: OWNER },
        private: false,
        description: "A calm, private web browser",
        pushed_at: commits[0].date,
      },
    ]);
  }

  const prefix = `/repos/${OWNER}/${REPO}`;
  if (!p.toLowerCase().startsWith(prefix.toLowerCase())) return notFound(res);
  const rest = p.slice(prefix.length);

  if (rest === "" || rest === "/") {
    return send(res, 200, {
      name: REPO,
      owner: { login: OWNER },
      default_branch: META.defaultBranch,
      private: false,
      html_url: `https://github.com/${OWNER}/${REPO}`,
      pushed_at: commits[0].date,
      permissions:
        person?.[1] === "viewer"
          ? { admin: false, maintain: false, push: false, triage: false, pull: true }
          : person?.[1] === "member"
            ? { admin: false, maintain: false, push: true, triage: true, pull: true }
            : { admin: true, maintain: true, push: true, triage: true, pull: true },
    });
  }

  if (rest.startsWith("/git/trees/") && req.method === "GET") {
    return send(res, 200, { sha: fakeSha(), tree: walk().map((f) => ({ path: f, type: "blob", mode: "100644" })) });
  }

  if (rest.startsWith("/contents/")) {
    const file = rest.slice("/contents/".length);
    let full = path.join(ROOT, file);
    if (!full.startsWith(ROOT)) return notFound(res);
    if (req.method === "GET") {
      const ref = url.searchParams.get("ref");
      const layered = overlay(ref, file);
      if (layered && fs.existsSync(layered)) full = layered;
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return notFound(res);
      // Bytes, not text: screenshots and PDFs live here too.
      const content = fs.readFileSync(full);
      return send(res, 200, {
        type: "file",
        path: file,
        sha: blobSha(content),
        content: content.toString("base64"),
        encoding: "base64",
      });
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      const layered = overlay(body.branch, file);
      if (layered) {
        if (!META.branches.some((b) => b.name === body.branch)) return notFound(res);
        full = fs.existsSync(layered) ? layered : full;
      }
      const exists = fs.existsSync(full);
      const current = exists ? blobSha(fs.readFileSync(full)) : null;
      if (exists && body.sha !== current) {
        return send(res, 409, { message: `${file} does not match ${body.sha}` });
      }
      if (!exists && body.sha) return send(res, 422, { message: "sha provided for a new file" });
      if (exists && !body.sha) return send(res, 422, { message: '"sha" wasn\'t supplied.' });
      const content = Buffer.from(body.content, "base64");
      const target = layered ?? full;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      const commit = addCommit(body.message, [file], body.branch);
      console.log(`[demo-github] commit ${commit.sha.slice(0, 7)} ${body.message}`);
      return send(res, exists ? 200 : 201, { commit: { sha: commit.sha }, content: { sha: blobSha(content), path: file } });
    }
  }

  if (rest === "/git/refs" && req.method === "POST") {
    const body = await readBody(req);
    const name = String(body.ref ?? "").replace(/^refs\/heads\//, "");
    if (META.branches.some((b) => b.name === name)) return send(res, 422, { message: "Reference already exists" });
    META.branches.push({ name, head: body.sha });
    return send(res, 201, { ref: `refs/heads/${name}`, object: { sha: body.sha } });
  }

  // Multi-file commits: ref → commit → tree → new commit → move ref.
  if (rest.startsWith("/git/ref/heads/") || rest.startsWith("/git/refs/heads/")) {
    const name = rest.replace(/^\/git\/refs?\/heads\//, "");
    const branch = META.branches.find((b) => b.name === name);
    if (!branch) return notFound(res);
    if (req.method === "PATCH") {
      const body = await readBody(req);
      branch.head = body.sha;
      return send(res, 200, { ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }
    return send(res, 200, { ref: `refs/heads/${name}`, object: { sha: branch.head } });
  }
  if (rest.startsWith("/git/commits/") && req.method === "GET") {
    return send(res, 200, { sha: rest.split("/").pop(), tree: { sha: "tree-" + rest.split("/").pop() } });
  }
  if (rest === "/git/blobs" && req.method === "POST") {
    const body = await readBody(req);
    const bytes = Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8");
    const sha = blobSha(bytes);
    blobs.set(sha, bytes);
    return send(res, 201, { sha });
  }
  if (rest.startsWith("/git/blobs/") && req.method === "GET") {
    const bytes = blobs.get(rest.split("/").pop());
    if (!bytes) return notFound(res);
    return send(res, 200, { content: bytes.toString("base64"), encoding: "base64" });
  }
  if (rest === "/git/trees" && req.method === "POST") {
    const body = await readBody(req);
    const id = fakeSha();
    pendingTrees.set(id, body.tree);
    return send(res, 201, { sha: id });
  }
  if (rest === "/git/commits" && req.method === "POST") {
    const body = await readBody(req);
    const files = pendingTrees.get(body.tree) ?? [];
    for (const f of files) {
      const full = path.join(ROOT, f.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.sha && blobs.has(f.sha) ? blobs.get(f.sha) : f.content);
    }
    const commit = addCommit(body.message, files.map((f) => f.path));
    console.log(`[demo-github] commit ${commit.sha.slice(0, 7)} ${body.message}`);
    return send(res, 201, { sha: commit.sha });
  }

  if (rest === "/branches") {
    return send(
      res,
      200,
      META.branches.map((b) => ({ name: b.name, protected: b.name === META.defaultBranch, commit: { sha: b.head } })),
    );
  }

  if (rest.startsWith("/compare/")) {
    const [base, head] = rest.slice("/compare/".length).split("...");
    const baseSet = new Set(history(branchHead(base)).map((c) => c.sha));
    const headList = history(branchHead(head));
    const headSet = new Set(headList.map((c) => c.sha));
    return send(res, 200, {
      ahead_by: headList.filter((c) => !baseSet.has(c.sha)).length,
      behind_by: [...baseSet].filter((sha) => !headSet.has(sha)).length,
    });
  }

  const checkRuns = rest.match(/^\/commits\/([^/]+)\/check-runs$/);
  if (checkRuns) {
    const pr = META.pulls.find((x) => x.headSha === checkRuns[1]);
    const total = pr?.checks ?? 0;
    const passed = pr?.checksPassed ?? total;
    return send(res, 200, {
      total_count: total,
      check_runs: Array.from({ length: total }, (_, i) => ({ conclusion: i < passed ? "success" : "failure" })),
    });
  }

  const single = rest.match(/^\/commits\/([^/]+)$/);
  if (single) {
    const ref = single[1];
    const c = bySha.get(ref) ?? bySha.get(branchHead(ref));
    return c ? send(res, 200, commitJson(c)) : notFound(res);
  }

  if (rest === "/commits") {
    const sha = url.searchParams.get("sha");
    const perPage = Number(url.searchParams.get("per_page") ?? 30);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const list = sha ? history(branchHead(sha) ?? sha) : history(branchHead(META.defaultBranch));
    return send(res, 200, list.slice((page - 1) * perPage, page * perPage).map(commitJson));
  }

  if (rest === "/pulls") {
    return send(
      res,
      200,
      META.pulls.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        state: pr.state,
        draft: pr.draft ?? false,
        user: { login: pr.author },
        head: { ref: pr.head, sha: pr.headSha ?? branchHead(pr.head) ?? fakeSha() },
        base: { ref: pr.base ?? META.defaultBranch },
        requested_reviewers: (pr.reviewers ?? []).map((login) => ({ login })),
        merged_at: pr.merged ? iso(pr.hoursAgo ?? 5) : null,
        created_at: iso((pr.hoursAgo ?? 5) + 24),
        updated_at: iso(pr.hoursAgo ?? 5),
        html_url: `https://github.com/${OWNER}/${REPO}/pull/${pr.number}`,
      })),
    );
  }

  if (rest === "/issues") {
    return send(
      res,
      200,
      META.issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels.map((name) => ({ name })),
        assignees: (issue.assignees ?? []).map((login) => ({ login })),
      })),
    );
  }

  return notFound(res);
});

const pendingTrees = new Map();
// Blobs created ahead of a tree (binary files), by SHA.
const blobs = new Map();

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[demo-github] ${OWNER}/${REPO} on http://127.0.0.1:${PORT} (files in ${ROOT})`);
});
