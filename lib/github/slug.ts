/**
 * "owner/name", or anything copied from GitHub that contains it: the page's
 * address, a clone URL, git@github.com:owner/name.git.
 */
export function repoSlug(input: string): string {
  const text = input.trim();
  const url = text.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  const [owner, name] = url ? [url[1], url[2]] : text.split("/");
  return name ? `${owner}/${name.replace(/\.git$/i, "")}` : text;
}
