import { createHash } from "node:crypto";
import {
  GitHubAccessError,
  type AccessibleRepo,
  type BranchSummary,
  type CardReference,
  type CommitDetail,
  type CommitSummary,
  type GraphCommit,
  type IssueSummary,
  type PullRequestSummary,
  type RepoFile,
  type RepoSummary,
} from "@/lib/github/client";
import type { Role } from "@/lib/roles";

/**
 * The same work as GitHubClient, against GitLab (gitlab.com or a company's
 * own server) through its REST API v4. Merge requests stand in for pull
 * requests, members for collaborators, access levels for roles; blob ids
 * are git's own blob SHA-1s, so the SHA checks behind every reviewed write
 * mean the same thing here.
 *
 * A project is `namespace/name`; projects in subgroups (a/b/c) are not
 * supported yet, since RepoBoard names a repository by two parts.
 */

type Query = Record<string, string | number | boolean | undefined>;

class GitLabError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitLabError";
  }
}

/** The part of a GitLab address the API lives under. */
export function gitlabApi(url: string): string {
  return `${url.replace(/\/+$/, "")}/api/v4`;
}

/** A GitLab server's address, cleaned: https only (http for this computer), no path. */
export function gitlabBase(input: string | null | undefined): string {
  const raw = (input ?? "").trim() || "https://gitlab.com";
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("A GitLab server is reached over https.");
  return `${url.protocol}//${url.host}`;
}

