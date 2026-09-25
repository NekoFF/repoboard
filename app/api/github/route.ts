import { NextResponse } from "next/server";
import { GitHubClient, GitHubNotConfiguredError } from "@/lib/github/client";
import { getVerifiedRepository } from "@/lib/github/access";

export const dynamic = "force-dynamic";

/**
 * Single read-only proxy for live GitHub data. Nothing here is cached in
 * SQLite — GitHub stays the source of truth for git objects.
 */
export async function GET(request: Request) {
  if (!await getVerifiedRepository()) {
    return NextResponse.json({ error: "GitHub access required" }, { status: 401 });
  }
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "branches";

  try {
    const gh = await GitHubClient.create();

    switch (resource) {
      case "branches":
        return NextResponse.json({ branches: await gh.listBranches() });
      case "commits":
        return NextResponse.json({
          commits: await gh.listCommits(
            url.searchParams.get("branch") ?? undefined,
          ),
        });
      case "commit": {
        const sha = url.searchParams.get("sha");
        if (!sha) {
          return NextResponse.json({ error: "sha required" }, { status: 400 });
        }
        return NextResponse.json({ commit: await gh.getCommit(sha) });
      }
      case "pulls":
        return NextResponse.json({ pulls: await gh.listPullRequests() });
      case "issues":
        return NextResponse.json({ issues: await gh.listIssues() });
      case "people":
        return NextResponse.json({ people: await gh.listPeople() });
      case "graph":
        return NextResponse.json({ commits: await gh.commitGraph() });
      case "refs":
        return NextResponse.json({ refs: await gh.findReferences() });
      case "markdown-files":
        return NextResponse.json({ files: await gh.listMarkdownFiles() });
      case "file": {
        const path = url.searchParams.get("path");
        if (!path) {
          return NextResponse.json({ error: "path required" }, { status: 400 });
        }
        return NextResponse.json({ file: await gh.getFile(path) });
      }
      default:
        return NextResponse.json(
          { error: `Unknown resource ${resource}` },
          { status: 400 },
        );
    }
  } catch (error) {
    if (error instanceof GitHubNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}
