import { NextResponse } from "next/server";
import { runAs } from "@/lib/actor";
import { getViewer } from "@/lib/github/access";

import { z } from "zod";
import type { ChecklistItem } from "@/lib/checklist";
import { GitHubClient } from "@/lib/github/client";
import { getVerifiedRepository } from "@/lib/github/access";
import {
  createTask,
  deleteTask,
  getBoardData,
  importIssues,
  createMilestone,
  createBoard,
  updateBoard,
  archiveBoard,
  listBoards,
  updateMilestone,
  deleteMilestone,
  reorderColumn,
  restoreTask,
  taskBelongsToBoard,
  boardStateStatus,
  pullBoardState,
  pushBoardState,
  linkTask,
  logActivity,
  moveTaskLocally,
  unlinkTask,
  updateTask,
} from "@/lib/board-service";

export const dynamic = "force-dynamic";

/** GET ?board=<id> for one board (the primary one by default), ?list=1 for all of them. */
export async function GET(request: Request) {
  if (!await getVerifiedRepository()) {
    return NextResponse.json({ error: "GitHub access required" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("list")) return NextResponse.json({ boards: listBoards() });
  const boardId = url.searchParams.get("board");
  const data = getBoardData(boardId);
  if (boardId && !data.boardId) return NextResponse.json({ error: "No such board in this project" }, { status: 404 });
  return NextResponse.json(data);
}

const boardFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).nullish(),
  color: z.string().max(20).nullish(),
  art: z.string().max(30).nullish(),
  owner: z.string().max(100).nullish(),
};
const boardSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("board-create"), ...boardFields }),
  z.object({ action: z.literal("board-update"), boardId: z.string(), ...boardFields, name: boardFields.name.optional() }),
  z.object({ action: z.literal("board-archive"), boardId: z.string() }),
]);

/** One checklist item and, recursively, its sub-items (lib/checklist.ts). */
const checklistItem: z.ZodType<ChecklistItem> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    text: z.string().max(2000),
    done: z.boolean(),
    notes: z.string().max(40_000).nullish(),
    assignee: z.string().max(100).nullish(),
    due: z.number().nullish(),
    children: z.array(checklistItem).max(200).optional(),
    comments: z
      .array(
        z.object({
          id: z.string(),
          author: z.string().max(100),
          kind: z.enum(["person", "agent"]),
          text: z.string().max(10_000),
          at: z.number(),
        }),
      )
      .max(500)
      .optional(),
  }),
) as z.ZodType<ChecklistItem>;

const createSchema = z.object({
  action: z.literal("create"),
  columnId: z.string(),
  title: z.string().min(1),
  description: z.string().nullish(),
  assignee: z.string().nullish(),
  labels: z.array(z.string()).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  milestoneId: z.string().nullish(),
  dueDate: z.number().nullish(),
});

const moveSchema = z.object({
  action: z.literal("move"),
  taskId: z.string(),
  columnId: z.string(),
  position: z.number().int().min(0),
});

const updateSchema = z.object({
  action: z.literal("update"),
  taskId: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  assignee: z.string().nullish(),
  dueDate: z.number().nullish(),
  checklist: z.array(checklistItem).max(500).optional(),
  labels: z.array(z.string()).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  milestoneId: z.string().nullish(),
});

