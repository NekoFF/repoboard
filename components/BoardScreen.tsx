"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TopBar } from "@/components/TopBar";

export function BoardScreen({
  data,
  header,
  connected,
  openPrs,
  branchCount,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
  openPrs: number;
  branchCount: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const labels = useMemo(
    () => Array.from(new Set(data.tasks.flatMap((t) => t.labels))).sort(),
    [data.tasks],
  );
  const assignees = useMemo(
    () =>
      Array.from(
        new Set(data.tasks.map((t) => t.assignee).filter(Boolean) as string[]),
      ).sort(),
    [data.tasks],
  );

  const counts = useMemo(() => {
    const byName = (name: string) => {
      const column = data.columns.find((c) => c.name === name);
      return column
        ? data.tasks.filter((t) => t.columnId === column.id).length
        : 0;
    };
    return {
      todo: byName("Todo"),
      inProgress: byName("In Progress"),
      review: byName("Review"),
      done: byName("Done"),
    };
  }, [data]);

  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const response = await fetch("/api/markdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const body = await response.json();
      if (!response.ok) setSyncError(body.error ?? "Sync failed");
      else router.refresh();
    } catch (error) {
      setSyncError((error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const lastSync = header.lastSyncAt
    ? new Date(header.lastSyncAt).toLocaleTimeString()
    : null;

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSync={lastSync}
        connected={connected}
        actions={
          <button className="rb-btn" onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync"}
          </button>
        }
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
        <div className="flex w-full items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-[24px] font-semibold text-ink">Project board</h1>
            <p className="text-[12px] text-muted">
              Tasks stay linked to branches, commits, pull requests and{" "}
              {data.markdownSource?.path ?? "ROADMAP.md"}.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <select
              className="rounded-sm bg-pill px-2 py-1 text-[11px] font-medium text-ink outline-none"
              value={assigneeFilter ?? ""}
              onChange={(event) =>
                setAssigneeFilter(event.target.value || null)
              }
            >
              <option value="">All assignees</option>
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <select
              className="rounded-sm bg-pill px-2 py-1 text-[11px] font-medium text-ink outline-none"
              value={labelFilter ?? ""}
              onChange={(event) => setLabelFilter(event.target.value || null)}
            >
              <option value="">Labels</option>
              {labels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>

            <input
              className="rounded-sm bg-pill px-2 py-1 text-[11px] font-medium text-ink outline-none placeholder:text-muted"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {syncError && (
          <div className="w-full rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
            {syncError}
          </div>
        )}

        <div className="flex w-full gap-[10px]">
          {[
            { label: "Open tasks", value: counts.todo + counts.inProgress + counts.review },
            { label: "In progress", value: counts.inProgress },
            { label: "Review", value: counts.review },
            { label: "Done", value: counts.done },
            { label: "Open PRs", value: openPrs },
            { label: "Branches", value: branchCount },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-lg border border-border bg-surface p-3"
            >
              <span className="text-[18px] font-semibold text-ink">
                {stat.value}
              </span>
              <span className="text-[11px] text-muted">{stat.label}</span>
            </div>
          ))}
        </div>

        {data.columns.length === 0 ? (
          <div className="rb-card p-6 text-center">
            <p className="text-[13px] font-medium text-ink">
              No board yet
            </p>
            <p className="mt-1 text-[12px] text-muted">
              Connect a repository in Settings to create the board.
            </p>
          </div>
        ) : (
          <KanbanBoard
            data={data}
            search={search}
            labelFilter={labelFilter}
            assigneeFilter={assigneeFilter}
          />
        )}
      </div>
    </>
  );
}
