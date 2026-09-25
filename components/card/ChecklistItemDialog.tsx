"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronRight, Plus, User, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  addItem,
  progress,
  setDone,
  updateItem,
  type Checklist,
  type ChecklistItem,
  type Located,
} from "@/lib/checklist";
import { Markdown } from "@/components/Markdown";
import { ActorAvatar, ActorName } from "@/components/Actor";
import { useShell } from "@/components/shell/ShellContext";
import { DueLabel, Popover, ProgressRing, RelativeTime, StatusIcon } from "@/components/ui";

const NOTES_TEMPLATE = `**What to do**

-

**How to check it**

-

**Keep in mind**

- `;

/**
 * One item of a card, in focus: its notes (what to do, how to check it, what
 * matters — often written by an AI for you to verify), its own sub-items,
 * who owns it, when it is due, and a comment thread. Sub-items open in the
 * same dialog, with the path back up at the top.
 */
export function ChecklistItemDialog({
  items,
  located,
  people,
  onChange,
  onOpen,
  onClose,
}: {
  items: Checklist;
  located: Located;
  people: string[];
  onChange: (items: Checklist) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { viewer } = useShell();
  const { item, path, number } = located;
  const [title, setTitle] = useState(item.text);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [comment, setComment] = useState("");
  const [child, setChild] = useState("");
  const [assignee, setAssignee] = useState("");

  useEffect(() => {
    setTitle(item.text);
    setNotes(item.notes ?? "");
    setEditingNotes(false);
  }, [item.id, item.text, item.notes]);

  const patch = (fn: (i: ChecklistItem) => ChecklistItem) => onChange(updateItem(items, item.id, fn));
  const kids = item.children ?? [];
  const kidProgress = progress(kids);
  const numbers = number.split(".");

  const saveNotes = () => {
    patch((i) => ({ ...i, notes: notes.trim() ? notes : null }));
    setEditingNotes(false);
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="rb-fade-in rb-scrim fixed inset-0 z-[80]" />
        <Dialog.Content
          className="rb-pop rb-glass-strong fixed inset-0 z-[81] m-auto flex h-fit max-h-[86dvh] w-[calc(100vw-32px)] max-w-[720px] flex-col overflow-hidden rounded-[22px] focus:outline-none"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {/* path back up: Card › 1 Home screen › 1.2 History */}
          <div className="flex items-center gap-1 px-5 pt-4 text-xs text-muted">
            {path.map((p, i) => (
              <span key={p.id} className="flex min-w-0 items-center gap-1">
                <button className="max-w-[180px] truncate rounded px-1 hover:bg-hover hover:text-ink" onClick={() => onOpen(p.id)}>
                  <span className="font-mono text-faint">{numbers.slice(0, i + 1).join(".")}</span> {p.text}
                </button>
                <ChevronRight className="size-3 shrink-0 text-faint" />
              </span>
            ))}
            <span className="font-mono text-faint">{number}</span>
            <div className="flex-1" />
            <Dialog.Close className="rb-icon-btn" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="rb-scroll-thin flex min-h-0 flex-col gap-6 overflow-y-auto px-5 pb-5 pt-2">
            <div className="flex items-start gap-3">
              <button
                className="mt-1 grid size-7 shrink-0 place-items-center rounded-md hover:bg-pill"
                aria-label={item.done ? "Mark as not done" : "Mark as done"}
                onClick={() => onChange(setDone(items, item.id, !item.done))}
              >
                <StatusIcon status={item.done ? "done" : "todo"} size={20} />
              </button>
              <Dialog.Title asChild>
                <textarea
                  rows={1}
                  className="min-w-0 flex-1 resize-none bg-transparent text-xl font-semibold tracking-[-0.015em] text-ink outline-none"
                  value={title}
                  aria-label="Item"
                  onChange={(event) => setTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.target as HTMLTextAreaElement).blur();
                    }
                  }}
                  onBlur={() => title.trim() && title !== item.text && patch((i) => ({ ...i, text: title.trim() }))}
                />
              </Dialog.Title>
            </div>

            {/* owner and due date */}
            <div className="-mt-2 flex flex-wrap items-center gap-2 pl-10">
              <Popover
                className="w-[220px]"
                trigger={
                  <button className="rb-chip">
                    {item.assignee ? <ActorAvatar name={item.assignee} size={16} /> : <User className="size-3.5 text-faint" />}
                    <span className={item.assignee ? "" : "text-faint"}>{item.assignee ?? "Nobody"}</span>
                  </button>
                }
              >
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    patch((i) => ({ ...i, assignee: assignee.trim().replace(/^@/, "") || null }));
                  }}
                >
                  <input autoFocus className="rb-input" placeholder="Name or GitHub login" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
                </form>
                <div className="mt-1 flex max-h-56 flex-col overflow-y-auto">
                  {people
                    .filter((p) => p.toLowerCase().includes(assignee.toLowerCase()))
                    .map((p) => (
                      <button key={p} className="rb-menu-item" onClick={() => patch((i) => ({ ...i, assignee: p }))}>
                        <ActorAvatar name={p} size={16} /> {p}
                      </button>
                    ))}
                  {item.assignee && (
                    <button className="rb-menu-item text-muted" onClick={() => patch((i) => ({ ...i, assignee: null }))}>
                      <X className="size-3.5" /> Nobody
                    </button>
                  )}
                </div>
              </Popover>
              <label className="rb-chip relative cursor-pointer">
                <CalendarDays className="size-3.5 text-faint" />
                {item.due ? <DueLabel value={item.due} /> : <span className="text-faint">No date</span>}
                <input
                  type="date"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={item.due ? new Date(item.due).toISOString().slice(0, 10) : ""}
                  onChange={(event) =>
                    patch((i) => ({ ...i, due: event.target.value ? Date.parse(`${event.target.value}T00:00:00Z`) : null }))
                  }
                />
              </label>
            </div>

            {/* notes */}
            <section className="flex flex-col gap-2 pl-10">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">Notes</h3>
                <span className="text-xs text-faint">What to do, how to check it, what to keep in mind</span>
              </div>
              {editingNotes ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    autoFocus
                    className="rb-input min-h-[180px] resize-y font-mono text-sm leading-relaxed"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        saveNotes();
                      }
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setNotes(item.notes ?? "");
                        setEditingNotes(false);
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5">
                    <button className="rb-btn-primary rb-btn-sm" onClick={saveNotes}>
                      Save
                    </button>
                    <button className="rb-btn-ghost" onClick={() => { setNotes(item.notes ?? ""); setEditingNotes(false); }}>
                      Cancel
                    </button>
                    <span className="ml-auto text-2xs text-faint">Markdown · ⌘↵ to save</span>
                  </div>
                </div>
              ) : item.notes ? (
                <div
                  className="-mx-2 cursor-text rounded-lg px-2 py-1 transition-colors hover:bg-hover"
                  onClick={(event) => !(event.target as HTMLElement).closest("a") && setEditingNotes(true)}
                >
                  <Markdown content={item.notes} className="text-sm" />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button className="rb-btn rb-btn-sm" onClick={() => { setNotes(NOTES_TEMPLATE); setEditingNotes(true); }}>
                    Add notes from a template
                  </button>
                  <button className="rb-btn-ghost" onClick={() => setEditingNotes(true)}>
                    Write freely
                  </button>
                </div>
              )}
            </section>

            {/* sub-items */}
            <section className="flex flex-col gap-1 pl-10">
              <div className="flex items-center gap-2 pb-1">
                <h3 className="text-sm font-semibold text-ink">Sub-items</h3>
                {kids.length > 0 && (
                  <span className="flex items-center gap-1 text-xs tabular-nums text-faint">
                    <ProgressRing done={kidProgress.done} total={kidProgress.total} size={12} /> {kidProgress.done}/{kidProgress.total}
                  </span>
                )}
              </div>
              {kids.map((kid, index) => (
                <div key={kid.id} className="group flex h-9 items-center gap-2 rounded-lg px-1 hover:bg-hover">
                  <button className="grid size-6 place-items-center" onClick={() => onChange(setDone(items, kid.id, !kid.done))} aria-label="Tick">
                    <StatusIcon status={kid.done ? "done" : "todo"} size={15} />
                  </button>
                  <span className="w-10 font-mono text-2xs text-faint">
                    {number}.{index + 1}
                  </span>
                  <button className="min-w-0 flex-1 truncate text-left text-sm text-ink" onClick={() => onOpen(kid.id)}>
                    <span className={kid.done ? "text-muted line-through decoration-faint" : ""}>{kid.text}</span>
                  </button>
                  {(kid.children?.length ?? 0) > 0 && (
                    <span className="text-2xs tabular-nums text-faint">
                      {progress(kid.children!).done}/{progress(kid.children!).total}
                    </span>
                  )}
                  <ChevronRight className="size-3.5 text-faint opacity-0 group-hover:opacity-100" />
                </div>
              ))}
              <form
                className="flex h-9 items-center gap-2 px-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!child.trim()) return;
                  onChange(addItem(items, item.id, { id: crypto.randomUUID(), text: child.trim(), done: false, children: [], comments: [] }));
                  setChild("");
                }}
              >
                <Plus className="ml-1 size-4 text-faint" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                  placeholder={`Add ${number}.${kids.length + 1} and press Enter`}
                  value={child}
                  onChange={(event) => setChild(event.target.value)}
                />
              </form>
            </section>

            {/* comments */}
            <section className="flex flex-col gap-3 pl-10">
              <h3 className="text-sm font-semibold text-ink">Comments</h3>
              {(item.comments ?? []).map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <ActorAvatar name={c.author} kind={c.kind} size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-faint">
                      <ActorName name={c.author} kind={c.kind} /> <RelativeTime value={c.at} className="ml-1" />
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{c.text}</p>
                  </div>
                </div>
              ))}
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!comment.trim()) return;
                  patch((i) => ({
                    ...i,
                    comments: [
                      ...(i.comments ?? []),
                      { id: crypto.randomUUID(), author: viewer ?? "me", kind: "person", text: comment.trim(), at: Date.now() },
                    ],
                  }));
                  setComment("");
                }}
              >
                <textarea
                  rows={2}
                  className="rb-input min-w-0 flex-1 resize-none"
                  placeholder="Write a comment…"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      (event.currentTarget.form as HTMLFormElement).requestSubmit();
                    }
                  }}
                />
                <button className="rb-btn rb-btn-sm" disabled={!comment.trim()}>
                  Comment
                </button>
              </form>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
