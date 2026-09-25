"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, LayoutGrid, MoreHorizontal, Pencil, Plus, Tag, User } from "lucide-react";
import type { BoardSummary } from "@/lib/board-service";
import { api, useResource } from "@/lib/client/api";
import { PageHeader } from "@/components/PageHeader";
import { ActorAvatar } from "@/components/Actor";
import { BOARD_COLORS, boardColor, boardHref, boardSeed, boardTone } from "@/components/labelColor";
import { BOARD_ART, BoardArt, resolveArt } from "@/components/BoardArt";
import { useShell } from "@/components/shell/ShellContext";
import {
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
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

const toneStyle = (color: string | null, name: string): CSSProperties => {
  const { hue, sat } = boardTone(color, name);
  return { ["--h" as string]: hue, ["--s" as string]: sat };
};

/** What a tile shows: its picture, and its name on glass (or in white on a plain colour). */
function TileFace({
  name,
  owner,
  art,
  seed,
}: {
  name: string;
  owner: string | null;
  art: string;
  seed: number;
}) {
  const label = (
    <>
      {owner && <ActorAvatar name={owner} size={22} />}
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </>
  );
  return (
    <>
      <BoardArt art={art} seed={seed} />
      {art === "plain" ? (
        <span className="absolute inset-x-5 bottom-4 flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em] text-white">
          {label}
        </span>
      ) : (
        <span className="rb-tile-plate text-md font-medium text-ink">{label}</span>
      )}
    </>
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
  // A new board starts with a picture chosen at random; an existing one with the one it shows.
  const [seed] = useState(() => (board ? boardSeed(board.id) : Math.floor(Math.random() * 1e9)));
  const [art, setArt] = useState(() =>
    board ? resolveArt(board.art, seed) : BOARD_ART[1 + Math.floor(Math.random() * (BOARD_ART.length - 1))].key,
  );
  const [busy, setBusy] = useState(false);

  const shownName = name.trim() || (kind === "person" ? owner.trim() : "") || "New board";
  const shownOwner = kind === "person" ? owner.trim().replace(/^@/, "") || null : null;

  const submit = async () => {
    const finalName = name.trim() || (kind === "person" ? owner.trim() : "");
    if (!finalName) return;
    setBusy(true);
    try {
      const fields = {
        name: finalName,
        description: description.trim() || null,
        color,
        art,
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
      wide
      title={board ? "Edit board" : "New board"}
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
        className="grid gap-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-4">
          {/* The tile as it will look on the Boards screen. */}
          <div className="rb-tile pointer-events-none mt-2" style={toneStyle(color, shownName)} aria-hidden>
            <div className="rb-tile-window">
              <TileFace name={shownName} owner={shownOwner} art={art} seed={seed} />
            </div>
          </div>
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
            <div className="flex flex-wrap gap-2">
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
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-muted">Picture</span>
            <span className="text-xs text-faint">{BOARD_ART.find((a) => a.key === art)?.name}</span>
          </div>
          <div role="radiogroup" aria-label="Picture" className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {BOARD_ART.map((a) => (
              <button
                key={a.key}
                type="button"
                role="radio"
                aria-checked={art === a.key}
                aria-label={a.name}
                title={a.name}
                onClick={() => setArt(a.key)}
                className={`rb-art-choice rb-tile rb-tile-flat relative aspect-[16/11] overflow-hidden rounded-[10px] transition-[box-shadow,scale] duration-150 ${
                  art === a.key
                    ? "ring-2 ring-accent ring-offset-2 ring-offset-raised"
                    : "ring-1 ring-ink/10 hover:scale-[1.04]"
                }`}
                style={toneStyle(color, shownName)}
              >
                <span className="absolute inset-0" style={{ backgroundColor: "var(--tl-bgc)" }} />
                <BoardArt art={a.key} seed={seed} still />
              </button>
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
  const seed = boardSeed(board.id);
  return (
    <div className="rb-tile group" style={toneStyle(board.color, board.name)}>
      <Link href={boardHref(board)} className="rb-tile-window outline-none" aria-label={`Open ${board.name}`}>
        <TileFace name={board.name} owner={board.owner} art={resolveArt(board.art, seed)} seed={seed} />
      </Link>
      <span className="absolute right-2.5 top-2.5 z-[2]">
        <Menu
          align="end"
          trigger={
            <button
              className="grid size-8 place-items-center rounded-full bg-[rgb(var(--glass)/0.55)] text-ink opacity-0 backdrop-blur-md transition-opacity hover:bg-[rgb(var(--glass)/0.8)] focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label="Board actions"
            >
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
  );
}

/** All boards of the project: the main one, then areas, then people. */
export function BoardsScreen({ boards }: { boards: BoardSummary[] }) {
  const params = useSearchParams();
  const [dialog, setDialog] = useState<null | "new" | BoardSummary>(params.get("new") ? "new" : null);
  const rank = (b: BoardSummary) => (b.primary ? 0 : b.owner ? 2 : 1);
  const ordered = [...boards].sort((a, b) => rank(a) - rank(b));

  return (
    <>
      <PageHeader
        title="Boards"
        icon={<LayoutGrid className="size-4" />}
        actions={
          <button className="rb-btn-primary rb-btn-sm" onClick={() => setDialog("new")}>
            <Plus className="size-3.5" /> New board
          </button>
        }
      />
      <div className="rb-under-header rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-6 pb-20 pt-10 sm:px-10">
          {ordered.length === 0 ? (
            <EmptyState title="No boards yet" body="Connect a repository to get a main board." />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-10">
              {ordered.map((b) => (
                <BoardTile key={b.id} board={b} onEdit={() => setDialog(b)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {dialog && <BoardDialog board={dialog === "new" ? undefined : dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
