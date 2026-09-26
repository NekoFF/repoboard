"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BoardTask } from "@/lib/board-service";
import { StatusIcon } from "@/components/ui";
import { statusOfColumn } from "@/lib/status";

function dateKey(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

/** Cards on the day they are due; the ones without a date wait underneath. */
export function BoardCalendar({
  tasks,
  columns,
  onOpen,
}: {
  tasks: BoardTask[];
  columns: { id: string; name: string }[];
  onOpen: (task: BoardTask) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const today = new Date();
  const month = new Date(Date.UTC(today.getFullYear(), today.getMonth() + monthOffset, 1));
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = (month.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const todayKey = dateKey(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const status = new Map(columns.map((c) => [c.id, statusOfColumn(c.name)]));

  const { scheduled, unscheduled } = useMemo(() => {
    const byDate = new Map<string, BoardTask[]>();
    const withoutDate: BoardTask[] = [];
    for (const task of tasks) {
      if (task.dueDate == null) withoutDate.push(task);
      else {
        const key = dateKey(task.dueDate);
        byDate.set(key, [...(byDate.get(key) ?? []), task]);
      }
    }
    return { scheduled: byDate, unscheduled: withoutDate };
  }, [tasks]);

  return (
    <div className="rb-scroll-thin rb-clear-rail min-h-0 flex-1 overflow-auto">
      <div className="flex items-center gap-2 px-4 py-3 lg:px-5">
        <h2 className="text-md font-semibold text-ink">
          {new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(month)}
        </h2>
        <div className="flex-1" />
        <button className="rb-icon-btn" onClick={() => setMonthOffset(monthOffset - 1)} aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </button>
        <button className="rb-btn rb-btn-sm" onClick={() => setMonthOffset(0)}>
          Today
        </button>
        <button className="rb-icon-btn" onClick={() => setMonthOffset(monthOffset + 1)} aria-label="Next month">
          <ChevronRight className="size-4" />
        </button>
      </div>
      {/* Narrow screens scroll sideways rather than cutting off the weekend. */}
      <div className="rb-scroll-thin mx-4 overflow-x-auto overflow-y-hidden rounded-xl border border-border lg:mx-5">
        <div className="grid min-w-[640px] grid-cols-7 border-b border-border bg-canvas text-center text-2xs font-medium text-faint">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="py-2">
              {day}
            </div>
          ))}
        </div>
        <div className="grid min-w-[640px] grid-cols-7">
          {Array.from({ length: cellCount }, (_, index) => {
            const date = new Date(Date.UTC(year, monthIndex, index - firstWeekday + 1));
            const key = dateKey(date.getTime());
            const dayTasks = scheduled.get(key) ?? [];
            const inMonth = date.getUTCMonth() === monthIndex;
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`min-h-[112px] border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0 ${
                  inMonth ? "bg-surface" : "bg-canvas"
                }`}
              >
                <span
                  className={`inline-grid size-6 place-items-center rounded-full text-xs tabular-nums ${
                    isToday ? "bg-accent font-semibold text-on-accent" : inMonth ? "text-muted" : "text-faint"
                  }`}
                >
                  {date.getUTCDate()}
                </span>
                <div className="mt-1 flex flex-col gap-1">
                  {dayTasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => onOpen(task)}
                      className="flex items-center gap-1.5 truncate rounded-md border border-border bg-surface px-1.5 py-1 text-left text-2xs text-ink shadow-card transition-colors hover:border-border-strong"
                      title={task.title}
                    >
                      <StatusIcon status={status.get(task.columnId) ?? "todo"} size={11} />
                      <span className="truncate">{task.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="px-4 py-5 lg:px-5">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-ink">
          No due date <span className="text-xs font-normal tabular-nums text-faint">{unscheduled.length}</span>
        </h3>
        {unscheduled.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unscheduled.map((task) => (
              <button
                key={task.id}
                onClick={() => onOpen(task)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-ink hover:border-border-strong"
              >
                <StatusIcon status={status.get(task.columnId) ?? "todo"} size={12} />
                {task.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Every visible card has a due date.</p>
        )}
      </div>
    </div>
  );
}
