"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, LayoutGrid, MoreHorizontal, Pencil, Plus, Tag, User, Users } from "lucide-react";
import type { BoardSummary } from "@/lib/board-service";
import { api, useResource } from "@/lib/client/api";
import { PageHeader } from "@/components/PageHeader";
import { ActorAvatar } from "@/components/Actor";
import { BOARD_COLORS, boardColor, boardHref } from "@/components/labelColor";
import { useShell } from "@/components/shell/ShellContext";
import {
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
  ProgressBar,
  RelativeTime,
  Segmented,
  Spinner,
  useToast,
} from "@/components/ui";

export function BoardMark({ board, size = 36 }: { board: Pick<BoardSummary, "name" | "color" | "owner">; size?: number }) {
  if (board.owner) {
    return (
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        <ActorAvatar name={board.owner} size={size} />
        <span
          className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface"
          style={{ backgroundColor: boardColor(board.color, board.name) }}
        />
      </span>
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px] font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: boardColor(board.color, board.name), fontSize: size * 0.4 }}
      aria-hidden
    >
      {board.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Create or edit a board: for a person (with an owner) or for an area of work. */
export function BoardDialog({ board, onClose }: { board?: BoardSummary; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { connected } = useShell();
  const people = useResource(api.people, [], { enabled: connected });
  const [kind, setKind] = useState<"topic" | "person">(board?.owner ? "person" : "topic");
  const [name, setName] = useState(board?.name ?? "");
  const [owner, setOwner] = useState(board?.owner ?? "");
  const [description, setDescription] = useState(board?.description ?? "");
  const [color, setColor] = useState(board?.color ?? BOARD_COLORS[0].key);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const finalName = name.trim() || (kind === "person" ? owner.trim() : "");
    if (!finalName) return;
    setBusy(true);
    try {
      const fields = {
        name: finalName,
        description: description.trim() || null,
        color,
        owner: kind === "person" ? owner.trim().replace(/^@/, "") || null : null,
      };
      if (board) {
        await api.updateBoard(board.id, fields);
        toast.push({ kind: "success", message: "Board saved" });
        onClose();
        router.refresh();
      } else {
        const { id } = await api.createBoard(fields);
        toast.push({ kind: "success", message: `Board ${finalName} created` });
        onClose();
        router.refresh();
        router.push(`/board/${encodeURIComponent(id)}`);
      }
    } catch (error) {
      toast.push({ kind: "error", message: "Could not save the board", detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={board ? "Edit board" : "New board"}
      description="A board for a person — their own list of work — or for an area like Design or Core."
      onClose={onClose}
      footer={
        <>
          <div className="flex-1" />
          <button className="rb-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="rb-btn-primary" onClick={submit} disabled={busy || !(name.trim() || (kind === "person" && owner.trim()))}>
            {busy && <Spinner />} {board ? "Save" : "Create board"}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "topic", label: <><Tag className="size-3.5" /> An area of work</> },
            { value: "person", label: <><User className="size-3.5" /> A person</> },
          ]}
        />
        {kind === "person" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted" htmlFor="board-owner">
              Whose board
            </label>
            <input
              id="board-owner"
              className="rb-input h-9"
              placeholder="GitHub login or a name, e.g. max"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              list="board-people"
              autoFocus
            />
            <datalist id="board-people">
              {(people.data?.people ?? []).map((p) => (
                <option key={p.login} value={p.login} />
              ))}
            </datalist>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted" htmlFor="board-name">
            Name
          </label>
          <input
            id="board-name"
            className="rb-input h-9"
            placeholder={kind === "person" ? owner || "e.g. Max" : "e.g. Design"}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus={kind === "topic"}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted" htmlFor="board-description">
            What it is for <span className="font-normal text-faint">(optional)</span>
          </label>
          <textarea
            id="board-description"
            rows={2}
            className="rb-input resize-none"
            placeholder={kind === "person" ? "Tasks for the internship: onboarding, first features…" : "Screens, components and the design system"}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Colour</span>
          <div className="flex gap-2">
            {BOARD_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-label={c.key}
                aria-pressed={color === c.key}
                onClick={() => setColor(c.key)}
                className={`size-7 rounded-full transition-transform ${color === c.key ? "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-raised" : "hover:scale-105"}`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

function BoardTile({ board, onEdit }: { board: BoardSummary; onEdit: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const total = board.open + board.done;
  return (
    <div className="group relative flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-lift">
      <Link href={boardHref(board)} className="absolute inset-0 rounded-2xl" aria-label={`Open ${board.name}`} />
      <div className="flex items-start gap-3">
        <BoardMark board={board} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-md font-semibold text-ink">
            {board.name}
            {board.primary && <span className="rb-pill">Main</span>}
          </p>
          <p className="truncate text-sm text-muted">
            {board.description ?? (board.owner ? `${board.owner}’s work` : board.primary ? "Follows the markdown file and board.json" : "An area of work")}
          </p>
        </div>
        <span className="relative z-[1]">
          <Menu
            align="end"
            trigger={
              <button className="rb-icon-btn opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Board actions">
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            <MenuItem icon={<Pencil className="size-3.5" />} onSelect={onEdit}>
              Edit
            </MenuItem>
            {!board.primary && (
              <>
                <MenuSeparator />
                <MenuItem
                  danger
                  icon={<Archive className="size-3.5" />}
                  onSelect={async () => {
                    try {
                      await api.archiveBoard(board.id);
                      toast.push({ kind: "info", message: `Archived ${board.name}`, detail: "Its cards are kept." });
                      router.refresh();
                    } catch (error) {
                      toast.push({ kind: "error", message: "Could not archive", detail: (error as Error).message });
                    }
                  }}
                >
                  Archive board
                </MenuItem>
              </>
            )}
          </Menu>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <ProgressBar counts={{ done: board.done, total: Math.max(total, 0) }} height={6} />
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            <span className="tabular-nums text-ink">{board.open}</span> open,{" "}
            <span className="tabular-nums text-ink">{board.done}</span> done
            {board.items.total > 0 && (
              <span className="text-faint">
                , {board.items.done}/{board.items.total} items
              </span>
            )}
          </span>
          {board.updatedAt && <RelativeTime value={board.updatedAt} className="text-faint" />}
        </div>
      </div>
    </div>
  );
}

/**
 * All boards of the project. A board is either one person's work or one area;
 * each holds cards (topics), and each card holds numbered items (steps).
 */
export function BoardsScreen({ boards }: { boards: BoardSummary[] }) {
  const params = useSearchParams();
  const [dialog, setDialog] = useState<null | "new" | BoardSummary>(params.get("new") ? "new" : null);
  const people = boards.filter((b) => b.owner);
  const areas = boards.filter((b) => !b.owner);

  const section = (title: string, icon: React.ReactNode, list: BoardSummary[], hint: string) =>
    list.length > 0 && (
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="flex items-center gap-2 text-md font-semibold text-ink">
            <span className="text-muted">{icon}</span>
            {title}
          </h2>
          <span className="hidden text-sm text-faint sm:inline">{hint}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((b) => (
            <BoardTile key={b.id} board={b} onEdit={() => setDialog(b)} />
          ))}
        </div>
      </section>
    );

  return (
    <>
      <PageHeader
        title="Boards"
        icon={<LayoutGrid className="size-4" />}
        meta={boards.length ? `${boards.length} in this project` : undefined}
        actions={
          <button className="rb-btn-primary rb-btn-sm" onClick={() => setDialog("new")}>
            <Plus className="size-3.5" /> New board
          </button>
        }
      />
      <div className="rb-under-header rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-10 px-6 pb-20 pt-8 sm:px-10">
          <p className="max-w-[70ch] text-md leading-relaxed text-muted">
            A project has boards — one per person, or one per area such as Design or Core. On a board, each{" "}
            <span className="text-ink">card</span> is a topic; inside a card, <span className="text-ink">items</span> are
            the steps, numbered 1, 1.1, 1.2, each with its own notes.
          </p>
          {section("Areas", <Tag className="size-4" />, areas, "Work grouped by subject")}
          {section("People", <Users className="size-4" />, people, "Each person’s own list of work")}
          {boards.length === 0 && <EmptyState title="No boards yet" body="Connect a repository to get a main board." />}
          <button
            className="flex h-24 items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
            onClick={() => setDialog("new")}
          >
            <Plus className="size-4" /> New board for a person or an area
          </button>
        </div>
      </div>
      {dialog && <BoardDialog board={dialog === "new" ? undefined : dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
