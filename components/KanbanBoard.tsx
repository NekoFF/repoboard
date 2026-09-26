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
import { Plus } from "lucide-react";
import { useShell } from "@/components/shell/ShellContext";
import type { BoardData, BoardMilestone, BoardTask } from "@/lib/board-service";
import { SortableTaskCard, StaticTaskCard, TaskCardBody } from "@/components/TaskCard";
import { BoardCalendar } from "@/components/BoardCalendar";
import { BoardList } from "@/components/BoardList";
import { EmptyState, StatusIcon, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { applyFilter, type BoardFilter } from "@/lib/client/filters";
import { useHotkeys } from "@/lib/client/hotkeys";
import { useCommitMove } from "@/lib/client/moves";
import { statusOfColumn } from "@/lib/status";

export type BoardView = "board" | "list" | "calendar";

function Column({
  id,
  name,
  tasks,
  doneColumnId,
  interactive,
  selectedId,
  milestones,
  mentions,
  onOpen,
  onSelect,
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
  selectedId: string | null;
  milestones: Map<string, BoardMilestone>;
  mentions: Map<number, number>;
  onOpen: (task: BoardTask) => void;
  onSelect: (task: BoardTask) => void;
  onToggleDone: (task: BoardTask) => void;
  onAdd: (columnId: string, title: string) => Promise<void>;
  composerOpen: string | null;
  setComposerOpen: (columnId: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  // Read-only people (lib/roles.ts) add nothing; known from the first render, unlike drag.
  const canAdd = useShell().role !== "viewer";
  const [title, setTitle] = useState("");
  const adding = composerOpen === id;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const status = statusOfColumn(name);

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
    <section
      aria-label={name}
      className={`rb-column min-w-[240px] flex-1 basis-0 transition-[background-color,box-shadow] duration-100 ${
        isOver ? "bg-pill ring-1 ring-inset ring-border-strong" : ""
      }`}
    >
      <div className="flex h-10 items-center gap-2 px-3">
        <StatusIcon status={status} />
        <h2 className="text-sm font-semibold text-ink">{name}</h2>
        <span className="text-xs tabular-nums text-faint">{tasks.length}</span>
        <div className="flex-1" />
        {canAdd && (
          <button
            className="rb-icon-btn size-6"
            onClick={() => setComposerOpen(adding ? null : id)}
            title={`Add a card to ${name}`}
            aria-label={`Add a card to ${name}`}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      <div ref={setNodeRef} className="rb-scroll-thin flex min-h-[72px] flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
        {adding && (
          <div className="rb-enter rounded-lg border border-ink/30 bg-surface p-2.5 shadow-card">
            <textarea
              ref={inputRef}
              rows={2}
              className="w-full resize-none bg-transparent text-sm leading-snug text-ink outline-none placeholder:text-faint"
              placeholder="What needs doing?"
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
            <div className="mt-1 flex items-center gap-1.5">
              <button className="rb-btn-primary rb-btn-sm" onClick={submit} disabled={!title.trim()}>
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
            </div>
          </div>
        )}

        {interactive ? (
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                milestone={task.milestoneId ? milestones.get(task.milestoneId) : null}
                isDone={task.columnId === doneColumnId}
                selected={task.id === selectedId}
                mentions={task.number != null ? mentions.get(task.number) : 0}
                onOpen={() => onOpen(task)}
                onSelect={() => onSelect(task)}
                onToggleDone={() => onToggleDone(task)}
              />
            ))}
          </SortableContext>
        ) : (
          tasks.map((task) => (
            <StaticTaskCard
              key={task.id}
              task={task}
              milestone={task.milestoneId ? milestones.get(task.milestoneId) : null}
              isDone={task.columnId === doneColumnId}
              onOpen={() => onOpen(task)}
            />
          ))
        )}

        {!adding && tasks.length === 0 && !canAdd && (
          <p className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-faint">Nothing here</p>
        )}
        {!adding && tasks.length === 0 && canAdd && (
          <button
            className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border-strong/70 text-xs text-faint transition-colors hover:border-border-strong hover:text-muted"
            onClick={() => setComposerOpen(id)}
          >
            Drop a card here or add one
          </button>
        )}
      </div>
    </section>
  );
}

export function KanbanBoard({
  data,
  filter,
  view,
  connected,
  mentions,
  onImportIssues,
  onCreate,
}: {
  data: BoardData;
  filter: BoardFilter;
  view: BoardView;
  connected: boolean;
  /** Commits and pull requests that mention each card number. */
  mentions: Map<number, number>;
  onImportIssues?: () => void;
  /** Opens the full "new card" dialog. */
  onCreate: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [tasks, setTasks] = useState<BoardTask[]>(data.tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  // A card opens as its own page; old ?card= links are forwarded there.
  const openCard = useCallback((id: string) => router.push(`/board/card/${id}`), [router]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState<string | null>(null);
  // Whether columns continue past either edge, for the fade that says so.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measureMore = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measureMore();
    const resize = new ResizeObserver(measureMore);
    resize.observe(el);
    return () => resize.disconnect();
  }, [measureMore, data.columns.length]);

  useEffect(() => setTasks(data.tasks), [data.tasks]);

  // dnd-kit numbers its accessibility announcements as it renders, which the
  // server and the browser do differently. Drag is a pointer feature anyway, so
  // the first paint is the same board without it.
  const [interactive, setInteractive] = useState(false);
  // Read-only people (lib/roles.ts) look at the board; nothing drags.
  const { role } = useShell();
  useEffect(() => setInteractive(role !== "viewer"), [role]);

  useEffect(() => {
    const card = searchParams.get("card");
    if (card) router.replace(`/board/card/${card}`);
  }, [searchParams, router]);

  const milestoneById = useMemo(
    () => new Map(data.milestones.map((m) => [m.id, m])),
    [data.milestones],
  );
  const doneColumnId =
    data.columns.find((c) => statusOfColumn(c.name) === "done")?.id ?? null;
  const firstColumnId = data.columns[0]?.id ?? null;

  useEffect(() => {
    const onRequest = (event: Event) => {
      const columnId = (event as CustomEvent<string | undefined>).detail ?? firstColumnId;
      if (columnId) setComposerOpen(columnId);
    };
    window.addEventListener("rb:new-card-inline", onRequest);
    return () => window.removeEventListener("rb:new-card-inline", onRequest);
  }, [firstColumnId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useMemo(() => applyFilter(tasks, filter, data), [tasks, filter, data]);

  const byColumn = useCallback(
    (columnId: string) =>
      visible.filter((task) => task.columnId === columnId).sort((a, b) => a.position - b.position),
    [visible],
  );

  // Every card of a column, filtered or not: a move while a filter is on must
  // not scramble the cards the filter hides.
  const allIn = (columnId: string, except?: string) =>
    tasks
      .filter((t) => t.columnId === columnId && t.id !== except)
      .sort((a, b) => a.position - b.position)
      .map((t) => t.id);

  /** The full column order after placing `taskId` where it now is among the visible cards. */
  const fullOrder = (columnId: string, visibleOrder: string[], taskId: string) => {
    const rest = allIn(columnId, taskId);
    const at = visibleOrder.indexOf(taskId);
    const before = visibleOrder.slice(0, at).reverse().find((id) => rest.includes(id));
    const after = visibleOrder.slice(at + 1).find((id) => rest.includes(id));
    const index = before ? rest.indexOf(before) + 1 : after ? rest.indexOf(after) : rest.length;
    rest.splice(index, 0, taskId);
    return rest;
  };

  const columnOf = (id: string): string | null => {
    if (data.columns.some((c) => c.id === id)) return id;
    return tasks.find((t) => t.id === id)?.columnId ?? null;
  };

  // The one path for every column change (see lib/client/moves.ts).
  const commitMove = useCommitMove(data, {
    revert: () => setTasks(data.tasks),
    undo: (taskId, columnId) =>
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, columnId } : t))),
  });

  const moveTo = async (task: BoardTask, columnId: string) => {
    if (task.columnId === columnId) return;
    const ordered = [...allIn(columnId, task.id), task.id];
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, columnId, position: ordered.length - 1 } : t)),
    );
    await commitMove(task.id, columnId, ordered);
  };

  const toggleDone = async (task: BoardTask) => {
    if (!doneColumnId || !firstColumnId) return;
    await moveTo(task, task.columnId === doneColumnId ? firstColumnId : doneColumnId);
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
          ? { ...task, columnId: overColumn, position: prev.filter((t) => t.columnId === overColumn).length }
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
    const visibleOrder =
      from !== -1 && to !== -1 && from !== to
        ? arrayMove(columnTasks, from, to)
        : columnTasks.includes(taskId)
          ? columnTasks
          : [...columnTasks, taskId];
    const ordered = fullOrder(targetColumnId, visibleOrder, taskId);

    setTasks((prev) =>
      prev.map((task) =>
        task.columnId === targetColumnId ? { ...task, position: ordered.indexOf(task.id) } : task,
      ),
    );
    await commitMove(taskId, targetColumnId, ordered);
  };

  const addCard = async (columnId: string, title: string) => {
    const optimisticId = `optimistic-${Date.now()}`;
    setTasks((prev) => [
      {
        id: optimisticId,
        number: null,
        columnId,
        title,
        description: null,
        assignee: null,
        dueDate: null,
        position: -1,
        priority: 0,
        milestoneId: null,
        updatedAt: Date.now(),
        checklist: [],
        markdownTaskId: null,
        labels: [],
        branches: [],
        commits: [],
        pullRequests: [],
        issues: [],
      },
      ...prev,
    ]);
    try {
      const { id } = (await api.boardAction({ boardId: data.boardId, action: "create", columnId, title })) as { id: string };
      setTasks((prev) => prev.map((task) => (task.id === optimisticId ? { ...task, id } : task)));
      router.refresh();
    } catch (error) {
      setTasks((prev) => prev.filter((task) => task.id !== optimisticId));
      toast.push({ kind: "error", message: "Could not create the card", detail: (error as Error).message });
    }
  };

  /* ----------------------------------------------------------- keyboard -- */

  // The order the arrow keys walk through, matching what is on screen.
  const grid = useMemo(
    () => data.columns.map((c) => byColumn(c.id).map((t) => t.id)),
    [data.columns, byColumn],
  );
  const flat = useMemo(() => grid.flat(), [grid]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      requestAnimationFrame(() =>
        document.querySelector(`[data-card-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
      );
    }
  }, []);

  const step = (dx: number, dy: number) => {
    if (!selectedId) {
      select(flat[0] ?? null);
      return;
    }
    if (view !== "board") {
      const index = flat.indexOf(selectedId);
      select(flat[Math.min(Math.max(index + dy + dx, 0), flat.length - 1)] ?? null);
      return;
    }
    const col = grid.findIndex((ids) => ids.includes(selectedId));
    const row = grid[col]?.indexOf(selectedId) ?? 0;
    if (dy) {
      const ids = grid[col];
      select(ids[Math.min(Math.max(row + dy, 0), ids.length - 1)] ?? selectedId);
      return;
    }
    let next = col + dx;
    while (next >= 0 && next < grid.length && grid[next].length === 0) next += dx;
    if (next < 0 || next >= grid.length) return;
    select(grid[next][Math.min(row, grid[next].length - 1)]);
  };

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  useHotkeys(
    {
      ArrowDown: () => step(0, 1),
      ArrowUp: () => step(0, -1),
      ArrowRight: () => step(1, 0),
      ArrowLeft: () => step(-1, 0),
      j: () => step(0, 1),
      k: () => step(0, -1),
      // Enter on a focused button or link is that control's, not the board's.
      Enter: (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, [data-card-id]")) return;
        if (selectedTask) openCard(selectedTask.id);
      },
      x: () => selectedTask && toggleDone(selectedTask),
      Escape: () => setSelectedId(null),
      c: onCreate,
      ...Object.fromEntries(
        data.columns.slice(0, 9).map((column, index) => [
          String(index + 1),
          () => selectedTask && moveTo(selectedTask, column.id),
        ]),
      ),
    },
    { enabled: view !== "calendar" },
  );

  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  const empty = tasks.length === 0;

  return (
    <>
      {empty ? (
        <div className="rb-board-canvas flex flex-1 items-center justify-center" style={{ paddingRight: "var(--rb-rail)" }}>
          <EmptyState
            title="Nothing on the board yet"
            body={
              data.board?.primary === false
                ? `Write the first card for ${data.board.name}, or bring in issues from GitHub.`
                : "Start from what already exists — your GitHub issues or a checklist in a markdown file — or write the first card yourself."
            }
            action={
              <>
                <button className="rb-btn-primary" onClick={onCreate}>
                  <Plus className="size-3.5" /> New card
                </button>
                {onImportIssues && (
                  <button className="rb-btn" onClick={onImportIssues}>
                    Import GitHub issues
                  </button>
                )}
                {data.board?.primary !== false && (
                  <button className="rb-btn" onClick={() => router.push("/docs")}>
                    Use a markdown file
                  </button>
                )}
              </>
            }
          />
        </div>
      ) : view === "calendar" ? (
        <BoardCalendar tasks={visible} columns={data.columns} onOpen={(task) => openCard(task.id)} />
      ) : view === "list" ? (
        <BoardList
          data={data}
          tasks={visible}
          selectedId={selectedId}
          mentions={mentions}
          onSelect={(task) => setSelectedId(task.id)}
          onOpen={(task) => openCard(task.id)}
          onToggleDone={toggleDone}
          onMove={moveTo}
        />
      ) : (
        <DndContext
          // Without a fixed id, dnd-kit numbers its accessibility announcements
          // differently on the server and in the browser (a hydration mismatch).
          id="repoboard-board"
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setTasks(data.tasks);
          }}
        >
          {/* The background runs behind the rail; the scrolling columns stop
              short of it, and fade at the edge when there are more. */}
          <div className="rb-board-canvas flex min-h-0 w-full flex-1" style={{ paddingRight: "var(--rb-rail)" }}>
          <div
            ref={scroller}
            className="rb-board-scroll flex min-h-0 min-w-0 flex-1 gap-2.5 overflow-x-auto p-3 lg:p-4"
            data-more={more.right ? "right" : undefined}
            data-less={more.left ? "left" : undefined}
            onScroll={measureMore}
          >
            {data.columns.map((column) => (
              <Column
                key={column.id}
                id={column.id}
                name={column.name}
                tasks={byColumn(column.id)}
                doneColumnId={doneColumnId}
                interactive={interactive}
                selectedId={selectedId}
                milestones={milestoneById}
                mentions={mentions}
                onOpen={(task) => openCard(task.id)}
                onSelect={(task) => setSelectedId(task.id)}
                onToggleDone={toggleDone}
                onAdd={addCard}
                composerOpen={composerOpen}
                setComposerOpen={setComposerOpen}
              />
            ))}
          </div>
          </div>

          <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
            {activeTask ? (
              <div className="w-[280px] rotate-[1.5deg] rounded-lg border border-border-strong bg-surface p-2.5 shadow-lift">
                <TaskCardBody
                  task={activeTask}
                  milestone={activeTask.milestoneId ? milestoneById.get(activeTask.milestoneId) : null}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

    </>
  );
}
