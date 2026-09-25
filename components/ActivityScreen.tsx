"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRightLeft,
  CircleAlert,
  FilePen,
  FileSearch,
  Flag,
  GitBranch,
  GitCommitHorizontal,
  Link2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, RelativeTime, RowSkeleton, Segmented, formatDate } from "@/components/ui";
import { api, useResource } from "@/lib/client/api";

type Filter = "all" | "cards" | "docs" | "comments" | "github";

const GROUPS: Record<Exclude<Filter, "all">, string[]> = {
  cards: ["card_created", "card_moved", "card_deleted", "card_restored", "card_updated", "board_created", "milestone_created"],
  docs: ["markdown_changed", "doc_changed", "doc_tracked", "doc_untracked", "conflict_detected"],
  comments: ["comment"],
  github: ["github_synced", "repo_connected", "branch_linked", "pr_linked", "issue_linked", "board_pulled", "board_pushed"],
};

const ICON: Record<string, ReactNode> = {
  card_created: <Plus className="size-3.5" />,
  card_moved: <ArrowRightLeft className="size-3.5" />,
  card_deleted: <Trash2 className="size-3.5" />,
  card_restored: <Undo2 className="size-3.5" />,
  comment: <MessageSquareText className="size-3.5" />,
  markdown_changed: <GitCommitHorizontal className="size-3.5" />,
  doc_changed: <FilePen className="size-3.5" />,
  doc_tracked: <FileSearch className="size-3.5" />,
  conflict_detected: <CircleAlert className="size-3.5 text-state-doing" />,
  github_synced: <RefreshCw className="size-3.5" />,
  board_pulled: <RefreshCw className="size-3.5" />,
  board_pushed: <GitCommitHorizontal className="size-3.5" />,
  branch_linked: <GitBranch className="size-3.5" />,
  pr_linked: <Link2 className="size-3.5" />,
  issue_linked: <Link2 className="size-3.5" />,
  milestone_created: <Flag className="size-3.5" />,
};

/** "codex: PR #8 is ready" → author "codex", so agent notes read as notes from someone. */
function splitAuthor(message: string): { author: string | null; text: string } {
  const match = message.match(/^([\w.-]{2,24}):\s+(.+)$/s);
  return match ? { author: match[1], text: match[2] } : { author: null, text: message };
}

export function ActivityScreen({ data }: { data: BoardData; header: RepoHeader; connected: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const events = useResource(() => api.activity(300), [], { pollMs: 30_000 });
  const all = useMemo(() => events.data?.events ?? [], [events.data]);
  const cards = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);

  const rows = useMemo(
    () => (filter === "all" ? all : all.filter((e) => GROUPS[filter].includes(e.type))),
    [all, filter],
  );
  const count = (f: Exclude<Filter, "all">) => all.filter((e) => GROUPS[f].includes(e.type)).length;

  // A log without day breaks is unreadable past ten rows.
  const days = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const event of rows) {
      const key = new Date(event.createdAt).toISOString().slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <>
      <PageHeader title="Activity" icon={<Activity className="size-4" />}>
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Everything", count: all.length },
            { value: "cards", label: "Cards", count: count("cards") },
            { value: "docs", label: "Documents", count: count("docs") },
            { value: "comments", label: "Comments", count: count("comments") },
            { value: "github", label: "GitHub", count: count("github") },
          ]}
        />
      </PageHeader>
      <div className="rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 pb-20 pt-8 sm:px-10">
          {events.loading && <RowSkeleton rows={8} />}
          {!events.loading && rows.length === 0 && (
            <EmptyState icon={<Activity className="size-6" />} title="Nothing here yet" body="Moves, commits, notes and syncs appear here as they happen." />
          )}
          {days.map(([day, list]) => (
            <section key={day} className="mb-8">
              <h2 className="sticky top-0 z-[1] bg-surface/95 py-2 text-xs font-medium text-faint backdrop-blur">
                {formatDate(Date.parse(day), { weekday: "long", day: "numeric", month: "long" })}
              </h2>
              <ol className="flex flex-col">
                {list.map((event) => {
                  const card = event.taskId ? cards.get(event.taskId) : undefined;
                  const { author, text } = event.type === "comment" ? splitAuthor(event.message) : { author: null, text: event.message };
                  return (
                    <li key={event.id} className="flex gap-3 border-b border-border py-3 last:border-b-0">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-pill text-muted">
                        {ICON[event.type] ?? <Activity className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-relaxed ${event.type === "comment" ? "whitespace-pre-wrap text-ink" : "text-muted"}`}>
                          {author && <span className="mr-1.5 font-medium text-ink">{author}</span>}
                          {text}
                        </p>
                        {card && (
                          <Link href={`/board?card=${card.id}`} className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-faint hover:text-ink">
                            {card.number != null && <span className="font-mono">RB-{card.number}</span>}
                            {card.title}
                          </Link>
                        )}
                      </div>
                      <RelativeTime value={event.createdAt} className="shrink-0 pt-0.5 text-xs text-faint" />
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
