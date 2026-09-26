import { Octokit } from "octokit";
import { getAuthProvider, getConfiguredRepo } from "./auth-provider";

export class GitHubNotConfiguredError extends Error {
  constructor() {
    super("GitHub is not connected. Add a token on the Settings screen.");
    this.name = "GitHubNotConfiguredError";
  }
}

export interface RepoSummary {
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: "public" | "private";
  htmlUrl: string;
  pushedAt: string | null;
}

export interface BranchSummary {
  name: string;
  protected: boolean;
  lastCommit: {
    sha: string;
    message: string;
    author: string | null;
    date: string | null;
  };
  ahead: number;
  behind: number;
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string | null;
  date: string | null;
  additions?: number;
  deletions?: number;
}

export interface CommitDetail extends CommitSummary {
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }[];
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string | null;
  head: string;
  base: string;
  reviewers: string[];
  mergeableState: string | null;
  checks: { total: number; passed: number } | null;
}

export interface GraphCommit {
  sha: string;
  message: string;
  author: string | null;
  date: string | null;
  parents: string[];
  /** Branches whose tip is this commit. */
  heads: string[];
}

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
}

export interface RepoFile {
  path: string;
  content: string;
  sha: string;
}

/** A commit or pull request that mentions a card, e.g. "fix focus loss (RB-12)". */
export interface CardReference {
  kind: "commit" | "pull";
  card: number;
  /** Short SHA or "#42". */
  ref: string;
  title: string;
  url: string;
  author: string | null;
  date: string | null;
  /** For pull requests: open, closed or merged. */
  state?: string;
}

const REF_PATTERN = /\bRB-(\d{1,6})\b/gi;

export function cardNumbersIn(text: string | null | undefined): number[] {
  if (!text) return [];
  const found = new Set<number>();
  for (const match of text.matchAll(REF_PATTERN)) found.add(Number(match[1]));
  return [...found];
}

/**
 * Octokit retries failed requests with a back-off. That is right for 5xx, but
 * GitHub answers 409 for an empty repository, and retrying that made every
 * screen of a fresh repository wait ~15 seconds for nothing.
 */
function makeOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    // Only for the demo and tests (scripts/demo-github.mjs); unset in real use.
    ...(process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {}),
    retry: { doNotRetry: [400, 401, 403, 404, 409, 410, 422, 451] },
  });
}

/** GitHub's answer for a repository that has no commits yet. */
export function isEmptyRepository(error: unknown): boolean {
  const e = error as { status?: number; message?: string };
  return e?.status === 409 || /repository is empty/i.test(e?.message ?? "");
}

const referenceCache = new Map<string, { at: number; refs: CardReference[] }>();
const REFERENCE_TTL_MS = 60_000;

export class GitHubClient {
  private constructor(
    private readonly octokit: Octokit,
    readonly owner: string,
    readonly repo: string,
  ) {}

  static async create(): Promise<GitHubClient> {
    const token = await getAuthProvider().getToken();
    const repo = getConfiguredRepo();
    if (!token || !repo) throw new GitHubNotConfiguredError();
    return new GitHubClient(makeOctokit(token), repo.owner, repo.name);
  }

  /** Validates a token/repo pair before it is persisted by the connect flow. */
  static async probe(token: string, slug: string): Promise<RepoSummary> {
    const [owner, name] = slug.split("/");
    if (!owner || !name) throw new Error("Repository must be owner/name");
    const octokit = makeOctokit(token);
    const { data } = await octokit.rest.repos.get({ owner, repo: name });
    return {
      owner: data.owner.login,
      name: data.name,
      defaultBranch: data.default_branch,
      visibility: data.private ? "private" : "public",
      htmlUrl: data.html_url,
      pushedAt: data.pushed_at ?? null,
    };
  }

  /** The GitHub login the token belongs to — the default author of notes. */
  static async viewer(token: string): Promise<string | null> {
    try {
      const { data } = await makeOctokit(token).rest.users.getAuthenticated();
      return data.login;
    } catch {
      return null;
    }
  }

  async getRepo(): Promise<RepoSummary> {
    const { data } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return {
      owner: data.owner.login,
      name: data.name,
      defaultBranch: data.default_branch,
      visibility: data.private ? "private" : "public",
      htmlUrl: data.html_url,
      pushedAt: data.pushed_at ?? null,
    };
  }

