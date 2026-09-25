"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, Trash2 } from "lucide-react";
import type { BoardData } from "@/lib/board-service";
import { api } from "@/lib/client/api";
import { DueLabel, EmptyState, Modal, ProgressBar, Spinner, useToast } from "@/components/ui";
import { statusOfColumn } from "@/lib/status";

export function milestoneProgress(data: BoardData, milestoneId: string) {
  const status = new Map(data.columns.map((c) => [c.id, statusOfColumn(c.name)]));
  const cards = data.tasks.filter((t) => t.milestoneId === milestoneId);
  const count = (s: string) => cards.filter((t) => status.get(t.columnId) === s).length;
  return { total: cards.length, done: count("done"), review: count("review"), doing: count("doing") };
}

/** Goals with a date. A milestone's progress is simply how many of its cards are done. */
export function MilestonesDialog({ data, onClose }: { data: BoardData; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (payload: Record<string, unknown>, message?: string) => {
    setBusy(true);
    try {
      await api.boardAction({ boardId: data.boardId, ...payload });
      if (message) toast.push({ kind: "success", message });
      router.refresh();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not save the milestone", detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Milestones" description="Group cards under a goal with a date, and watch it fill up." onClose={onClose}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void act(
            {
              action: "milestone-create",
              name: name.trim(),
              dueDate: due ? Date.parse(`${due}T00:00:00Z`) : null,
            },
            `Milestone “${name.trim()}” created`,
          );
          setName("");
          setDue("");
        }}
      >
        <input
          className="rb-input min-w-[180px] flex-1"
          placeholder="New milestone, e.g. Public beta"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        <input type="date" className="rb-input w-[150px]" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Target date" />
        <button className="rb-btn-primary" disabled={!name.trim() || busy}>
          {busy && <Spinner />} Add
        </button>
      </form>

      <div className="mt-4 flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
        {data.milestones.length === 0 && (
          <EmptyState compact icon={<Flag className="size-5" />} title="No milestones yet" body="Add one above, then pick it on a card." />
        )}
        {data.milestones.map((m) => {
          const progress = milestoneProgress(data, m.id);
          return (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <Flag className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <input
                  className="w-full truncate bg-transparent text-sm font-medium text-ink outline-none"
                  defaultValue={m.name}
                  aria-label="Milestone name"
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value && value !== m.name) void act({ action: "milestone-update", milestoneId: m.id, name: value });
                  }}
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="w-full max-w-[180px]">
                    <ProgressBar counts={progress} height={4} />
                  </span>
                  <span className="text-2xs tabular-nums text-faint">
                    {progress.done}/{progress.total} done
                  </span>
                </div>
              </div>
              <label className="relative text-xs text-muted">
                {m.dueDate ? <DueLabel value={m.dueDate} /> : <span className="text-faint">No date</span>}
                <input
                  type="date"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  defaultValue={m.dueDate ? new Date(m.dueDate).toISOString().slice(0, 10) : ""}
                  onChange={(event) =>
                    act({
                      action: "milestone-update",
                      milestoneId: m.id,
                      dueDate: event.target.value ? Date.parse(`${event.target.value}T00:00:00Z`) : null,
                    })
                  }
                />
              </label>
              <button
                className="rb-icon-btn"
                aria-label={`Delete ${m.name}`}
                onClick={() => act({ action: "milestone-delete", milestoneId: m.id }, `Deleted “${m.name}”; its cards stay`)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
