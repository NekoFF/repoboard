"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardTask } from "@/lib/board-service";

export function TaskCardBody({
  task,
  onOpen,
}: {
  task: BoardTask;
  onOpen?: () => void;
}) {
  return (
    <div className="flex flex-col gap-[9px]">
      <button
        className="text-left text-[13px] font-medium text-ink hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          onOpen?.();
        }}
      >
        {task.title}
      </button>

      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span key={label} className="rb-pill">
              {label}
            </span>
          ))}
        </div>
      )}

      {task.branches.map((branch) => (
        <div
          key={branch}
          className="flex items-center gap-[6px] text-[11px] text-muted"
        >
          <span className="font-medium">⑂</span>
          <span className="truncate">{branch}</span>
        </div>
      ))}

      {(task.assignee ||
        task.commits.length > 0 ||
        task.pullRequests.length > 0 ||
        task.issues.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {task.assignee && (
            <span className="text-[11px] font-medium text-muted">
              ● {task.assignee}
            </span>
          )}
          {task.commits.length > 0 && (
            <span className="text-[11px] text-muted">
              {task.commits.length} commits
            </span>
          )}
          {task.pullRequests.map((pr) => (
            <span key={`pr-${pr}`} className="rb-pill">
              #{pr}
            </span>
          ))}
          {task.issues.map((issue) => (
            <span key={`issue-${issue}`} className="rb-pill">
              issue #{issue}
            </span>
          ))}
        </div>
      )}

      {task.checklist.length > 0 && (
        <div className="text-[11px] text-muted">
          {task.checklist.filter((c) => c.done).length}/{task.checklist.length}{" "}
          checklist
        </div>
      )}
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
      className="w-full cursor-grab rounded-xl border border-border bg-surface p-3 active:cursor-grabbing"
    >
      <TaskCardBody task={task} onOpen={onOpen} />
    </div>
  );
}