async function call<T>(
  api: string,
  token: string,
  method: string,
  path: string,
  { query, body }: { query?: Query; body?: unknown } = {},
): Promise<{ data: T; next: number | null }> {
  const url = new URL(`${api}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new GitHubAccessError("offline", "GitLab could not be reached. Check the internet connection and the server's address.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && ("message" in data || "error" in data)
        ? JSON.stringify((data as { message?: unknown; error?: unknown }).message ?? (data as { error?: unknown }).error)
        : null) ?? `GitLab answered ${res.status}`;
    throw new GitLabError(res.status, message.replace(/^"|"$/g, ""));
  }
  const next = Number(res.headers.get("x-next-page")) || null;
  return { data: data as T, next };
}

/** Every page of a list, up to `max` pages of 100. */
async function all<T>(api: string, token: string, path: string, query: Query = {}, max = 10): Promise<T[]> {
  const out: T[] = [];
  let page: number | null = 1;
  for (let n = 0; page && n < max; n += 1) {
    const result: { data: T[]; next: number | null } = await call<T[]>(api, token, "GET", path, { query: { ...query, per_page: 100, page } });
    out.push(...result.data);
    page = result.next;
  }
  return out;
}

function roleFrom(project: { permissions?: { project_access?: { access_level?: number } | null; group_access?: { access_level?: number } | null } }): Role {
  const level = Math.max(project.permissions?.project_access?.access_level ?? 0, project.permissions?.group_access?.access_level ?? 0);
  // Maintainer (40) and Owner (50) manage; Developer (30) works; Guest and Reporter look.
  if (level >= 40) return "manager";
  if (level >= 30) return "member";
  // Admins of the whole server see access_level null; treat an answer without permissions as the owner's.
  return project.permissions ? "viewer" : "manager";
}

const blobSha = (content: string | Buffer) => {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
};

interface GLProject {
  id: number;
  path: string;
  path_with_namespace: string;
  namespace: { full_path: string };
  default_branch: string | null;
  visibility: "private" | "internal" | "public";
  web_url: string;
  last_activity_at: string | null;
  description: string | null;
  empty_repo?: boolean;
  permissions?: { project_access?: { access_level?: number } | null; group_access?: { access_level?: number } | null };
}

interface GLCommit {
  id: string;
  title: string;
  message: string;
  author_name: string | null;
  committed_date: string | null;
  authored_date?: string | null;
  parent_ids?: string[];
  stats?: { additions: number; deletions: number };
  web_url?: string;
}

function summaryOf(p: GLProject): RepoSummary {
  return {
    owner: p.namespace.full_path,
    name: p.path,
    defaultBranch: p.default_branch ?? "main",
    visibility: p.visibility === "public" ? "public" : "private",
    htmlUrl: p.web_url,
    pushedAt: p.last_activity_at ?? null,
    role: roleFrom(p),
  };
}

const CARD = /\bRB-(\d+)\b/gi;
const cardsIn = (text?: string | null) => [...(text ?? "").matchAll(CARD)].map((m) => Number(m[1]));

export class GitLabClient {
  private readonly api: string;
  private project: GLProject | null = null;

  constructor(
    private readonly token: string,
    readonly owner: string,
    readonly repo: string,
    readonly base: string,
  ) {
    this.api = gitlabApi(base);
  }

  private get id() {
    return encodeURIComponent(`${this.owner}/${this.repo}`);
  }

  private req<T>(method: string, path: string, opts?: { query?: Query; body?: unknown }) {
    return call<T>(this.api, this.token, method, `/projects/${this.id}${path}`, opts).then((r) => r.data);
  }

  private list<T>(path: string, query?: Query, max?: number) {
    return all<T>(this.api, this.token, `/projects/${this.id}${path}`, query, max);
  }

  private async info(): Promise<GLProject> {
    this.project ??= await this.req<GLProject>("GET", "");
    return this.project;
  }

  private async branch(): Promise<string> {
    return (await this.info()).default_branch ?? "main";
  }

  /** A token/project pair, checked before it is saved; errors say what to do. */
  static async probe(token: string, slug: string, base: string): Promise<RepoSummary> {
    const parts = slug.split("/");
    if (parts.length !== 2 || parts.some((p) => !p)) {
      throw new GitHubAccessError(
        "no_access",
        parts.length > 2
          ? `${slug} is in a subgroup. RepoBoard opens GitLab projects directly under a user or group for now.`
          : "A GitLab project is written as group/name.",
      );
    }
    try {
      const { data } = await call<GLProject>(gitlabApi(base), token, "GET", `/projects/${encodeURIComponent(slug)}`);
      return summaryOf(data);
    } catch (error) {
      if (error instanceof GitHubAccessError) throw error;
      const status = (error as GitLabError).status;
      if (status === 401) throw new GitHubAccessError("expired", "GitLab no longer accepts this key: it has expired or was revoked.");
      if (status === 404) throw new GitHubAccessError("no_access", `This key cannot open ${slug}: the name is wrong, or your account has no access to it.`);
      if (status === 403) throw new GitHubAccessError("forbidden", `GitLab refused ${slug}. The key needs the api scope.`);
      throw new GitHubAccessError("unknown", `GitLab answered with an error (${status}). Try again in a moment.`);
    }
  }

  static async viewer(token: string, base: string): Promise<string | null> {
    try {
      const { data } = await call<{ username: string }>(gitlabApi(base), token, "GET", "/user");
      return data.username;
    } catch {
      return null;
    }
  }

  /** The projects a key opens, most recently active first. */
  static async repositoriesFor(token: string, base: string): Promise<AccessibleRepo[]> {
    try {
      const projects = await all<GLProject>(gitlabApi(base), token, "/projects", {
        membership: true,
        simple: true,
        order_by: "last_activity_at",
        archived: false,
      }, 3);
      return projects.map((p) => ({
        fullName: p.path_with_namespace,
        private: p.visibility !== "public",
        description: p.description ?? null,
        pushedAt: p.last_activity_at ?? null,
      }));
    } catch (error) {
      if (error instanceof GitHubAccessError) throw error;
      if ((error as GitLabError).status === 401) {
        throw new GitHubAccessError("expired", "GitLab did not accept this key. Check that it was copied whole, or make a new one.");
      }
      throw error;
    }
  }

  async getRepo(): Promise<RepoSummary> {
    this.project = null;
    return summaryOf(await this.info());
  }

  async listBranches(): Promise<BranchSummary[]> {
    const main = await this.branch();
    const branches = await this.list<{ name: string; protected: boolean; commit: GLCommit }>("/repository/branches", {}, 2).catch(
      (error) => {
        if ((error as GitLabError).status === 404) return [];
        throw error;
      },
    );
    const count = (from: string, to: string) =>
      this.req<{ commits: unknown[] }>("GET", "/repository/compare", { query: { from, to, straight: false } })
        .then((r) => r.commits.length)
        .catch(() => 0);
    return Promise.all(
      branches.map(async (b) => ({
        name: b.name,
        protected: b.protected,
        lastCommit: { sha: b.commit.id, message: b.commit.title, author: b.commit.author_name, date: b.commit.committed_date },
        ahead: b.name === main ? 0 : await count(main, b.name),
        behind: b.name === main ? 0 : await count(b.name, main),
      })),
    );
  }

  async listCommits(branch?: string, perPage = 30): Promise<CommitSummary[]> {
    const commits = await this.req<GLCommit[]>("GET", "/repository/commits", {
      query: { ref_name: branch ?? (await this.branch()), per_page: Math.min(perPage, 100) },
    }).catch((error) => {
      if ((error as GitLabError).status === 404) return [] as GLCommit[];
      throw error;
    });
    return commits.map((c) => ({ sha: c.id, message: c.title, author: c.author_name, date: c.committed_date }));
  }

  async getCommit(sha: string): Promise<CommitDetail> {
    const [c, diff] = await Promise.all([
      this.req<GLCommit>("GET", `/repository/commits/${encodeURIComponent(sha)}`, { query: { stats: true } }),
      this.req<{ new_path: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean; diff: string }[]>(
        "GET",
        `/repository/commits/${encodeURIComponent(sha)}/diff`,
      ).catch(() => []),
    ]);
    return {
      sha: c.id,
      message: c.message,
      author: c.author_name,
      date: c.committed_date,
      additions: c.stats?.additions,
      deletions: c.stats?.deletions,
      files: diff.map((f) => {
        const lines = f.diff.split("\n");
        return {
          filename: f.new_path,
          status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified",
          additions: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
          deletions: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
          patch: f.diff,
        };
      }),
    };
  }

  private mergeRequests(count: number) {
    return this.req<
      {
        iid: number;
        title: string;
        description: string | null;
        state: "opened" | "closed" | "merged" | "locked";
        draft?: boolean;
        work_in_progress?: boolean;
        author: { username: string } | null;
        source_branch: string;
        target_branch: string;
        reviewers?: { username: string }[];
        web_url: string;
        merged_at: string | null;
        updated_at: string | null;
        created_at: string | null;
      }[]
    >("GET", "/merge_requests", { query: { state: "all", per_page: count, order_by: "updated_at" } }).catch(() => []);
  }

  async listPullRequests(): Promise<PullRequestSummary[]> {
    return (await this.mergeRequests(30)).map((mr) => ({
      number: mr.iid,
      title: mr.title,
      state: mr.state === "opened" ? "open" : "closed",
      draft: Boolean(mr.draft ?? mr.work_in_progress),
      author: mr.author?.username ?? null,
      head: mr.source_branch,
      base: mr.target_branch,
      reviewers: (mr.reviewers ?? []).map((r) => r.username),
      mergeableState: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
      checks: null,
    }));
  }

  async listIssues(): Promise<IssueSummary[]> {
    const issues = await this.req<{ iid: number; title: string; state: "opened" | "closed"; labels: string[]; assignees: { username: string }[] }[]>(
      "GET",
      "/issues",
      { query: { state: "all", per_page: 50 } },
    ).catch(() => []);
    return issues.map((i) => ({
      number: i.iid,
      title: i.title,
      state: i.state === "opened" ? "open" : "closed",
      labels: i.labels,
      assignees: i.assignees.map((a) => a.username),
    }));
  }

  async findReferences(): Promise<CardReference[]> {
    const web = (await this.info()).web_url;
    const [commits, mrs] = await Promise.all([
      this.req<GLCommit[]>("GET", "/repository/commits", { query: { per_page: 100 } }).catch(() => [] as GLCommit[]),
      this.mergeRequests(50),
    ]);
    const refs: CardReference[] = [];
    for (const c of commits) {
      for (const card of cardsIn(c.message)) {
        refs.push({
          kind: "commit",
          card,
          ref: c.id.slice(0, 7),
          title: c.title,
          url: `${web}/-/commit/${c.id}`,
          author: c.author_name,
          date: c.committed_date,
        });
      }
    }
    for (const mr of mrs) {
      for (const card of new Set([...cardsIn(mr.title), ...cardsIn(mr.description), ...cardsIn(mr.source_branch)])) {
        refs.push({
          kind: "pull",
          card,
          ref: `!${mr.iid}`,
          title: mr.title,
          url: mr.web_url,
          author: mr.author?.username ?? null,
          date: mr.merged_at ?? mr.updated_at ?? mr.created_at,
          state: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
        });
      }
    }
    return refs;
  }

  private branchCommits(branch: string, page: number, perPage = 100) {
    return this.req<GLCommit[]>("GET", "/repository/commits", { query: { ref_name: branch, per_page: perPage, page } }).catch(
      () => [] as GLCommit[],
    );
  }

  private toGraph(c: GLCommit): GraphCommit {
    return { sha: c.id, message: c.title, author: c.author_name, date: c.committed_date, parents: c.parent_ids ?? [], heads: [] };
  }

  async commitGraph(limitPerBranch = 40, maxBranches = 12, mainLimit = limitPerBranch): Promise<GraphCommit[]> {
    const main = await this.branch();
    const branches = await this.list<{ name: string; commit: GLCommit }>("/repository/branches", {}, 2).catch(() => []);
    const ordered = [...branches.filter((b) => b.name === main), ...branches.filter((b) => b.name !== main)].slice(0, maxBranches);
    const bySha = new Map<string, GraphCommit>();
    await Promise.all(
      ordered.map(async (b) => {
        const wanted = b.name === main ? mainLimit : limitPerBranch;
        const pages = Math.ceil(wanted / 100);
        for (let n = 1; n <= pages; n += 1) {
          for (const c of await this.branchCommits(b.name, n, Math.min(wanted, 100))) if (!bySha.has(c.id)) bySha.set(c.id, this.toGraph(c));
        }
      }),
    );
    for (const b of ordered) bySha.get(b.commit.id)?.heads.push(b.name);
    return [...bySha.values()].sort((a, b) => Date.parse(b.date ?? "0") - Date.parse(a.date ?? "0"));
  }

  async storyGraph(mainLimit = 300, maxBranches = 20, branchLimit = 300): Promise<GraphCommit[]> {
    const main = await this.branch();
    const branches = await this.list<{ name: string; commit: GLCommit }>("/repository/branches", {}, 2).catch(() => []);
    const bySha = new Map<string, GraphCommit>();
    for (let n = 1; n <= Math.ceil(mainLimit / 100); n += 1) {
      for (const c of await this.branchCommits(main, n)) if (!bySha.has(c.id)) bySha.set(c.id, this.toGraph(c));
    }
    const onMain = new Set(bySha.keys());
    const others = branches
      .filter((b) => b.name !== main && b.name !== "repoboard" && !onMain.has(b.commit.id))
      .sort((a, b) => Date.parse(b.commit.committed_date ?? "0") - Date.parse(a.commit.committed_date ?? "0"))
      .slice(0, maxBranches);
    await Promise.all(
      others.map(async (b) => {
        for (let n = 1; n * 40 <= branchLimit + 40; n += 1) {
          const page = await this.branchCommits(b.name, n, 40);
          const stop = page.findIndex((c) => onMain.has(c.id));
          for (const c of stop >= 0 ? page.slice(0, stop + 1) : page) if (!bySha.has(c.id)) bySha.set(c.id, this.toGraph(c));
          if (stop >= 0 || page.length < 40) return;
        }
      }),
    );
    for (const b of branches) bySha.get(b.commit.id)?.heads.push(b.name);
    return [...bySha.values()].sort((a, b) => Date.parse(b.date ?? "0") - Date.parse(a.date ?? "0"));
  }

  async listPeople(): Promise<{ login: string; avatarUrl: string }[]> {
    return this.list<{ username: string; avatar_url: string | null }>("/members/all", {}, 2)
      .then((m) => m.map((p) => ({ login: p.username, avatarUrl: p.avatar_url ?? "" })))
      .catch(() => []);
  }

  private async tree(branch?: string): Promise<string[]> {
    const ref = branch ?? (await this.branch());
    return this.list<{ path: string; type: string }>("/repository/tree", { recursive: true, ref }, 50)
      .then((t) => t.filter((n) => n.type === "blob").map((n) => n.path).sort())
      .catch((error) => {
        if ((error as GitLabError).status === 404) return [];
        throw error;
      });
  }

  async listMarkdownFiles(branch?: string): Promise<string[]> {
    return (await this.tree(branch)).filter((p) => p.endsWith(".md"));
  }

  async listFiles(): Promise<string[]> {
    return this.tree();
  }

  private async file(path: string, ref?: string) {
    return this.req<{ content: string; blob_id: string; last_commit_id: string }>(
      "GET",
      `/repository/files/${encodeURIComponent(path)}`,
      { query: { ref: ref ?? (await this.branch()) } },
    );
  }

  async getFile(path: string, ref?: string): Promise<RepoFile> {
    const f = await this.file(path, ref);
    return { path, content: Buffer.from(f.content, "base64").toString("utf8"), sha: f.blob_id };
  }

  async getFileBytes(path: string, ref?: string): Promise<{ bytes: Buffer; sha: string }> {
    const f = await this.file(path, ref);
    return { bytes: Buffer.from(f.content, "base64"), sha: f.blob_id };
  }

  async headCommit(branch?: string): Promise<string> {
    const b = await this.req<{ commit: { id: string } }>("GET", `/repository/branches/${encodeURIComponent(branch ?? (await this.branch()))}`);
    return b.commit.id;
  }

  private exists(path: string, ref?: string) {
    return this.file(path, ref).then(
      () => true,
      () => false,
    );
  }

  async createFiles(args: { files: { path: string; content: string }[]; message: string; branch?: string }): Promise<{ commitSha: string }> {
    const branch = args.branch ?? (await this.branch());
    for (const f of args.files) if (await this.exists(f.path, branch)) throw new Error(`${f.path} already exists`);
    const commit = await this.req<{ id: string }>("POST", "/repository/commits", {
      body: {
        branch,
        commit_message: args.message,
        actions: args.files.map((f) => ({ action: "create", file_path: f.path, content: f.content })),
      },
    });
    return { commitSha: commit.id };
  }

  async commitChanges(args: {
    message: string;
    edits: { path: string; content: string; expectedSha: string }[];
    adds: { path: string; base64: string }[];
    branch?: string;
  }): Promise<{ commitSha: string }> {
    const branch = args.branch ?? (await this.branch());
    const edits = await Promise.all(
      args.edits.map(async (e) => {
        const current = await this.file(e.path, branch);
        if (current.blob_id !== e.expectedSha) {
          const error = new Error(`${e.path} changed on GitLab meanwhile`);
          (error as Error & { code?: string }).code = "CONFLICT";
          throw error;
        }
        return { action: "update", file_path: e.path, content: e.content, last_commit_id: current.last_commit_id };
      }),
    );
    for (const a of args.adds) if (await this.exists(a.path, branch)) throw new Error(`${a.path} already exists`);
    const commit = await this.req<{ id: string }>("POST", "/repository/commits", {
      body: {
        branch,
        commit_message: args.message,
        actions: [...edits, ...args.adds.map((a) => ({ action: "create", file_path: a.path, content: a.base64, encoding: "base64" }))],
      },
    });
    return { commitSha: commit.id };
  }

  async ensureBranch(name: string): Promise<void> {
    const found = await this.req("GET", `/repository/branches/${encodeURIComponent(name)}`).then(
      () => true,
      (error) => {
        if ((error as GitLabError).status === 404) return false;
        throw error;
      },
    );
    if (found) return;
    await this.req("POST", "/repository/branches", { query: { branch: name, ref: await this.branch() } }).catch((error) => {
      // Another computer made it a moment ago.
      if ((error as GitLabError).status !== 400) throw error;
    });
  }

  /**
   * Writes one file. With `expectedSha` the file must still be that blob —
   * the same refusal GitHub's Contents API gives (409) — and GitLab's own
   * last_commit_id check catches a write in between.
   */
  async putFile(args: {
    path: string;
    content: string;
    expectedSha?: string;
    message: string;
    branch?: string;
  }): Promise<{ commitSha: string; contentSha: string }> {
    const branch = args.branch ?? (await this.branch());
    const encoded = encodeURIComponent(args.path);
    if (args.expectedSha) {
      const current = await this.file(args.path, branch);
      if (current.blob_id !== args.expectedSha) throw new GitLabError(409, `${args.path} changed on GitLab meanwhile`);
      await this.req("PUT", `/repository/files/${encoded}`, {
        body: { branch, content: args.content, commit_message: args.message, last_commit_id: current.last_commit_id },
      }).catch((error) => {
        if ((error as GitLabError).status === 400) throw new GitLabError(409, `${args.path} changed on GitLab meanwhile`);
        throw error;
      });
    } else {
      await this.req("POST", `/repository/files/${encoded}`, {
        body: { branch, content: args.content, commit_message: args.message },
      }).catch((error) => {
        if ((error as GitLabError).status === 400) throw new GitLabError(422, `${args.path} already exists`);
        throw error;
      });
    }
    const head = await this.req<{ commit: { id: string } }>("GET", `/repository/branches/${encodeURIComponent(branch)}`);
    return { commitSha: head.commit.id, contentSha: blobSha(args.content) };
  }
}