const linkSchema = z.object({
  action: z.literal("link"),
  taskId: z.string(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  pullRequest: z.number().int().optional(),
  issue: z.number().int().optional(),
});

const unlinkSchema = z.object({
  action: z.literal("unlink"),
  taskId: z.string(),
  branch: z.string().optional(),
  pullRequest: z.number().int().optional(),
  issue: z.number().int().optional(),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  taskId: z.string(),
});

const reorderSchema = z.object({
  action: z.literal("reorder"),
  columnId: z.string(),
  orderedIds: z.array(z.string()),
});

const restoreSchema = z.object({
  action: z.literal("restore"),
  taskId: z.string(),
});

const commentSchema = z.object({
  action: z.literal("comment"),
  taskId: z.string(),
  message: z.string().min(1),
});

// Literal per option: a discriminated union needs a literal discriminator.
const boardStatusSchema = z.object({ action: z.literal("board-status") });
const boardPullSchema = z.object({ action: z.literal("board-pull") });
const boardPushSchema = z.object({ action: z.literal("board-push") });

const importSchema = z.object({
  action: z.literal("import-issues"),
  numbers: z.array(z.number().int()),
  columnId: z.string(),
});

const milestoneCreateSchema = z.object({
  action: z.literal("milestone-create"),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  dueDate: z.number().nullish(),
});
const milestoneUpdateSchema = z.object({
  action: z.literal("milestone-update"),
  milestoneId: z.string(),
  name: z.string().trim().min(1).optional(),
  description: z.string().nullish(),
  dueDate: z.number().nullish(),
});
const milestoneDeleteSchema = z.object({
  action: z.literal("milestone-delete"),
  milestoneId: z.string(),
});

const bodySchema = z.discriminatedUnion("action", [
  milestoneCreateSchema,
  milestoneUpdateSchema,
  milestoneDeleteSchema,
  createSchema,
  moveSchema,
  updateSchema,
  linkSchema,
  unlinkSchema,
  deleteSchema,
  reorderSchema,
  importSchema,
  restoreSchema,
  commentSchema,
  boardStatusSchema,
  boardPullSchema,
  boardPushSchema,
]);

/** Every change made through this route is attributed to the token's owner. */
export async function POST(request: Request) {
  const login = await getViewer().catch(() => null);
  return runAs(login ? { name: login, kind: "person" } : null, () => handlePost(request));
}

async function handlePost(request: Request) {
  if (!await getVerifiedRepository()) {
    return NextResponse.json({ error: "GitHub access required" }, { status: 401 });
  }
  const raw = await request.json().catch(() => null);

  // Managing the boards themselves.
  if (typeof raw?.action === "string" && raw.action.startsWith("board-") && !["board-status", "board-pull", "board-push"].includes(raw.action)) {
    const managed = boardSchema.safeParse(raw);
    if (!managed.success) return NextResponse.json({ error: managed.error.issues[0].message }, { status: 400 });
    try {
      const b = managed.data;
      if (b.action === "board-create") return NextResponse.json({ id: createBoard(b) });
      if (b.action === "board-update") {
        updateBoard(b.boardId, b);
        return NextResponse.json({ ok: true });
      }
      archiveBoard(b.boardId);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  // Every card action names the board it is about; without one, the primary board.
  const requestedBoard = typeof raw?.boardId === "string" ? raw.boardId : null;
  const data = getBoardData(requestedBoard);
  if (requestedBoard && !data.boardId) {
    return NextResponse.json({ error: "No such board in this project" }, { status: 404 });
  }
  if (!data.repository || !data.boardId) {
    return NextResponse.json(
      { error: "Connect a repository first" },
      { status: 409 },
    );
  }

  const body = parsed.data;
  const columnIds = new Set(data.columns.map((column) => column.id));
  const taskIds = new Set(data.tasks.map((task) => task.id));
  const milestoneIds = new Set(data.milestones.map((m) => m.id));
  const invalidTarget =
    ((body.action === "create" || body.action === "import-issues" || body.action === "move" || body.action === "reorder") && !columnIds.has(body.columnId)) ||
    ((body.action === "move" || body.action === "update" || body.action === "link" || body.action === "unlink" || body.action === "delete" || body.action === "comment") && !taskIds.has(body.taskId)) ||
    (body.action === "restore" && !taskBelongsToBoard(body.taskId, data.boardId)) ||
    (body.action === "reorder" && body.orderedIds.some((taskId) => !taskIds.has(taskId))) ||
    ((body.action === "milestone-update" || body.action === "milestone-delete") &&
      !milestoneIds.has(body.milestoneId)) ||
    ((body.action === "create" || body.action === "update") &&
      body.milestoneId != null &&
      !milestoneIds.has(body.milestoneId));
  if (invalidTarget) {
    return NextResponse.json({ error: "Card or column not found" }, { status: 404 });
  }

  switch (body.action) {
    case "milestone-create": {
      const id = createMilestone({
        boardId: data.boardId,
        repositoryId: data.repository.id,
        name: body.name,
        description: body.description ?? null,
        dueDate: body.dueDate ?? null,
      });
      return NextResponse.json({ id });
    }
    case "milestone-update":
      updateMilestone(body.milestoneId, body);
      return NextResponse.json({ ok: true });
    case "milestone-delete":
      deleteMilestone(body.milestoneId);
      return NextResponse.json({ ok: true });
    case "create": {
      const id = createTask({
        boardId: data.boardId,
        columnId: body.columnId,
        title: body.title,
        description: body.description ?? null,
        assignee: body.assignee ?? null,
        labels: body.labels,
        priority: body.priority,
        milestoneId: body.milestoneId ?? null,
        dueDate: body.dueDate ?? null,
        repositoryId: data.repository.id,
      });
      return NextResponse.json({ id });
    }
    case "move": {
      const moved = moveTaskLocally(body.taskId, body.columnId, body.position);
      if (!moved) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      if (moved.fromColumn !== moved.toColumn) {
        const task = data.tasks.find((t) => t.id === body.taskId);
        logActivity({
          repositoryId: data.repository.id,
          taskId: body.taskId,
          type: "card_moved",
          message: `moved ${task?.title ?? "a card"} from ${moved.fromColumn} to ${moved.toColumn}`,
        });
      }
      return NextResponse.json({ ...moved });
    }
    case "update": {
      updateTask(body.taskId, {
        title: body.title,
        description: body.description,
        assignee: body.assignee,
        dueDate: body.dueDate,
        checklist: body.checklist,
        labels: body.labels,
        priority: body.priority,
        milestoneId: body.milestoneId,
      });
      return NextResponse.json({ ok: true });
    }
    case "link": {
      linkTask({ ...body, repositoryId: data.repository.id });
      return NextResponse.json({ ok: true });
    }
    case "unlink": {
      unlinkTask(body);
      return NextResponse.json({ ok: true });
    }
    case "reorder": {
      reorderColumn(body.columnId, body.orderedIds);
      return NextResponse.json({ ok: true });
    }
    case "import-issues": {
      const gh = await GitHubClient.create();
      const all = await gh.listIssues();
      const wanted = all.filter((issue) => body.numbers.includes(issue.number));
      const result = importIssues({
        boardId: data.boardId,
        columnId: body.columnId,
        repositoryId: data.repository.id,
        issues: wanted.map((issue) => ({
          number: issue.number,
          title: issue.title,
          labels: issue.labels,
        })),
      });
      return NextResponse.json(result);
    }
    case "board-status":
      return NextResponse.json(await boardStateStatus());
    case "board-pull":
      return NextResponse.json((await pullBoardState()) ?? { added: 0, updated: 0 });
    case "board-push":
      return NextResponse.json(await pushBoardState());
    case "restore": {
      restoreTask(body.taskId);
      logActivity({
        repositoryId: data.repository.id,
        taskId: body.taskId,
        type: "card_restored",
        message: `restored ${data.tasks.find((t) => t.id === body.taskId)?.title ?? "a card"}`,
      });
      return NextResponse.json({ ok: true });
    }
    case "comment": {
      logActivity({
        repositoryId: data.repository.id,
        taskId: body.taskId,
        type: "comment",
        message: body.message,
      });
      return NextResponse.json({ ok: true });
    }
    case "delete": {
      deleteTask(body.taskId);
      logActivity({
        repositoryId: data.repository.id,
        taskId: body.taskId,
        type: "card_deleted",
        message: `deleted ${data.tasks.find((t) => t.id === body.taskId)?.title ?? "a card"}`,
      });
      return NextResponse.json({ ok: true });
    }
  }
}
