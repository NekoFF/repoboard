"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, Check, FileText, GitBranch, GitPullRequest } from "lucide-react";
import type { BoardMilestone, BoardTask } from "@/lib/board-service";
import { labelColor, displayLabel } from "@/components/labelColor";
import { DueLabel, PriorityIcon, ProgressRing } from "@/components/ui";
import { ActorAvatar } from "@/components/Actor";
import { progress } from "@/lib/checklist";

export function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  return <ActorAvatar name={name} size={size} />;
}

export function LabelChip({ label }: { label: string }) {
  return (
    <span
      title={label}
      className="inline-flex h-5 max-w-[140px] items-center gap-1.5 rounded-full border border-border px-2 text-2xs font-medium text-muted"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: labelColor(label) }} aria-hidden />
      <span className="truncate">{displayLabel(label)}</span>
    </span>
  );
}

/**
 * A card says what it is and whether anything needs attention — nothing more.
 * Everything else has a home in the detail panel.
 */
export function TaskCardBody({
  task,
  milestone,
  done,
  mentions = 0,
}: {
  task: BoardTask;
  milestone?: BoardMilestone | null;
  done?: boolean;
  mentions?: number;
}) {
  const checklist = progress(task.checklist);
  const checklistDone = checklist.done;
  const hasMeta =
    task.labels.length > 0 ||
    Boolean(milestone) ||
    task.checklist.length > 0 ||
    task.branches.length > 0 ||
    task.pullRequests.length > 0 ||
    Boolean(task.description) ||
    Boolean(task.markdownTaskId) ||
    mentions > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-4 items-center gap-1.5 text-2xs text-faint">
        {task.priority > 0 && <PriorityIcon priority={task.priority} size={13} />}
        {task.number != null && <span className="font-mono tracking-tight">RB-{task.number}</span>}
        <span className="flex-1" />
        {task.dueDate && !done && <DueLabel value={task.dueDate} className="font-medium" />}
        {task.assignee && <Avatar name={task.assignee} size={16} />}
      </div>

      <p className={`text-sm font-medium leading-[1.4] ${done ? "text-muted line-through decoration-faint" : "text-ink"}`}>
        {task.title}
      </p>

      {hasMeta && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-2xs text-muted">
          {task.labels.slice(0, 3).map((label) => (
            <LabelChip key={label} label={label} />
          ))}
          {task.labels.length > 3 && <span className="text-faint">+{task.labels.length - 3}</span>}
          {milestone && (
            <span className="inline-flex h-5 max-w-[140px] items-center truncate rounded-full bg-pill px-2 font-medium" title={`Milestone: ${milestone.name}`}>
              {milestone.name}
            </span>
          )}
          {checklist.total > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums" title="Checklist">
              <ProgressRing done={checklistDone} total={checklist.total} size={12} />
              {checklistDone}/{checklist.total}
            </span>
          )}
          {task.branches.length > 0 && (
            <span className="inline-flex items-center" title={`Branch ${task.branches[0]}`}>
              <GitBranch className="size-3" />
            </span>
          )}
          {(task.pullRequests.length > 0 || mentions > 0) && (
            <span className="inline-flex items-center gap-0.5" title="Pull requests and commits that mention this card">
              <GitPullRequest className="size-3" />
              {task.pullRequests.length + mentions}
            </span>
          )}
          {task.description && <AlignLeft className="size-3" aria-label="Has a description" />}
          {task.markdownTaskId && <FileText className="size-3" aria-label="Comes from the markdown file" />}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  task: BoardTask;
  milestone?: BoardMilestone | null;
  isDone: boolean;
  selected?: boolean;
  mentions?: number;
  onOpen: () => void;
  onSelect?: () => void;
  onToggleDone?: () => void;
}

function DoneButton({ isDone, onToggleDone }: { isDone: boolean; onToggleDone?: () => void }) {
  if (!onToggleDone) return null;
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onToggleDone();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={isDone ? "Move back to Todo" : "Mark as done"}
      aria-label={isDone ? "Move back to Todo" : "Mark as done"}
      className={`absolute bottom-2 right-2 z-10 grid size-5 place-items-center rounded-full border transition-all duration-100 ${
        isDone
          ? "border-state-done bg-state-done text-surface"
          : "border-border-strong bg-surface text-transparent opacity-0 hover:border-state-done hover:text-state-done focus-visible:opacity-100 group-hover/card:opacity-100"
      }`}
    >
      <Check className="size-3" strokeWidth={3} />
    </button>
  );
}

/** Same card, no drag wiring — used for the first paint before mount. */
export function StaticTaskCard({ task, milestone, isDone, selected, mentions, onOpen }: CardProps) {
  return (
    <div
      role="button"
      tabIndex={-1}
      data-card-id={task.id}
      data-selected={selected ? "true" : undefined}
      onClick={onOpen}
      className="rb-task cursor-pointer"
    >
      <TaskCardBody task={task} milestone={milestone} done={isDone} mentions={mentions} />
    </div>
  );
}

export function SortableTaskCard({
  task,
  milestone,
  isDone,
  selected,
  mentions,
  onOpen,
  onSelect,
  onToggleDone,
}: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? "transform 160ms cubic-bezier(0.22,1,0.36,1)",
      }}
      className={`group/card relative ${isDragging ? "opacity-30" : ""}`}
    >
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        data-card-id={task.id}
        data-selected={selected ? "true" : undefined}
        onClick={onOpen}
        onFocus={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
            return;
          }
          // Space and the arrows are dnd-kit's keyboard dragging.
          listeners?.onKeyDown?.(event);
        }}
        className="rb-task cursor-pointer active:cursor-grabbing"
      >
        <TaskCardBody task={task} milestone={milestone} done={isDone} mentions={mentions} />
      </div>
      <DoneButton isDone={isDone} onToggleDone={onToggleDone} />
    </div>
  );
}
