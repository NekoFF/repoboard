"use client";

import { useState } from "react";
import { CalendarDays, ChevronRight, CornerDownRight, MessageSquareText, NotebookText, Plus, Trash2 } from "lucide-react";
import {
  newId,
  addItem,
  locate,
  progress,
  removeItem,
  setDone,
  type Checklist,
  type ChecklistItem,
} from "@/lib/checklist";
import { ActorAvatar } from "@/components/Actor";
import { ChecklistItemDialog } from "@/components/card/ChecklistItemDialog";
import { DueLabel, ProgressRing, StatusIcon, Tooltip, useToast } from "@/components/ui";



function AddRow({ depth, onAdd, placeholder }: { depth: number; onAdd: (text: string) => void; placeholder: string }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex h-9 items-center gap-2.5 rounded-lg px-2"
      style={{ paddingLeft: 8 + depth * 26 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        onAdd(text.trim());
        setText("");
      }}
    >
      <Plus className="size-4 shrink-0 text-faint" />
      <input
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        autoFocus={depth > 0}
      />
    </form>
  );
}

/**
 * The card's items as a numbered tree — 1, 1.1, 1.1.2 — that folds. Ticking
 * is one click; the item itself opens in a dialog with its notes (what to do,
 * how to check it), sub-items and comments.
 */
export function ChecklistTree({
  items,
  people,
  onChange,
}: {
  items: Checklist;
  people: string[];
  onChange: (items: Checklist) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const toast = useToast();
  const total = progress(items);

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = (parentId: string | null, text: string) => {
    onChange(addItem(items, parentId, { id: newId(), text, done: false, children: [], comments: [] }));
    if (parentId) setOpen((prev) => new Set(prev).add(parentId));
  };

  const row = (item: ChecklistItem, number: string, depth: number): React.ReactNode => {
    const kids = item.children ?? [];
    const kidProgress = progress(kids);
    const expanded = open.has(item.id);
    return (
      <div key={item.id}>
        <div
          className="group/row flex min-h-10 items-center gap-2 rounded-lg pr-1.5 transition-colors hover:bg-hover"
          style={{ paddingLeft: 4 + depth * 26 }}
        >
          <button
            className={`grid size-5 shrink-0 place-items-center rounded text-faint hover:text-ink ${kids.length ? "" : "invisible"}`}
            onClick={() => toggleOpen(item.id)}
            aria-label={expanded ? "Fold" : "Unfold"}
          >
            <ChevronRight className={`size-3.5 transition-transform duration-100 ${expanded ? "rotate-90" : ""}`} />
          </button>
          <button
            className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-pill"
            aria-label={item.done ? "Mark as not done" : "Mark as done"}
            onClick={() => onChange(setDone(items, item.id, !item.done))}
          >
            <StatusIcon status={item.done ? "done" : kidProgress.done > 0 ? "doing" : "todo"} size={16} />
          </button>
          <span className="w-9 shrink-0 font-mono text-2xs text-faint">{number}</span>
          <button className="min-w-0 flex-1 truncate py-2 text-left" onClick={() => setDialog(item.id)}>
            <span className={`text-base ${item.done ? "text-muted line-through decoration-faint" : "text-ink"}`}>
              {item.text || "Untitled"}
            </span>
          </button>
          <span className="flex shrink-0 items-center gap-2 text-2xs text-faint">
            {item.notes && (
              <Tooltip content="Has notes">
                <NotebookText className="size-3.5" />
              </Tooltip>
            )}
            {(item.comments?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageSquareText className="size-3.5" />
                {item.comments!.length}
              </span>
            )}
            {kids.length > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ProgressRing done={kidProgress.done} total={kidProgress.total} size={12} />
                {kidProgress.done}/{kidProgress.total}
              </span>
            )}
            {item.due && !item.done && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3" />
                <DueLabel value={item.due} />
              </span>
            )}
            {item.assignee && <ActorAvatar name={item.assignee} size={18} />}
          </span>
          <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100">
            <Tooltip content="Add a sub-item">
              <button className="rb-icon-btn size-7" onClick={() => setAddingUnder(item.id)} aria-label="Add a sub-item">
                <CornerDownRight className="size-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Delete item">
              <button
                className="rb-icon-btn size-7 hover:text-danger"
                onClick={() => {
                  const before = items;
                  onChange(removeItem(items, item.id));
                  // With its sub-items, notes and comments: offer it back.
                  toast.push({ kind: "info", message: "Item deleted", detail: item.text, action: { label: "Undo", run: () => onChange(before) } });
                }}
                aria-label="Delete item"
              >
                <Trash2 className="size-3.5" />
              </button>
            </Tooltip>
          </span>
        </div>
        {expanded && kids.map((kid, index) => row(kid, `${number}.${index + 1}`, depth + 1))}
        {addingUnder === item.id && (
          <div onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && setAddingUnder(null)}>
            <AddRow depth={depth + 1} placeholder={`Sub-item of ${number}, then Enter`} onAdd={(text) => add(item.id, text)} />
          </div>
        )}
      </div>
    );
  };

  const located = dialog ? locate(items, dialog) : null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-7 items-center gap-2">
        <h3 className="text-md font-semibold text-ink">Items</h3>
        {total.total > 0 && (
          <span className="flex items-center gap-1.5 text-xs tabular-nums text-faint">
            <ProgressRing done={total.done} total={total.total} size={13} /> {total.done}/{total.total}
          </span>
        )}
        <div className="flex-1" />
        {items.some((i) => i.children?.length) && (
          <button
            className="rb-btn-ghost"
            onClick={() =>
              setOpen((prev) => (prev.size ? new Set() : new Set(items.flatMap(function all(i): string[] { return [i.id, ...(i.children ?? []).flatMap(all)]; }))))
            }
          >
            {open.size ? "Fold all" : "Unfold all"}
          </button>
        )}
      </div>
      <div className="flex flex-col">
        {items.map((item, index) => row(item, String(index + 1), 0))}
        <AddRow depth={0} placeholder={items.length ? "Add an item and press Enter" : "First item — e.g. Home screen"} onAdd={(text) => add(null, text)} />
      </div>

      {located && (
        <ChecklistItemDialog
          items={items}
          located={located}
          people={people}
          onChange={onChange}
          onOpen={setDialog}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
