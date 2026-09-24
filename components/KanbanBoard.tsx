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
import { SortableTaskCard, TaskCardBody } from "@/components/TaskCard";
import { CardDetailPanel } from "@/components/CardDetailPanel";
import { MarkdownWriteDialog } from "@/components/MarkdownWriteDialog";
import { EmptyState, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";

function Column({
  id,
  name,
  tasks,
  onOpen,
  onAdd,
  isEmptyBoard,
  composerOpen,
  setComposerOpen,
}: {
  id: string;
  name: string;
  tasks: BoardTask[];
  onOpen: (task: BoardTask) => void;
  onAdd: (columnId: string, title: string) => Promise<void>;
  isEmptyBoard: boolean;
  composerOpen: string | null;
  setComposerOpen: (columnId: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [title, setTitle] = useState("");
  const adding = composerOpen === id;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) requestAnimationFrame(() => inputRef.current?.focus());
  }, [adding]);

  const submit = async () => {
    const value = title.trim();
    if (!value) return;
    setTitle("");
    await onAdd(id, value);
    // Stay open: adding cards one after another is the common case.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[13px] font-semibold text-ink">{name}</span>
        <span className="rb-pill tabular-nums">{tasks.length}</span>
        <div className="flex-1" />
        <button
          className="rb-btn-ghost opacity-0 transition-opacity focus-visible:opacity-100 group-hover/board:opacity-100"
          onClick={() => setComposerOpen(adding ? null : id)}
          aria-label={`Add card to ${name}`}
        >
          +
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-[140px] flex-1 flex-col gap-2.5 rounded-xl border border-dashed p-1.5 transition-colors duration-150 ${
          isOver
            ? "border-ink/25 bg-pill/70"
            : "border-transparent hover:border-border/60"
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

        {tasks.length === 0 && !adding && !isEmptyBoard && (
          <p className="px-2 py-3 text-[11.5px] text-muted/70">
            Drop a card here
          </p>
        )}

        {adding ? (
          <div className="rb-enter flex flex-col gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-card">
            <input
              ref={inputRef}
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted/70"
              placeholder="What needs doing?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                } else if (event.key === "Escape") {
                  setTitle("");
                  setComposerOpen(null);
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button className="rb-btn-primary" onClick={submit}>
                Add
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
                <span className="rb-kbd">↵</span> to add
              </span>
            </div>
          </div>
        ) : (
          <button
            className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[12px] text-muted transition-colors hover:bg-pill hover:text-ink"
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

  // Server data wins whenever it changes underneath us (sync, refresh, etc).
  useEffect(() => setTasks(data.tasks), [data.tasks]);

  // Deep link: /board?card=<id> opens the panel, so ⌘K results can land on a card.
  useEffect(() => {
    const card = searchParams.get("card");
    if (card) setOpenTaskId(card);
  }, [searchParams]);

  // "n" opens the composer in the first column, the way a keyboard-first tool should.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey) return;
      if (event.key.toLowerCase() === "n" && data.columns[0]) {
        event.preventDefault();
        setComposerOpen(data.columns[0].id);
      }
    };
    const onRequest = () =>
      data.columns[0] && setComposerOpen(data.columns[0].id);

    window.addEventListener("keydown", onKey);
    window.addEventListener("rb:new-card", onRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("rb:new-card", onRequest);
    };
  }, [data.columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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

  /** Live cross-column preview while dragging, so the gap opens under the cursor. */
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
    const original = data.tasks.find((t) => t.id === taskId);
    const current = tasks.find((t) => t.id === taskId);
    if (!original || !current) return;

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

    const changedColumn = original.columnId !== targetColumnId;

    try {
      if (changedColumn) {
        await api.boardAction({
          action: "move",
          taskId,
          columnId: targetColumnId,
          position: ordered.indexOf(taskId),
        });
      }
      await api.boardAction({
        action: "reorder",
        columnId: targetColumnId,
        orderedIds: ordered,
      });

      if (changedColumn) {
        const heading = data.columns.find((c) => c.id === targetColumnId)?.name;
        const fromName = data.columns.find(
          (c) => c.id === original.columnId,
        )?.name;

        if (original.markdownTaskId && heading) {
          // Markdown-backed cards need a GitHub write — always previewed first.
          setPendingWrite({
            taskId,
            targetHeading: heading,
            previousColumnId: original.columnId,
          });
        } else {
          toast.push({
            kind: "success",
            message: `Moved to ${heading}`,
            detail: fromName ? `from ${fromName}` : undefined,
          });
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

  const addCard = async (columnId: string, title: string) => {
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: BoardTask = {
      id: optimisticId,
      columnId,
      title,
      description: null,
      assignee: null,
      dueDate: null,
      position: tasks.filter((t) => t.columnId === columnId).length,
      checklist: [],
      markdownTaskId: null,
      labels: [],
      branches: [],
      commits: [],
      pullRequests: [],
      issues: [],
    };
    setTasks((prev) => [...prev, optimistic]);

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
        <div className="group/board flex w-full flex-1 gap-3 overflow-x-auto pb-2">
          {data.columns.map((column) => (
            <Column
              key={column.id}
              id={column.id}
              name={column.name}
              tasks={byColumn(column.id)}
              onOpen={(task) => setOpenTaskId(task.id)}
              onAdd={addCard}
              isEmptyBoard={boardIsEmpty}
              composerOpen={composerOpen}
              setComposerOpen={setComposerOpen}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
          {activeTask ? (
            <div className="w-[260px] rotate-1 rounded-xl border border-ink/15 bg-surface p-3 shadow-lift">
              <TaskCardBody task={activeTask} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {boardIsEmpty && (
        <EmptyState
          icon="▦"
          title="This board has no cards yet"
          body="Import your GitHub issues, pick a markdown file to sync, or just add a card. Everything you add stays linked to the repository."
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
                Set up markdown sync
              </button>
              <button
                className="rb-btn"
                onClick={() =>
                  data.columns[0] && setComposerOpen(data.columns[0].id)
                }
              >
                Add a card
              </button>
            </div>
          }
        />
      )}

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
            // Discarding the write puts the card back where it came from, so the
            // board never claims a state the markdown file does not have.
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
