"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardTask } from "@/lib/board-service";
import { labelColor } from "@/components/labelColor";
import { formatDate } from "@/components/ui";

function ChecklistRing({ done, total }: { done: number; total: number }) {
  const ratio = total === 0 ? 0 : done / total;
  const circumference = 2 * Math.PI * 5;
  const complete = done === total && total > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${
        complete ? "text-success-fg" : "text-muted"
      }`}
      title={`${done} of ${total} checklist items done`}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
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

export function TaskCardBody({ task }: { task: BoardTask }) {
  const doneItems = task.checklist.filter((c) => c.done).length;
  const displayLabel = (label: string) => label.replace(/^[^:]+:/, "").replace(/[-_]/g, " ");
  const hasFooter =
    Boolean(task.description) ||
    task.checklist.length > 0 ||
    task.branches.length > 0 ||
    task.pullRequests.length > 0 ||
    Boolean(task.assignee) ||
    Boolean(task.dueDate);

  return (
    <div className="flex flex-col gap-2">
      {task.issues.length > 0 && <span className="text-[10.5px] font-medium text-muted">Issue #{task.issues[0]}</span>}
      <p className="text-[13px] font-medium leading-[1.4] text-ink">{task.title}</p>

      {task.number !== null && (
        <span
          className="font-mono text-[10.5px] text-muted/70"
          title="Write this in a commit message and the card will find that commit"
        >
          RB-{task.number}
        </span>
      )}

      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {task.labels.slice(0, 2).map((label) => (
            <span
              key={label}
              title={label}
              className="inline-flex items-center gap-1.5 rounded-md bg-pill px-1.5 py-[3px] text-[10.5px] font-medium capitalize text-ink"
            >
              <span
                className="size-[6px] shrink-0 rounded-full"
                style={{ backgroundColor: labelColor(label) }}
                aria-hidden
              />
              {displayLabel(label)}
            </span>
          ))}
          {task.labels.length > 2 && <span className="self-center text-[10px] text-muted">+{task.labels.length - 2}</span>}
        </div>
      )}

      {hasFooter && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
          {task.description && <span title="Has a description">≡</span>}

          {task.checklist.length > 0 && (
            <ChecklistRing done={doneItems} total={task.checklist.length} />
          )}

          {task.branches.length > 0 && (
            <span title={`Branch: ${task.branches[0]}`}>⑂ branch</span>
          )}

          {task.pullRequests.map((pr) => (
            <span key={`pr-${pr}`} title={`Pull request #${pr}`}>
              ↗ #{pr}
            </span>
          ))}
          {task.dueDate && (
            <span className={task.dueDate < Date.now() ? "text-danger-fg" : ""}>
              {formatDate(task.dueDate)}
            </span>
          )}

          <div className="flex-1" />

          {task.assignee && (
            <span
              title={task.assignee}
              className="grid size-[18px] place-items-center rounded-full bg-pill text-[9px] font-semibold text-muted"
            >
              {task.assignee.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Same card, no drag wiring — used for the first paint before mount. */
export function StaticTaskCard({
  task,
  isDone,
  onOpen,
}: {
  task: BoardTask;
  isDone: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
      className={`rb-task cursor-pointer pr-8 ${isDone ? "opacity-70" : ""}`}
    >
      <TaskCardBody task={task} />
    </div>
  );
}

export function SortableTaskCard({
  task,
  isDone,
  onOpen,
  onToggleDone,
}: {
  task: BoardTask;
  isDone: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? "transform 180ms cubic-bezier(0.22,1,0.36,1)",
      }}
      className={`group/card relative ${isDragging ? "opacity-0" : ""}`}
    >
      {/* The tick is the plain answer to "how do I mark this done?" — it moves
          the card to the Done column, the same thing a drag there would do. */}
      <button
        onClick={(event) => {
          event.stopPropagation();
          onToggleDone();
        }}
        title={isDone ? "Move back to Todo" : "Mark as done"}
        aria-label={isDone ? "Move back to Todo" : "Mark as done"}
        className={`absolute right-2 top-2 z-10 grid size-[22px] place-items-center rounded-full border text-[11px] transition-all
          ${
            isDone
              ? "border-success-fg/40 bg-success-bg text-success-fg opacity-100"
              : "border-border bg-surface text-muted opacity-0 hover:border-success-fg/50 hover:text-success-fg group-hover/card:opacity-100 focus-visible:opacity-100"
          }`}
      >
        ✓
      </button>

      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onOpen();
          }
        }}
        className={`rb-task cursor-pointer pr-8 active:cursor-grabbing ${
          isDone ? "opacity-70" : ""
        }`}
      >
        <TaskCardBody task={task} />
      </div>
    </div>
  );
}
