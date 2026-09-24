"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useResource } from "@/lib/client/api";
import { Spinner } from "@/components/ui";

interface Command {
  id: string;
  group: "Navigate" | "Cards" | "Branches" | "Pull requests" | "Issues" | "Actions";
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * ⌘K over everything the app knows: local cards plus live GitHub objects.
 * Opening it is what makes the repository feel searchable rather than
 * navigable only through tabs.
 */
export function CommandPalette({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "/" && !typing && !open) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Everything is fetched once the palette first opens, then kept for the session.
  const board = useResource(api.board, [], { enabled: open });
  const branches = useResource(api.branches, [], { enabled: open && connected });
  const pulls = useResource(api.pulls, [], { enabled: open && connected });
  const issues = useResource(api.issues, [], { enabled: open && connected });

  const loading =
    board.loading || branches.loading || pulls.loading || issues.loading;

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };

    const items: Command[] = [
      { id: "nav-overview", group: "Navigate", label: "Overview", run: go("/") },
      { id: "nav-board", group: "Navigate", label: "Project board", run: go("/board") },
      { id: "nav-branches", group: "Navigate", label: "Branches", run: go("/repository?tab=branches") },
      { id: "nav-commits", group: "Navigate", label: "Commits", run: go("/repository?tab=commits") },
      { id: "nav-pulls", group: "Navigate", label: "Pull requests", run: go("/repository?tab=pulls") },
      { id: "nav-issues", group: "Navigate", label: "Issues", run: go("/repository?tab=issues") },
      { id: "nav-markdown", group: "Navigate", label: "Markdown sync", run: go("/markdown-sync") },
      { id: "nav-activity", group: "Navigate", label: "Activity", run: go("/activity") },
      { id: "nav-settings", group: "Navigate", label: "Settings", run: go("/settings") },
    ];

    const columns = new Map(
      (board.data?.columns ?? []).map((c) => [c.id, c.name]),
    );

    for (const task of board.data?.tasks ?? []) {
      items.push({
        id: `task-${task.id}`,
        group: "Cards",
        label: task.title,
        hint: columns.get(task.columnId),
        run: () => {
          setOpen(false);
          router.push(`/board?card=${task.id}`);
        },
      });
    }

    for (const branch of branches.data?.branches ?? []) {
      items.push({
        id: `branch-${branch.name}`,
        group: "Branches",
        label: branch.name,
        hint: `+${branch.ahead} / -${branch.behind}`,
        run: go(`/repository?tab=commits&branch=${encodeURIComponent(branch.name)}`),
      });
    }

    for (const pr of pulls.data?.pulls ?? []) {
      items.push({
        id: `pr-${pr.number}`,
        group: "Pull requests",
        label: `#${pr.number} ${pr.title}`,
        hint: pr.state,
        run: go("/repository?tab=pulls"),
      });
    }

    for (const issue of issues.data?.issues ?? []) {
      items.push({
        id: `issue-${issue.number}`,
        group: "Issues",
        label: `#${issue.number} ${issue.title}`,
        hint: issue.state,
        run: go("/repository?tab=issues"),
      });
    }

    return items;
  }, [board.data, branches.data, pulls.data, issues.data, router]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 40);
    return commands
      .map((command) => {
        const label = command.label.toLowerCase();
        const index = label.indexOf(q);
        if (index === -1) return null;
        // Prefix matches first, then shorter labels — the usual "did you mean
        // the thing you just typed the start of" ordering.
        return { command, score: index * 10 + label.length / 100 };
      })
      .filter((x): x is { command: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((x) => x.command);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const grouped: { group: string; items: { command: Command; index: number }[] }[] =
    [];
  results.forEach((command, index) => {
    const bucket = grouped.find((g) => g.group === command.group);
    if (bucket) bucket.items.push({ command, index });
    else grouped.push({ group: command.group, items: [{ command, index }] });
  });

  return (
    <div
      className="rb-fade-in fixed inset-0 z-[90] flex items-start justify-center bg-ink/20 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="rb-pop flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <span className="text-[13px] text-muted" aria-hidden>
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search cards, branches, pull requests, issues…"
            className="w-full bg-transparent py-3 text-[13px] text-ink outline-none placeholder:text-muted/70"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                results[active]?.run();
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {loading && <Spinner className="text-muted" />}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-muted">
              {loading ? "Loading…" : `Nothing matches “${query}”`}
            </p>
          )}

          {grouped.map((group) => (
            <div key={group.group} className="px-1 py-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted/70">
                {group.group}
              </p>
              {group.items.map(({ command, index }) => (
                <button
                  key={command.id}
                  data-index={index}
                  onMouseEnter={() => setActive(index)}
                  onClick={command.run}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    index === active ? "bg-pill" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {command.label}
                  </span>
                  {command.hint && (
                    <span className="shrink-0 text-[11px] text-muted">
                      {command.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className="rb-kbd">↑</span>
            <span className="rb-kbd">↓</span> navigate
          </span>
          <span className="flex items-center gap-1">
            <span className="rb-kbd">↵</span> open
          </span>
          <span className="flex items-center gap-1">
            <span className="rb-kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
