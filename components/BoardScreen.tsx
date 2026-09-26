"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BoardDialog, BoardMark } from "@/components/BoardsScreen";
import {
  CalendarDays,
  CloudUpload,
  Columns3,
  Flag,
  GitCommitHorizontal,
  List,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Download,
  Pencil,
  SquareKanban,
} from "lucide-react";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { KanbanBoard, type BoardView } from "@/components/KanbanBoard";
import { PageHeader } from "@/components/PageHeader";
import { ImportIssuesDialog } from "@/components/ImportIssuesDialog";
import { MarkdownWriteDialog } from "@/components/MarkdownWriteDialog";
import { DocWriteDialog } from "@/components/DocWriteDialog";
import { NewCardDialog } from "@/components/NewCardDialog";
import { MilestonesDialog } from "@/components/MilestonesDialog";
import { AutoSyncDialog, SyncChip } from "@/components/SyncControls";
import { FilterBar, type FilterBarHandle } from "@/components/FilterBar";
import { Menu, MenuItem, MenuSeparator, Modal, Segmented, Spinner, Tooltip, useToast } from "@/components/ui";
import { api, ApiError, useResource } from "@/lib/client/api";
import { applyFilter, parseFilter } from "@/lib/client/filters";
import { useHotkeys } from "@/lib/client/hotkeys";
import { setCurrentBoard } from "@/lib/client/current-board";
import { statusOfColumn } from "@/lib/status";
import { canManageBoard, canWrite } from "@/lib/roles";
import { useShell } from "@/components/shell/ShellContext";

const VIEW_KEY = "rb-board-view";

