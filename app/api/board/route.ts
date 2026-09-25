import { NextResponse } from "next/server";
import { z } from "zod";
import { GitHubClient } from "@/lib/github/client";
import {
  createTask,
  deleteTask,
  getBoardData,
  importIssues,
  reorderColumn,
  restoreTask,
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

export async function GET() {
  return NextResponse.json(getBoardData());
}

const createSchema = z.object({
  action: z.literal("create"),
  columnId: z.string(),
  title: z.string().min(1),
  description: z.string().nullish(),
  assignee: z.string().nullish(),
  labels: z.array(z.string()).optional(),
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
  checklist: z
    .array(z.object({ id: z.string(), text: z.string(), done: z.boolean() }))
    .optional(),
  labels: z.array(z.string()).optional(),
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

const bodySchema = z.discriminatedUnion("action", [
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

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const data = getBoardData();
  if (!data.repository || !data.boardId) {
    return NextResponse.json(
      { error: "Connect a repository first" },
      { status: 409 },
    );
  }

  const body = parsed.data;

  switch (body.action) {
    case "create": {
      const id = createTask({
        boardId: data.boardId,
        columnId: body.columnId,
        title: body.title,
        description: body.description ?? null,
        assignee: body.assignee ?? null,
        labels: body.labels,
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
          message: `Card moved ${moved.fromColumn} → ${moved.toColumn}${
            task ? `: ${task.title}` : ""
          }`,
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
        message: "Card restored",
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
        type: "card_deleted",
        message: `Card deleted`,
      });
      return NextResponse.json({ ok: true });
    }
  }
}
