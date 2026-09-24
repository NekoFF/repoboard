"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { BoardData, BoardTask } from "@/lib/board-service";
import { SortableTaskCard, TaskCardBody } from "@/components/TaskCard";
import { CardDetailPanel } from "@/components/CardDetailPanel";
import { MarkdownWriteDialog } from "@/components/MarkdownWriteDialog";

function Column({
  id,
  name,
  tasks,
  onOpen,
  onAdd,
}: {
  id: string;
  name: string;
  tasks: BoardTask[];
  onOpen: (task: BoardTask) => void;
  onAdd: (columnId: string, title: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">{name}</span>
        <span className="rb-pill">{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-[120px] flex-1 flex-col gap-[10px] rounded-xl p-1 transition-colors ${
          isOver ? "bg-pill" : ""
        }`}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onOpen={() => onOpen(task)}
            />
          ))}
        </SortableContext>

        {adding ? (
          <form
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim()) return;
              onAdd(id, title.trim());
              setTitle("");
              setAdding(false);
            }}
          >
            <input
              autoFocus
              className="rb-input"
              placeholder="Card title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAdding(false);
                  setTitle("");
                }
              }}
            />
            <div className="flex gap-2">
              <button type="submit" className="rb-btn-primary">
                Add
              </button>
              <button
                type="button"
                className="rb-btn"
                onClick={() => {
                  setAdding(false);
                  setTitle("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="flex items-center gap-[6px] p-2 text-[12px] text-muted hover:text-ink"
            onClick={() => setAdding(true)}
          >
            <span className="font-medium">+</span>
            <span>Add card</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({
  data,
  search,
  labelFilter,
  assigneeFilter,
}: {
  data: BoardData;
  search: string;
  labelFilter: string | null;
  assigneeFilter: string | null;
}) {
  const [tasks, setTasks] = useState<BoardTask[]>(data.tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<BoardTask | null>(null);
  const [pendingWrite, setPendingWrite] = useState<{
    taskId: string;
    targetHeading: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (query && !task.title.toLowerCase().includes(query)) return false;
      if (labelFilter && !task.labels.includes(labelFilter)) return false;
      if (assigneeFilter && task.assignee !== assigneeFilter) return false;
      return true;
    });
  }, [tasks, search, labelFilter, assigneeFilter]);

  const byColumn = (columnId: string) =>
    visible
      .filter((task) => task.columnId === columnId)
      .sort((a, b) => a.position - b.position);

  const columnOf = (id: string): string | null => {
    if (data.columns.some((c) => c.id === id)) return id;
    return tasks.find((t) => t.id === id)?.columnId ?? null;
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const targetColumnId = columnOf(String(over.id));
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !targetColumnId || task.columnId === targetColumnId) return;

    const destination = byColumn(targetColumnId);
    const position = destination.length;

    // Optimistic local move; the server call reconciles.
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, columnId: targetColumnId, position } : t,
      ),
    );

    const response = await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "move",
        taskId,
        columnId: targetColumnId,
        position,
      }),
    });

    if (!response.ok) {
      setTasks(data.tasks);
      setError("Could not move the card");
      return;
    }

    // A card that came from Markdown must be written back to GitHub, but never
    // silently: open the preview dialog and let the user commit or discard.
    if (task.markdownTaskId) {
      const heading = data.columns.find((c) => c.id === targetColumnId)?.name;
      if (heading) setPendingWrite({ taskId, targetHeading: heading });
    }
  };

  const addCard = async (columnId: string, title: string) => {
    const response = await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", columnId, title }),
    });
    if (!response.ok) {
      setError("Could not create the card");
      return;
    }
    const { id } = (await response.json()) as { id: string };
    setTasks((prev) => [
      ...prev,
      {
        id,
        columnId,
        title,
        description: null,
        assignee: null,
        dueDate: null,
        position: prev.filter((t) => t.columnId === columnId).length,
        checklist: [],
        markdownTaskId: null,
        labels: [],
        branches: [],
        commits: [],
        pullRequests: [],
        issues: [],
      },
    ]);
  };

  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  return (
    <>
      {error && (
        <div className="w-full rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
          {error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) =>
          setActiveId(String(event.active.id))
        }
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex w-full flex-1 gap-3 overflow-x-auto">
          {data.columns.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              name={column.name}
              tasks={byColumn(column.id)}
              onOpen={setOpenTask}
              onAdd={addCard}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
              <TaskCardBody task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openTask && (
        <CardDetailPanel
          task={tasks.find((t) => t.id === openTask.id) ?? openTask}
          columns={data.columns}
          markdownPath={data.markdownSource?.path ?? null}
          onClose={() => setOpenTask(null)}
          onChange={(updated) =>
            setTasks((prev) =>
              prev.map((t) => (t.id === updated.id ? updated : t)),
            )
          }
          onDelete={(taskId) => {
            setTasks((prev) => prev.filter((t) => t.id !== taskId));
            setOpenTask(null);
          }}
        />
      )}

      {pendingWrite && (
        <MarkdownWriteDialog
          taskId={pendingWrite.taskId}
          targetHeading={pendingWrite.targetHeading}
          onClose={() => setPendingWrite(null)}
        />
      )}
    </>
  );
}
