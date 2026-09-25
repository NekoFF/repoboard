"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Flag, User } from "lucide-react";
import type { BoardData } from "@/lib/board-service";
import { api } from "@/lib/client/api";
import { parseItemMeta } from "@/lib/markdown/format";
import { Menu, MenuItem, Modal, PriorityIcon, Spinner, StatusIcon, useToast } from "@/components/ui";
import { PRIORITY_LABEL, statusOfColumn } from "@/lib/status";

/**
 * The full "new card" form. The title understands the same shorthand as the
 * markdown format, so "Fix login !high @neko due:2026-10-01 #auth" fills in
 * priority, assignee, due date and label as you type.
 */
export function NewCardDialog({
  data,
  initialColumnId,
  onClose,
}: {
  data: BoardData;
  initialColumnId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState(initialColumnId ?? data.columns[0]?.id ?? "");
  const [priority, setPriority] = useState(0);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);

  const meta = parseItemMeta(title);
  const effectivePriority = meta.priority || priority;
  const column = data.columns.find((c) => c.id === columnId);
  const milestone = data.milestones.find((m) => m.id === milestoneId);

  const create = async () => {
    const clean = (meta.title || title).trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await api.boardAction({
        action: "create",
        columnId,
        title: clean,
        description: description.trim() || null,
        priority: effectivePriority,
        assignee: meta.owners[0] ?? null,
        labels: meta.tags,
        milestoneId,
        dueDate: meta.due ? Date.parse(`${meta.due}T00:00:00Z`) : null,
      });
      toast.push({ kind: "success", message: "Card created", detail: clean });
      router.refresh();
      if (another) {
        setTitle("");
        setDescription("");
      } else {
        onClose();
      }
    } catch (error) {
      toast.push({ kind: "error", message: "Could not create the card", detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New card"
      onClose={onClose}
      footer={
        <>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="accent-[rgb(var(--ink))]" checked={another} onChange={(e) => setAnother(e.target.checked)} />
            Create another
          </label>
          <div className="flex-1" />
          <span className="hidden text-2xs text-faint sm:inline">⌘↵</span>
          <button className="rb-btn-primary" onClick={create} disabled={!title.trim() || busy}>
            {busy && <Spinner />} Create card
          </button>
        </>
      }
    >
      <div
        className="flex flex-col gap-3"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void create();
          }
        }}
      >
        <input
          autoFocus
          className="w-full bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-faint"
          placeholder="Card title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              void create();
            }
          }}
        />
        <textarea
          rows={4}
          className="w-full resize-none bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          placeholder="Description (markdown)…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <Menu
            trigger={
              <button className="rb-chip">
                <StatusIcon status={statusOfColumn(column?.name)} /> {column?.name}
              </button>
            }
          >
            {data.columns.map((c) => (
              <MenuItem key={c.id} icon={<StatusIcon status={statusOfColumn(c.name)} />} checked={c.id === columnId} onSelect={() => setColumnId(c.id)}>
                {c.name}
              </MenuItem>
            ))}
          </Menu>
          <Menu
            trigger={
              <button className="rb-chip">
                <PriorityIcon priority={effectivePriority} /> {PRIORITY_LABEL[effectivePriority]}
              </button>
            }
          >
            {[1, 2, 3, 4, 0].map((p) => (
              <MenuItem key={p} icon={<PriorityIcon priority={p} />} checked={effectivePriority === p} onSelect={() => setPriority(p)}>
                {PRIORITY_LABEL[p]}
              </MenuItem>
            ))}
          </Menu>
          {data.milestones.length > 0 && (
            <Menu
              trigger={
                <button className="rb-chip">
                  <Flag className="size-3.5 text-faint" /> {milestone?.name ?? "Milestone"}
                </button>
              }
            >
              {data.milestones.map((m) => (
                <MenuItem key={m.id} checked={m.id === milestoneId} onSelect={() => setMilestoneId(m.id)}>
                  {m.name}
                </MenuItem>
              ))}
              {milestoneId && <MenuItem onSelect={() => setMilestoneId(null)}>No milestone</MenuItem>}
            </Menu>
          )}
          {meta.owners[0] && (
            <span className="rb-chip pointer-events-none">
              <User className="size-3.5 text-faint" /> {meta.owners[0]}
            </span>
          )}
          {meta.due && (
            <span className="rb-chip pointer-events-none">
              <CalendarDays className="size-3.5 text-faint" /> {meta.due}
            </span>
          )}
          {meta.tags.map((t) => (
            <span key={t} className="rb-chip pointer-events-none">#{t}</span>
          ))}
        </div>
        <p className="text-2xs text-faint">
          Shorthand in the title: <code className="font-mono">!high</code> <code className="font-mono">@name</code>{" "}
          <code className="font-mono">due:2026-10-01</code> <code className="font-mono">#label</code>
        </p>
      </div>
    </Modal>
  );
}
