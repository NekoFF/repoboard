"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  SquareKanban,
} from "lucide-react";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { KanbanBoard, type BoardView } from "@/components/KanbanBoard";
import { PageHeader } from "@/components/PageHeader";
import { ImportIssuesDialog } from "@/components/ImportIssuesDialog";
import { MarkdownWriteDialog } from "@/components/MarkdownWriteDialog";
import { NewCardDialog } from "@/components/NewCardDialog";
import { MilestonesDialog } from "@/components/MilestonesDialog";
import { FilterBar, type FilterBarHandle } from "@/components/FilterBar";
import { Menu, MenuItem, MenuSeparator, Modal, Segmented, Spinner, Tooltip, useToast } from "@/components/ui";
import { api, useResource } from "@/lib/client/api";
import { applyFilter, parseFilter } from "@/lib/client/filters";
import { useHotkeys } from "@/lib/client/hotkeys";
import { statusOfColumn } from "@/lib/status";

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
  const toast = useToast();
  const filterRef = useRef<FilterBarHandle>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<BoardView>("board");
  const [syncing, setSyncing] = useState(false);
  const [dialog, setDialog] = useState<null | "import" | "commit" | "new" | "milestones" | "save">(null);
  const [saving, setSaving] = useState(false);

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

  // Deep links: ?new=1 opens the form, ?ref=12 opens card RB-12, ?q= filters.
  useEffect(() => {
    if (params.get("new")) {
      setDialog("new");
      router.replace("/board", { scroll: false });
    }
    const ref = params.get("ref");
    if (ref) {
      const task = data.tasks.find((t) => t.number === Number(ref));
      router.replace(task ? `/board?card=${task.id}` : "/board", { scroll: false });
      if (!task) toast.push({ kind: "info", message: `RB-${ref} is not on this board` });
    }
    const q = params.get("q");
    if (q) setQuery(q);
  }, [params, data.tasks, router, toast]);

  // What the board says that the markdown file does not say yet.
  const pending = useResource(api.pending, [], { enabled: connected && Boolean(data.markdownSource) });
  // How far the board has drifted from the copy stored in the repository.
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
      toast.push({ kind: "error", message: "Sync failed", detail: (error as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  const saveBoard = async () => {
    setSaving(true);
    try {
      const result = await api.boardPush();
      toast.push({ kind: "success", message: "Board saved to the repository", detail: `${result.changes.length} changes in .repoboard/board.json` });
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

  return (
    <>
      <PageHeader
        title="Board"
        icon={<SquareKanban className="size-4" />}
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
            {boardChanges > 0 && (
              <Tooltip content="Card order, checklists and links are kept in .repoboard/board.json so teammates see them">
                <button className="rb-btn rb-btn-sm" onClick={() => setDialog("save")}>
                  <CloudUpload className="size-3.5" /> Save to repo
                  <span className="tabular-nums text-faint">{boardChanges}</span>
                </button>
              </Tooltip>
            )}
            <Tooltip content={data.markdownSource ? `Sync with ${data.markdownSource.path}` : "Pull the board from the repository"} shortcut="S">
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
              <MenuItem icon={<Flag className="size-3.5" />} shortcut="M" onSelect={() => setDialog("milestones")}>
                Milestones
              </MenuItem>
              <MenuItem icon={<Download className="size-3.5" />} disabled={!connected} onSelect={() => setDialog("import")}>
                Import GitHub issues
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<RefreshCw className="size-3.5" />} onSelect={() => router.push("/docs")}>
                {data.markdownSource ? `Board source: ${data.markdownSource.path}` : "Drive the board from a markdown file"}
              </MenuItem>
            </Menu>
            <Tooltip content="New card" shortcut="C">
              <button className="rb-btn-primary rb-btn-sm ml-1" onClick={() => setDialog("new")}>
                <Plus className="size-3.5" /> New card
              </button>
            </Tooltip>
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

      <div className="flex min-h-0 flex-1 flex-col">
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
          title="Save the board to the repository"
          description="Commits .repoboard/board.json, so anyone who connects this repository sees the same cards, order and checklists."
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

      {dialog === "import" && data.columns[0] && (
        <ImportIssuesDialog
          columns={data.columns}
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
