"use client";

import { useMemo, useState } from "react";
import { api, useResource } from "@/lib/client/api";
import { Modal, RowSkeleton, Spinner } from "@/components/ui";

/**
 * Turns real GitHub issues into board cards. Issues already on the board are
 * shown as such rather than hidden, so the list matches what github.com shows.
 */
export function ImportIssuesDialog({
  columns,
  boardId,
  linkedIssues,
  onClose,
  onDone,
}: {
  columns: { id: string; name: string }[];
  boardId?: string | null;
  linkedIssues: number[];
  onClose: () => void;
  onDone: (created: number) => void;
}) {
  const issues = useResource(api.issues, []);
  const [selected, setSelected] = useState<number[]>([]);
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = issues.data?.issues ?? [];
    return all.filter((issue) => (onlyOpen ? issue.state === "open" : true));
  }, [issues.data, onlyOpen]);

  const importable = rows.filter((r) => !linkedIssues.includes(r.number));
  // Only what is on screen can be imported: hiding closed issues drops them from the selection.
  const visibleSelected = selected.filter((n) => rows.some((r) => r.number === n));
  const hiddenClosed = (issues.data?.issues ?? []).length - rows.length;

  const run = async () => {
    if (visibleSelected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importIssues(visibleSelected, columnId, boardId);
      onDone(result.created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import GitHub issues"
      onClose={onClose}
      footer={
        <>
          <label className="flex items-center gap-2 text-sm text-muted">
            Into
            <select
              className="rb-input w-auto py-1 text-sm"
              value={columnId}
              onChange={(event) => setColumnId(event.target.value)}
            >
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex-1" />
          <button className="rb-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rb-btn-primary"
            onClick={run}
            disabled={busy || visibleSelected.length === 0}
          >
            {busy ? <Spinner /> : null}
            Import {visibleSelected.length || ""}
          </button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input
            type="checkbox"
            className="size-3.5 accent-ink"
            checked={onlyOpen}
            onChange={(event) => setOnlyOpen(event.target.checked)}
          />
          Open issues only
        </label>
        <div className="flex-1" />
        <button
          className="rb-btn-ghost"
          onClick={() =>
            setSelected(
              selected.length === importable.length
                ? []
                : importable.map((issue) => issue.number),
            )
          }
        >
          {selected.length === importable.length && importable.length > 0
            ? "Clear selection"
            : "Select all"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-warn-border bg-warn-bg p-3 text-sm text-warn-fg">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        {issues.loading && <RowSkeleton rows={4} />}

        {issues.error && (
          <div className="flex items-center gap-2 p-3">
            <span className="text-sm text-warn-fg">{issues.error}</span>
            <button className="rb-btn-ghost" onClick={issues.reload}>
              Retry
            </button>
          </div>
        )}

        {!issues.loading && !issues.error && rows.length === 0 && (
          <p className="p-4 text-center text-sm text-muted">
            {hiddenClosed > 0 ? `No open issues. ${hiddenClosed} closed one${hiddenClosed === 1 ? " is" : "s are"} hidden.` : "No issues in this repository."}
          </p>
        )}

        {rows.map((issue) => {
          const already = linkedIssues.includes(issue.number);
          const checked = selected.includes(issue.number);
          return (
            <label
              key={issue.number}
              className={`flex items-center gap-2.5 border-b border-border p-2.5 last:border-b-0 ${
                already ? "opacity-50" : "cursor-pointer hover:bg-hover"
              }`}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-ink"
                disabled={already}
                checked={checked}
                onChange={(event) =>
                  setSelected((prev) =>
                    event.target.checked
                      ? [...prev, issue.number]
                      : prev.filter((n) => n !== issue.number),
                  )
                }
              />
              <span className="font-mono text-xs text-muted">
                #{issue.number}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {issue.title}
              </span>
              {issue.labels.slice(0, 3).map((label) => (
                <span key={label} className="rb-pill">
                  {label}
                </span>
              ))}
              <span className={issue.state === "open" ? "rb-pill-ok" : "rb-pill"}>
                {already ? "on board" : issue.state}
              </span>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
