"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardTask } from "@/lib/board-service";
import type {
  BranchSummary,
  IssueSummary,
  PullRequestSummary,
} from "@/lib/github/client";

interface ActivityEvent {
  id: string;
  type: string;
  message: string;
  taskId: string | null;
  createdAt: number;
}

export function CardDetailPanel({
  task,
  columns,
  markdownPath,
  onClose,
  onChange,
  onDelete,
}: {
  task: BoardTask;
  columns: { id: string; name: string }[];
  markdownPath: string | null;
  onClose: () => void;
  onChange: (task: BoardTask) => void;
  onDelete: (taskId: string) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(task);
  const [saving, setSaving] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [pulls, setPulls] = useState<PullRequestSummary[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);

  const status = columns.find((c) => c.id === draft.columnId)?.name ?? "";

  useEffect(() => {
    setDraft(task);
  }, [task]);

  useEffect(() => {
    (async () => {
      const [activityRes, branchRes, pullRes, issueRes] = await Promise.all([
        fetch("/api/activity?limit=100").then((r) => r.json()).catch(() => null),
        fetch("/api/github?resource=branches").then((r) => r.json()).catch(() => null),
        fetch("/api/github?resource=pulls").then((r) => r.json()).catch(() => null),
        fetch("/api/github?resource=issues").then((r) => r.json()).catch(() => null),
      ]);
      setActivity(
        (activityRes?.events ?? []).filter(
          (e: ActivityEvent) => !e.taskId || e.taskId === task.id,
        ),
      );
      setBranches(branchRes?.branches ?? []);
      setPulls(pullRes?.pulls ?? []);
      setIssues(issueRes?.issues ?? []);
    })();
  }, [task.id]);

  const save = async (patch: Partial<BoardTask>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaving(true);
    await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update",
        taskId: task.id,
        title: next.title,
        description: next.description,
        assignee: next.assignee,
        dueDate: next.dueDate,
        checklist: next.checklist,
        labels: next.labels,
      }),
    });
    setSaving(false);
    onChange(next);
  };

  const link = async (payload: Record<string, unknown>) => {
    await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "link", taskId: task.id, ...payload }),
    });
    router.refresh();
  };

  const remove = async () => {
    await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", taskId: task.id }),
    });
    onDelete(task.id);
  };

  const linkedBranch = branches.find((b) => draft.branches.includes(b.name));
  const linkedPr = pulls.find((p) => draft.pullRequests.includes(p.number));

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[860px] border-l border-border bg-surface shadow-xl">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rb-pill">{status}</span>
          {draft.labels.map((label) => (
            <span key={label} className="rb-pill">
              {label}
            </span>
          ))}
          {draft.pullRequests.map((pr) => (
            <span key={pr} className="rb-pill">
              #{pr}
            </span>
          ))}
          <div className="flex-1" />
          <button className="rb-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <input
          className="w-full bg-transparent text-[20px] font-semibold text-ink outline-none"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          onBlur={() => save({ title: draft.title })}
        />

        <textarea
          className="rb-input min-h-[80px] resize-y text-[13px] text-muted"
          placeholder="Description"
          value={draft.description ?? ""}
          onChange={(event) =>
            setDraft({ ...draft, description: event.target.value })
          }
          onBlur={() => save({ description: draft.description })}
        />

        <div className="flex flex-wrap gap-2">
          <input
            className="rb-input max-w-[200px]"
            placeholder="Assignee"
            value={draft.assignee ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, assignee: event.target.value })
            }
            onBlur={() => save({ assignee: draft.assignee })}
          />
          <input
            type="date"
            className="rb-input max-w-[170px]"
            value={
              draft.dueDate
                ? new Date(draft.dueDate).toISOString().slice(0, 10)
                : ""
            }
            onChange={(event) => {
              const value = event.target.value
                ? new Date(event.target.value).getTime()
                : null;
              save({ dueDate: value });
            }}
          />
          <input
            className="rb-input max-w-[240px]"
            placeholder="labels, comma separated"
            value={draft.labels.join(", ")}
            onChange={(event) =>
              setDraft({
                ...draft,
                labels: event.target.value
                  .split(",")
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            onBlur={() => save({ labels: draft.labels })}
          />
        </div>

        <span className="text-[13px] font-semibold text-ink">Checklist</span>
        <div className="flex flex-col gap-1">
          {draft.checklist.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) =>
                  save({
                    checklist: draft.checklist.map((c) =>
                      c.id === item.id
                        ? { ...c, done: event.target.checked }
                        : c,
                    ),
                  })
                }
              />
              <span className={item.done ? "text-muted line-through" : "text-ink"}>
                {item.text}
              </span>
            </label>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const input = (event.target as HTMLFormElement).elements.namedItem(
                "item",
              ) as HTMLInputElement;
              if (!input.value.trim()) return;
              save({
                checklist: [
                  ...draft.checklist,
                  {
                    id: crypto.randomUUID(),
                    text: input.value.trim(),
                    done: false,
                  },
                ],
              });
              input.value = "";
            }}
          >
            <input
              name="item"
              className="rb-input"
              placeholder="Add checklist item"
            />
          </form>
        </div>

        <span className="text-[13px] font-semibold text-ink">
          Linked development
        </span>

        {linkedBranch && (
          <div className="flex flex-col gap-[5px] rounded-lg bg-pill p-3">
            <span className="text-[12px] font-semibold text-ink">
              ⑂ {linkedBranch.name}
            </span>
            <span className="text-[11px] text-muted">
              {linkedBranch.ahead} commits ahead of main
              {linkedPr ? ` · PR #${linkedPr.number} ${linkedPr.state}` : ""}
              {linkedPr?.checks
                ? ` · checks ${linkedPr.checks.passed}/${linkedPr.checks.total}`
                : ""}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <select
            className="rb-input max-w-[240px]"
            defaultValue=""
            onChange={(event) =>
              event.target.value && link({ branch: event.target.value })
            }
          >
            <option value="">Link branch…</option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>

          <select
            className="rb-input max-w-[240px]"
            defaultValue=""
            onChange={(event) =>
              event.target.value &&
              link({ pullRequest: Number(event.target.value) })
            }
          >
            <option value="">Link pull request…</option>
            {pulls.map((pr) => (
              <option key={pr.number} value={pr.number}>
                #{pr.number} {pr.title}
              </option>
            ))}
          </select>

          <select
            className="rb-input max-w-[240px]"
            defaultValue=""
            onChange={(event) =>
              event.target.value && link({ issue: Number(event.target.value) })
            }
          >
            <option value="">Link issue…</option>
            {issues.map((issue) => (
              <option key={issue.number} value={issue.number}>
                #{issue.number} {issue.title}
              </option>
            ))}
          </select>
        </div>

        {draft.markdownTaskId && markdownPath && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="rb-pill">{markdownPath}</span>
            <span>rb:{draft.markdownTaskId}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button className="rb-btn" onClick={remove}>
            Delete card
          </button>
          {saving && <span className="text-[11px] text-muted">Saving…</span>}
        </div>
      </div>

      <aside className="flex w-[370px] shrink-0 flex-col gap-[9px] overflow-y-auto border-l border-border p-4">
        <span className="text-[14px] font-semibold text-ink">Activity</span>
        {activity.length === 0 && (
          <span className="text-[12px] text-muted">No events yet</span>
        )}
        {activity.map((event) => (
          <div key={event.id} className="border-t border-border p-2">
            <p className="text-[12px] font-medium text-ink">{event.message}</p>
            <p className="text-[11px] text-muted">
              {new Date(event.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
      </aside>
    </div>
  );
}
