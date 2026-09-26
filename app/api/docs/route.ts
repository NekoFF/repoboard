import { NextResponse } from "next/server";
import { runAs } from "@/lib/actor";
import { getViewer } from "@/lib/github/access";

import { z } from "zod";
import { getVerifiedRepository } from "@/lib/github/access";
import { GitHubClient } from "@/lib/github/client";
import {
  commitDocCreate,
  createWorkspace,
  previewWorkspace,
  syncWorkspace,
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

const RAW_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

/**
 * GET              tracked documents with their last known progress
 * GET ?path=x.md   one document, fresh from GitHub
 * GET ?files=1     every markdown file in the repository, for the picker
 * GET ?all=1       every file in the repository, for pointing at a proof
 * GET ?text=path   any text file as it is now, to show the lines a proof names
 * GET ?raw=path    an image or PDF from the repository, for showing it here
 *                  (the token never reaches the browser, so it is fetched here)
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
    if (url.searchParams.get("all")) {
      const gh = await GitHubClient.create();
      return NextResponse.json({ files: await gh.listFiles() });
    }
    const text = url.searchParams.get("text");
    if (text) {
      const gh = await GitHubClient.create();
      const file = await gh.getFile(text);
      if (file.content.includes("\u0000")) return NextResponse.json({ error: "That file is not text" }, { status: 415 });
      return NextResponse.json({ path: text, content: file.content, sha: file.sha });
    }
    const raw = url.searchParams.get("raw");
    if (raw) {
      const type = RAW_TYPES[raw.split(".").pop()?.toLowerCase() ?? ""];
      if (!type) return NextResponse.json({ error: "Only images and PDFs are shown" }, { status: 415 });
      const gh = await GitHubClient.create();
      const { bytes, sha } = await gh.getFileBytes(raw);
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "content-type": type, "cache-control": "private, max-age=300", etag: `"${sha}"` },
      });
    }
    return NextResponse.json({ docs: listDocs() });
  } catch (error) {
    return failure(error);
  }
}

const itemState = z.enum(["todo", "doing", "review", "done", "cancelled"]);
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
  z.object({
    type: z.literal("note"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    author: z.string().min(1).max(40),
    text: z.string().min(1).max(4000),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("proof"),
    line: z.number().int().min(0),
    title: z.string(),
    id: z.string().nullish(),
    state: itemState,
    by: z.string().min(1).max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    proofs: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("link"), url: z.string().url().max(2000), label: z.string().max(300) }),
          z.object({
            kind: z.literal("place"),
            path: z.string().min(1).max(500),
            from: z.number().int().min(1).nullish(),
            to: z.number().int().min(1).nullish(),
          }),
          z.object({ kind: z.literal("quote"), text: z.string().min(1).max(4000) }),
          z.object({ kind: z.literal("image"), path: z.string().min(1).max(500), alt: z.string().max(300) }),
        ]),
      )
      .max(10),
  }),
  z.object({ type: z.literal("replace"), content: z.string() }),
]);
const attachment = z.object({ path: z.string().min(1).max(500), base64: z.string().min(1) });

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("track"), path: z.string().min(1) }),
  z.object({ action: z.literal("untrack"), id: z.string() }),
  z.object({ action: z.literal("pin"), id: z.string(), pinned: z.boolean() }),
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("sync-workspace") }),
  z.object({
    action: z.literal("workspace-preview"),
    templates: z.array(z.string()),
    readme: z.boolean(),
  }),
  z.object({
    action: z.literal("workspace-create"),
    templates: z.array(z.string()),
    readme: z.boolean(),
  }),
  z.object({
    action: z.literal("preview"),
    path: z.string().min(1),
    edits: z.array(edit).min(1),
    baseSha: z.string().nullable(),
    attachments: z.array(z.string()).max(10).optional(),
  }),
  z.object({
    action: z.literal("commit"),
    path: z.string().min(1),
    edits: z.array(edit).min(1),
    expectedSha: z.string(),
    force: z.boolean().optional(),
    attachments: z.array(attachment).max(10).optional(),
  }),
  z.object({ action: z.literal("create-preview"), path: z.string().min(1), content: z.string() }),
  z.object({ action: z.literal("create"), path: z.string().min(1), content: z.string() }),
]);

/** Every change made through this route is attributed to the token's owner. */
export async function POST(request: Request) {
  const login = await getViewer().catch(() => null);
  return runAs(login ? { name: login, kind: "person" } : null, () => handlePost(request));
}

async function handlePost(request: Request) {
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
      case "sync-workspace":
        return NextResponse.json(await syncWorkspace());
      case "workspace-preview":
        return NextResponse.json(await previewWorkspace(body));
      case "workspace-create":
        return NextResponse.json(await createWorkspace(body));
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
