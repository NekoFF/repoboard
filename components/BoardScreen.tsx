"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TopBar } from "@/components/TopBar";
import { ImportIssuesDialog } from "@/components/ImportIssuesDialog";
import { MarkdownWriteDialog } from "@/components/MarkdownWriteDialog";
import { RelativeTime, Spinner, useToast } from "@/components/ui";
import { api, useResource } from "@/lib/client/api";

export function BoardScreen({
  data,
  header,
  connected,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [committing, setCommitting] = useState(false);

  // What the board says that the markdown file does not say yet. Moves pile up
  // here instead of committing one at a time.
  const pending = useResource(api.pending, [], {
    enabled: connected && Boolean(data.markdownSource),
  });

  useEffect(() => {
    const onChanged = () => pending.reload();
    window.addEventListener("rb:pending-changed", onChanged);
    return () => window.removeEventListener("rb:pending-changed", onChanged);
  }, [pending]);

  // Live repository signal, refreshed on a slow poll so the board reflects
  // what GitHub says without the user pressing anything.
  const pulls = useResource(api.pulls, [], {
    enabled: connected,
    pollMs: 90_000,
  });
  const branches = useResource(api.branches, [], {
    enabled: connected,
    pollMs: 90_000,
  });

  const labels = useMemo(
    () =>
      Array.from(new Set(data.tasks.flatMap((t) => t.labels)))
        .sort()
        .map((label) => ({
          label,
          count: data.tasks.filter((t) => t.labels.includes(label)).length,
        })),
    [data.tasks],
  );

  const assignees = useMemo(
    () =>
      Array.from(
        new Set(data.tasks.map((t) => t.assignee).filter(Boolean) as string[]),
      ).sort(),
    [data.tasks],
  );

  const doneCount = useMemo(() => {
    const done = data.columns.find((c) => c.name === "Done");
    return done ? data.tasks.filter((t) => t.columnId === done.id).length : 0;
  }, [data]);

  const openPrs = (pulls.data?.pulls ?? []).filter((p) => p.state === "open");
  const staleBranches = (branches.data?.branches ?? []).filter(
    (b) => b.behind > 0 && !b.protected,
  );

  useEffect(() => {
    // "s" syncs, matching the Sync button — muscle memory beats hunting a button.
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        sync();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sync = async () => {
    if (!data.markdownSource) {
      toast.push({
        kind: "info",
        message: "No markdown source yet",
        detail: "Pick a file on the Markdown Sync screen first.",
        action: {
          label: "Open",
          run: () => router.push("/markdown-sync"),
        },
      });
      return;
    }
    setSyncing(true);
    try {
      const result = await api.markdownAction<{
        created: number;
        updated: number;
        idsAssigned: number;
        path: string;
      }>({ action: "sync" });
      toast.push({
        kind: "success",
        message: `Synced ${result.path}`,
        detail:
          `${result.created} created · ${result.updated} updated` +
          (result.idsAssigned
            ? ` · ${result.idsAssigned} task id(s) written back`
            : ""),
      });
      router.refresh();
    } catch (error) {
      toast.push({
        kind: "error",
        message: "Sync failed",
        detail: (error as Error).message,
      });
    } finally {
      setSyncing(false);
    }
  };

  const filtersActive = Boolean(search || labelFilter || assigneeFilter);

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSyncAt={header.lastSyncAt}
        connected={connected}
        actions={
          <>
            <button
              className="rb-btn"
              onClick={sync}
              disabled={syncing}
              title="Pull the markdown source and reconcile cards (s)"
            >
              {syncing ? <Spinner /> : null}
              {syncing ? "Syncing" : "Sync"}
            </button>
            {(pending.data?.moves.length ?? 0) > 0 && (
              <button
                className="rb-btn border-warn-border bg-warn-bg text-warn-fg hover:bg-warn-bg"
                onClick={() => setCommitting(true)}
                title="Write the queued moves to the markdown file in one commit"
              >
                {pending.data!.moves.length} to commit
              </button>
            )}
            <button
              className="rb-btn-primary"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("rb:new-card"))
              }
            >
              + New card <span className="rb-kbd ml-1">n</span>
            </button>
          </>
        }
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
        <div className="flex w-full flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-ink">
              Project board
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
              <span>
                {data.tasks.length} card{data.tasks.length === 1 ? "" : "s"} ·{" "}
                {doneCount} done
              </span>
              {connected && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {branches.loading
                      ? "loading branches…"
                      : `${branches.data?.branches.length ?? 0} branches`}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{openPrs.length} open PRs</span>
                  {staleBranches.length > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-warn-fg">
                        {staleBranches.length} behind {header.defaultBranch}
                      </span>
                    </>
                  )}
                </>
              )}
              {data.markdownSource && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono text-[11px]">
                    {data.markdownSource.path}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-[11.5px] font-medium text-ink outline-none transition-colors hover:border-ink/25"
              value={assigneeFilter ?? ""}
              onChange={(event) => setAssigneeFilter(event.target.value || null)}
            >
              <option value="">All assignees</option>
              {assignees.map((assignee) => (
                <option key={assignee} value={assignee}>
                  {assignee}
                </option>
              ))}
            </select>

            <select
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-[11.5px] font-medium text-ink outline-none transition-colors hover:border-ink/25"
              value={labelFilter ?? ""}
              onChange={(event) => setLabelFilter(event.target.value || null)}
            >
              <option value="">All labels</option>
              {labels.map(({ label, count }) => (
                <option key={label} value={label}>
                  {label} ({count})
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 transition-colors focus-within:border-ink">
              <span className="text-[11px] text-muted" aria-hidden>
                ⌕
              </span>
              <input
                className="w-32 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-muted/70"
                placeholder="Filter cards"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <span className="rb-kbd">/</span>
            </div>

            {filtersActive && (
              <button
                className="rb-btn-ghost"
                onClick={() => {
                  setSearch("");
                  setLabelFilter(null);
                  setAssigneeFilter(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {data.columns.length === 0 ? (
          <div className="rb-card p-6 text-center">
            <p className="text-[13px] font-medium text-ink">No board yet</p>
            <p className="mt-1 text-[12px] text-muted">
              Connect a repository in Settings to create one.
            </p>
          </div>
        ) : (
          <KanbanBoard
            data={data}
            search={search}
            labelFilter={labelFilter}
            assigneeFilter={assigneeFilter}
            onImportIssues={connected ? () => setImporting(true) : undefined}
          />
        )}

        <div className="flex items-center gap-2 pt-1 text-[11px] text-muted">
          {connected && (
            <>
              <span>
                GitHub data{" "}
                {branches.refreshing ? (
                  "refreshing…"
                ) : (
                  <RelativeTime value={branches.updatedAt} />
                )}
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>
            Last markdown sync <RelativeTime value={header.lastSyncAt} />
          </span>
          <div className="flex-1" />
          <span className="flex items-center gap-1">
            <span className="rb-kbd">⌘K</span> search
            <span className="rb-kbd ml-2">n</span> new card
            <span className="rb-kbd ml-2">s</span> sync
          </span>
        </div>
      </div>

      {committing && (
        <MarkdownWriteDialog
          all
          onDiscard={() => setCommitting(false)}
          onDone={() => {
            setCommitting(false);
            pending.reload();
            router.refresh();
          }}
        />
      )}

      {importing && data.columns[0] && (
        <ImportIssuesDialog
          columns={data.columns}
          linkedIssues={data.tasks.flatMap((t) => t.issues)}
          onClose={() => setImporting(false)}
          onDone={(created) => {
            setImporting(false);
            toast.push({
              kind: "success",
              message: `Imported ${created} issue${created === 1 ? "" : "s"}`,
            });
            router.refresh();
          }}
        />
      )}
    </>
  );
}