  async listBranches(): Promise<BranchSummary[]> {
    const repo = await this.getRepo();
    const { data } = await this.octokit.rest.repos.listBranches({
      owner: this.owner,
      repo: this.repo,
      per_page: 100,
    });

    return Promise.all(
      data.map(async (branch) => {
        const [commit, comparison] = await Promise.all([
          this.octokit.rest.repos.getCommit({
            owner: this.owner,
            repo: this.repo,
            ref: branch.commit.sha,
          }),
          branch.name === repo.defaultBranch
            ? Promise.resolve(null)
            : this.octokit.rest.repos
                .compareCommitsWithBasehead({
                  owner: this.owner,
                  repo: this.repo,
                  basehead: `${repo.defaultBranch}...${branch.name}`,
                })
                .catch(() => null),
        ]);

        return {
          name: branch.name,
          protected: branch.protected,
          lastCommit: {
            sha: commit.data.sha,
            message: commit.data.commit.message.split("\n")[0],
            author:
              commit.data.author?.login ??
              commit.data.commit.author?.name ??
              null,
            date: commit.data.commit.author?.date ?? null,
          },
          ahead: comparison?.data.ahead_by ?? 0,
          behind: comparison?.data.behind_by ?? 0,
        };
      }),
    );
  }

  async listCommits(branch?: string, perPage = 30): Promise<CommitSummary[]> {
    const data = await this.octokit.rest.repos
      .listCommits({ owner: this.owner, repo: this.repo, sha: branch, per_page: perPage })
      .then((r) => r.data)
      .catch((error) => {
        if (isEmptyRepository(error)) return [];
        throw error;
      });
    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      author: c.author?.login ?? c.commit.author?.name ?? null,
      date: c.commit.author?.date ?? null,
    }));
  }

  async getCommit(sha: string): Promise<CommitDetail> {
    const { data } = await this.octokit.rest.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref: sha,
    });
    return {
      sha: data.sha,
      message: data.commit.message,
      author: data.author?.login ?? data.commit.author?.name ?? null,
      date: data.commit.author?.date ?? null,
      additions: data.stats?.additions,
      deletions: data.stats?.deletions,
      files: (data.files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
    };
  }

  async listPullRequests(): Promise<PullRequestSummary[]> {
    const { data } = await this.octokit.rest.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: "all",
      per_page: 30,
    });

    return Promise.all(
      data.map(async (pr) => {
        const checks = await this.octokit.rest.checks
          .listForRef({
            owner: this.owner,
            repo: this.repo,
            ref: pr.head.sha,
          })
          .then((r) => ({
            total: r.data.total_count,
            passed: r.data.check_runs.filter(
              (run) => run.conclusion === "success",
            ).length,
          }))
          .catch(() => null);

        return {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft ?? false,
          author: pr.user?.login ?? null,
          head: pr.head.ref,
          base: pr.base.ref,
          reviewers: (pr.requested_reviewers ?? []).map((r) => r.login),
          mergeableState: pr.merged_at ? "merged" : pr.state,
          checks,
        };
      }),
    );
  }

  async listIssues(): Promise<IssueSummary[]> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state: "all",
      per_page: 50,
    });
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels.map((l) =>
          typeof l === "string" ? l : (l.name ?? ""),
        ),
        assignees: (issue.assignees ?? []).map((a) => a.login),
      }));
  }

  /**
   * Every recent commit and pull request that names a card. This is what makes
   * a board wired to git worth having: write "RB-12" in a commit message and the
   * card knows about it, without anyone linking anything by hand.
   */
  async findReferences(): Promise<CardReference[]> {
    const key = `${this.owner}/${this.repo}`.toLowerCase();
    const cached = referenceCache.get(key);
    if (cached && Date.now() - cached.at < REFERENCE_TTL_MS) return cached.refs;

    const base = `https://github.com/${this.owner}/${this.repo}`;
    const [commits, pulls] = await Promise.all([
      this.octokit.rest.repos
        .listCommits({ owner: this.owner, repo: this.repo, per_page: 100 })
        .then((r) => r.data)
        .catch(() => []),
      this.octokit.rest.pulls
        .list({ owner: this.owner, repo: this.repo, state: "all", per_page: 50 })
        .then((r) => r.data)
        .catch(() => []),
    ]);

    const refs: CardReference[] = [];
    for (const commit of commits) {
      for (const card of cardNumbersIn(commit.commit.message)) {
        refs.push({
          kind: "commit",
          card,
          ref: commit.sha.slice(0, 7),
          title: commit.commit.message.split("\n")[0],
          url: `${base}/commit/${commit.sha}`,
          author: commit.author?.login ?? commit.commit.author?.name ?? null,
          date: commit.commit.author?.date ?? null,
        });
      }
    }
    for (const pr of pulls) {
      const cards = new Set([
        ...cardNumbersIn(pr.title),
        ...cardNumbersIn(pr.body),
        ...cardNumbersIn(pr.head.ref),
      ]);
      for (const card of cards) {
        refs.push({
          kind: "pull",
          card,
          ref: `#${pr.number}`,
          title: pr.title,
          url: pr.html_url,
          author: pr.user?.login ?? null,
          date: pr.merged_at ?? pr.updated_at ?? pr.created_at ?? null,
          state: pr.merged_at ? "merged" : pr.state,
        });
      }
    }

    referenceCache.set(key, { at: Date.now(), refs });
    return refs;
  }

  /**
   * The history of every branch at once, with parents, so it can be drawn as
   * lines that split and merge. Limited to recent commits on the most
   * recently active branches — enough to see the shape of the work.
   */
  async commitGraph(limitPerBranch = 40, maxBranches = 12): Promise<GraphCommit[]> {
    const repo = await this.getRepo();
    const branches = await this.octokit.rest.repos
      .listBranches({ owner: this.owner, repo: this.repo, per_page: 100 })
      .then((r) => r.data)
      .catch((error) => {
        if (isEmptyRepository(error)) return [];
        throw error;
      });
    // Default branch first, then the rest; the API gives no activity order,
    // so the per-branch histories decide what is recent.
    const ordered = [
      ...branches.filter((b) => b.name === repo.defaultBranch),
      ...branches.filter((b) => b.name !== repo.defaultBranch),
    ].slice(0, maxBranches);

    const byShaMap = new Map<string, GraphCommit>();
    await Promise.all(
      ordered.map(async (branch) => {
        const { data } = await this.octokit.rest.repos
          .listCommits({ owner: this.owner, repo: this.repo, sha: branch.name, per_page: limitPerBranch })
          .catch(() => ({ data: [] as Awaited<ReturnType<Octokit["rest"]["repos"]["listCommits"]>>["data"] }));
        for (const c of data) {
          if (byShaMap.has(c.sha)) continue;
          byShaMap.set(c.sha, {
            sha: c.sha,
            message: c.commit.message.split("\n")[0],
            author: c.author?.login ?? c.commit.author?.name ?? null,
            date: c.commit.author?.date ?? null,
            parents: c.parents.map((p) => p.sha),
            heads: [],
          });
        }
      }),
    );
    for (const branch of ordered) byShaMap.get(branch.commit.sha)?.heads.push(branch.name);
    return [...byShaMap.values()].sort(
      (a, b) => Date.parse(b.date ?? "0") - Date.parse(a.date ?? "0"),
    );
  }

  /**
   * People who can be assigned work in this repository (GitHub's assignees:
   * the owner and collaborators). Empty when the token may not list them.
   */
  async listPeople(): Promise<{ login: string; avatarUrl: string }[]> {
    return this.octokit.rest.issues
      .listAssignees({ owner: this.owner, repo: this.repo, per_page: 100 })
      .then((r) => r.data.map((u) => ({ login: u.login, avatarUrl: u.avatar_url })))
      .catch(() => []);
  }

  /** Lists the markdown files a user can pick as a board source. */
  async listMarkdownFiles(): Promise<string[]> {
    const repo = await this.getRepo();
    const data = await this.octokit.rest.git
      .getTree({ owner: this.owner, repo: this.repo, tree_sha: repo.defaultBranch, recursive: "1" })
      .then((r) => r.data)
      .catch((error) => {
        // An empty repository has no tree yet; a 404 means the default branch does not exist yet.
        if (isEmptyRepository(error) || (error as { status?: number }).status === 404) return { tree: [] };
        throw error;
      });
    return data.tree
      .filter((n) => n.type === "blob" && n.path?.endsWith(".md"))
      .map((n) => n.path!)
      .sort();
  }

  async getFile(path: string, ref?: string): Promise<RepoFile> {
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
      ref,
    });
    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`${path} is not a file`);
    }
    return {
      path,
      content: Buffer.from(data.content, "base64").toString("utf8"),
      sha: data.sha,
    };
  }

  /**
   * Several new files in one commit (the Contents API can only do one per
   * commit). Fails instead of overwriting when a path already exists, and the
   * branch update is not forced, so a concurrent push makes it fail cleanly.
   */
  async createFiles(args: {
    files: { path: string; content: string }[];
    message: string;
  }): Promise<{ commitSha: string }> {
    const repo = await this.getRepo();
    const branch = repo.defaultBranch;
    const ref = await this.octokit.rest.git
      .getRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` })
      .then((r) => r.data)
      .catch((error) => {
        if (isEmptyRepository(error) || (error as { status?: number }).status === 404) return null;
        throw error;
      });
    if (!ref) {
      // An empty repository has no branch to commit onto; the Contents API can
      // start one, one file per commit.
      let commitSha = "";
      for (const file of args.files) {
        const written = await this.putFile({ path: file.path, content: file.content, message: args.message });
        commitSha = written.commitSha;
      }
      return { commitSha };
    }
    const { data: head } = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: ref.object.sha,
    });
    for (const file of args.files) {
      const exists = await this.getFile(file.path).then(
        () => true,
        () => false,
      );
      if (exists) throw new Error(`${file.path} already exists`);
    }
    const { data: tree } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: head.tree.sha,
      tree: args.files.map((f) => ({ path: f.path, mode: "100644" as const, type: "blob" as const, content: f.content })),
    });
    const { data: commit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: args.message,
      tree: tree.sha,
      parents: [head.sha],
    });
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
      force: false,
    });
    return { commitSha: commit.sha };
  }

  /** The commit the default branch points at now — what a permalink should name. */
  async headCommit(): Promise<string> {
    const repo = await this.getRepo();
    const { data } = await this.octokit.rest.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${repo.defaultBranch}` });
    return data.object.sha;
  }

  /** Every file in the repository (paths only), for pickers. */
  async listFiles(): Promise<string[]> {
    const repo = await this.getRepo();
    const data = await this.octokit.rest.git
      .getTree({ owner: this.owner, repo: this.repo, tree_sha: repo.defaultBranch, recursive: "1" })
      .then((r) => r.data)
      .catch((error) => {
        if (isEmptyRepository(error) || (error as { status?: number }).status === 404) return { tree: [] };
        throw error;
      });
    return data.tree
      .filter((n) => n.type === "blob" && n.path)
      .map((n) => n.path!)
      .sort();
  }

  /** A file's bytes — for images and PDFs, which must not pass through a string. */
  async getFileBytes(path: string): Promise<{ bytes: Buffer; sha: string }> {
    const { data } = await this.octokit.rest.repos.getContent({ owner: this.owner, repo: this.repo, path });
    if (Array.isArray(data) || data.type !== "file") throw new Error(`${path} is not a file`);
    if (data.content) return { bytes: Buffer.from(data.content, "base64"), sha: data.sha };
    // Files over 1 MB come without content; the blob has them.
    const blob = await this.octokit.rest.git.getBlob({ owner: this.owner, repo: this.repo, file_sha: data.sha });
    return { bytes: Buffer.from(blob.data.content, "base64"), sha: data.sha };
  }

  /**
   * One commit that edits files and adds new ones — a checklist and the
   * screenshot that proves an item, together or not at all. Every edited file
   * must still be at `expectedSha` and every new file must not exist yet;
   * the branch moves without force, so a push in between makes it fail.
   */
  async commitChanges(args: {
    message: string;
    edits: { path: string; content: string; expectedSha: string }[];
    adds: { path: string; base64: string }[];
  }): Promise<{ commitSha: string }> {
    const repo = await this.getRepo();
    const branch = repo.defaultBranch;
    const { data: ref } = await this.octokit.rest.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` });
    const { data: head } = await this.octokit.rest.git.getCommit({ owner: this.owner, repo: this.repo, commit_sha: ref.object.sha });

    for (const edit of args.edits) {
      const current = await this.getFile(edit.path, ref.object.sha);
      if (current.sha !== edit.expectedSha) {
        const error = new Error(`${edit.path} changed on GitHub meanwhile`);
        (error as Error & { code?: string }).code = "CONFLICT";
        throw error;
      }
    }
    for (const add of args.adds) {
      const exists = await this.getFile(add.path, ref.object.sha).then(
        () => true,
        () => false,
      );
      if (exists) throw new Error(`${add.path} already exists`);
    }

    const blobs = await Promise.all(
      args.adds.map((add) =>
        this.octokit.rest.git
          .createBlob({ owner: this.owner, repo: this.repo, content: add.base64, encoding: "base64" })
          .then((r) => ({ path: add.path, sha: r.data.sha })),
      ),
    );
    const { data: tree } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: head.tree.sha,
      tree: [
        ...args.edits.map((e) => ({ path: e.path, mode: "100644" as const, type: "blob" as const, content: e.content })),
        ...blobs.map((b) => ({ path: b.path, mode: "100644" as const, type: "blob" as const, sha: b.sha })),
      ],
    });
    const { data: commit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: args.message,
      tree: tree.sha,
      parents: [head.sha],
    });
    await this.octokit.rest.git.updateRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}`, sha: commit.sha, force: false });
    return { commitSha: commit.sha };
  }

  /**
   * Writes a file back. `expectedSha` is passed straight to the Contents API,
   * which rejects the write if the blob moved underneath us — the server-side
   * half of the conflict guarantee (the client-side check runs first so the UI
   * can show a diff instead of an API error).
   */
  async putFile(args: {
    path: string;
    content: string;
    /** Omitted when creating a file that does not exist yet. */
    expectedSha?: string;
    message: string;
    branch?: string;
  }): Promise<{ commitSha: string; contentSha: string }> {
    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path: args.path,
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      sha: args.expectedSha ? args.expectedSha : undefined,
      branch: args.branch,
    });
    return {
      commitSha: data.commit.sha ?? "",
      contentSha: data.content?.sha ?? "",
    };
  }
}
