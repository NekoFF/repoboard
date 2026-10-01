import { NextResponse } from "next/server";
import { z } from "zod";
import { runAs } from "@/lib/actor";
import { currentWho, getVerifiedRepository, getViewer, invalidateAccessCache } from "@/lib/github/access";
import { activeHost, getAuthProvider, listProjects } from "@/lib/github/auth-provider";
import { installUrl } from "@/lib/github/app";
import { GitLabClient } from "@/lib/gitlab/client";
import { closePlanOffer, movePlan, planPeople, planStatus, previewPlanMove, openPlanAt } from "@/lib/plan-move";
import { repoSlug } from "@/lib/github/slug";
import type { PlanLocation } from "@/lib/plan";

/**
 * Where the open project keeps its plan (lib/plan.ts, lib/plan-move.ts):
 * the status, a look at a move before it happens, the move itself, and who
 * can open the plan. Only a project admin moves it.
 */
export const dynamic = "force-dynamic";

function denied() {
  return NextResponse.json({ error: "GitHub access required" }, { status: 401 });
}

function status() {
  const project = listProjects().find((p) => p.active);
  return planStatus({ via: project?.via === "github" ? "github" : "key", host: activeHost(), installUrl: installUrl() });
}

export async function GET(request: Request) {
  if (!(await getVerifiedRepository())) return denied();
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("people")) return NextResponse.json(await planPeople());
    return NextResponse.json({ status: status() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

const location = z
  .object({
    mode: z.enum(["main", "branch", "repo"]),
    repo: z.string().max(200).nullable().optional(),
  })
  .transform((l): PlanLocation => ({ mode: l.mode, repo: l.mode === "repo" && l.repo ? repoSlug(l.repo) : null }));

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), to: location }),
  z.object({ action: z.literal("move"), to: location, leaveNote: z.boolean(), removeOld: z.boolean() }),
  z.object({ action: z.literal("offer-seen") }),
  z.object({ action: z.literal("use"), to: location }),
  z.object({ action: z.literal("create"), name: z.string().regex(/^[\w.-]{1,100}$/, "Use letters, numbers, dots, dashes") }),
]);

export async function POST(request: Request) {
  const login = await getViewer().catch(() => null);
  return runAs(login ? { name: login, kind: "person" } : null, () => handlePost(request));
}

async function handlePost(request: Request) {
  if (!(await getVerifiedRepository())) return denied();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  const who = await currentWho();
  if (body.action === "offer-seen") {
    closePlanOffer();
    return NextResponse.json({ ok: true });
  }
  if (who?.role !== "manager") {
    return NextResponse.json({ error: "Only a project admin can choose where the plan is kept.", forbidden: true }, { status: 403 });
  }
  try {
    if (body.action === "preview") return NextResponse.json({ preview: await previewPlanMove(body.to) });
    if (body.action === "use") {
      const used = await openPlanAt(body.to);
      invalidateAccessCache();
      return NextResponse.json({ ...used, status: status() });
    }
    if (body.action === "create") {
      // GitLab only: the key may make projects. On GitHub the person makes it on github.com.
      const host = activeHost();
      if (host.kind !== "gitlab") return NextResponse.json({ error: "On GitHub, create it on github.com (the button opens the page)." }, { status: 400 });
      const token = await getAuthProvider().getToken();
      const project = listProjects().find((p) => p.active)!;
      const [owner] = project.repo.split("/");
      const mine = (await getViewer())?.toLowerCase() === owner.toLowerCase();
      const namespaceId = mine ? undefined : (await GitLabClient.namespaceId(token!, host.url, owner)) ?? undefined;
      const created = await GitLabClient.createProject(token!, host.url, body.name, namespaceId);
      return NextResponse.json({ repo: created.slug });
    }
    const result = await movePlan(body.to, { leaveNote: body.leaveNote, removeOld: body.removeOld });
    invalidateAccessCache();
    return NextResponse.json({ ...result, status: status() });
  } catch (error) {
    const e = error as Error & { code?: string; status?: number };
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "CONFLICT" ? 409 : 400 });
  }
}
