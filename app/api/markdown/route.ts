import { NextResponse } from "next/server";
import { z } from "zod";
import {
  commitMarkdownMove,
  getBoardData,
  previewMarkdownMove,
  setMarkdownSource,
  syncFromMarkdown,
} from "@/lib/board-service";
import { GitHubClient } from "@/lib/github/client";
import { parseMarkdown } from "@/lib/markdown/parser";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = getBoardData();
  if (!data.repository) {
    return NextResponse.json({ error: "Not connected" }, { status: 409 });
  }

  let files: string[] = [];
  let current: { content: string; sha: string } | null = null;

  try {
    const gh = await GitHubClient.create();
    files = await gh.listMarkdownFiles();
    if (data.markdownSource) {
      const file = await gh.getFile(data.markdownSource.path);
      current = { content: file.content, sha: file.sha };
    }
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message, source: data.markdownSource },
      { status: 502 },
    );
  }

  const remoteDrift =
    current && data.markdownSource?.lastKnownSha
      ? current.sha !== data.markdownSource.lastKnownSha
      : false;

  // The screen shows what the parser actually found, not a sample of what a
  // roadmap might look like.
  const parsed = current ? parseMarkdown(current.content) : null;

  return NextResponse.json({
    source: data.markdownSource,
    files,
    current,
    remoteDrift,
    columns: data.columns.map((c) => c.name),
    tasks:
      parsed?.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        heading: task.heading,
        done: task.done,
      })) ?? [],
    headings: parsed?.headings.map((h) => h.text) ?? [],
  });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-source"), path: z.string().min(1) }),
  z.object({ action: z.literal("sync") }),
  z.object({
    action: z.literal("preview"),
    taskId: z.string(),
    targetHeading: z.string(),
  }),
  z.object({
    action: z.literal("commit"),
    taskId: z.string(),
    targetHeading: z.string(),
    expectedSha: z.string(),
    force: z.boolean().optional(),
  }),
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

  const body = parsed.data;

  try {
    switch (body.action) {
      case "set-source": {
        const data = getBoardData();
        if (!data.repository) {
          return NextResponse.json(
            { error: "Not connected" },
            { status: 409 },
          );
        }
        const id = setMarkdownSource(data.repository.id, body.path);
        return NextResponse.json({ id, path: body.path });
      }
      case "sync":
        return NextResponse.json(await syncFromMarkdown());
      case "preview":
        return NextResponse.json(
          await previewMarkdownMove(body.taskId, body.targetHeading),
        );
      case "commit":
        return NextResponse.json(await commitMarkdownMove(body));
    }
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err.code === "CONFLICT") {
      return NextResponse.json({ error: err.message, conflict: true }, {
        status: 409,
      });
    }
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
