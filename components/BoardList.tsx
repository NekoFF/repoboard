"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { BoardData, BoardTask } from "@/lib/board-service";
import { Avatar, LabelChip } from "@/components/TaskCard";
import { DueLabel, Menu, MenuItem, PriorityIcon, RelativeTime, StatusIcon } from "@/components/ui";
import { statusOfColumn } from "@/lib/status";

/**
 * The board as rows, grouped by column — for scanning a lot of cards at once.
 * Same cards, same moves, same keyboard; only the layout differs.
 */
export function BoardList({
  data,
  tasks,
  selectedId,
  mentions,
  onSelect,
  onOpen,
  onToggleDone,
  onMove,
}: {
  data: BoardData;
  tasks: BoardTask[];
  selectedId: string | null;
  mentions: Map<number, number>;
  onSelect: (task: BoardTask) => void;
  onOpen: (task: BoardTask) => void;
  onToggleDone: (task: BoardTask) => void;
  onMove: (task: BoardTask, columnId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const milestones = new Map(data.milestones.map((m) => [m.id, m]));

  return (
    <div className="rb-scroll-thin rb-clear-rail min-h-0 flex-1 overflow-y-auto">
      {data.columns.map((column) => {
        const status = statusOfColumn(column.name);
        const rows = tasks
          .filter((t) => t.columnId === column.id)
          .sort((a, b) => a.position - b.position);
        const isCollapsed = collapsed.has(column.id);
        return (
          <section key={column.id} aria-label={column.name}>
            <button
              className="sticky top-0 z-[1] flex h-9 w-full items-center gap-2 border-b border-border bg-canvas/95 px-4 text-left backdrop-blur lg:px-5"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(column.id)) next.delete(column.id);
                  else next.add(column.id);
                  return next;
                })
              }
              aria-expanded={!isCollapsed}
            >
              <ChevronRight className={`size-3.5 text-faint transition-transform duration-100 ${isCollapsed ? "" : "rotate-90"}`} />
              <StatusIcon status={status} />
              <span className="text-sm font-semibold text-ink">{column.name}</span>
              <span className="text-xs tabular-nums text-faint">{rows.length}</span>
            </button>

            {!isCollapsed &&
              rows.map((task) => {
                const milestone = task.milestoneId ? milestones.get(task.milestoneId) : null;
                const done = status === "done";
                const refs = (task.number != null ? mentions.get(task.number) : 0) ?? 0;
                return (
                  <div
                    key={task.id}
                    data-card-id={task.id}
                    data-selected={task.id === selectedId ? "true" : undefined}
                    role="button"
                    tabIndex={-1}
                    onClick={() => onOpen(task)}
                    onMouseEnter={() => onSelect(task)}
                    className="group flex h-10 cursor-pointer items-center gap-2.5 border-b border-border px-4 text-sm transition-colors hover:bg-hover data-[selected=true]:bg-hover lg:px-5"
                  >
                    <span className="w-4 shrink-0">
                      <PriorityIcon priority={task.priority} />
                    </span>
                    <span className="w-[52px] shrink-0 font-mono text-2xs text-faint">
                      {task.number != null ? `RB-${task.number}` : ""}
                    </span>
                    <span onClick={(event) => event.stopPropagation()}>
                      <Menu
                        trigger={
                          <button className="grid size-6 place-items-center rounded-md hover:bg-pill" aria-label="Change status">
                            <StatusIcon status={status} />
                          </button>
                        }
                      >
                        {data.columns.map((c, index) => (
                          <MenuItem
                            key={c.id}
                            icon={<StatusIcon status={statusOfColumn(c.name)} />}
                            checked={c.id === task.columnId}
                            shortcut={String(index + 1)}
                            onSelect={() => onMove(task, c.id)}
                          >
                            {c.name}
                          </MenuItem>
                        ))}
                      </Menu>
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${done ? "text-muted line-through decoration-faint" : "text-ink"}`}>
                      {task.title}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 md:flex">
                      {task.labels.slice(0, 2).map((label) => (
                        <LabelChip key={label} label={label} />
                      ))}
                      {milestone && (
                        <span className="inline-flex h-5 max-w-[140px] items-center truncate rounded-full bg-pill px-2 text-2xs font-medium text-muted">
                          {milestone.name}
                        </span>
                      )}
                      {refs > 0 && <span className="text-2xs text-faint">{refs} mention{refs === 1 ? "" : "s"}</span>}
                    </span>
                    <span className="w-16 shrink-0 text-right text-xs">
                      {task.dueDate && !done ? <DueLabel value={task.dueDate} /> : null}
                    </span>
                    <span className="hidden w-16 shrink-0 text-right text-xs text-faint lg:inline">
                      <RelativeTime value={task.updatedAt} />
                    </span>
                    <span className="w-5 shrink-0">{task.assignee && <Avatar name={task.assignee} />}</span>
                    <button
                      className="rb-icon-btn size-6 opacity-0 group-hover:opacity-100"
                      title={done ? "Reopen" : "Mark as done"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleDone(task);
                      }}
                    >
                      <StatusIcon status={done ? "todo" : "done"} size={13} />
                    </button>
                  </div>
                );
              })}
            {!isCollapsed && rows.length === 0 && (
              <p className="border-b border-border px-4 py-2.5 text-xs text-faint lg:px-5">No cards here.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
