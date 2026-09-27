import { createHash } from "node:crypto";
import { getAuthProvider, getConfiguredRepo, listProjects, tokenFor } from "@/lib/github/auth-provider";
import { GitHubAccessError, GitHubClient, type AccessReason, type RepoSummary } from "@/lib/github/client";
import type { Who } from "@/lib/roles";

const VALID_FOR_MS = 60_000;
const FAILED_FOR_MS = 5_000;
const HEALTH_FOR_MS = 5 * 60_000;

/**
 * Whether the active project opens right now — and if not, why, so the
 * screen can say "the token expired" rather than greet a returning person
 * as if they were new.
 */
export type AccessState =
  | { state: "none" }
  | { state: "ok"; repo: RepoSummary }
  | { state: "failed"; slug: string; reason: AccessReason; message: string };

function probeState(token: string, slug: string): Promise<AccessState> {
  return GitHubClient.probe(token, slug)
    .then((repo): AccessState => ({ state: "ok", repo }))
    .catch((error): AccessState => {
      const known = error instanceof GitHubAccessError;
      return {
        state: "failed",
        slug,
        reason: known ? error.reason : "unknown",
        message: known ? error.message : "GitHub could not open the repository. Try again in a moment.",
      };
    });
}

const keyOf = (token: string, slug: string) =>
  createHash("sha256").update(token).update("\0").update(slug.toLowerCase()).digest("hex");

let cached: { key: string; until: number; result: AccessState; pending?: Promise<AccessState> } | null = null;

/** The active project's state, without exposing the token to a page. */
export async function getAccessState(): Promise<AccessState> {
  const token = await getAuthProvider().getToken();
  const repo = getConfiguredRepo();
  if (!repo) return { state: "none" };
  const slug = `${repo.owner}/${repo.name}`;
  if (!token) return { state: "failed", slug, reason: "expired", message: "There is no key for this project." };

  const key = keyOf(token, slug);
  if (cached?.key === key) {
    if (cached.pending) return cached.pending;
    if (cached.until > Date.now()) return cached.result;
  }
  const pending = probeState(token, slug);
  cached = { key, until: 0, result: { state: "none" }, pending };
  const result = await pending;
  if (cached?.key === key) {
    cached = { key, until: Date.now() + (result.state === "ok" ? VALID_FOR_MS : FAILED_FOR_MS), result };
  }
  // A project that opens is healthy, whatever the health cache said before.
  health.set(slug.toLowerCase(), { key, until: Date.now() + HEALTH_FOR_MS, result });
  return result;
}

/** Verify the exact token/repository pair without exposing the token to a page. */
export async function getVerifiedRepository(): Promise<RepoSummary | null> {
  const access = await getAccessState();
  return access.state === "ok" ? access.repo : null;
}

export function invalidateAccessCache(): void {
  cached = null;
  health.clear();
}

const health = new Map<string, { key: string; until: number; result: AccessState }>();

export type ProjectHealth = "ok" | AccessReason;

/**
 * Whether each connected project's token still opens its repository, checked
 * at most every few minutes — so Settings and the project menu can say which
 * ones work before the person switches.
 */
export async function projectHealth(): Promise<Map<string, ProjectHealth>> {
  const out = new Map<string, ProjectHealth>();
  await Promise.all(
    listProjects().map(async (p) => {
      const token = process.env.GITHUB_PAT || tokenFor(p.repo);
      const id = p.repo.toLowerCase();
      if (!token) {
        out.set(id, "expired");
        return;
      }
      const key = keyOf(token, p.repo);
      const known = health.get(id);
      let result = known && known.key === key && known.until > Date.now() ? known.result : null;
      if (!result) {
        result = await probeState(token, p.repo);
        health.set(id, { key, until: Date.now() + (result.state === "ok" ? HEALTH_FOR_MS : FAILED_FOR_MS * 6), result });
      }
      out.set(id, result.state === "ok" ? "ok" : result.state === "failed" ? result.reason : "unknown");
    }),
  );
  return out;
}

/** The person using the open project and their role in it (lib/roles.ts), or null when it does not open. */
export async function currentWho(): Promise<Who | null> {
  const access = await getAccessState();
  if (access.state !== "ok") return null;
  return { login: await getViewer(), role: access.repo.role };
}

const viewers = new Map<string, string | null>();

/** Login of the person the active token belongs to, cached per token. */
export async function getViewer(): Promise<string | null> {
  const token = await getAuthProvider().getToken();
  if (!token) return null;
  const key = createHash("sha256").update(token).digest("hex");
  if (viewers.has(key)) return viewers.get(key) ?? null;
  const login = await GitHubClient.viewer(token);
  if (login) viewers.set(key, login);
  return login;
}
