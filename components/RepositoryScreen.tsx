"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import type { CommitDetail } from "@/lib/github/client";
import { TopBar } from "@/components/TopBar";
import {
  EmptyState,
  Modal,
  RelativeTime,
  RowSkeleton,
  Segmented,
  Spinner,
  useToast,
} from "@/components/ui";
import { api, useResource } from "@/lib/client/api";

type Tab = "branches" | "commits" | "pulls" | "issues";

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
  const searchParams = useSearchParams();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState<string | null>(
    searchParams.get("branch"),
  );
  const [openCommit, setOpenCommit] = useState<CommitDetail | null>(null);
  const [loadingCommit, setLoadingCommit] = useState<string | null>(null);

  const branches = useResource(api.branches, [], { enabled: connected });
  const commits = useResource(
    () => api.commits(branch ?? undefined),
    [branch],
    { enabled: connected && tab === "commits" },
  );
  const pulls = useResource(api.pulls, [], {
    enabled: connected && tab === "pulls",
  });
  const issues = useResource(api.issues, [], {
    enabled: connected && tab === "issues",
  });

  useEffect(() => {
    const urlTab = searchParams.get("tab") as Tab | null;
    if (urlTab && urlTab !== tab) setTab(urlTab);
    const urlBranch = searchParams.get("branch");
    if (urlBranch !== branch) setBranch(urlBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const switchTab = (next: Tab) => {
    setTab(next);
    router.replace(`/repository?tab=${next}${branch ? `&branch=${branch}` : ""}`);
  };

  const filter = <T,>(items: T[], pick: (item: T) => string[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      pick(item).some((value) => value.toLowerCase().includes(q)),
    );
  };

  const taskFor = {
    branch: (name: string) => data.tasks.find((t) => t.branches.includes(name)),
    pr: (number: number) =>
      data.tasks.find((t) => t.pullRequests.includes(number)),
    issue: (number: number) => data.tasks.find((t) => t.issues.includes(number)),
  };

  const openCommitDetail = async (sha: string) => {
    setLoadingCommit(sha);
    try {
      const { commit } = await api.commit(sha);
      setOpenCommit(commit);
    } catch (error) {
      toast.push({
        kind: "error",
        message: "Could not load the commit",
        detail: (error as Error).message,
      });
    } finally {
      setLoadingCommit(null);
    }
  };

  const linkToCard = async (
    payload: Record<string, unknown>,
    label: string,
  ) => {
    const card = data.tasks[0];
    if (!card) {
      toast.push({
        kind: "info",
        message: "No cards yet",
        detail: "Create a card first, then link from its detail panel.",
      });
      return;
    }
    toast.push({
      kind: "info",
      message: `Open a card to link ${label}`,
      detail: "Linking happens from the card, so it lands on the right one.",
      action: { label: "Board", run: () => router.push("/board") },
    });
  };

  const branchRows = filter(branches.data?.branches ?? [], (b) => [
    b.name,
    b.lastCommit.message,
  ]);
  const commitRows = filter(commits.data?.commits ?? [], (c) => [
    c.message,
    c.sha,
    c.author ?? "",
  ]);
  const prRows = filter(pulls.data?.pulls ?? [], (p) => [
    p.title,
    `#${p.number}`,
    p.head,
  ]);
  const issueRows = filter(issues.data?.issues ?? [], (i) => [
    i.title,
    `#${i.number}`,
    ...i.labels,
  ]);

  const active = {
    branches,
    commits,
    pulls,
    issues,
  }[tab];

  const counts = useMemo(
    () => ({
      branches: branches.data?.branches.length,
      pulls: pulls.data?.pulls.filter((p) => p.state === "open").length,
      issues: issues.data?.issues.filter((i) => i.state === "open").length,
    }),
    [branches.data, pulls.data, issues.data],
  );

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSyncAt={header.lastSyncAt}
        connected={connected}
        actions={
          <button
            className="rb-btn"
            onClick={active.reload}
            disabled={active.refreshing}
          >
            {active.refreshing ? <Spinner /> : null} Refresh
          </button>
        }
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-ink">
            Repository
          </h1>
          <p className="text-[12px] text-muted">
            Live from github.com — nothing on this screen is stored locally.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={tab}
            onChange={switchTab}
            options={[
              { value: "branches", label: "Branches", count: counts.branches },
              { value: "commits", label: "Commits" },
              { value: "pulls", label: "Pull requests", count: counts.pulls },
              { value: "issues", label: "Issues", count: counts.issues },
            ]}
          />

          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 transition-colors focus-within:border-ink">
            <span className="text-[11px] text-muted" aria-hidden>
              ⌕
            </span>
            <input
              className="w-40 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-muted/70"
              placeholder={`Filter ${tab}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {branch && (
            <span className="rb-pill font-mono">
              ⑂ {branch}
              <button
                className="ml-1 text-muted hover:text-ink"
                onClick={() => {
                  setBranch(null);
                  router.replace(`/repository?tab=${tab}`);
                }}
              >
                ×
              </button>
            </span>
          )}

          <div className="flex-1" />
          <span className="text-[11px] text-muted">
            updated <RelativeTime value={active.updatedAt} />
          </span>
        </div>

        {!connected && (
          <EmptyState
            icon="⌘"
            title="Not connected"
            body="Add a token in Settings to read this repository."
          />
        )}

        {active.error && (
          <div className="flex items-center gap-2 rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
            {active.error}
            <button className="rb-btn-ghost ml-auto" onClick={active.reload}>
              Retry
            </button>
          </div>
        )}

        {connected && active.loading && (
          <div className="overflow-hidden rounded-xl border border-border">
            <RowSkeleton rows={6} />
          </div>
        )}

        {connected && !active.loading && tab === "branches" && (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center gap-3 border-b border-border bg-canvas/40 px-3 py-2 text-[11px] font-medium text-muted">
              <span className="w-[26%]">Branch</span>
              <span className="flex-1">Last commit</span>
              <span className="w-24 text-right">Ahead / behind</span>
              <span className="w-[18%]">Linked card</span>
              <span className="w-24 text-right">Status</span>
            </div>
            {branchRows.map((item) => {
              const card = taskFor.branch(item.name);
              return (
                <button
                  key={item.name}
                  onClick={() => {
                    setBranch(item.name);
                    switchTab("commits");
                  }}
                  className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-pill"
                >
                  <span className="w-[26%] truncate font-mono text-[12px] text-ink">
                    ⑂ {item.name}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="font-mono text-[11px] text-muted">
                      {item.lastCommit.sha.slice(0, 7)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                      {item.lastCommit.message}
                    </span>
                    <RelativeTime
                      value={item.lastCommit.date}
                      className="shrink-0 text-[11px] text-muted"
                    />
                  </span>
                  <span className="w-24 text-right text-[12px] tabular-nums text-ink">
                    <span className="text-success-fg">+{item.ahead}</span>{" "}
                    <span className={item.behind ? "text-warn-fg" : "text-muted"}>
                      −{item.behind}
                    </span>
                  </span>
                  <span className="w-[18%] truncate text-[12px] text-ink">
                    {card?.title ?? <span className="text-muted">—</span>}
                  </span>
                  <span className="w-24 text-right">
                    {item.protected ? (
                      <span className="rb-pill">protected</span>
                    ) : item.behind > 0 ? (
                      <span className="rb-pill-warn">needs rebase</span>
                    ) : (
                      <span className="rb-pill-ok">level</span>
                    )}
                  </span>
                </button>
              );
            })}
            {branchRows.length === 0 && (
              <p className="p-4 text-center text-[12px] text-muted">
                Nothing matches “{query}”.
              </p>
            )}
          </div>
        )}

        {connected && !active.loading && tab === "commits" && (
          <div className="overflow-hidden rounded-xl border border-border">
            {commitRows.map((commit) => (
              <button
                key={commit.sha}
                onClick={() => openCommitDetail(commit.sha)}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-pill"
              >
                <span className="font-mono text-[11px] text-muted">
                  {commit.sha.slice(0, 7)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {commit.message}
                </span>
                {loadingCommit === commit.sha && <Spinner className="text-muted" />}
                <span className="shrink-0 text-[11px] text-muted">
                  {commit.author ?? "unknown"}
                </span>
                <RelativeTime
                  value={commit.date}
                  className="w-16 shrink-0 text-right text-[11px] text-muted"
                />
              </button>
            ))}
            {commitRows.length === 0 && (
              <p className="p-4 text-center text-[12px] text-muted">
                No commits {branch ? `on ${branch}` : ""} match this filter.
              </p>
            )}
          </div>
        )}

        {connected && !active.loading && tab === "pulls" && (
          <div className="overflow-hidden rounded-xl border border-border">
            {prRows.map((pr) => (
              <div
                key={pr.number}
                className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0"
              >
                <span className="font-mono text-[11px] text-muted">
                  #{pr.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                  {pr.title}
                </span>
                {pr.draft && <span className="rb-pill">draft</span>}
                <span
                  className={pr.state === "open" ? "rb-pill-ok" : "rb-pill"}
                >
                  {pr.mergeableState ?? pr.state}
                </span>
                <span className="font-mono text-[11px] text-muted">
                  {pr.head} → {pr.base}
                </span>
                {pr.checks && (
                  <span
                    className={
                      pr.checks.total === 0
                        ? "rb-pill"
                        : pr.checks.passed === pr.checks.total
                          ? "rb-pill-ok"
                          : "rb-pill-warn"
                    }
                  >
                    checks {pr.checks.passed}/{pr.checks.total}
                  </span>
                )}
                {taskFor.pr(pr.number) ? (
                  <span className="rb-pill">on board</span>
                ) : (
                  <button
                    className="rb-btn-ghost"
                    onClick={() =>
                      linkToCard({ pullRequest: pr.number }, `PR #${pr.number}`)
                    }
                  >
                    Link
                  </button>
                )}
              </div>
            ))}
            {prRows.length === 0 && (
              <p className="p-4 text-center text-[12px] text-muted">
                No pull requests.
              </p>
            )}
          </div>
        )}

        {connected && !active.loading && tab === "issues" && (
          <div className="overflow-hidden rounded-xl border border-border">
            {issueRows.map((issue) => (
              <div
                key={issue.number}
                className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0"
              >
                <span className="font-mono text-[11px] text-muted">
                  #{issue.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                  {issue.title}
                </span>
                {issue.labels.map((label) => (
                  <span key={label} className="rb-pill">
                    {label}
                  </span>
                ))}
                <span
                  className={issue.state === "open" ? "rb-pill-ok" : "rb-pill"}
                >
                  {issue.state}
                </span>
                {taskFor.issue(issue.number) ? (
                  <span className="rb-pill">on board</span>
                ) : (
                  <button
                    className="rb-btn-ghost"
                    onClick={() => router.push("/board")}
                    title="Import issues from the board's empty state or the import dialog"
                  >
                    Add to board
                  </button>
                )}
              </div>
            ))}
            {issueRows.length === 0 && (
              <p className="p-4 text-center text-[12px] text-muted">
                No issues.
              </p>
            )}
          </div>
        )}
      </div>

      {openCommit && (
        <Modal
          wide
          onClose={() => setOpenCommit(null)}
          title={
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[12px] text-muted">
                {openCommit.sha.slice(0, 7)}
              </span>
              <span className="min-w-0 truncate">
                {openCommit.message.split("\n")[0]}
              </span>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            <span>{openCommit.author ?? "unknown"}</span>
            <span aria-hidden>·</span>
            <RelativeTime value={openCommit.date} />
            <span aria-hidden>·</span>
            <span className="text-success-fg">+{openCommit.additions ?? 0}</span>
            <span className="text-danger-fg">−{openCommit.deletions ?? 0}</span>
            <span aria-hidden>·</span>
            <span>{openCommit.files.length} file(s)</span>
          </div>

          <div className="flex flex-col gap-3">
            {openCommit.files.map((file) => (
              <div
                key={file.filename}
                className="overflow-hidden rounded-lg border border-border"
              >
                <div className="flex items-center gap-2 bg-canvas/40 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                    {file.filename}
                  </span>
                  <span className="rb-pill">{file.status}</span>
                  <span className="text-[11px] text-success-fg">
                    +{file.additions}
                  </span>
                  <span className="text-[11px] text-danger-fg">
                    −{file.deletions}
                  </span>
                </div>
                {file.patch ? (
                  <div className="max-h-[320px] overflow-auto font-mono text-[11px] leading-relaxed">
                    {file.patch.split("\n").map((line, index) => (
                      <div
                        key={index}
                        className={`px-3 py-[1px] ${
                          line.startsWith("+") && !line.startsWith("+++")
                            ? "bg-success-bg/50 text-success-fg"
                            : line.startsWith("-") && !line.startsWith("---")
                              ? "bg-warn-bg/30 text-danger-fg"
                              : line.startsWith("@@")
                                ? "bg-pill text-muted"
                                : "text-muted"
                        }`}
                      >
                        {line || " "}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-2 text-[11.5px] text-muted">
                    GitHub returned no patch for this file (binary or too large).
                  </p>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
