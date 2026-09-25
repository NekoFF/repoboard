"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { BoardData, BoardTask } from "@/lib/board-service";
import {
  SortableTaskCard,
  StaticTaskCard,
  TaskCardBody,
} from "@/components/TaskCard";
import { CardDetailPanel } from "@/components/CardDetailPanel";
import { MarkdownWriteDialog } from "@/components/MarkdownWriteDialog";
import { EmptyState, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";

const DONE_COLUMN = "Done";

function Column({
  id,
  name,
  tasks,
  doneColumnId,
  interactive,
  onOpen,
  onToggleDone,
  onAdd,
  composerOpen,
  setComposerOpen,
}: {
  id: string;
  name: string;
  tasks: BoardTask[];
  doneColumnId: string | null;
  interactive: boolean;
  onOpen: (task: BoardTask) => void;
  onToggleDone: (task: BoardTask) => void;
  onAdd: (columnId: string, title: string) => Promise<void>;
  composerOpen: string | null;
  setComposerOpen: (columnId: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [title, setTitle] = useState("");
  const adding = composerOpen === id;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (adding) requestAnimationFrame(() => inputRef.current?.focus());
  }, [adding]);

  const submit = async () => {
    const value = title.trim();
    if (!value) return;
    setTitle("");
    await onAdd(id, value);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div
      className={`rb-column w-[286px] shrink-0 transition-colors duration-150 ${
        isOver ? "border-ink/25 bg-pill" : ""
      }`}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-ink">{name}</span>
        <span className="text-[12px] tabular-nums text-muted">
          {tasks.length}
        </span>
        <div className="flex-1" />
        <button
          className="grid size-6 place-items-center rounded-md text-[14px] text-muted transition-colors hover:bg-pill hover:text-ink"
          onClick={() => setComposerOpen(adding ? null : id)}
          title={`Add a card to ${name}`}
          aria-label={`Add a card to ${name}`}
        >
          +
        </button>
      </div>

      <div
        ref={setNodeRef}
        className="flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        {interactive ? (
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                isDone={task.columnId === doneColumnId}
                onOpen={() => onOpen(task)}
                onToggleDone={() => onToggleDone(task)}
              />
            ))}
          </SortableContext>
        ) : (
          tasks.map((task) => (
            <StaticTaskCard
              key={task.id}
              task={task}
              isDone={task.columnId === doneColumnId}
              onOpen={() => onOpen(task)}
            />
          ))
        )}

        {adding && (
          <div className="rb-enter rounded-[10px] border border-ink/20 bg-surface p-2.5 shadow-card">
            <textarea
              ref={inputRef}
              rows={2}
              className="w-full resize-none bg-transparent text-[13.5px] leading-snug text-ink outline-none placeholder:text-muted/70"
              placeholder="Card title…"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                } else if (event.key === "Escape") {
                  setTitle("");
                  setComposerOpen(null);
                }
              }}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button className="rb-btn-primary py-1" onClick={submit}>
                Add card
              </button>
              <button
                className="rb-btn-ghost"
                onClick={() => {
                  setTitle("");
                  setComposerOpen(null);
                }}
              >
                Cancel
              </button>
              <div className="flex-1" />
              <span className="text-[10.5px] text-muted">
                <span className="rb-kbd">↵</span>
              </span>
            </div>
          </div>
        )}

        {!adding && (
          <button
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-pill hover:text-ink"
            onClick={() => setComposerOpen(id)}
          >
            <span aria-hidden>+</span> Add card
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
  onImportIssues,
}: {
  data: BoardData;
  search: string;
  labelFilter: string | null;
  assigneeFilter: string | null;
  onImportIssues?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [tasks, setTasks] = useState<BoardTask[]>(data.tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState<string | null>(null);
  const [pendingWrite, setPendingWrite] = useState<{
    taskId: string;
    targetHeading: string;
    previousColumnId: string;
  } | null>(null);

  useEffect(() => setTasks(data.tasks), [data.tasks]);

  // dnd-kit numbers its accessibility announcements as it renders, which the
  // server and the browser do differently. Drag is a pointer feature anyway, so
  // the first paint is the same board without it.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);

  useEffect(() => {
    const card = searchParams.get("card");
    if (card) setOpenTaskId(card);
  }, [searchParams]);

  const doneColumnId =
    data.columns.find((c) => c.name === DONE_COLUMN)?.id ?? null;
  const firstColumnId = data.columns[0]?.id ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey) return;
      if (event.key.toLowerCase() === "n" && firstColumnId) {
        event.preventDefault();
        setComposerOpen(firstColumnId);
      }
    };
    const onRequest = () => firstColumnId && setComposerOpen(firstColumnId);

    window.addEventListener("keydown", onKey);
    window.addEventListener("rb:new-card", onRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("rb:new-card", onRequest);
    };
  }, [firstColumnId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (
        query &&
        !task.title.toLowerCase().includes(query) &&
        !task.labels.some((l) => l.toLowerCase().includes(query)) &&
        !task.branches.some((b) => b.toLowerCase().includes(query))
      ) {
        return false;
      }
      if (labelFilter && !task.labels.includes(labelFilter)) return false;
      if (assigneeFilter && task.assignee !== assigneeFilter) return false;
      return true;
    });
  }, [tasks, search, labelFilter, assigneeFilter]);

  const byColumn = useCallback(
    (columnId: string) =>
      visible
        .filter((task) => task.columnId === columnId)
        .sort((a, b) => a.position - b.position),
    [visible],
  );

  const columnOf = (id: string): string | null => {
    if (data.columns.some((c) => c.id === id)) return id;
    return tasks.find((t) => t.id === id)?.columnId ?? null;
  };

  /**
   * One path for every way a card changes column — drag, the tick button, the
   * detail panel — so a markdown-backed card always goes through the preview.
   */
  const commitMove = async (
    taskId: string,
    targetColumnId: string,
    orderedIds: string[],
  ) => {
    const original = data.tasks.find((t) => t.id === taskId);
    if (!original) return;
    const changedColumn = original.columnId !== targetColumnId;

    try {
      if (changedColumn) {
        await api.boardAction({
          action: "move",
          taskId,
          columnId: targetColumnId,
          position: Math.max(orderedIds.indexOf(taskId), 0),
        });
      }
      await api.boardAction({
        action: "reorder",
        columnId: targetColumnId,
        orderedIds,
      });

      if (changedColumn) {
        const heading = data.columns.find((c) => c.id === targetColumnId)?.name;
        const from = data.columns.find((c) => c.id === original.columnId)?.name;

        toast.push({
          kind: "success",
          message: `Moved to ${heading}`,
          detail: original.markdownTaskId
            ? "Queued for the next commit to the markdown file"
            : from
              ? `from ${from}`
              : undefined,
        });
        if (original.markdownTaskId) {
          // Let the board header refresh its "changes not in the file" count.
          window.dispatchEvent(new CustomEvent("rb:pending-changed"));
        }
      }
      router.refresh();
    } catch (error) {
      setTasks(data.tasks);
      toast.push({
        kind: "error",
        message: "Could not move the card",
        detail: (error as Error).message,
      });
    }
  };

  const toggleDone = async (task: BoardTask) => {
    if (!doneColumnId || !firstColumnId) return;
    const target = task.columnId === doneColumnId ? firstColumnId : doneColumnId;
    const ordered = [...byColumn(target).map((t) => t.id), task.id];

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, columnId: target, position: ordered.length }
          : t,
      ),
    );
    await commitMove(task.id, target, ordered);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeTask = tasks.find((t) => t.id === active.id);
    const overColumn = columnOf(String(over.id));
    if (!activeTask || !overColumn || activeTask.columnId === overColumn) return;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === activeTask.id
          ? {
              ...task,
              columnId: overColumn,
              position: prev.filter((t) => t.columnId === overColumn).length,
            }
          : task,
      ),
    );
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const taskId = String(active.id);
    const current = tasks.find((t) => t.id === taskId);
    if (!current) return;

    const targetColumnId = columnOf(String(over.id)) ?? current.columnId;
    const columnTasks = byColumn(targetColumnId).map((t) => t.id);
    const from = columnTasks.indexOf(taskId);
    const to = columnTasks.indexOf(String(over.id));

    const ordered =
      from !== -1 && to !== -1 && from !== to
        ? arrayMove(columnTasks, from, to)
        : columnTasks.includes(taskId)
          ? columnTasks
          : [...columnTasks, taskId];

    setTasks((prev) =>
      prev.map((task) =>
        task.columnId === targetColumnId
          ? { ...task, position: ordered.indexOf(task.id) }
          : task,
      ),
    );

    await commitMove(taskId, targetColumnId, ordered);
  };

  const addCard = async (columnId: string, title: string) => {
    const optimisticId = `optimistic-${Date.now()}`;
    setTasks((prev) => [
      ...prev,
      {
        id: optimisticId,
        number: null,
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

    try {
      const { id } = (await api.boardAction({
        action: "create",
        columnId,
        title,
      })) as { id: string };
      setTasks((prev) =>
        prev.map((task) => (task.id === optimisticId ? { ...task, id } : task)),
      );
      router.refresh();
    } catch (error) {
      setTasks((prev) => prev.filter((task) => task.id !== optimisticId));
      toast.push({
        kind: "error",
        message: "Could not create the card",
        detail: (error as Error).message,
      });
    }
  };

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;
  const activeTask = tasks.find((t) => t.id === activeId) ?? null;
  const boardIsEmpty = tasks.length === 0;

  const closePanel = () => {
    setOpenTaskId(null);
    if (searchParams.get("card")) router.replace("/board");
  };

  return (
    <>
      <DndContext
        // Without a fixed id, dnd-kit numbers its accessibility announcements
        // differently on the server and in the browser, which React reports as
        // a hydration mismatch.
        id="repoboard-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) =>
          setActiveId(String(event.active.id))
        }
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setTasks(data.tasks);
        }}
      >
        <div className="rb-board-canvas flex min-h-0 w-full flex-1 gap-3 overflow-x-auto rounded-xl border border-border p-3">
          {data.columns.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              name={column.name}
              tasks={byColumn(column.id)}
              doneColumnId={doneColumnId}
              interactive={interactive}
              onOpen={(task) => setOpenTaskId(task.id)}
              onToggleDone={toggleDone}
              onAdd={addCard}
              composerOpen={composerOpen}
              setComposerOpen={setComposerOpen}
            />
          ))}

          {boardIsEmpty && (
            <div className="flex flex-1 items-center justify-center p-4">
              <EmptyState
                icon="▦"
                title="No cards yet"
                body="Import your GitHub issues, drive the board from a markdown file, or just add a card."
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {onImportIssues && (
                      <button className="rb-btn-primary" onClick={onImportIssues}>
                        Import GitHub issues
                      </button>
                    )}
                    <button
                      className="rb-btn"
                      onClick={() => router.push("/markdown-sync")}
                    >
                      Use a markdown file
                    </button>
                  </div>
                }
              />
            </div>
          )}
        </div>

        <DragOverlay
          dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22,1,0.36,1)" }}
        >
          {activeTask ? (
            <div className="w-[262px] rotate-2 rounded-[10px] border border-ink/15 bg-surface p-3 shadow-lift">
              <TaskCardBody task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openTask && (
        <CardDetailPanel
          task={openTask}
          columns={data.columns}
          markdownPath={data.markdownSource?.path ?? null}
          onClose={closePanel}
          onChange={(updated) =>
            setTasks((prev) =>
              prev.map((t) => (t.id === updated.id ? updated : t)),
            )
          }
          onDelete={(taskId) => {
            setTasks((prev) => prev.filter((t) => t.id !== taskId));
            closePanel();
            router.refresh();
          }}
        />
      )}

      {pendingWrite && (
        <MarkdownWriteDialog
          taskId={pendingWrite.taskId}
          targetHeading={pendingWrite.targetHeading}
          onDiscard={() => {
            setTasks((prev) =>
              prev.map((task) =>
                task.id === pendingWrite.taskId
                  ? { ...task, columnId: pendingWrite.previousColumnId }
                  : task,
              ),
            );
            api
              .boardAction({
                action: "move",
                taskId: pendingWrite.taskId,
                columnId: pendingWrite.previousColumnId,
                position: 0,
              })
              .finally(() => {
                setPendingWrite(null);
                router.refresh();
              });
          }}
          onDone={() => {
            setPendingWrite(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
