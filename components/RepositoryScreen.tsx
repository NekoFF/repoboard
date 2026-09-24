"use client";

import { useEffect, useState } from "react";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import type {
  BranchSummary,
  CommitDetail,
  CommitSummary,
  IssueSummary,
  PullRequestSummary,
} from "@/lib/github/client";
import { TopBar } from "@/components/TopBar";

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
  const [tab, setTab] = useState<Tab>(initialTab);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [pulls, setPulls] = useState<PullRequestSummary[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [openCommit, setOpenCommit] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const query =
          tab === "commits" && selectedBranch
            ? `resource=commits&branch=${encodeURIComponent(selectedBranch)}`
            : `resource=${tab}`;
        const response = await fetch(`/api/github?${query}`, {
          cache: "no-store",
        });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error ?? "GitHub request failed");
          return;
        }
        if (tab === "branches") setBranches(body.branches ?? []);
        if (tab === "commits") setCommits(body.commits ?? []);
        if (tab === "pulls") setPulls(body.pulls ?? []);
        if (tab === "issues") setIssues(body.issues ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, selectedBranch, connected]);

  const openCommitDetail = async (sha: string) => {
    const response = await fetch(`/api/github?resource=commit&sha=${sha}`);
    const body = await response.json();
    if (response.ok) setOpenCommit(body.commit);
  };

  const taskForBranch = (branch: string) =>
    data.tasks.find((t) => t.branches.includes(branch));

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "branches", label: "Branches", count: branches.length || undefined },
    { id: "commits", label: "Commits" },
    { id: "pulls", label: "Pull Requests", count: pulls.length || undefined },
    { id: "issues", label: "Issues", count: issues.length || undefined },
  ];

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSync={null}
        connected={connected}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-semibold text-ink">Repository</h1>
          <p className="text-[12px] text-muted">
            Branches, recent commits and pull requests for the connected
            repository.
          </p>
        </div>

        <div className="flex gap-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={
                tab === item.id
                  ? "rounded-md bg-active px-[10px] py-[7px] text-[12px] font-medium text-white"
                  : "rb-btn px-[10px] py-[7px]"
              }
            >
              {item.label}
              {item.count ? ` ${item.count}` : ""}
            </button>
          ))}
        </div>

        {!connected && (
          <div className="rb-card p-4 text-[12px] text-muted">
            Connect a repository in Settings to load live GitHub data.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
            {error}
          </div>
        )}

        {loading && <p className="text-[12px] text-muted">Loading from GitHub…</p>}

        {connected && !loading && tab === "branches" && (
          <div className="w-full overflow-hidden rounded-xl border border-border">
            <div className="flex w-full p-3 text-[11px] font-medium text-muted">
              <span className="flex-1">Branch</span>
              <span className="flex-1">Last commit</span>
              <span className="flex-1">Ahead / Behind</span>
              <span className="flex-1">Linked task</span>
              <span className="flex-1">Status</span>
            </div>
            {branches.length === 0 && (
              <div className="border-t border-border p-3 text-[12px] text-muted">
                No branches returned.
              </div>
            )}
            {branches.map((branch) => {
              const task = taskForBranch(branch.name);
              return (
                <button
                  key={branch.name}
                  className="flex w-full items-center border-t border-border p-3 text-left hover:bg-pill"
                  onClick={() => {
                    setSelectedBranch(branch.name);
                    setTab("commits");
                  }}
                >
                  <span className="flex-1">
                    <span className="rb-pill">⑂ {branch.name}</span>
                  </span>
                  <span className="flex-1 truncate text-[12px] text-muted">
                    {branch.lastCommit.sha.slice(0, 7)} ·{" "}
                    {branch.lastCommit.message}
                  </span>
                  <span className="flex-1 text-[12px] font-medium text-ink">
                    +{branch.ahead} / -{branch.behind}
                  </span>
                  <span className="flex-1 truncate text-[12px] font-medium text-ink">
                    {task?.title ?? "—"}
                  </span>
                  <span className="flex-1">
                    {branch.protected ? (
                      <span className="rb-pill">protected</span>
                    ) : branch.behind > 0 ? (
                      <span className="inline-flex items-center rounded-sm bg-warn-bg px-2 py-1 text-[11px] font-medium text-warn-fg">
                        needs rebase
                      </span>
                    ) : (
                      <span className="rb-pill">active</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {connected && !loading && tab === "commits" && (
          <div className="flex flex-col gap-2">
            {selectedBranch && (
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span className="rb-pill">⑂ {selectedBranch}</span>
                <button
                  className="hover:text-ink"
                  onClick={() => setSelectedBranch(null)}
                >
                  clear
                </button>
              </div>
            )}
            <div className="w-full overflow-hidden rounded-xl border border-border">
              {commits.map((commit) => (
                <button
                  key={commit.sha}
                  className="flex w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0 hover:bg-pill"
                  onClick={() => openCommitDetail(commit.sha)}
                >
                  <span className="rb-pill">{commit.sha.slice(0, 7)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                    {commit.message}
                  </span>
                  <span className="text-[11px] text-muted">
                    {commit.author ?? "unknown"} ·{" "}
                    {commit.date
                      ? new Date(commit.date).toLocaleDateString()
                      : "—"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {connected && !loading && tab === "pulls" && (
          <div className="w-full overflow-hidden rounded-xl border border-border">
            {pulls.map((pr) => (
              <div
                key={pr.number}
                className="flex w-full flex-wrap items-center gap-2 border-b border-border p-3 last:border-b-0"
              >
                <span className="rb-pill">#{pr.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                  {pr.title}
                </span>
                {pr.draft && <span className="rb-pill">draft</span>}
                <span className="rb-pill">{pr.state}</span>
                <span className="text-[11px] text-muted">
                  {pr.head} → {pr.base}
                </span>
                {pr.checks && (
                  <span
                    className={`inline-flex items-center rounded-sm px-2 py-1 text-[11px] font-medium ${
                      pr.checks.passed === pr.checks.total
                        ? "bg-success-bg text-success-fg"
                        : "bg-warn-bg text-warn-fg"
                    }`}
                  >
                    checks {pr.checks.passed}/{pr.checks.total}
                  </span>
                )}
                {pr.reviewers.length > 0 && (
                  <span className="text-[11px] text-muted">
                    reviewers: {pr.reviewers.join(", ")}
                  </span>
                )}
              </div>
            ))}
            {pulls.length === 0 && (
              <div className="p-3 text-[12px] text-muted">
                No pull requests.
              </div>
            )}
          </div>
        )}

        {connected && !loading && tab === "issues" && (
          <div className="w-full overflow-hidden rounded-xl border border-border">
            {issues.map((issue) => (
              <div
                key={issue.number}
                className="flex w-full flex-wrap items-center gap-2 border-b border-border p-3 last:border-b-0"
              >
                <span className="rb-pill">#{issue.number}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                  {issue.title}
                </span>
                <span className="rb-pill">{issue.state}</span>
                {issue.labels.map((label) => (
                  <span key={label} className="rb-pill">
                    {label}
                  </span>
                ))}
                {issue.assignees.length > 0 && (
                  <span className="text-[11px] text-muted">
                    {issue.assignees.join(", ")}
                  </span>
                )}
              </div>
            ))}
            {issues.length === 0 && (
              <div className="p-3 text-[12px] text-muted">No issues.</div>
            )}
          </div>
        )}
      </div>

      {openCommit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-6">
          <div className="flex max-h-full w-full max-w-4xl flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="rb-pill">{openCommit.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                {openCommit.message.split("\n")[0]}
              </span>
              <button className="rb-btn" onClick={() => setOpenCommit(null)}>
                Close
              </button>
            </div>
            <p className="text-[11px] text-muted">
              {openCommit.author ?? "unknown"} ·{" "}
              {openCommit.date
                ? new Date(openCommit.date).toLocaleString()
                : "—"}{" "}
              · +{openCommit.additions ?? 0} / -{openCommit.deletions ?? 0}
            </p>
            <div className="flex flex-col gap-3 overflow-auto">
              {openCommit.files.map((file) => (
                <div key={file.filename} className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 p-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                      {file.filename}
                    </span>
                    <span className="text-[11px] text-success-fg">
                      +{file.additions}
                    </span>
                    <span className="text-[11px] text-danger-fg">
                      -{file.deletions}
                    </span>
                  </div>
                  {file.patch && (
                    <pre className="overflow-x-auto border-t border-border bg-code-bg p-3 text-[11px] leading-relaxed text-code-fg">
                      {file.patch}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
