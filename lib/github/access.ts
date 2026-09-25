import { createHash } from "node:crypto";
import { getAuthProvider, getConfiguredRepo } from "@/lib/github/auth-provider";
import { GitHubClient, type RepoSummary } from "@/lib/github/client";

const VALID_FOR_MS = 60_000;
const FAILED_FOR_MS = 5_000;

let cached: {
  key: string;
  until: number;
  result: RepoSummary | null;
  pending?: Promise<RepoSummary | null>;
} | null = null;

/** Verify the exact token/repository pair without exposing the token to a page. */
export async function getVerifiedRepository(): Promise<RepoSummary | null> {
  const token = await getAuthProvider().getToken();
  const repo = getConfiguredRepo();
  if (!token || !repo) return null;

  const slug = `${repo.owner}/${repo.name}`;
  const key = createHash("sha256").update(token).update("\0").update(slug.toLowerCase()).digest("hex");
  if (cached?.key === key) {
    if (cached.pending) return cached.pending;
    if (cached.until > Date.now()) return cached.result;
  }

  const pending = GitHubClient.probe(token, slug).catch(() => null);
  cached = { key, until: 0, result: null, pending };
  const result = await pending;
  if (cached?.key === key) {
    cached = { key, until: Date.now() + (result ? VALID_FOR_MS : FAILED_FOR_MS), result };
  }
  return result;
}

export function invalidateAccessCache(): void {
  cached = null;
}
