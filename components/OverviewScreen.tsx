"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { TopBar } from "@/components/TopBar";
import {
  EmptyState,
  RelativeTime,
  RowSkeleton,
  Skeleton,
} from "@/components/ui";
import { api, useResource } from "@/lib/client/api";

function Panel({
  title,
  href,
  hint,
  children,
}: {
  title: string;
  href?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface p-[14px]">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {hint}
        <div className="flex-1" />
        {href && (
          <Link href={href} className="rb-btn-ghost">
            Open
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function OverviewScreen({
  data,
  header,
  connected,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
}) {
  const branches = useResource(api.branches, [], { enabled: connected });
  const commits = useResource(() => api.commits(), [], { enabled: connected });
  const pulls = useResource(api.pulls, [], { enabled: connected });
  const issues = useResource(api.issues, [], { enabled: connected });
  const activity = useResource(() => api.activity(12), []);

  const openPrs = (pulls.data?.pulls ?? []).filter((p) => p.state === "open");
  const openIssues = (issues.data?.issues ?? []).filter(
    (i) => i.state === "open",
  );
  const stale = (branches.data?.branches ?? [])
    .filter((b) => b.behind > 0 && !b.protected)
    .sort((a, b) => b.behind - a.behind);

  const cardsByColumn = useMemo(
    () =>
      data.columns.map((column) => ({
        name: column.name,
        count: data.tasks.filter((t) => t.columnId === column.id).length,
      })),
    [data],
  );

  const totalCards = data.tasks.length;

  if (!connected) {
    return (
      <>
        <TopBar
          owner={header.owner}
          repo={header.name}
          defaultBranch={header.defaultBranch}
          lastSyncAt={header.lastSyncAt}
          connected={false}
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon="⌘"
            title="Connect a repository"
            body="RepoBoard reads branches, commits, pull requests, issues and a markdown roadmap straight from GitHub. Nothing leaves your machine except calls to github.com."
            action={
              <Link href="/settings" className="rb-btn-primary">
                Open settings
              </Link>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSyncAt={header.lastSyncAt}
        connected={connected}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-ink">
            Overview
          </h1>
          <p className="text-[12px] text-muted">
            Live state of {header.owner}/{header.name}. GitHub stays the source
            of truth; the board only adds planning on top.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="text-[18px] font-semibold tabular-nums text-ink">
              {totalCards}
            </span>
            <span className="text-[11px] text-muted">
              Cards ·{" "}
              {cardsByColumn
                .filter((c) => c.count)
                .map((c) => `${c.count} ${c.name.toLowerCase()}`)
                .join(", ") || "none yet"}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="text-[18px] font-semibold tabular-nums text-ink">
              {branches.loading ? (
                <Skeleton className="inline-block h-5 w-8" />
              ) : (
                (branches.data?.branches.length ?? 0)
              )}
            </span>
            <span className="text-[11px] text-muted">
              Branches · {stale.length} behind {header.defaultBranch ?? "main"}
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="text-[18px] font-semibold tabular-nums text-ink">
              {pulls.loading ? (
                <Skeleton className="inline-block h-5 w-8" />
              ) : (
                openPrs.length
              )}
            </span>
            <span className="text-[11px] text-muted">
              Open pull requests · {pulls.data?.pulls.length ?? 0} total
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="text-[18px] font-semibold tabular-nums text-ink">
              {issues.loading ? (
                <Skeleton className="inline-block h-5 w-8" />
              ) : (
                openIssues.length
              )}
            </span>
            <span className="text-[11px] text-muted">
              Open issues · {data.tasks.filter((t) => t.issues.length).length} on
              the board
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Panel title="Recent commits" href="/repository?tab=commits">
            {commits.loading && <RowSkeleton rows={4} />}
            {commits.error && (
              <div className="flex items-center gap-2 text-[12px] text-warn-fg">
                {commits.error}
                <button className="rb-btn-ghost" onClick={commits.reload}>
                  Retry
                </button>
              </div>
            )}
            <div className="flex flex-col">
              {(commits.data?.commits ?? []).slice(0, 6).map((commit) => (
                <div
                  key={commit.sha}
                  className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                >
                  <span className="font-mono text-[11px] text-muted">
                    {commit.sha.slice(0, 7)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                    {commit.message}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {commit.author}
                  </span>
                  <RelativeTime
                    value={commit.date}
                    className="w-16 shrink-0 text-right text-[11px] text-muted"
                  />
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Needs attention"
            hint={
              stale.length ? (
                <span className="rb-pill-warn">{stale.length}</span>
              ) : (
                <span className="rb-pill-ok">clear</span>
              )
            }
            href="/repository?tab=branches"
          >
            {branches.loading && <RowSkeleton rows={3} />}
            {!branches.loading && stale.length === 0 && (
              <p className="py-2 text-[12px] text-muted">
                Every branch is level with {header.defaultBranch ?? "the default branch"}.
              </p>
            )}
            <div className="flex flex-col">
              {stale.slice(0, 6).map((branch) => (
                <div
                  key={branch.name}
                  className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                    {branch.name}
                  </span>
                  <span className="rb-pill-warn tabular-nums">
                    {branch.behind} behind
                  </span>
                  <RelativeTime
                    value={branch.lastCommit.date}
                    className="w-16 shrink-0 text-right text-[11px] text-muted"
                  />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Pull requests" href="/repository?tab=pulls">
            {pulls.loading && <RowSkeleton rows={3} />}
            {!pulls.loading && openPrs.length === 0 && (
              <p className="py-2 text-[12px] text-muted">
                No open pull requests.
              </p>
            )}
            {openPrs.slice(0, 5).map((pr) => (
              <div
                key={pr.number}
                className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
              >
                <span className="font-mono text-[11px] text-muted">
                  #{pr.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                  {pr.title}
                </span>
                {pr.draft && <span className="rb-pill">draft</span>}
                {pr.checks && (
                  <span
                    className={
                      pr.checks.passed === pr.checks.total
                        ? "rb-pill-ok"
                        : "rb-pill-warn"
                    }
                  >
                    {pr.checks.passed}/{pr.checks.total}
                  </span>
                )}
              </div>
            ))}
          </Panel>

          <Panel title="Activity" href="/activity">
            {activity.loading && <RowSkeleton rows={3} />}
            {!activity.loading && (activity.data?.events.length ?? 0) === 0 && (
              <p className="py-2 text-[12px] text-muted">
                Nothing recorded yet. Moves, syncs and conflicts show up here.
              </p>
            )}
            {(activity.data?.events ?? []).slice(0, 6).map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
              >
                <span className="rb-pill shrink-0 px-1.5 py-0.5 text-[10px]">
                  {event.type.replace(/_/g, " ")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                  {event.message}
                </span>
                <RelativeTime
                  value={event.createdAt}
                  className="shrink-0 text-[11px] text-muted"
                />
              </div>
            ))}
          </Panel>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-canvas/40 p-3 text-[11.5px] text-muted">
          <span className="rb-pill">
            {data.markdownSource?.path ?? "no markdown source"}
          </span>
          {data.markdownSource ? (
            <>
              <span>
                last fetched SHA{" "}
                <code className="font-mono">
                  {data.markdownSource.lastKnownSha?.slice(0, 7) ?? "—"}
                </code>
              </span>
              <Link href="/markdown-sync" className="rb-btn-ghost ml-auto">
                Markdown sync
              </Link>
            </>
          ) : (
            <>
              <span>Pick a roadmap file to drive the board from markdown.</span>
              <Link href="/markdown-sync" className="rb-btn-ghost ml-auto">
                Set up
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
