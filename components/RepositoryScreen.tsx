"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  CircleCheck,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitGraph as GraphIcon,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Plus,
  Search,
  Shield,
  X,
} from "lucide-react";
import type { BoardData, BoardTask, RepoHeader } from "@/lib/board-service";
import type { CommitDetail } from "@/lib/github/client";
import { api, useResource } from "@/lib/client/api";
import { useShell } from "@/components/shell/ShellContext";
import { PageHeader } from "@/components/PageHeader";
import { GitGraph } from "@/components/GitGraph";
import { LabelChip } from "@/components/TaskCard";
import {
  EmptyState,
  Menu,
  MenuItem,
  RelativeTime,
  RowSkeleton,
  Segmented,
  Sheet,
  Skeleton,
  Spinner,
  useToast,
} from "@/components/ui";

type Tab = "graph" | "branches" | "commits" | "pulls" | "issues";

function CardChip({ task }: { task: BoardTask | undefined }) {
  if (!task) return null;
  return (
    <Link
      href={`/board?card=${task.id}`}
      onClick={(event) => event.stopPropagation()}
      className="hidden max-w-[200px] shrink-0 truncate rounded-sm bg-pill px-1.5 py-0.5 text-2xs text-muted hover:text-ink md:inline"
      title={task.title}
    >
      {task.number != null && <span className="font-mono">RB-{task.number} </span>}
      {task.title}
    </Link>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

const rowClass =
  "flex min-h-11 w-full items-center gap-3 border-b border-border px-4 py-2 text-left transition-colors hover:bg-hover lg:px-5";

/** A patch as returned by GitHub, coloured line by line. */
function Patch({ patch }: { patch: string }) {
  return (
    <div className="overflow-auto bg-code-bg font-mono text-xs leading-[1.7]">
      {patch.split("\n").map((line, i) => (
        <div
          key={i}
          className={`whitespace-pre px-3 ${
            line.startsWith("+")
              ? "bg-state-done/10 text-ink"
              : line.startsWith("-")
                ? "bg-danger/10 text-muted"
                : line.startsWith("@@")
                  ? "text-state-review"
                  : "text-faint"
          }`}
        >
          {line || " "}
        </div>
      ))}
    </div>
  );
}

function CommitSheet({ sha, repo, onClose }: { sha: string; repo: string | null; onClose: () => void }) {
  const commit = useResource(() => api.commit(sha), [sha]);
  const c: CommitDetail | undefined = commit.data?.commit;
  const [title, ...body] = (c?.message ?? "").split("\n");
  return (
    <Sheet label={`Commit ${sha.slice(0, 7)}`} onClose={onClose} width={900}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <GitCommitHorizontal className="size-4 text-muted" />
        <span className="font-mono text-sm text-ink">{sha.slice(0, 7)}</span>
        <div className="flex-1" />
        {repo && (
          <a className="rb-btn-ghost" href={`https://github.com/${repo}/commit/${sha}`} target="_blank" rel="noreferrer noopener">
            GitHub <ExternalLink className="size-3.5" />
          </a>
        )}
        <button className="rb-icon-btn" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="rb-scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {commit.loading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {commit.error && <p className="text-sm text-danger">{commit.error}</p>}
        {c && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold text-ink">{title}</h2>
              {body.join("\n").trim() && (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{body.join("\n").trim()}</p>
              )}
              <p className="mt-3 flex flex-wrap gap-x-4 text-sm text-muted">
                <span>{c.author}</span>
                <RelativeTime value={c.date} />
                <span className="font-mono text-xs">
                  <span className="text-state-done">+{c.additions ?? 0}</span> <span className="text-danger">−{c.deletions ?? 0}</span>
                </span>
                <span>
                  {c.files.length} file{c.files.length === 1 ? "" : "s"}
                </span>
              </p>
            </div>
            {c.files.map((file) => (
              <div key={file.filename} className="overflow-hidden rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-canvas px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{file.filename}</span>
                  <span className="text-2xs text-faint">{file.status}</span>
                  <span className="font-mono text-2xs">
                    <span className="text-state-done">+{file.additions}</span> <span className="text-danger">−{file.deletions}</span>
                  </span>
                </div>
                {file.patch ? <Patch patch={file.patch} /> : <p className="px-3 py-2 text-xs text-faint">No text diff (binary or too large).</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function RepositoryScreen({
  data,
  header,
  connected,
  initialTab,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
  initialTab: Tab;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { repo } = useShell();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [branch, setBranch] = useState<string | null>(params.get("branch"));
  const [query, setQuery] = useState("");
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [importing, setImporting] = useState<number | null>(null);

  useEffect(() => {
    const t = params.get("tab") as Tab | null;
    if (t) setTab(t);
    setBranch(params.get("branch"));
  }, [params]);

  const go = (next: Tab, nextBranch: string | null = branch) => {
    setTab(next);
    setBranch(nextBranch);
    router.replace(`/repository?tab=${next}${nextBranch ? `&branch=${encodeURIComponent(nextBranch)}` : ""}`, { scroll: false });
  };

  const graph = useResource(api.graph, [], { enabled: connected && tab === "graph" });
  const branches = useResource(api.branches, [], { enabled: connected && (tab === "branches" || tab === "commits") });
  const commits = useResource(() => api.commits(branch ?? undefined), [branch], { enabled: connected && tab === "commits" });
  const pulls = useResource(api.pulls, [], { enabled: connected && tab === "pulls" });
  const issues = useResource(api.issues, [], { enabled: connected && tab === "issues" });

  const cardsByNumber = useMemo(
    () => new Map(data.tasks.filter((t) => t.number != null).map((t) => [t.number!, t])),
    [data.tasks],
  );
  const cardFor = {
    branch: (name: string) => data.tasks.find((t) => t.branches.includes(name)),
    pr: (n: number, title: string) =>
      data.tasks.find((t) => t.pullRequests.includes(n)) ??
      cardsByNumber.get(Number(title.match(/\bRB-(\d+)/i)?.[1])),
    issue: (n: number) => data.tasks.find((t) => t.issues.includes(n)),
  };

  const q = query.trim().toLowerCase();
  const match = (...values: (string | null | undefined)[]) => !q || values.some((v) => v?.toLowerCase().includes(q));

  const addIssue = async (number: number) => {
    const column = data.columns[0];
    if (!column) return;
    setImporting(number);
    try {
      const result = await api.importIssues([number], column.id);
      toast.push({
        kind: "success",
        message: result.created ? `Issue #${number} is on the board` : `Issue #${number} was already on the board`,
      });
      router.refresh();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not add the issue", detail: (error as Error).message });
    } finally {
      setImporting(null);
    }
  };

  const loading = (r: { loading: boolean }) => r.loading && <RowSkeleton rows={8} />;
  const failed = (r: { error: string | null; reload: () => void }) =>
    r.error && (
      <EmptyState
        title="GitHub did not answer"
        body={r.error}
        action={
          <button className="rb-btn" onClick={r.reload}>
            Try again
          </button>
        }
      />
    );

  return (
    <>
      <PageHeader
        title="Code"
        icon={<GitBranch className="size-4" />}
        meta={repo ?? undefined}
        actions={
          repo && (
            <a className="rb-btn rb-btn-sm" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer noopener">
              GitHub <ExternalLink className="size-3.5" />
            </a>
          )
        }
      >
        <Segmented
          size="sm"
          value={tab}
          onChange={(t) => go(t)}
          options={[
            { value: "graph", label: <><GraphIcon className="size-3.5" /> Graph</> },
            { value: "branches", label: <><GitBranch className="size-3.5" /> Branches</> },
            { value: "commits", label: <><GitCommitHorizontal className="size-3.5" /> Commits</> },
            { value: "pulls", label: <><GitPullRequest className="size-3.5" /> Pull requests</> },
            { value: "issues", label: <><CircleDot className="size-3.5" /> Issues</> },
          ]}
        />
        {tab === "commits" && (
          <Menu
            trigger={
              <button className="rb-btn rb-btn-sm">
                <GitBranch className="size-3.5" />
                <span className="font-mono">{branch ?? "default branch"}</span>
                <ChevronDown className="size-3.5 text-faint" />
              </button>
            }
          >
            <MenuItem checked={!branch} onSelect={() => go("commits", null)}>
              Default branch
            </MenuItem>
            {(branches.data?.branches ?? []).map((b) => (
              <MenuItem key={b.name} checked={b.name === branch} onSelect={() => go("commits", b.name)}>
                <span className="font-mono text-xs">{b.name}</span>
              </MenuItem>
            ))}
          </Menu>
        )}
        {tab !== "graph" && (
          <label className="ml-auto flex h-7 w-full max-w-[260px] items-center gap-1.5 rounded-md border border-border bg-surface px-2">
            <Search className="size-3.5 text-faint" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              placeholder="Filter"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
      </PageHeader>

      <div className="rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!connected && <EmptyState title="Not connected" body="Connect a repository in Settings to see its code." />}

        {tab === "graph" && connected && (
          <>
            {loading(graph)}
            {failed(graph)}
            {graph.data &&
              (graph.data.commits.length ? (
                <GitGraph commits={graph.data.commits} cardsByNumber={cardsByNumber} onOpen={setOpenSha} mainBranch={header.defaultBranch} />
              ) : (
                <EmptyState icon={<GraphIcon className="size-6" />} title="No commits yet" body="Push the first commit and its history appears here." />
              ))}
          </>
        )}

        {tab === "branches" && connected && (
          <>
            {loading(branches)}
            {failed(branches)}
            <Rows>
              {(branches.data?.branches ?? [])
                .filter((b) => match(b.name, b.lastCommit.message))
                .map((b) => {
                  const max = Math.max(1, b.ahead, b.behind);
                  return (
                    <button key={b.name} className={rowClass} onClick={() => go("commits", b.name)}>
                      <GitBranch className="size-4 shrink-0 text-muted" />
                      <span className="w-[260px] min-w-0 shrink-0 truncate font-mono text-sm text-ink">{b.name}</span>
                      {b.protected && <Shield className="size-3.5 shrink-0 text-faint" aria-label="Protected" />}
                      <span className="min-w-0 flex-1 truncate text-sm text-muted">{b.lastCommit.message}</span>
                      <CardChip task={cardFor.branch(b.name)} />
                      <span className="hidden w-28 shrink-0 items-center gap-1 sm:flex" title={`${b.behind} behind, ${b.ahead} ahead`}>
                        <span className="flex h-1.5 flex-1 justify-end overflow-hidden rounded-l-full bg-ink/[0.05]">
                          <span className="h-full bg-muted/60" style={{ width: `${(b.behind / max) * 100}%` }} />
                        </span>
                        <span className="flex h-1.5 flex-1 overflow-hidden rounded-r-full bg-ink/[0.05]">
                          <span className="h-full bg-state-done" style={{ width: `${(b.ahead / max) * 100}%` }} />
                        </span>
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-2xs tabular-nums text-faint">
                        {b.behind}↓ {b.ahead}↑
                      </span>
                      <RelativeTime value={b.lastCommit.date} className="w-16 shrink-0 text-right text-xs text-faint" />
                    </button>
                  );
                })}
            </Rows>
          </>
        )}

        {tab === "commits" && connected && (
          <>
            {loading(commits)}
            {failed(commits)}
            <Rows>
              {(commits.data?.commits ?? [])
                .filter((c) => match(c.message, c.sha, c.author))
                .map((c) => (
                  <button key={c.sha} className={rowClass} onClick={() => setOpenSha(c.sha)}>
                    <GitCommitHorizontal className="size-4 shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.message}</span>
                    <CardChip task={cardsByNumber.get(Number(c.message.match(/\bRB-(\d+)/i)?.[1]))} />
                    <span className="hidden w-24 shrink-0 truncate text-xs text-muted sm:inline">{c.author}</span>
                    <span className="w-16 shrink-0 font-mono text-2xs text-faint">{c.sha.slice(0, 7)}</span>
                    <RelativeTime value={c.date} className="w-16 shrink-0 text-right text-xs text-faint" />
                  </button>
                ))}
            </Rows>
          </>
        )}

        {tab === "pulls" && connected && (
          <>
            {loading(pulls)}
            {failed(pulls)}
            <Rows>
              {(pulls.data?.pulls ?? [])
                .filter((p) => match(p.title, `#${p.number}`, p.head, p.author))
                .map((pr) => {
                  const merged = pr.mergeableState === "merged";
                  const Icon = merged ? GitMerge : pr.draft ? GitPullRequestDraft : GitPullRequest;
                  const tone = merged ? "text-state-review" : pr.state === "open" ? (pr.draft ? "text-faint" : "text-state-done") : "text-danger";
                  return (
                    <a
                      key={pr.number}
                      className={rowClass}
                      href={repo ? `https://github.com/${repo}/pull/${pr.number}` : undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <Icon className={`size-4 shrink-0 ${tone}`} />
                      <span className="w-10 shrink-0 font-mono text-xs text-faint">#{pr.number}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{pr.title}</span>
                      <CardChip task={cardFor.pr(pr.number, pr.title)} />
                      <span className="hidden max-w-[220px] shrink-0 truncate font-mono text-2xs text-faint lg:inline">
                        {pr.head} → {pr.base}
                      </span>
                      {pr.checks && pr.checks.total > 0 && (
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 text-2xs tabular-nums ${
                            pr.checks.passed === pr.checks.total ? "text-state-done" : "text-state-doing"
                          }`}
                          title="Checks passed"
                        >
                          <CircleCheck className="size-3.5" />
                          {pr.checks.passed}/{pr.checks.total}
                        </span>
                      )}
                      <span className="w-20 shrink-0 truncate text-right text-xs text-muted">{pr.author}</span>
                    </a>
                  );
                })}
              {pulls.data?.pulls.length === 0 && <EmptyState title="No pull requests" body="Pull requests on GitHub show up here." />}
            </Rows>
          </>
        )}

        {tab === "issues" && connected && (
          <>
            {loading(issues)}
            {failed(issues)}
            <Rows>
              {(issues.data?.issues ?? [])
                .filter((i) => match(i.title, `#${i.number}`, ...i.labels))
                .map((issue) => {
                  const card = cardFor.issue(issue.number);
                  return (
                    <div key={issue.number} className={rowClass}>
                      <CircleDot className={`size-4 shrink-0 ${issue.state === "open" ? "text-state-done" : "text-state-review"}`} />
                      <span className="w-10 shrink-0 font-mono text-xs text-faint">#{issue.number}</span>
                      <a
                        className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
                        href={repo ? `https://github.com/${repo}/issues/${issue.number}` : undefined}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {issue.title}
                      </a>
                      <span className="hidden shrink-0 gap-1 md:flex">
                        {issue.labels.slice(0, 3).map((l) => (
                          <LabelChip key={l} label={l} />
                        ))}
                      </span>
                      {card ? (
                        <CardChip task={card} />
                      ) : (
                        issue.state === "open" && (
                          <button className="rb-btn-ghost shrink-0" onClick={() => addIssue(issue.number)} disabled={importing === issue.number}>
                            {importing === issue.number ? <Spinner /> : <Plus className="size-3.5" />} Board
                          </button>
                        )
                      )}
                      <span className="w-20 shrink-0 truncate text-right text-xs text-muted">{issue.assignees[0] ?? ""}</span>
                    </div>
                  );
                })}
              {issues.data?.issues.length === 0 && <EmptyState title="No issues" body="Issues on GitHub show up here." />}
            </Rows>
          </>
        )}
      </div>

      {openSha && <CommitSheet sha={openSha} repo={repo} onClose={() => setOpenSha(null)} />}
    </>
  );
}
