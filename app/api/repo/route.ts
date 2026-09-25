import { NextResponse } from "next/server";
import { runAs } from "@/lib/actor";
import { getViewer } from "@/lib/github/access";

import { z } from "zod";
import {
  connectRepository,
  getBoardData,
  getRepoIdentity,
  projectSummaries,
} from "@/lib/board-service";
import {
  getAuthProvider,
  isEnvironmentConfigured,
  listProjects,
  removeProject,
  saveProject,
  setActiveProject,
} from "@/lib/github/auth-provider";
import { getVerifiedRepository, invalidateAccessCache } from "@/lib/github/access";

export const dynamic = "force-dynamic";

function projects() {
  const list = listProjects();
  const stats = projectSummaries(list.map((p) => p.repo));
  return list.map((p) => ({ ...p, ...stats.get(p.repo.toLowerCase()) }));
}

export async function GET() {
  const provider = getAuthProvider();
  const token = await provider.getToken();
  const live = await getVerifiedRepository();
  const base = {
    authKind: provider.kind,
    authLabel: provider.label,
    tokenSource: process.env.GITHUB_PAT ? "env" : token ? "file" : null,
    managedByEnvironment: isEnvironmentConfigured(),
    // Names and counts only — tokens never leave the server.
    projects: projects(),
  };
  if (!live) {
    return NextResponse.json({
      connected: false,
      ...base,
      projects: listProjects(),
    });
  }

  const identity = getRepoIdentity();
  return NextResponse.json({
    connected: true,
    ...base,
    repo: identity.configured,
    stored: identity.stored,
    live,
    markdownSource: getBoardData().markdownSource,
  });
}

const slug = z.string().regex(/^[^/\s]+\/[^/\s]+$/, "Use owner/name");

const bodySchema = z.union([
  z.object({
    action: z.literal("connect").optional(),
    token: z.string().min(10, "Token looks too short"),
    repo: slug,
  }),
  z.object({ action: z.literal("switch"), repo: slug }),
  z.object({ action: z.literal("remove"), repo: slug }),
]);

/** Every change made through this route is attributed to the token's owner. */
export async function POST(request: Request) {
  const login = await getViewer().catch(() => null);
  return runAs(login ? { name: login, kind: "person" } : null, () => handlePost(request));
}

async function handlePost(request: Request) {
  if (isEnvironmentConfigured()) {
    return NextResponse.json(
      {
        error:
          "This instance is configured through environment variables. Change GITHUB_REPO / GITHUB_PAT to switch repositories.",
      },
      { status: 409 },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;

  try {
    if ("token" in body) {
      const summary = await connectRepository(body.token.trim(), body.repo.trim());
      // Stored under GitHub's spelling of the name, so it matches the board row.
      saveProject(`${summary.owner}/${summary.name}`, body.token.trim());
      invalidateAccessCache();
      return NextResponse.json({ connected: true, repo: summary, projects: projects() });
    }
    if (body.action === "switch") {
      if (!setActiveProject(body.repo)) {
        return NextResponse.json({ error: `${body.repo} is not connected` }, { status: 404 });
      }
      invalidateAccessCache();
      return NextResponse.json({ switched: body.repo, projects: projects() });
    }
    removeProject(body.repo);
    invalidateAccessCache();
    return NextResponse.json({ removed: body.repo, projects: projects() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

/** Disconnects the active project (its board stays in the database). */
export async function DELETE() {
  if (isEnvironmentConfigured()) {
    return NextResponse.json(
      { error: "This instance is configured through environment variables." },
      { status: 409 },
    );
  }
  const active = listProjects().find((p) => p.active);
  if (active) removeProject(active.repo);
  invalidateAccessCache();
  return NextResponse.json({ connected: false, projects: projects() });
}
