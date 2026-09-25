import { NextResponse } from "next/server";
import { z } from "zod";
import { getVerifiedRepository } from "@/lib/github/access";
import { GitHubClient } from "@/lib/github/client";
import {
  commitDocCreate,
  commitDocEdit,
  listDocs,
  previewDocCreate,
  previewDocEdit,
  readDoc,
  refreshDocs,
  setDocPinned,
  trackDoc,
  untrackDoc,
} from "@/lib/docs-service";

export const dynamic = "force-dynamic";

const denied = () => NextResponse.json({ error: "GitHub access required" }, { status: 401 });

function failure(error: unknown) {
  const err = error as Error & { code?: string; status?: number };
  if (err.code === "CONFLICT") {
    return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
  }
  if (err.status === 404) {
    return NextResponse.json({ error: "That file is not in the repository" }, { status: 404 });
  }
  return NextResponse.json({ error: err.message }, { status: 502 });
}

/**
 * GET              tracked documents with their last known progress
 * GET ?path=x.md   one document, fresh from GitHub
 * GET ?files=1     every markdown file in the repository, for the picker
 */
export async function GET(request: Request) {
  if (!(await getVerifiedRepository())) return denied();
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  try {
    if (path) return NextResponse.json(await readDoc(path));
    if (url.searchParams.get("files")) {
      const gh = await GitHubClient.create();
      return NextResponse.json({ files: await gh.listMarkdownFiles() });
    }
    return NextResponse.json({ docs: listDocs() });
  } catch (error) {
    return failure(error);
  }
}

const itemState = z.enum(["todo", "doing", "done", "cancelled"]);
const edit = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    state: itemState,
  }),
  z.object({
    type: z.literal("toggle"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    done: z.boolean(),
  }),
  z.object({ type: z.literal("add"), section: z.string().nullable(), title: z.string().min(1) }),
  z.object({ type: z.literal("replace"), content: z.string() }),
]);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("track"), path: z.string().min(1) }),
  z.object({ action: z.literal("untrack"), id: z.string() }),
  z.object({ action: z.literal("pin"), id: z.string(), pinned: z.boolean() }),
  z.object({ action: z.literal("refresh") }),
  z.object({
    action: z.literal("preview"),
    path: z.string().min(1),
    edits: z.array(edit).min(1),
    baseSha: z.string().nullable(),
  }),
  z.object({
    action: z.literal("commit"),
    path: z.string().min(1),
    edits: z.array(edit).min(1),
    expectedSha: z.string(),
    force: z.boolean().optional(),
  }),
  z.object({ action: z.literal("create-preview"), path: z.string().min(1), content: z.string() }),
  z.object({ action: z.literal("create"), path: z.string().min(1), content: z.string() }),
]);

export async function POST(request: Request) {
  if (!(await getVerifiedRepository())) return denied();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;
  try {
    switch (body.action) {
      case "track":
        return NextResponse.json(trackDoc(body.path));
      case "untrack":
        untrackDoc(body.id);
        return NextResponse.json({ ok: true });
      case "pin":
        setDocPinned(body.id, body.pinned);
        return NextResponse.json({ ok: true });
      case "refresh":
        return NextResponse.json(await refreshDocs());
      case "preview":
        return NextResponse.json(await previewDocEdit(body));
      case "commit":
        return NextResponse.json(await commitDocEdit(body));
      case "create-preview":
        return NextResponse.json(await previewDocCreate(body));
      case "create":
        return NextResponse.json(await commitDocCreate(body));
    }
  } catch (error) {
    return failure(error);
  }
}
