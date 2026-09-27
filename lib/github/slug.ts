/**
 * "owner/name", or anything copied from GitHub or GitLab that contains it:
 * the page's address (with /tree/…, /-/blob/… after it), a clone URL,
 * git@github.com:owner/name.git.
 */
export function repoSlug(input: string): string {
  const text = input.trim();
  const ssh = text.match(/^git@[^:]+:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  const url = text.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.[a-z.]+|[a-z0-9.-]+\.[a-z]{2,})(?::\d+)?\/([^/\s#?]+)\/([^/\s#?]+)/i);
  const [owner, name] = url ? [url[1], url[2]] : text.split("/");
  return name ? `${owner}/${name.replace(/\.git$/i, "")}` : text;
}
