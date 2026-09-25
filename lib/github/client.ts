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
    return new GitHubClient(new Octokit({ auth: token }), repo.owner, repo.name);
  }

  /** Validates a token/repo pair before it is persisted by the connect flow. */
  static async probe(token: string, slug: string): Promise<RepoSummary> {
    const [owner, name] = slug.split("/");
    if (!owner || !name) throw new Error("Repository must be owner/name");
    const octokit = new Octokit({ auth: token });
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
    const { data } = await this.octokit.rest.repos.listCommits({
      owner: this.owner,
      repo: this.repo,
      sha: branch,
      per_page: perPage,
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

  /** Lists the markdown files a user can pick as a board source. */
  async listMarkdownFiles(): Promise<string[]> {
    const repo = await this.getRepo();
    const { data } = await this.octokit.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: repo.defaultBranch,
      recursive: "1",
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
