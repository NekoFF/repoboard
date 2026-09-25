"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { KanbanBoard } from "@/components/KanbanBoard";
import { TopBar } from "@/components/TopBar";
import { ImportIssuesDialog } from "@/components/ImportIssuesDialog";
import { Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";

const displayLabel = (label: string) => label.replace(/^[^:]+:/, "").replace(/[-_]/g, " ");

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
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "upcoming" | "none">("all");
  const [view, setView] = useState<"board" | "calendar">("board");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);

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

  const activeFilterCount = Number(Boolean(labelFilter)) + Number(Boolean(assigneeFilter)) + Number(dueFilter !== "all");

  useEffect(() => {
    if (!filtersOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [filtersOpen]);

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
      if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === "s" && !filtersOpen) {
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

  const filtersActive = Boolean(search || activeFilterCount);

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSyncAt={header.lastSyncAt}
        connected={connected}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto bg-canvas p-4 lg:p-5">
        <div className="flex flex-wrap items-center gap-3 px-1">
          <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
            <h1 className="text-[21px] font-semibold tracking-[-0.025em] text-ink">Board</h1>
            <p className="mt-0.5 truncate text-[12px] text-muted">
              {data.tasks.length} cards · {data.columns.length} lists
            </p>
          </div>
          <button className="rb-btn" onClick={sync} disabled={syncing} title="Sync markdown (s)">
            {syncing && <Spinner />}{syncing ? "Syncing" : "Sync markdown"}
          </button>
          <button className="rb-btn-primary" onClick={() => window.dispatchEvent(new CustomEvent("rb:new-card"))}>
            <span aria-hidden>+</span> New card
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <div className="inline-flex rounded-md bg-pill p-0.5" aria-label="Board view">
            <button className={`rb-view-tab ${view === "board" ? "rb-view-tab-active" : ""}`} aria-pressed={view === "board"} onClick={() => setView("board")}>Board</button>
            <button className={`rb-view-tab ${view === "calendar" ? "rb-view-tab-active" : ""}`} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>Calendar</button>
          </div>
          <div className="relative" ref={filterRef}>
            <button className={`rb-btn ${activeFilterCount ? "border-ink/30" : ""}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} aria-controls="board-filters">
              <span aria-hidden>☷</span> Filter {activeFilterCount > 0 && <span className="rounded bg-pill px-1.5 tabular-nums">{activeFilterCount}</span>}
            </button>
            {filtersOpen && (
              <div id="board-filters" className="absolute left-0 top-[calc(100%+8px)] z-20 w-[264px] rounded-lg border border-border bg-surface p-3 shadow-pop">
                <p className="mb-3 text-[12px] font-semibold text-ink">Filter cards</p>
                <label className="rb-filter-field">Assignee
                  <select className="rb-input mt-1" value={assigneeFilter ?? ""} onChange={(event) => setAssigneeFilter(event.target.value || null)}>
                    <option value="">Anyone</option>
                    {assignees.map((assignee) => <option key={assignee} value={assignee}>{assignee}</option>)}
                  </select>
                </label>
                <label className="rb-filter-field">Label
                  <select className="rb-input mt-1" value={labelFilter ?? ""} onChange={(event) => setLabelFilter(event.target.value || null)}>
                    <option value="">Any label</option>
                    {labels.map(({ label, count }) => <option key={label} value={label}>{displayLabel(label)} ({count})</option>)}
                  </select>
                </label>
                <label className="rb-filter-field">Due date
                  <select className="rb-input mt-1" value={dueFilter} onChange={(event) => setDueFilter(event.target.value as typeof dueFilter)}>
                    <option value="all">Any date</option>
                    <option value="overdue">Overdue</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="none">No due date</option>
                  </select>
                </label>
                <div className="mt-3 flex justify-between border-t border-border pt-2">
                  <button className="rb-btn-ghost" onClick={() => { setLabelFilter(null); setAssigneeFilter(null); setDueFilter("all"); }}>Clear filters</button>
                  <button className="rb-btn-ghost text-ink" onClick={() => setFiltersOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
          <div className="ml-auto flex min-w-[180px] flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-[7px] sm:max-w-[260px]">
            <span className="text-muted" aria-hidden>⌕</span>
            <input className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-muted/70" placeholder="Search cards" aria-label="Search cards" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          {filtersActive && <button className="rb-btn-ghost" onClick={() => { setSearch(""); setLabelFilter(null); setAssigneeFilter(null); setDueFilter("all"); }}>Clear all</button>}
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
            dueFilter={dueFilter}
            view={view}
            connected={connected}
            onImportIssues={connected ? () => setImporting(true) : undefined}
          />
        )}
      </div>

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
