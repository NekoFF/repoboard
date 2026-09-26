"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, CloudOff, CloudUpload, FilePlus2, FileText, Keyboard, Moon, Pin as PinIcon, Plus, Sun, X } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Menu, MenuItem, MenuLabel, MenuSeparator, ProgressRing, StatusIcon, Tooltip } from "@/components/ui";
import { api, useResource } from "@/lib/client/api";
import { newCardHref } from "@/lib/client/current-board";
import { MAX_PINS, usePins, type Pin } from "@/lib/client/pins";
import { requestSync, useSyncStatus } from "@/lib/client/sync";
import { statusOfColumn } from "@/lib/status";
import { boardColor, boardHref } from "@/components/labelColor";

function RailButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} shortcut={shortcut} side="left">
      <button
        onClick={onClick}
        aria-label={label}
        className="relative grid size-9 place-items-center rounded-full text-muted transition-[background-color,color,box-shadow] duration-150 hover:bg-surface/80 hover:text-ink hover:shadow-card"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** A number on a rail button: how many things wait. */
function Count({ n, tone }: { n: number; tone: "review" | "accent" }) {
  return (
    <span
      className={`absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums text-white ${
        tone === "review" ? "bg-state-review" : "bg-accent"
      }`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * The pill inside the main panel's right edge. At the top, making things
 * (a card, a document); in the middle, what the person pinned for one press
 * from anywhere; at the bottom, what waits for them — items to check, board
 * changes not yet in the repository — and the view (shortcuts, theme).
 * Search lives once, at the top of the sidebar (it shows at every width).
 */
export function ToolRail() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openShortcuts, boards, docs, repo, connected, role } = useShell();
  const { resolved, toggle } = useTheme();
  const { pins, pin, unpin, full } = usePins(repo);

  const cards = useResource(api.projectCards, [repo, pathname], { enabled: connected });
  const tracked = useResource(api.docs, [repo, pathname], { enabled: connected });
  const boardState = useResource(api.boardStatus, [repo], { enabled: connected });

  // Board changes not in the repository yet: look again when the window is looked at.
  const reloadBoardState = boardState.reload;
  useEffect(() => {
    if (!connected) return;
    let last = Date.now();
    const look = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      last = Date.now();
      reloadBoardState();
    };
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [connected, reloadBoardState]);

  const toCheck = useMemo(() => {
    const data = cards.data;
    const status = new Map((data?.columns ?? []).map((c) => [c.id, statusOfColumn(c.name)]));
    const inReview = (data?.tasks ?? []).filter((t) => status.get(t.columnId) === "review").length;
    const items = (tracked.data?.docs ?? []).reduce((sum, d) => sum + (d.review ?? 0), 0);
    return inReview + items;
  }, [cards.data, tracked.data]);
  // With automatic sync on, nothing waits to be saved by hand; a failed sync is what waits.
  const sync = useSyncStatus();
  const unsaved = boardState.data?.autoSync || sync.state !== "off" ? 0 : (boardState.data?.changes.length ?? 0);

  // What "pin this page" would pin, if this page can be pinned.
  const here = useMemo((): Pin | null => {
    if (pathname === "/board") {
      const main = boards.find((b) => b.primary);
      return main ? { kind: "board", id: main.id, href: "/board", label: main.name } : null;
    }
    const card = pathname.match(/^\/board\/card\/([^/]+)$/);
    if (card) {
      const ref = decodeURIComponent(card[1]);
      const number = ref.match(/^RB-(\d+)$/i)?.[1];
      const task = (cards.data?.tasks ?? []).find((t) => t.id === ref || (number && String(t.number) === number));
      const label = task ? `${task.number ? `RB-${task.number} ` : ""}${task.title}` : ref;
      return { kind: "card", id: ref, href: pathname, label };
    }
    const board = pathname.match(/^\/board\/([^/]+)$/);
    if (board) {
      const b = boards.find((x) => x.id === decodeURIComponent(board[1]));
      return b ? { kind: "board", id: b.id, href: pathname, label: b.name } : null;
    }
    const path = params.get("path");
    if (pathname === "/docs" && path) {
      const doc = docs.find((d) => d.path === path) ?? tracked.data?.docs.find((d) => d.path === path);
      return { kind: "doc", id: path, href: `/docs?path=${encodeURIComponent(path)}`, label: doc?.title ?? path.split("/").pop() ?? path };
    }
    return null;
  }, [pathname, params, boards, docs, tracked.data, cards.data]);

  const current = pathname + (params.get("path") ? `?path=${encodeURIComponent(params.get("path")!)}` : "");
  const pinned = (href: string) => pins.some((p) => p.href === href);
  const toggleBoard = (b: (typeof boards)[number]) => {
    const href = boardHref(b);
    if (pinned(href)) unpin(href);
    else pin({ kind: "board", id: b.id, href, label: b.name });
  };
  const checklists = docs.filter((d) => d.kind === "checklist");

  const face = (p: Pin) => {
    if (p.kind === "board") {
      const b = boards.find((x) => x.id === p.id);
      const name = b?.name ?? p.label;
      return (
        <span
          className="grid size-[26px] place-items-center rounded-lg text-[11px] font-semibold text-white"
          style={{ backgroundColor: boardColor(b?.color ?? null, name) }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      );
    }
    if (p.kind === "doc") {
      const d = tracked.data?.docs.find((x) => x.path === p.id) ?? docs.find((x) => x.path === p.id);
      return d && d.total > 0 ? <ProgressRing done={d.done} total={d.total} size={20} /> : <FileText className="size-4" />;
    }
    const ref = p.id.match(/^RB-(\d+)$/i)?.[1];
    const data = cards.data;
    const task = data?.tasks.find((t) => t.id === p.id || (ref && String(t.number) === ref));
    const column = task ? data?.columns.find((c) => c.id === task.columnId) : undefined;
    return <StatusIcon status={column ? statusOfColumn(column.name) : "todo"} size={18} />;
  };

  return (
    <aside
      aria-label="Tools"
      className="rb-rail absolute bottom-2.5 right-2.5 top-2.5 z-30 hidden w-11 flex-col items-center gap-1 rounded-full py-2 lg:flex"
    >
      {role !== "viewer" && (
        <>
          <RailButton label="New card" shortcut="C" onClick={() => router.push(newCardHref(boards.map(boardHref)))}>
            <Plus className="size-4" />
          </RailButton>
          <RailButton label="New document" onClick={() => router.push("/docs?new=1")}>
            <FilePlus2 className="size-4" />
          </RailButton>
        </>
      )}

      <span className="my-1 h-px w-5 shrink-0 bg-border" />

      {/* Pinned: the person's own shortcuts. */}
      <div className="rb-scroll-thin flex min-h-0 flex-col items-center gap-1 overflow-y-auto overflow-x-visible px-1 py-1">
        {pins.map((p) => (
          <div key={p.href} className="group relative">
            <Tooltip content={p.label} side="left">
              <button
                onClick={() => router.push(p.href)}
                aria-label={p.label}
                className={`grid size-9 place-items-center rounded-xl text-muted transition-colors hover:bg-surface/80 hover:text-ink ${
                  current === p.href ? "bg-surface text-ink shadow-card" : ""
                }`}
              >
                {face(p)}
              </button>
            </Tooltip>
            <button
              onClick={() => unpin(p.href)}
              aria-label={`Unpin ${p.label}`}
              className="absolute -right-1 -top-1 hidden size-4 place-items-center rounded-full bg-surface text-muted shadow-card hover:text-ink group-hover:grid"
            >
              <X className="size-2.5" strokeWidth={3} />
            </button>
          </div>
        ))}
        <Menu
          side="left"
          align="start"
          width={240}
          trigger={
            <button
              aria-label="Pin a board, card or checklist"
              title="Pin a board, card or checklist"
              className="grid size-9 place-items-center rounded-xl text-faint transition-colors hover:bg-surface/80 hover:text-ink"
            >
              <PinIcon className="size-4" />
            </button>
          }
        >
          <MenuItem icon={<PinIcon className="size-3.5" />} disabled={!here || pinned(here.href) || full} onSelect={() => here && pin(here)}>
            {here ? (pinned(here.href) ? "This page is pinned" : "Pin this page") : "This page can't be pinned"}
          </MenuItem>
          {boards.length > 0 && (
            <>
              <MenuSeparator />
              <MenuLabel>Boards</MenuLabel>
              {boards.map((b) => (
                <MenuItem key={b.id} checked={pinned(boardHref(b))} disabled={full && !pinned(boardHref(b))} onSelect={() => toggleBoard(b)}>
                  {b.name}
                </MenuItem>
              ))}
            </>
          )}
          {checklists.length > 0 && (
            <>
              <MenuSeparator />
              <MenuLabel>Checklists</MenuLabel>
              {checklists.map((d) => {
                const href = `/docs?path=${encodeURIComponent(d.path)}`;
                return (
                  <MenuItem
                    key={d.id}
                    checked={pinned(href)}
                    disabled={full && !pinned(href)}
                    onSelect={() => (pinned(href) ? unpin(href) : pin({ kind: "doc", id: d.path, href, label: d.title }))}
                  >
                    {d.title}
                  </MenuItem>
                );
              })}
            </>
          )}
          <p className="px-2 pb-1 pt-2 text-2xs text-faint">Up to {MAX_PINS}. Kept on this computer.</p>
        </Menu>
      </div>

      <div className="flex-1" />

      {/* What waits for the person. */}
      {toCheck > 0 && (
        <RailButton label={`${toCheck} waiting for your check`} onClick={() => router.push("/#to-check")}>
          <CheckCheck className="size-4" />
          <Count n={toCheck} tone="review" />
        </RailButton>
      )}
      {unsaved > 0 && (
        <RailButton
          label={`${unsaved} board change${unsaved === 1 ? "" : "s"} not in the repository yet`}
          onClick={() => router.push("/board?save=1")}
        >
          <CloudUpload className="size-4" />
          <Count n={unsaved} tone="accent" />
        </RailButton>
      )}
      {sync.state === "error" && (
        <RailButton label={`Sync failed: ${sync.error ?? "unknown error"}. Press to try again.`} onClick={requestSync}>
          <CloudOff className="size-4 text-danger" />
        </RailButton>
      )}
      {(toCheck > 0 || unsaved > 0 || sync.state === "error") && <span className="my-1 h-px w-5 shrink-0 bg-border" />}

      <RailButton label="Keyboard shortcuts" shortcut="?" onClick={openShortcuts}>
        <Keyboard className="size-4" />
      </RailButton>
      <RailButton label={resolved === "dark" ? "Light theme" : "Dark theme"} onClick={toggle}>
        {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </RailButton>
    </aside>
  );
}
