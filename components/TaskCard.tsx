"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardTask } from "@/lib/board-service";

function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function ChecklistRing({ done, total }: { done: number; total: number }) {
  const ratio = total === 0 ? 0 : done / total;
  const circumference = 2 * Math.PI * 5;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform="rotate(-90 7 7)"
          style={{ transition: "stroke-dashoffset 240ms ease" }}
        />
      </svg>
      {done}/{total}
    </span>
  );
}

export function TaskCardBody({
  task,
  dragging,
}: {
  task: BoardTask;
  dragging?: boolean;
}) {
  const doneItems = task.checklist.filter((c) => c.done).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink">
          {task.title}
        </p>
        {task.assignee && (
          <span
            title={task.assignee}
            className="grid size-5 shrink-0 place-items-center rounded-full bg-pill text-[9px] font-semibold text-muted"
          >
            {initials(task.assignee)}
          </span>
        )}
      </div>

      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span key={label} className="rb-pill">
              {label}
            </span>
          ))}
        </div>
      )}

      {task.branches.length > 0 && (
        <div className="flex flex-col gap-1">
          {task.branches.map((branch) => (
            <div
              key={branch}
              className="flex items-center gap-1.5 text-[11px] text-muted"
            >
              <span aria-hidden>⑂</span>
              <span className="truncate font-mono text-[10.5px]">{branch}</span>
            </div>
          ))}
        </div>
      )}

      {(task.checklist.length > 0 ||
        task.pullRequests.length > 0 ||
        task.issues.length > 0 ||
        task.markdownTaskId ||
        task.dueDate) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {task.checklist.length > 0 && (
            <ChecklistRing done={doneItems} total={task.checklist.length} />
          )}
          {task.pullRequests.map((pr) => (
            <span key={`pr-${pr}`} className="rb-pill">
              PR #{pr}
            </span>
          ))}
          {task.issues.map((issue) => (
            <span key={`issue-${issue}`} className="rb-pill">
              #{issue}
            </span>
          ))}
          {task.markdownTaskId && (
            <span
              className="text-[11px] text-muted"
              title="Linked to a task in the markdown source"
            >
              md
            </span>
          )}
          {task.dueDate && (
            <span
              className={`text-[11px] ${
                task.dueDate < Date.now() ? "text-danger-fg" : "text-muted"
              }`}
            >
              {new Date(task.dueDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
      )}

      {dragging && <span className="sr-only">dragging</span>}
    </div>
  );
}

export function SortableTaskCard({
  task,
  onOpen,
}: {
  task: BoardTask;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? "transform 180ms cubic-bezier(0.22,1,0.36,1)",
      }}
      className={isDragging ? "opacity-0" : ""}
    >
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className="group w-full cursor-pointer rounded-xl border border-border bg-surface p-3 text-left shadow-card transition-all duration-150
          hover:-translate-y-px hover:border-ink/15 hover:shadow-lift active:cursor-grabbing"
      >
        <TaskCardBody task={task} />
      </div>
    </div>
  );
}
