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
import { getAccessState, invalidateAccessCache, projectHealth, type ProjectHealth } from "@/lib/github/access";
import { GitHubAccessError, GitHubClient } from "@/lib/github/client";
import { repoSlug } from "@/lib/github/slug";

export const dynamic = "force-dynamic";

function projects() {
  const list = listProjects();
  const stats = projectSummaries(list.map((p) => p.repo));
  return list.map((p) => ({ ...p, ...stats.get(p.repo.toLowerCase()) }));
}

/**
 * Names for every project, and counts only for the ones whose token GitHub
 * accepts now — a project nobody can open shows no board data.
 */
async function projectsWithHealth() {
  const health = await projectHealth();
  const list = listProjects();
  const stats = projectSummaries(list.map((p) => p.repo));
  return list.map((p) => {
    const state: ProjectHealth = health.get(p.repo.toLowerCase()) ?? "unknown";
    return state === "ok" ? { ...p, ...stats.get(p.repo.toLowerCase()), health: state } : { ...p, health: state };
  });
}

export async function GET(request: Request) {
  const provider = getAuthProvider();
  const token = await provider.getToken();
  const access = await getAccessState();
  const live = access.state === "ok" ? access.repo : null;
  const withHealth = new URL(request.url).searchParams.has("health");
  const base = {
    authKind: provider.kind,
    authLabel: provider.label,
    tokenSource: process.env.GITHUB_PAT ? "env" : token ? "file" : null,
    managedByEnvironment: isEnvironmentConfigured(),
    // Why the active project does not open, when it does not.
    access: access.state === "failed" ? { slug: access.slug, reason: access.reason, message: access.message } : null,
    // Names and counts only — tokens never leave the server.
    projects: withHealth ? await projectsWithHealth() : live ? projects() : listProjects(),
  };
  if (!live) {
    return NextResponse.json({ connected: false, ...base });
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

const slug = z
  .string()
  .transform(repoSlug)
  .pipe(z.string().regex(/^[^/\s]+\/[^/\s]+$/, "Pick a repository, or type it as owner/name"));

const bodySchema = z.union([
  z.object({
    action: z.literal("connect").optional(),
    token: z.string().min(10, "Token looks too short"),
    repo: slug,
  }),
  z.object({ action: z.literal("repos"), token: z.string().min(10, "Token looks too short") }),
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
    if (body.action === "repos") {
      const repos = await GitHubClient.repositoriesFor(body.token.trim());
      return NextResponse.json({ repos });
    }
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
    // The open project goes: open the first other one whose token works.
    const health = await projectHealth();
    const next = listProjects().find((p) => p.repo.toLowerCase() !== body.repo.toLowerCase() && health.get(p.repo.toLowerCase()) === "ok");
    removeProject(body.repo, next?.repo ?? null);
    invalidateAccessCache();
    return NextResponse.json({ removed: body.repo, projects: listProjects() });
  } catch (error) {
    // `reason` lets the connect screen offer the right next step.
    const reason = error instanceof GitHubAccessError ? error.reason : undefined;
    return NextResponse.json({ error: (error as Error).message, reason }, { status: 400 });
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