export function BoardScreen({
  data,
  connected,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const filterRef = useRef<FilterBarHandle>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<BoardView>("board");
  const [syncing, setSyncing] = useState(false);
  const [dialog, setDialog] = useState<null | "import" | "commit" | "new" | "milestones" | "save" | "autosync">(null);
  const [saving, setSaving] = useState(false);
  const [ids, setIds] = useState<{ path: string; content: string; baseSha: string; count: number } | null>(null);

  // The tool rail's "not in the repository yet" opens the save dialog here.
  useEffect(() => {
    if (params.get("save") !== "1") return;
    setDialog("save");
    const next = new URLSearchParams(params.toString());
    next.delete("save");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_KEY);
      if (stored === "list" || stored === "calendar" || stored === "board") setView(stored);
    } catch {
      /* keep the default */
    }
  }, []);
  const changeView = (next: BoardView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* not remembered, still switched */
    }
  };

  useEffect(() => setCurrentBoard(pathname), [pathname]);

  // Deep links: ?new=1 opens the form, ?ref=12 opens card RB-12, ?q= filters.
  useEffect(() => {
    if (params.get("new")) {
      setDialog("new");
      router.replace(pathname, { scroll: false });
    }
    const ref = params.get("ref");
    if (ref) {
      const task = data.tasks.find((t) => t.number === Number(ref));
      router.replace(task ? `/board/card/${task.id}` : pathname, { scroll: false });
      if (!task) toast.push({ kind: "info", message: `RB-${ref} is not on this board` });
    }
    // Read once, then taken out of the address, so a refresh does not keep
    // putting it back over what the person typed since.
    const q = params.get("q");
    if (q) {
      setQuery(q);
      const rest = new URLSearchParams(params.toString());
      rest.delete("q");
      router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // What the board says that the markdown file does not say yet.
  // The markdown file belongs to the main board only; board.json holds every board.
  const primary = data.board?.primary ?? true;
  const { role, viewer } = useShell();
  const writable = canWrite({ role, login: viewer });
  const manage = data.board ? canManageBoard({ role, login: viewer }, data.board) : role === "manager";
  const pending = useResource(api.pending, [], { enabled: connected && primary && Boolean(data.markdownSource) });
  // How far the boards have drifted from the copy stored in the repository.
  const boardState = useResource(api.boardStatus, [], { enabled: connected });
  const refs = useResource(api.refs, [], { enabled: connected });

  useEffect(() => {
    const onChanged = () => {
      pending.reload();
      boardState.reload();
    };
    window.addEventListener("rb:pending-changed", onChanged);
    return () => window.removeEventListener("rb:pending-changed", onChanged);
  }, [pending, boardState]);

  const mentions = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of refs.data?.refs ?? []) map.set(r.card, (map.get(r.card) ?? 0) + 1);
    return map;
  }, [refs.data]);

  const filter = useMemo(() => parseFilter(query), [query]);
  const matches = useMemo(() => applyFilter(data.tasks, filter, data).length, [data, filter]);

  const counts = useMemo(() => {
    const status = new Map(data.columns.map((c) => [c.id, statusOfColumn(c.name)]));
    const done = data.tasks.filter((t) => status.get(t.columnId) === "done").length;
    return { open: data.tasks.length - done, done };
  }, [data]);

  const sync = async () => {
    setSyncing(true);
    try {
      // The repository's copy of the board first, then the roadmap file.
      const pulled = await api.boardPull().catch(() => null);
      if (data.markdownSource) {
        const result = await api.markdownAction<{ created: number; updated: number; idsAssigned: number; path: string }>({
          action: "sync",
        });
        toast.push({
          kind: "success",
          message: `Synced with ${result.path}`,
          detail: [
            `${result.created} new, ${result.updated} updated`,
            result.idsAssigned ? `${result.idsAssigned} ids written to the file` : null,
          ]
            .filter(Boolean)
            .join(", "),
        });
      } else {
        toast.push({
          kind: "success",
          message: "Board is up to date",
          detail: pulled && (pulled.added || pulled.updated) ? `${pulled.added} new, ${pulled.updated} updated from the repository` : undefined,
        });
      }
      boardState.reload();
      pending.reload();
      router.refresh();
    } catch (error) {
      const body = (error as ApiError).body;
      if (body?.needsIds) {
        // First sync of a file without ids: show the exact change before writing it.
        setIds(body as unknown as { path: string; content: string; baseSha: string; count: number });
      } else {
        toast.push({ kind: "error", message: "Sync failed", detail: (error as Error).message });
      }
    } finally {
      setSyncing(false);
    }
  };

  const saveBoard = async () => {
    setSaving(true);
    try {
      const result = await api.boardPush();
      toast.push({ kind: "success", message: "Boards saved to the repository", detail: `${result.changes.length} changes in .repoboard/board.json` });
      boardState.reload();
      setDialog(null);
    } catch (error) {
      toast.push({ kind: "error", message: "Could not save the board", detail: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  useHotkeys({
    "/": () => filterRef.current?.focus(),
    s: () => !syncing && sync(),
    m: () => setDialog("milestones"),
  });

  const pendingMoves = pending.data?.moves.length ?? 0;
  const boardChanges = boardState.data?.changes.length ?? 0;
  const autoSync = boardState.data?.autoSync ?? false;

  return (
    <>
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <Link href="/boards" className="text-muted hover:text-ink">
              Boards
            </Link>
            <span className="text-faint">/</span>
            <span className="truncate">{data.board?.name ?? "Board"}</span>
          </span>
        }
        icon={data.board ? <BoardMark board={data.board} size={20} /> : <SquareKanban className="size-4" />}
        meta={`${counts.open} open, ${counts.done} done`}
        actions={
          <>
            {pendingMoves > 0 && (
              <Tooltip content="Moves of cards from the markdown file, waiting for your review">
                <button className="rb-btn rb-btn-sm border-warn-border bg-warn-bg text-warn-fg hover:bg-warn-bg" onClick={() => setDialog("commit")}>
                  <GitCommitHorizontal className="size-3.5" />
                  Review {pendingMoves} move{pendingMoves === 1 ? "" : "s"}
                </button>
              </Tooltip>
            )}
            {autoSync && <SyncChip />}
            {!autoSync && boardChanges > 0 && (
              <Tooltip content="Boards, card order, checklists and links are kept in .repoboard/board.json so teammates see them">
                <button className="rb-btn rb-btn-sm" onClick={() => setDialog("save")}>
                  <CloudUpload className="size-3.5" /> Save to repo
                  <span className="tabular-nums text-faint">{boardChanges}</span>
                </button>
              </Tooltip>
            )}
            <Tooltip content={data.markdownSource ? `Sync with ${data.markdownSource.path}` : "Pull the boards from the repository"} shortcut="S">
              <button className="rb-icon-btn" onClick={sync} disabled={syncing} aria-label="Sync">
                {syncing ? <Spinner /> : <RefreshCw className="size-4" />}
              </button>
            </Tooltip>
            <Menu
              align="end"
              trigger={
                <button className="rb-icon-btn" aria-label="More board actions">
                  <MoreHorizontal className="size-4" />
                </button>
              }
            >
              <MenuItem icon={<Pencil className="size-3.5" />} disabled={!manage} onSelect={() => setEditing(true)}>
                Edit board
              </MenuItem>
              <MenuItem icon={<Flag className="size-3.5" />} shortcut="M" disabled={!writable} onSelect={() => setDialog("milestones")}>
                Milestones
              </MenuItem>
              <MenuItem icon={<Download className="size-3.5" />} disabled={!connected || !writable} onSelect={() => setDialog("import")}>
                Import GitHub issues
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<CloudUpload className="size-3.5" />} disabled={!connected || role !== "manager"} onSelect={() => setDialog("autosync")}>
                {autoSync ? "Automatic sync is on" : "Sync the boards automatically…"}
              </MenuItem>
              {primary && <MenuSeparator />}
              {primary && <MenuItem icon={<RefreshCw className="size-3.5" />} onSelect={() => router.push("/docs")}>
                {data.markdownSource ? `Board source: ${data.markdownSource.path}` : "Drive the board from a markdown file"}
              </MenuItem>}
            </Menu>
            {writable ? (
              <Tooltip content="New card" shortcut="C">
                <button className="rb-btn-primary rb-btn-sm ml-1" onClick={() => setDialog("new")}>
                  <Plus className="size-3.5" /> New card
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="Your role on GitHub is Read: you can look, not change. An admin can give you Write.">
                <span className="rb-pill ml-1">View only</span>
              </Tooltip>
            )}
          </>
        }
      >
        <Segmented
          size="sm"
          value={view}
          onChange={changeView}
          options={[
            { value: "board", label: <><Columns3 className="size-3.5" /> Board</> },
            { value: "list", label: <><List className="size-3.5" /> List</> },
            { value: "calendar", label: <><CalendarDays className="size-3.5" /> Calendar</> },
          ]}
        />
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <FilterBar ref={filterRef} data={data} query={query} onChange={setQuery} matches={matches} />
      </PageHeader>

      <div className="rb-under-header rb-full-bleed flex min-h-0 flex-1 flex-col">
        <KanbanBoard
          data={data}
          filter={filter}
          view={view}
          connected={connected}
          mentions={mentions}
          onImportIssues={connected ? () => setDialog("import") : undefined}
          onCreate={() => setDialog("new")}
        />
      </div>

      {dialog === "new" && <NewCardDialog data={data} onClose={() => setDialog(null)} />}
      {editing && data.board && (
        <BoardDialog
          board={{ ...data.board, open: counts.open, done: counts.done, items: { done: 0, total: 0 }, updatedAt: null }}
          onClose={() => setEditing(false)}
        />
      )}

      {ids && (
        <DocWriteDialog
          path={ids.path}
          edits={[{ type: "replace", content: ids.content }]}
          baseSha={ids.baseSha}
          onClose={() => setIds(null)}
          onDone={() => {
            setIds(null);
            toast.push({
              kind: "info",
              message: `Added ${ids.count} id${ids.count === 1 ? "" : "s"} to ${ids.path}`,
              detail: "They are hidden comments; GitHub shows the file as before. Syncing now.",
            });
            void sync();
          }}
        />
      )}
      {dialog === "milestones" && <MilestonesDialog data={data} onClose={() => setDialog(null)} />}

      {dialog === "commit" && (
        <MarkdownWriteDialog
          all
          onDiscard={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            pending.reload();
            router.refresh();
          }}
        />
      )}

      {dialog === "save" && (
        <Modal
          title="Save the boards to the repository"
          description="Commits .repoboard/board.json, so anyone who connects this repository sees the same boards, cards, order and checklists."
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="rb-btn" onClick={() => setDialog(null)}>
                Not now
              </button>
              <div className="flex-1" />
              <button className="rb-btn-primary" onClick={saveBoard} disabled={saving}>
                {saving && <Spinner />} Commit {boardChanges} change{boardChanges === 1 ? "" : "s"}
              </button>
            </>
          }
        >
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border text-sm">
            {(boardState.data?.changes ?? []).map((change, index) => (
              <li key={index} className="px-3 py-2 text-ink">
                {change}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Newer edits from the repository are merged in first, card by card, so nobody else’s work is overwritten.
          </p>
        </Modal>
      )}

      {dialog === "autosync" && (
        <AutoSyncDialog
          on={autoSync}
          onClose={() => setDialog(null)}
          onChanged={() => {
            setDialog(null);
            boardState.reload();
            router.refresh();
          }}
        />
      )}

      {dialog === "import" && data.columns[0] && (
        <ImportIssuesDialog
          columns={data.columns}
          boardId={data.boardId}
          linkedIssues={data.tasks.flatMap((t) => t.issues)}
          onClose={() => setDialog(null)}
          onDone={(created) => {
            setDialog(null);
            toast.push({ kind: "success", message: `Imported ${created} issue${created === 1 ? "" : "s"}` });
            router.refresh();
          }}
        />
      )}
    </>
  );
}
