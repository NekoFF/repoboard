/**
 * GitHub's page for a new fine-grained token, filled in for RepoBoard: a
 * name, a description, the owner, a lifetime and the permissions. GitHub
 * cannot pick the repository from a link, so that stays the person's one
 * choice on the page.
 * https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
 */
export const TOKEN_PERMISSIONS = { contents: "write", pull_requests: "read", issues: "read", metadata: "read" } as const;

export const TOKENS_PAGE = "https://github.com/settings/personal-access-tokens";

export function tokenTemplateUrl({ owner, now = new Date(), days = 90 }: { owner?: string | null; now?: Date; days?: number } = {}): string {
  const url = new URL(`${TOKENS_PAGE}/new`);
  // Token names must be unique on the account, so the time goes in the name.
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  url.searchParams.set("name", `RepoBoard ${stamp}`);
  url.searchParams.set(
    "description",
    "RepoBoard: boards and checklists for this repository. It writes only reviewed commits under .repoboard/.",
  );
  const who = owner?.trim();
  if (who && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(who)) url.searchParams.set("target_name", who);
  url.searchParams.set("expires_in", String(days));
  for (const [name, level] of Object.entries(TOKEN_PERMISSIONS)) url.searchParams.set(name, level);
  return url.toString();
}
