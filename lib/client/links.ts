"use client";

import { useShell } from "@/components/shell/ShellContext";
import type { HostChoice } from "@/lib/client/api";

/**
 * Where things of the open repository live on the web — GitHub's paths or
 * GitLab's (/-/commit/…, /-/merge_requests/…). Every "open on GitHub" link
 * goes through here, so a GitLab project links to GitLab.
 */
export function repoLinks(host: HostChoice | undefined, repo: string | null) {
  const gitlab = host?.kind === "gitlab" ? host.url.replace(/\/+$/, "") : null;
  const web = repo ? (gitlab ? `${gitlab}/${repo}` : `https://github.com/${repo}`) : null;
  const dash = gitlab ? "/-" : "";
  const path = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  return {
    service: gitlab ? "GitLab" : "GitHub",
    web,
    commit: (sha: string) => (web ? `${web}${dash}/commit/${sha}` : undefined),
    pull: (n: number) => (web ? `${web}${dash}/${gitlab ? "merge_requests" : "pull"}/${n}` : undefined),
    issue: (n: number) => (web ? `${web}${dash}/issues/${n}` : undefined),
    blob: (ref: string, file: string) => (web ? `${web}${dash}/blob/${ref}/${path(file)}` : undefined),
  };
}

export function useRepoLinks() {
  const { repo, projects } = useShell();
  const host = projects.find((p) => p.active)?.host;
  return repoLinks(host, repo);
}

/**
 * Where a file of the project opens on the web, wherever the plan is kept
 * (lib/plan.ts): .repoboard/ files in the plan's repository or on
 * RepoBoard's branch, everything else in the code, on `codeRef`.
 */
export function fileLink(
  host: HostChoice | undefined,
  repo: string | null,
  plan: { mode: "main" | "branch" | "repo"; repo: string | null } | null | undefined,
  file: string,
  codeRef = "HEAD",
): string | undefined {
  const clean = file.replace(/^\/+/, "");
  const inPlan = clean === ".repoboard" || clean.startsWith(".repoboard/");
  if (inPlan && plan?.mode === "repo" && plan.repo) return repoLinks(host, plan.repo).blob("HEAD", clean);
  if (inPlan && plan?.mode === "branch") return repoLinks(host, repo).blob("repoboard", clean);
  return repoLinks(host, repo).blob(codeRef, clean);
}
