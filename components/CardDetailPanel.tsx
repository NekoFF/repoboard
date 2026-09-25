"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CircleDot,
  Copy,
  ExternalLink,
  FileText,
  Flag,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Link2,
  MoreHorizontal,
  Plus,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { BoardData, BoardTask } from "@/lib/board-service";
import { api, useResource } from "@/lib/client/api";
import { Markdown } from "@/components/Markdown";
import { Avatar, LabelChip } from "@/components/TaskCard";
import { displayLabel, labelColor } from "@/components/labelColor";
import {
  DueLabel,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  PriorityIcon,
  ProgressRing,
  PropertyRow,
  RelativeTime,
  Sheet,
  Skeleton,
  Spinner,
  StatusIcon,
  Tooltip,
  useToast,
} from "@/components/ui";
import { PRIORITY_LABEL, statusOfColumn } from "@/lib/status";
import { useHotkeys } from "@/lib/client/hotkeys";

function Section({ title, count, action, children }: { title: string; count?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-7 items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {count !== undefined && <span className="text-xs tabular-nums text-faint">{count}</span>}
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

function toDateInput(value: number | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function CardDetailPanel({
  task,
  data,
  connected,
  onClose,
  onChange,
  onMove,
  onDelete,
  onNavigate,
}: {
  task: BoardTask;
  data: BoardData;
  connected: boolean;
  onClose: () => void;
  onChange: (task: BoardTask) => void;
  onMove: (task: BoardTask, columnId: string) => Promise<void>;
  onDelete: (taskId: string) => void;
  onNavigate: (direction: 1 | -1) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(task);
  const [saving, setSaving] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [assigneeDraft, setAssigneeDraft] = useState(task.assignee ?? "");
  const [milestoneDraft, setMilestoneDraft] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(task), [task]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.title]);

  const column = data.columns.find((c) => c.id === draft.columnId);
  const status = statusOfColumn(column?.name);
  const branch = draft.branches[0] ?? null;
  const milestone = data.milestones.find((m) => m.id === draft.milestoneId) ?? null;

  const activity = useResource(() => api.activity(200), [task.id]);
  const branches = useResource(api.branches, [], { enabled: connected });
  const pulls = useResource(api.pulls, [], { enabled: connected });
  const issues = useResource(api.issues, [], { enabled: connected });
  const refs = useResource(api.refs, [], { enabled: connected && draft.number != null });
  const commits = useResource(() => api.commits(branch ?? undefined), [branch], {
    enabled: Boolean(branch) && connected,
  });

  const branchInfo = branches.data?.branches.find((b) => b.name === branch);
  const linkedPulls = (pulls.data?.pulls ?? []).filter((pr) => draft.pullRequests.includes(pr.number));
  const linkedIssues = (issues.data?.issues ?? []).filter((issue) => draft.issues.includes(issue.number));
  const mentions = (refs.data?.refs ?? []).filter((r) => r.card === draft.number);
  const cardEvents = useMemo(
    () => (activity.data?.events ?? []).filter((event) => event.taskId === task.id),
    [activity.data, task.id],
  );

  const allLabels = useMemo(
    () => Array.from(new Set(data.tasks.flatMap((t) => t.labels))).sort(),
    [data.tasks],
  );
  const allAssignees = useMemo(
    () => Array.from(new Set(data.tasks.map((t) => t.assignee).filter(Boolean) as string[])).sort(),
    [data.tasks],
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
        priority: next.priority,
        milestoneId: next.milestoneId,
      });
      onChange(next);
      router.refresh();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not save", detail: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const link = async (payload: Record<string, unknown>, label: string) => {
    try {
      await api.boardAction({ action: "link", taskId: task.id, ...payload });
      const next = { ...draft };
      if (payload.branch) next.branches = [...next.branches, payload.branch as string];
      if (payload.pullRequest) next.pullRequests = [...next.pullRequests, payload.pullRequest as number];
      if (payload.issue) next.issues = [...next.issues, payload.issue as number];
      setDraft(next);
      onChange(next);
      toast.push({ kind: "success", message: `Linked ${label}` });
      router.refresh();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not link", detail: (error as Error).message });
    }
  };

  const unlink = async (payload: Record<string, unknown>, label: string) => {
    await api.boardAction({ action: "unlink", taskId: task.id, ...payload });
    const next = { ...draft };
    if (payload.branch) next.branches = next.branches.filter((b) => b !== payload.branch);
    if (payload.pullRequest) next.pullRequests = next.pullRequests.filter((p) => p !== payload.pullRequest);
    if (payload.issue) next.issues = next.issues.filter((i) => i !== payload.issue);
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

  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toast.push({ kind: "success", message: `Copied ${what}` }),
      () => toast.push({ kind: "error", message: "Could not copy" }),
    );
  };

  const createMilestone = async () => {
    const name = milestoneDraft.trim();
    if (!name) return;
    setMilestoneDraft("");
    try {
      const { id } = (await api.boardAction({ action: "milestone-create", name })) as { id: string };
      await save({ milestoneId: id });
    } catch (error) {
      toast.push({ kind: "error", message: "Could not create the milestone", detail: (error as Error).message });
    }
  };

  useHotkeys(
    {
      "mod+ArrowDown": () => onNavigate(1),
      "mod+ArrowUp": () => onNavigate(-1),
    },
    { allowInOverlay: true },
  );

  const checklistDone = draft.checklist.filter((c) => c.done).length;
  const ref = draft.number != null ? `RB-${draft.number}` : null;
  const sourcePath = draft.markdownTaskId ? data.markdownSource?.path : null;

  const properties = (
    <>
          <PropertyRow label="Status">
            <Menu
              trigger={
                <button className="rb-chip">
                  <StatusIcon status={status} /> {column?.name}
                </button>
              }
            >
              {data.columns.map((c, index) => (
                <MenuItem
                  key={c.id}
                  icon={<StatusIcon status={statusOfColumn(c.name)} />}
                  checked={c.id === draft.columnId}
                  shortcut={String(index + 1)}
                  onSelect={() => {
                    setDraft({ ...draft, columnId: c.id });
                    void onMove(draft, c.id);
                  }}
                >
                  {c.name}
                </MenuItem>
              ))}
            </Menu>
          </PropertyRow>

          <PropertyRow label="Priority">
            <Menu
              trigger={
                <button className="rb-chip">
                  <PriorityIcon priority={draft.priority} /> {PRIORITY_LABEL[draft.priority]}
                </button>
              }
            >
              {[1, 2, 3, 4, 0].map((p) => (
                <MenuItem key={p} icon={<PriorityIcon priority={p} />} checked={draft.priority === p} onSelect={() => save({ priority: p })}>
                  {PRIORITY_LABEL[p]}
                </MenuItem>
              ))}
            </Menu>
          </PropertyRow>

          <PropertyRow label="Assignee">
            <Popover
              trigger={
                <button className="rb-chip">
                  {draft.assignee ? <Avatar name={draft.assignee} size={16} /> : <User className="size-3.5 text-faint" />}
                  <span className={draft.assignee ? "" : "text-faint"}>{draft.assignee ?? "Nobody"}</span>
                </button>
              }
              className="w-[220px]"
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({ assignee: assigneeDraft.trim().replace(/^@/, "") || null });
                }}
              >
                <input
                  autoFocus
                  className="rb-input"
                  placeholder="GitHub username"
                  value={assigneeDraft}
                  onChange={(event) => setAssigneeDraft(event.target.value)}
                />
              </form>
              <div className="mt-1 flex flex-col">
                {allAssignees
                  .filter((a) => a !== draft.assignee && a.toLowerCase().includes(assigneeDraft.toLowerCase()))
                  .map((a) => (
                    <button key={a} className="rb-menu-item" onClick={() => save({ assignee: a })}>
                      <Avatar name={a} size={16} /> {a}
                    </button>
                  ))}
                {draft.assignee && (
                  <button className="rb-menu-item text-muted" onClick={() => { setAssigneeDraft(""); void save({ assignee: null }); }}>
                    <X className="size-3.5" /> Unassign
                  </button>
                )}
              </div>
            </Popover>
          </PropertyRow>

          <PropertyRow label="Due date">
            <label className="rb-chip relative cursor-pointer">
              <CalendarDays className="size-3.5 text-faint" />
              {draft.dueDate ? <DueLabel value={draft.dueDate} /> : <span className="text-faint">No date</span>}
              <input
                type="date"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={toDateInput(draft.dueDate)}
                onChange={(event) =>
                  save({ dueDate: event.target.value ? Date.parse(`${event.target.value}T00:00:00Z`) : null })
                }
              />
            </label>
            {draft.dueDate && (
              <button className="rb-icon-btn size-6" aria-label="Clear due date" onClick={() => save({ dueDate: null })}>
                <X className="size-3.5" />
              </button>
            )}
          </PropertyRow>

          <PropertyRow label="Milestone">
            <Popover
              trigger={
                <button className="rb-chip">
                  <Flag className="size-3.5 text-faint" />
                  <span className={`truncate ${milestone ? "" : "text-faint"}`}>{milestone?.name ?? "None"}</span>
                </button>
              }
              className="w-[240px]"
            >
              <div className="flex flex-col">
                {data.milestones.map((m) => (
                  <button key={m.id} className="rb-menu-item" onClick={() => save({ milestoneId: m.id })}>
                    <Flag className="size-3.5 text-muted" />
                    <span className="flex-1 truncate text-left">{m.name}</span>
                    {m.id === draft.milestoneId && <Check className="size-3.5" />}
                  </button>
                ))}
                {draft.milestoneId && (
                  <button className="rb-menu-item text-muted" onClick={() => save({ milestoneId: null })}>
                    <X className="size-3.5" /> Remove from milestone
                  </button>
                )}
                <form
                  className="mt-1 border-t border-border pt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createMilestone();
                  }}
                >
                  <input
                    className="rb-input"
                    placeholder="New milestone, e.g. Public beta"
                    value={milestoneDraft}
                    onChange={(event) => setMilestoneDraft(event.target.value)}
                  />
                </form>
              </div>
            </Popover>
          </PropertyRow>

          <PropertyRow label="Labels">
            {draft.labels.map((label) => (
              <button
                key={label}
                className="group/label"
                title={`Remove ${label}`}
                onClick={() => save({ labels: draft.labels.filter((l) => l !== label) })}
              >
                <LabelChip label={label} />
              </button>
            ))}
            <Popover
              trigger={
                <button className="rb-icon-btn size-6" aria-label="Add label">
                  <Tag className="size-3.5" />
                </button>
              }
              className="w-[220px]"
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = labelDraft.trim();
                  if (!value) return;
                  void save({ labels: [...new Set([...draft.labels, value])] });
                  setLabelDraft("");
                }}
              >
                <input
                  autoFocus
                  className="rb-input"
                  placeholder="Label name"
                  value={labelDraft}
                  onChange={(event) => setLabelDraft(event.target.value)}
                />
              </form>
              <div className="mt-1 flex max-h-56 flex-col overflow-y-auto">
                {allLabels
                  .filter((l) => l.toLowerCase().includes(labelDraft.toLowerCase()))
                  .map((label) => {
                    const on = draft.labels.includes(label);
                    return (
                      <button
                        key={label}
                        className="rb-menu-item"
                        onClick={() =>
                          save({ labels: on ? draft.labels.filter((l) => l !== label) : [...draft.labels, label] })
                        }
                      >
                        <span className="size-2 rounded-full" style={{ backgroundColor: labelColor(label) }} />
                        <span className="flex-1 truncate text-left">{displayLabel(label)}</span>
                        {on && <Check className="size-3.5" />}
                      </button>
                    );
                  })}
              </div>
            </Popover>
          </PropertyRow>

          {draft.checklist.length > 0 && (
            <PropertyRow label="Checklist">
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <ProgressRing done={checklistDone} total={draft.checklist.length} /> {checklistDone} of {draft.checklist.length}
              </span>
            </PropertyRow>
          )}

          {sourcePath && (
            <PropertyRow label="Source">
              <Link href={`/docs?path=${encodeURIComponent(sourcePath)}`} className="rb-chip max-w-full">
                <FileText className="size-3.5 text-faint" />
                <span className="truncate font-mono text-2xs">{sourcePath}</span>
              </Link>
            </PropertyRow>
          )}

          <div className="mt-4 border-t border-border pt-3 text-2xs leading-relaxed text-faint">
            Updated <RelativeTime value={draft.updatedAt} />
          </div>
    </>
  );

  return (
    <Sheet label={`Card ${ref ?? ""} ${draft.title}`} onClose={onClose} width={860}>
      {/* ------------------------------------------------------ header -- */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
        <StatusIcon status={status} />
        <span className="ml-1.5 text-sm text-muted">{column?.name}</span>
        {ref && (
          <Tooltip content="Copy — write it in a commit message to link that commit">
            <button className="rb-btn-ghost ml-1 font-mono text-xs" onClick={() => copy(ref, ref)}>
              {ref}
            </button>
          </Tooltip>
        )}
        {saving && (
          <span className="ml-2 flex items-center gap-1.5 text-xs text-faint">
            <Spinner /> Saving
          </span>
        )}
        <div className="flex-1" />
        <Tooltip content="Previous card" shortcut="⌘↑">
          <button className="rb-icon-btn" onClick={() => onNavigate(-1)} aria-label="Previous card">
            <ArrowUp className="size-4" />
          </button>
        </Tooltip>
        <Tooltip content="Next card" shortcut="⌘↓">
          <button className="rb-icon-btn" onClick={() => onNavigate(1)} aria-label="Next card">
            <ArrowDown className="size-4" />
          </button>
        </Tooltip>
        <Menu
          align="end"
          trigger={
            <button className="rb-icon-btn" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </button>
          }
        >
          {ref && (
            <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => copy(ref, ref)}>
              Copy reference
            </MenuItem>
          )}
          <MenuItem
            icon={<Link2 className="size-3.5" />}
            onSelect={() => copy(`${window.location.origin}/board?card=${task.id}`, "link")}
          >
            Copy link
          </MenuItem>
          <MenuItem
            icon={<GitBranch className="size-3.5" />}
            onSelect={() =>
              copy(
                `${ref ? `${ref.toLowerCase()}-` : ""}${draft.title
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 48)}`,
                "branch name",
              )
            }
          >
            Copy branch name
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 className="size-3.5" />} onSelect={remove}>
            Delete card
          </MenuItem>
        </Menu>
        <button className="rb-icon-btn" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ------------------------------------------------------- main -- */}
        <div className="rb-scroll-thin min-w-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-7 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-2">
              <textarea
                ref={titleRef}
                rows={1}
                aria-label="Title"
                className="w-full resize-none bg-transparent text-xl font-semibold tracking-[-0.015em] text-ink outline-none"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    (event.target as HTMLTextAreaElement).blur();
                  }
                }}
                onBlur={() => draft.title.trim() && draft.title !== task.title && save({ title: draft.title.trim() })}
              />

              {editingDescription ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    autoFocus
                    className="rb-input min-h-[160px] resize-y font-mono text-sm leading-relaxed"
                    placeholder="Markdown works here. Mention RB-12 or [[docs/PLAN.md]] to link things."
                    value={draft.description ?? ""}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        setEditingDescription(false);
                        void save({ description: draft.description?.trim() || null });
                      }
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setDraft({ ...draft, description: task.description });
                        setEditingDescription(false);
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      className="rb-btn-primary rb-btn-sm"
                      onClick={() => {
                        setEditingDescription(false);
                        void save({ description: draft.description?.trim() || null });
                      }}
                    >
                      Save
                    </button>
                    <button
                      className="rb-btn-ghost"
                      onClick={() => {
                        setDraft({ ...draft, description: task.description });
                        setEditingDescription(false);
                      }}
                    >
                      Cancel
                    </button>
                    <span className="ml-auto text-2xs text-faint">⌘↵ to save</span>
                  </div>
                </div>
              ) : draft.description ? (
                <div
                  className="-mx-2 cursor-text rounded-md px-2 py-1 transition-colors hover:bg-hover"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a")) return;
                    setEditingDescription(true);
                  }}
                >
                  <Markdown content={draft.description} />
                </div>
              ) : (
                <button
                  className="-mx-2 rounded-md px-2 py-1.5 text-left text-sm text-faint transition-colors hover:bg-hover hover:text-muted"
                  onClick={() => setEditingDescription(true)}
                >
                  Add a description…
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1 rounded-lg border border-border p-3 md:hidden">{properties}</div>

            {/* checklist */}
            <Section
              title="Checklist"
              count={draft.checklist.length ? `${checklistDone}/${draft.checklist.length}` : undefined}
            >
              <div className="flex flex-col">
                {draft.checklist.map((item) => (
                  <div key={item.id} className="group/item -mx-1.5 flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-hover">
                    <button
                      className="grid size-5 place-items-center"
                      aria-label={item.done ? "Mark as not done" : "Mark as done"}
                      onClick={() =>
                        save({
                          checklist: draft.checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)),
                        })
                      }
                    >
                      <StatusIcon status={item.done ? "done" : "todo"} />
                    </button>
                    <span className={`min-w-0 flex-1 truncate text-sm ${item.done ? "text-muted line-through decoration-faint" : "text-ink"}`}>
                      {item.text}
                    </span>
                    <button
                      className="rb-icon-btn size-6 opacity-0 group-hover/item:opacity-100"
                      aria-label="Remove item"
                      onClick={() => save({ checklist: draft.checklist.filter((c) => c.id !== item.id) })}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="-mx-1.5 flex h-8 items-center gap-2 px-1.5">
                  <Plus className="size-4 text-faint" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                    placeholder="Add an item and press Enter"
                    aria-label="Add checklist item"
                    value={newItem}
                    onChange={(event) => setNewItem(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && newItem.trim()) {
                        event.preventDefault();
                        void save({
                          checklist: [...draft.checklist, { id: crypto.randomUUID(), text: newItem.trim(), done: false }],
                        });
                        setNewItem("");
                      }
                    }}
                  />
                </div>
              </div>
            </Section>

            {/* development */}
            <Section
              title="Development"
              action={
                <Menu
                  align="end"
                  width={300}
                  trigger={
                    <button className="rb-btn-ghost" disabled={!connected}>
                      <Plus className="size-3.5" /> Link
                    </button>
                  }
                >
                  <MenuLabel>Branches</MenuLabel>
                  {(branches.data?.branches ?? [])
                    .filter((b) => !draft.branches.includes(b.name))
                    .slice(0, 12)
                    .map((b) => (
                      <MenuItem key={b.name} icon={<GitBranch className="size-3.5" />} onSelect={() => link({ branch: b.name }, b.name)}>
                        <span className="font-mono text-xs">{b.name}</span>
                      </MenuItem>
                    ))}
                  <MenuLabel>Pull requests</MenuLabel>
                  {(pulls.data?.pulls ?? [])
                    .filter((pr) => !draft.pullRequests.includes(pr.number))
                    .slice(0, 12)
                    .map((pr) => (
                      <MenuItem key={pr.number} icon={<GitPullRequest className="size-3.5" />} onSelect={() => link({ pullRequest: pr.number }, `PR #${pr.number}`)}>
                        #{pr.number} {pr.title}
                      </MenuItem>
                    ))}
                  <MenuLabel>Issues</MenuLabel>
                  {(issues.data?.issues ?? [])
                    .filter((i) => !draft.issues.includes(i.number))
                    .slice(0, 12)
                    .map((issue) => (
                      <MenuItem key={issue.number} icon={<CircleDot className="size-3.5" />} onSelect={() => link({ issue: issue.number }, `issue #${issue.number}`)}>
                        #{issue.number} {issue.title}
                      </MenuItem>
                    ))}
                  {(branches.loading || pulls.loading || issues.loading) && (
                    <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
                      <Spinner /> Loading from GitHub
                    </p>
                  )}
                </Menu>
              }
            >
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {branch && (
                  <div className="flex flex-col gap-1.5 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <GitBranch className="size-3.5 text-muted" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-ink">{branch}</span>
                      {branchInfo && (
                        <span className="text-2xs tabular-nums text-faint">
                          {branchInfo.ahead} ahead · {branchInfo.behind} behind
                        </span>
                      )}
                      <button className="rb-icon-btn size-6" aria-label="Unlink branch" onClick={() => unlink({ branch }, branch)}>
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {commits.loading && <Skeleton className="h-8 w-full" />}
                    {commits.data?.commits.slice(0, 4).map((commit) => (
                      <div key={commit.sha} className="flex items-center gap-2 pl-5 text-xs">
                        <span className="font-mono text-faint">{commit.sha.slice(0, 7)}</span>
                        <span className="min-w-0 flex-1 truncate text-muted">{commit.message}</span>
                        <RelativeTime value={commit.date} className="shrink-0 text-faint" />
                      </div>
                    ))}
                  </div>
                )}
                {linkedPulls.map((pr) => (
                  <div key={pr.number} className="flex items-center gap-2 px-3 py-2.5">
                    <GitPullRequest className={`size-3.5 ${pr.mergeableState === "merged" ? "text-state-review" : pr.state === "open" ? "text-state-done" : "text-muted"}`} />
                    <span className="font-mono text-xs text-faint">#{pr.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{pr.title}</span>
                    {pr.checks && (
                      <span className={pr.checks.passed === pr.checks.total ? "rb-pill-ok" : "rb-pill-warn"}>
                        checks {pr.checks.passed}/{pr.checks.total}
                      </span>
                    )}
                    <span className="rb-pill">{pr.mergeableState ?? pr.state}</span>
                    <button className="rb-icon-btn size-6" aria-label="Unlink pull request" onClick={() => unlink({ pullRequest: pr.number }, `PR #${pr.number}`)}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {linkedIssues.map((issue) => (
                  <div key={issue.number} className="flex items-center gap-2 px-3 py-2.5">
                    <CircleDot className={`size-3.5 ${issue.state === "open" ? "text-state-done" : "text-state-review"}`} />
                    <span className="font-mono text-xs text-faint">#{issue.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{issue.title}</span>
                    <span className="rb-pill">{issue.state}</span>
                    <button className="rb-icon-btn size-6" aria-label="Unlink issue" onClick={() => unlink({ issue: issue.number }, `issue #${issue.number}`)}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {mentions.map((m) => (
                  <a
                    key={`${m.kind}-${m.ref}`}
                    href={m.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group flex items-center gap-2 px-3 py-2.5 hover:bg-hover"
                    title={`Mentions ${ref}`}
                  >
                    {m.kind === "commit" ? (
                      <GitCommitHorizontal className="size-3.5 text-muted" />
                    ) : (
                      <GitPullRequest className={`size-3.5 ${m.state === "merged" ? "text-state-review" : m.state === "open" ? "text-state-done" : "text-muted"}`} />
                    )}
                    <span className="font-mono text-xs text-faint">{m.ref}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.title}</span>
                    {m.author && <span className="hidden text-2xs text-faint sm:inline">{m.author}</span>}
                    <RelativeTime value={m.date} className="shrink-0 text-2xs text-faint" />
                    <ExternalLink className="size-3 text-faint opacity-0 group-hover:opacity-100" />
                  </a>
                ))}
                {!branch && linkedPulls.length === 0 && linkedIssues.length === 0 && mentions.length === 0 && (
                  <p className="px-3 py-3 text-sm text-muted">
                    {refs.loading ? (
                      <span className="flex items-center gap-2"><Spinner /> Looking for commits that mention {ref}</span>
                    ) : (
                      <>
                        Nothing yet. Write <code className="rounded-sm bg-code-bg px-1 font-mono text-xs">{ref ?? "RB-n"}</code> in a
                        commit message or pull request and it shows up here.
                      </>
                    )}
                  </p>
                )}
              </div>
            </Section>

            {/* activity */}
            <Section title="Activity">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2 focus-within:border-ink/40">
                  <textarea
                    rows={2}
                    className="min-w-0 resize-none bg-transparent px-1 text-sm text-ink outline-none placeholder:text-faint"
                    placeholder="Leave a note for yourself, a teammate or an agent…"
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        void comment();
                      }
                    }}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-2xs text-faint">⌘↵</span>
                    <button className="rb-btn rb-btn-sm" disabled={!commentDraft.trim()} onClick={comment}>
                      Comment
                    </button>
                  </div>
                </div>
                <ol className="flex flex-col">
                  {activity.loading && <Skeleton className="h-8 w-full" />}
                  {cardEvents.map((event) => (
                    <li key={event.id} className="relative flex gap-3 pb-3 pl-4 before:absolute before:bottom-0 before:left-[3px] before:top-3 before:w-px before:bg-border last:before:hidden">
                      <span className={`absolute left-0 top-[7px] size-[7px] rounded-full ${event.type === "comment" ? "bg-ink" : "bg-border-strong"}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-snug ${event.type === "comment" ? "whitespace-pre-wrap text-ink" : "text-muted"}`}>
                          {event.message}
                        </p>
                        <RelativeTime value={event.createdAt} className="text-2xs text-faint" />
                      </div>
                    </li>
                  ))}
                  {!activity.loading && cardEvents.length === 0 && (
                    <li className="text-sm text-faint">No history yet.</li>
                  )}
                </ol>
              </div>
            </Section>
          </div>
        </div>

        {/* ------------------------------------------------- properties -- */}
        <aside className="rb-scroll-thin hidden w-[272px] shrink-0 flex-col gap-1 overflow-y-auto border-l border-border bg-canvas/60 px-4 py-4 md:flex">
          {properties}
        </aside>
      </div>
    </Sheet>
  );
}
