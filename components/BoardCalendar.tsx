"use client";

import { useMemo, useState } from "react";
import type { BoardTask } from "@/lib/board-service";

function dateKey(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

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
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const { scheduled, unscheduled } = useMemo(() => {
    const byDate = new Map<string, BoardTask[]>();
    const withoutDate: BoardTask[] = [];
    for (const task of tasks) {
      if (task.dueDate == null) {
        withoutDate.push(task);
      } else {
        const key = dateKey(task.dueDate);
        byDate.set(key, [...(byDate.get(key) ?? []), task]);
      }
    }
    return { scheduled: byDate, unscheduled: withoutDate };
  }, [tasks]);

  return (
    <div className="rb-board-canvas min-h-[540px] flex-1 overflow-auto rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-3">
        <h2 className="text-[15px] font-semibold text-ink">
          {new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(month)}
        </h2>
        <div className="flex items-center gap-1">
          <button className="rb-btn-ghost" onClick={() => setMonthOffset(monthOffset - 1)} aria-label="Previous month">‹</button>
          <button className="rb-btn" onClick={() => setMonthOffset(0)}>Today</button>
          <button className="rb-btn-ghost" onClick={() => setMonthOffset(monthOffset + 1)} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="grid min-w-[630px] grid-cols-7 border-b border-border bg-surface text-center text-[11px] font-medium text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="py-2">{day}</div>)}
      </div>
      <div className="grid min-w-[630px] grid-cols-7 bg-surface">
        {Array.from({ length: cellCount }, (_, index) => {
          const date = new Date(Date.UTC(year, monthIndex, index - firstWeekday + 1));
          const key = dateKey(date.getTime());
          const dayTasks = scheduled.get(key) ?? [];
          const inMonth = date.getUTCMonth() === monthIndex;
          return (
            <div key={key} className={`min-h-[106px] border-b border-r border-border p-1.5 last:border-r-0 ${inMonth ? "bg-surface" : "bg-pill/40"}`}>
              <span className={`inline-grid size-6 place-items-center rounded-full text-[11px] ${key === todayKey ? "bg-active font-semibold text-white" : inMonth ? "text-muted" : "text-muted/50"}`}>
                {date.getUTCDate()}
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {dayTasks.map((task) => (
                  <button key={task.id} onClick={() => onOpen(task)} className="truncate rounded-md border border-border bg-surface px-1.5 py-1 text-left text-[11px] leading-tight text-ink shadow-card hover:border-ink/25" title={task.title}>
                    {task.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border bg-surface px-5 py-4">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-semibold text-ink">No due date</h3>
          <span className="text-[11px] tabular-nums text-muted">{unscheduled.length}</span>
        </div>
        {unscheduled.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unscheduled.map((task) => (
              <button key={task.id} onClick={() => onOpen(task)} className="rounded-md border border-border bg-pill/40 px-2 py-1.5 text-[11px] text-ink hover:border-ink/25">
                {task.title}<span className="ml-2 text-muted">{columns.find((column) => column.id === task.columnId)?.name}</span>
              </button>
            ))}
          </div>
        ) : <p className="mt-2 text-[12px] text-muted">Every visible card has a due date.</p>}
      </div>
    </div>
  );
}
