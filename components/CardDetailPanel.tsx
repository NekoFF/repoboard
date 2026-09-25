"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardTask } from "@/lib/board-service";
import { api, useResource } from "@/lib/client/api";
import { RelativeTime, Skeleton, Spinner, useToast } from "@/components/ui";

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {title}
        </h3>
        <div className="h-px flex-1 bg-border" />
        {action}
      </div>
      {children}
    </section>
  );
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
  const toast = useToast();
  const [draft, setDraft] = useState(task);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(task), [task]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status = columns.find((c) => c.id === draft.columnId)?.name ?? "";

  const branch = draft.branches[0] ?? null;
  const activity = useResource(() => api.activity(120), [task.id]);
  const branches = useResource(api.branches, []);
  const pulls = useResource(api.pulls, []);
  const issues = useResource(api.issues, []);
  // Commits for the linked branch — the card's real development history.
  const commits = useResource(
    () => api.commits(branch ?? undefined),
    [branch],
    { enabled: Boolean(branch) },
  );

  const branchInfo = branches.data?.branches.find((b) => b.name === branch);
  const linkedPulls = (pulls.data?.pulls ?? []).filter((pr) =>
    draft.pullRequests.includes(pr.number),
  );
  const linkedIssues = (issues.data?.issues ?? []).filter((issue) =>
    draft.issues.includes(issue.number),
  );

  const cardEvents = useMemo(
    () =>
      (activity.data?.events ?? []).filter(
        (event) => event.taskId === task.id || event.taskId === null,
      ),
    [activity.data, task.id],
  );

  const save = async (patch: Partial<BoardTask>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaving(true);
    try {
      await api.boardAction({
        action: "update",
        taskId: task.id,
        title: next.title,
        description: next.description,
        assignee: next.assignee,
        dueDate: next.dueDate,
        checklist: next.checklist,
        labels: next.labels,
      });
      onChange(next);
    } catch (error) {
      toast.push({
        kind: "error",
        message: "Could not save",
        detail: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  const link = async (payload: Record<string, unknown>, label: string) => {
    try {
      await api.boardAction({ action: "link", taskId: task.id, ...payload });
      const next = { ...draft };
      if (payload.branch) next.branches = [...next.branches, payload.branch as string];
      if (payload.pullRequest)
        next.pullRequests = [...next.pullRequests, payload.pullRequest as number];
      if (payload.issue)
        next.issues = [...next.issues, payload.issue as number];
      setDraft(next);
      onChange(next);
      toast.push({ kind: "success", message: `Linked ${label}` });
      router.refresh();
    } catch (error) {
      toast.push({
        kind: "error",
        message: "Could not link",
        detail: (error as Error).message,
      });
    }
  };

  const unlink = async (payload: Record<string, unknown>, label: string) => {
    await api.boardAction({ action: "unlink", taskId: task.id, ...payload });
    const next = { ...draft };
    if (payload.branch)
      next.branches = next.branches.filter((b) => b !== payload.branch);
    if (payload.pullRequest)
      next.pullRequests = next.pullRequests.filter(
        (p) => p !== payload.pullRequest,
      );
    if (payload.issue)
      next.issues = next.issues.filter((i) => i !== payload.issue);
    setDraft(next);
    onChange(next);
    toast.push({ kind: "info", message: `Unlinked ${label}` });
    router.refresh();
  };

  const remove = async () => {
    await api.boardAction({ action: "delete", taskId: task.id });
    // Deleting is reversible, so offer the way back instead of asking first.
    toast.push({
      kind: "info",
      message: "Card deleted",
      detail: draft.title,
      action: {
        label: "Undo",
        run: async () => {
          await api.boardAction({ action: "restore", taskId: task.id });
          router.refresh();
        },
      },
    });
    onDelete(task.id);
  };

  const comment = async () => {
    const message = commentDraft.trim();
    if (!message) return;
    setCommentDraft("");
    await api.boardAction({ action: "comment", taskId: task.id, message });
    activity.reload();
  };

  const checklistDone = draft.checklist.filter((c) => c.done).length;

  return (
    <>
      <div
        className="rb-fade-in fixed inset-0 z-30 bg-ink/10"
        onClick={onClose}
      />
      <aside className="rb-panel-in fixed inset-y-0 right-0 z-40 flex w-full max-w-[880px] border-l border-border bg-surface shadow-panel">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/95 px-5 py-3 backdrop-blur">
            <span className="rb-pill">{status}</span>
          {draft.number !== null && (
            <span
              className="font-mono text-[11px] text-muted"
              title="Mention this in a commit message to tie that commit to this card"
            >
              RB-{draft.number}
            </span>
          )}
            {draft.markdownTaskId && markdownPath && (
              <span className="rb-pill" title={`rb:${draft.markdownTaskId}`}>
                {markdownPath}
              </span>
            )}
            <div className="flex-1" />
            {saving && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <Spinner /> Saving
              </span>
            )}
            <button className="rb-btn-ghost" onClick={onClose}>
              Close <span className="rb-kbd ml-1">esc</span>
            </button>
          </div>

          <div className="flex flex-col gap-6 p-5">
            <div className="flex flex-col gap-2">
              <textarea
                ref={titleRef}
                rows={1}
                className="w-full resize-none bg-transparent text-[20px] font-semibold leading-tight text-ink outline-none"
                value={draft.title}
                onChange={(event) => {
                  setDraft({ ...draft, title: event.target.value });
                  event.target.style.height = "auto";
                  event.target.style.height = `${event.target.scrollHeight}px`;
                }}
                onBlur={() => draft.title.trim() && save({ title: draft.title })}
              />

              <textarea
                className="min-h-[60px] w-full resize-y rounded-lg border border-transparent bg-transparent p-2 text-[13px] leading-relaxed text-muted outline-none transition-colors hover:border-border focus:border-border focus:bg-canvas"
                placeholder="Add a description…"
                value={draft.description ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                onBlur={() => save({ description: draft.description })}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">Assignee</span>
                <input
                  className="rb-input py-1.5 text-[12px]"
                  placeholder="unassigned"
                  value={draft.assignee ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, assignee: event.target.value })
                  }
                  onBlur={() => save({ assignee: draft.assignee })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">Due</span>
                <input
                  type="date"
                  className="rb-input py-1.5 text-[12px]"
                  value={
                    draft.dueDate
                      ? new Date(draft.dueDate).toISOString().slice(0, 10)
                      : ""
                  }
                  onChange={(event) =>
                    save({
                      dueDate: event.target.value
                        ? new Date(event.target.value).getTime()
                        : null,
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">Column</span>
                <select
                  className="rb-input py-1.5 text-[12px]"
                  value={draft.columnId}
                  onChange={async (event) => {
                    const columnId = event.target.value;
                    setDraft({ ...draft, columnId });
                    await api.boardAction({
                      action: "move",
                      taskId: task.id,
                      columnId,
                      position: 0,
                    });
                    onChange({ ...draft, columnId });
                    router.refresh();
                  }}
                >
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <Section title="Labels">
              <div className="flex flex-wrap items-center gap-1.5">
                {draft.labels.map((label) => (
                  <button
                    key={label}
                    className="rb-pill group/label hover:bg-warn-bg hover:text-warn-fg"
                    onClick={() =>
                      save({ labels: draft.labels.filter((l) => l !== label) })
                    }
                    title="Remove label"
                  >
                    {label}
                    <span className="opacity-0 transition-opacity group-hover/label:opacity-100">
                      ×
                    </span>
                  </button>
                ))}
                <input
                  className="w-28 rounded-sm bg-pill px-2 py-1 text-[11px] outline-none placeholder:text-muted/70"
                  placeholder="add label"
                  value={labelDraft}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && labelDraft.trim()) {
                      event.preventDefault();
                      save({
                        labels: [
                          ...new Set([...draft.labels, labelDraft.trim()]),
                        ],
                      });
                      setLabelDraft("");
                    }
                  }}
                />
              </div>
            </Section>

            <Section
              title="Checklist"
              action={
                draft.checklist.length > 0 ? (
                  <span className="text-[11px] tabular-nums text-muted">
                    {checklistDone}/{draft.checklist.length}
                  </span>
                ) : null
              }
            >
              <div className="flex flex-col gap-1">
                {draft.checklist.map((item) => (
                  <label
                    key={item.id}
                    className="group/item flex items-center gap-2 rounded-md px-1 py-1 hover:bg-pill"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-ink"
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
                    <span
                      className={`flex-1 text-[12.5px] ${
                        item.done ? "text-muted line-through" : "text-ink"
                      }`}
                    >
                      {item.text}
                    </span>
                    <button
                      className="text-[11px] text-muted opacity-0 transition-opacity hover:text-danger-fg group-hover/item:opacity-100"
                      onClick={(event) => {
                        event.preventDefault();
                        save({
                          checklist: draft.checklist.filter(
                            (c) => c.id !== item.id,
                          ),
                        });
                      }}
                    >
                      remove
                    </button>
                  </label>
                ))}
                <input
                  className="rb-input py-1.5 text-[12.5px]"
                  placeholder="Add an item and press ↵"
                  value={newItem}
                  onChange={(event) => setNewItem(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newItem.trim()) {
                      event.preventDefault();
                      save({
                        checklist: [
                          ...draft.checklist,
                          {
                            id: crypto.randomUUID(),
                            text: newItem.trim(),
                            done: false,
                          },
                        ],
                      });
                      setNewItem("");
                    }
                  }}
                />
              </div>
            </Section>

            <Section title="Linked development">
              <div className="flex flex-col gap-2">
                {branch && (
                  <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-ink">
                        ⑂ {branch}
                      </span>
                      <div className="flex-1" />
                      <button
                        className="rb-btn-ghost"
                        onClick={() => unlink({ branch }, branch)}
                      >
                        Unlink
                      </button>
                    </div>
                    {branches.loading ? (
                      <Skeleton className="h-3 w-48" />
                    ) : branchInfo ? (
                      <p className="text-[11.5px] text-muted">
                        {branchInfo.ahead} ahead · {branchInfo.behind} behind ·
                        last commit{" "}
                        <span className="font-mono">
                          {branchInfo.lastCommit.sha.slice(0, 7)}
                        </span>{" "}
                        <RelativeTime value={branchInfo.lastCommit.date} />
                      </p>
                    ) : (
                      <p className="text-[11.5px] text-muted">
                        Branch not found on GitHub anymore.
                      </p>
                    )}

                    {commits.loading && <Skeleton className="h-12 w-full" />}
                    {commits.data && (
                      <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                        {commits.data.commits.slice(0, 5).map((commit) => (
                          <div
                            key={commit.sha}
                            className="flex items-center gap-2 px-2.5 py-1.5"
                          >
                            <span className="font-mono text-[11px] text-muted">
                              {commit.sha.slice(0, 7)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                              {commit.message}
                            </span>
                            <RelativeTime
                              value={commit.date}
                              className="shrink-0 text-[11px] text-muted"
                            />
                          </div>
                        ))}
                        {commits.data.commits.length === 0 && (
                          <p className="px-2.5 py-2 text-[11.5px] text-muted">
                            No commits on this branch yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {linkedPulls.map((pr) => (
                  <div
                    key={pr.number}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
                  >
                    <span className="rb-pill">PR #{pr.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {pr.title}
                    </span>
                    {pr.draft && <span className="rb-pill">draft</span>}
                    <span className="rb-pill">{pr.state}</span>
                    {pr.checks && (
                      <span
                        className={
                          pr.checks.passed === pr.checks.total
                            ? "rb-pill-ok"
                            : "rb-pill-warn"
                        }
                      >
                        checks {pr.checks.passed}/{pr.checks.total}
                      </span>
                    )}
                    <button
                      className="rb-btn-ghost"
                      onClick={() =>
                        unlink({ pullRequest: pr.number }, `PR #${pr.number}`)
                      }
                    >
                      Unlink
                    </button>
                  </div>
                ))}

                {linkedIssues.map((issue) => (
                  <div
                    key={issue.number}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
                  >
                    <span className="rb-pill">issue #{issue.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {issue.title}
                    </span>
                    <span className="rb-pill">{issue.state}</span>
                    <button
                      className="rb-btn-ghost"
                      onClick={() =>
                        unlink(
                          { issue: issue.number },
                          `issue #${issue.number}`,
                        )
                      }
                    >
                      Unlink
                    </button>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <select
                    className="rb-input max-w-[220px] py-1.5 text-[12px]"
                    value=""
                    onChange={(event) =>
                      event.target.value &&
                      link({ branch: event.target.value }, event.target.value)
                    }
                  >
                    <option value="">
                      {branches.loading ? "Loading branches…" : "Link a branch…"}
                    </option>
                    {(branches.data?.branches ?? [])
                      .filter((b) => !draft.branches.includes(b.name))
                      .map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                  </select>

                  <select
                    className="rb-input max-w-[220px] py-1.5 text-[12px]"
                    value=""
                    onChange={(event) =>
                      event.target.value &&
                      link(
                        { pullRequest: Number(event.target.value) },
                        `PR #${event.target.value}`,
                      )
                    }
                  >
                    <option value="">
                      {pulls.data?.pulls.length === 0
                        ? "No pull requests"
                        : "Link a pull request…"}
                    </option>
                    {(pulls.data?.pulls ?? [])
                      .filter((pr) => !draft.pullRequests.includes(pr.number))
                      .map((pr) => (
                        <option key={pr.number} value={pr.number}>
                          #{pr.number} {pr.title}
                        </option>
                      ))}
                  </select>

                  <select
                    className="rb-input max-w-[220px] py-1.5 text-[12px]"
                    value=""
                    onChange={(event) =>
                      event.target.value &&
                      link(
                        { issue: Number(event.target.value) },
                        `issue #${event.target.value}`,
                      )
                    }
                  >
                    <option value="">
                      {issues.data?.issues.length === 0
                        ? "No issues"
                        : "Link an issue…"}
                    </option>
                    {(issues.data?.issues ?? [])
                      .filter((issue) => !draft.issues.includes(issue.number))
                      .map((issue) => (
                        <option key={issue.number} value={issue.number}>
                          #{issue.number} {issue.title}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </Section>

            <div className="flex items-center gap-2 border-t border-border pt-4">
              <button
                className="rb-btn-ghost hover:text-danger-fg"
                onClick={remove}
              >
                Delete card
              </button>
            </div>
          </div>
        </div>

        <aside className="flex w-[320px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-canvas/40 p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Activity
          </h3>

          <textarea
            rows={2}
            className="rb-input resize-none text-[12px]"
            placeholder="Leave a note…  (⌘↵ to post)"
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                comment();
              }
            }}
          />
          {activity.loading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {!activity.loading && cardEvents.length === 0 && (
            <p className="text-[12px] text-muted">Nothing recorded yet.</p>
          )}
          {cardEvents.map((event) => (
            <div key={event.id} className="rounded-lg px-1 py-1.5">
              <p className="text-[12px] leading-snug text-ink">
                {event.message}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span className="rb-pill px-1.5 py-0.5 text-[10px]">
                  {event.type.replace(/_/g, " ")}
                </span>
                <RelativeTime value={event.createdAt} />
              </p>
            </div>
          ))}
        </aside>
      </aside>
    </>
  );
}
