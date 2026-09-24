"use client";

import { useMemo, useState } from "react";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { TopBar } from "@/components/TopBar";
import { EmptyState, RelativeTime, RowSkeleton, Segmented } from "@/components/ui";
import { api, useResource } from "@/lib/client/api";

type Filter = "all" | "cards" | "markdown" | "github";

const GROUPS: Record<Exclude<Filter, "all">, string[]> = {
  cards: ["card_created", "card_moved", "card_deleted", "board_created"],
  markdown: ["markdown_changed", "conflict_detected"],
  github: [
    "github_synced",
    "repo_connected",
    "branch_linked",
    "pr_linked",
    "issue_linked",
  ],
};

export function ActivityScreen({
  data,
  header,
  connected,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const events = useResource(() => api.activity(200), [], { pollMs: 30_000 });

  const all = events.data?.events ?? [];

  const counts = useMemo(
    () => ({
      all: all.length,
      cards: all.filter((e) => GROUPS.cards.includes(e.type)).length,
      markdown: all.filter((e) => GROUPS.markdown.includes(e.type)).length,
      github: all.filter((e) => GROUPS.github.includes(e.type)).length,
    }),
    [all],
  );

  const rows = useMemo(
    () =>
      filter === "all"
        ? all
        : all.filter((event) => GROUPS[filter].includes(event.type)),
    [all, filter],
  );

  // Group by calendar day: a log without day breaks is unreadable past ten rows.
  const days = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const event of rows) {
      const key = new Date(event.createdAt).toDateString();
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return Array.from(map.entries());
  }, [rows]);

  const titleFor = (taskId: string | null) =>
    taskId ? data.tasks.find((t) => t.id === taskId)?.title : undefined;

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
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-ink">
              Activity
            </h1>
            <p className="text-[12px] text-muted">
              Everything RepoBoard did locally: cards, moves, markdown writes,
              syncs and refused conflicts.
            </p>
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: counts.all },
              { value: "cards", label: "Cards", count: counts.cards },
              { value: "markdown", label: "Markdown", count: counts.markdown },
              { value: "github", label: "GitHub", count: counts.github },
            ]}
          />
        </div>

        {events.loading && (
          <div className="overflow-hidden rounded-xl border border-border">
            <RowSkeleton rows={6} />
          </div>
        )}

        {!events.loading && rows.length === 0 && (
          <EmptyState
            icon="↺"
            title="No events yet"
            body="Move a card, run a sync or link a branch — every action lands here with a timestamp."
          />
        )}

        {days.map(([day, items]) => (
          <section key={day} className="flex flex-col gap-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {day === new Date().toDateString() ? "Today" : day}
            </h2>
            <div className="overflow-hidden rounded-xl border border-border">
              {items.map((event) => {
                const title = titleFor(event.taskId);
                const isConflict = event.type === "conflict_detected";
                return (
                  <div
                    key={event.id}
                    className={`flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 ${
                      isConflict ? "bg-warn-bg/40" : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 ${isConflict ? "rb-pill-warn" : "rb-pill"}`}
                    >
                      {event.type.replace(/_/g, " ")}
                    </span>
                    <span className="min-w-0 flex-1 text-[12.5px] text-ink">
                      {event.message}
                      {title && (
                        <span className="ml-1.5 text-muted">· {title}</span>
                      )}
                    </span>
                    <RelativeTime
                      value={event.createdAt}
                      className="shrink-0 text-[11px] text-muted"
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
