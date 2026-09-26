import { NextResponse } from "next/server";
import { z } from "zod";
import { runAs } from "@/lib/actor";
import { connectRepository } from "@/lib/board-service";
import { githubApp, installUrl, pollSignIn, startSignIn } from "@/lib/github/app";
import { invalidateAccessCache } from "@/lib/github/access";
import {
  accountLogin,
  accountToken,
  isEnvironmentConfigured,
  saveAccount,
  saveProject,
  signOut,
} from "@/lib/github/auth-provider";
import { GitHubAccessError, GitHubClient } from "@/lib/github/client";
import { repoSlug } from "@/lib/github/slug";

export const dynamic = "force-dynamic";

/**
 * Signing in with GitHub (lib/github/app.ts). The token GitHub hands back
 * stays on this computer, like a key: the page only ever sees the login and
 * the repositories it opens.
 */
export async function GET() {
  const app = githubApp();
  return NextResponse.json({
    available: Boolean(app) && !isEnvironmentConfigured(),
    login: accountLogin(),
    installUrl: installUrl(),
  });
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("poll"), flowId: z.string().uuid() }),
  z.object({ action: z.literal("repos") }),
  z.object({ action: z.literal("connect"), repos: z.array(z.string().min(3)).min(1).max(50) }),
  z.object({ action: z.literal("sign-out") }),
]);

export async function POST(request: Request) {
  if (isEnvironmentConfigured()) {
    return NextResponse.json({ error: "This instance is configured through environment variables." }, { status: 409 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const input = parsed.data;

  try {
    switch (input.action) {
      case "start":
        return NextResponse.json(await startSignIn());

      case "poll": {
        const result = await pollSignIn(input.flowId);
        if (result.state !== "done") return NextResponse.json({ state: result.state });
        const login = await GitHubClient.viewer(result.token);
        if (!login) return NextResponse.json({ error: "GitHub gave a token it does not accept. Try again." }, { status: 400 });
        saveAccount(login, result.token);
        invalidateAccessCache();
        const repos = await GitHubClient.appRepositories(result.token);
        return NextResponse.json({ state: "done", login, repos });
      }

      case "repos": {
        const token = accountToken();
        if (!token) return NextResponse.json({ error: "Not signed in with GitHub.", reason: "expired" }, { status: 401 });
        return NextResponse.json({ login: accountLogin(), repos: await GitHubClient.appRepositories(token) });
      }

      case "connect": {
        const token = accountToken();
        if (!token) return NextResponse.json({ error: "Not signed in with GitHub.", reason: "expired" }, { status: 401 });
        const login = accountLogin();
        const targets = input.repos.map(repoSlug);
        // The first one picked opens: connect it last, as connecting opens a project.
        const order = [...targets.slice(1), targets[0]];
        const connected: string[] = [];
        await runAs(login ? { name: login, kind: "person" } : null, async () => {
          for (const slug of order) {
            const summary = await connectRepository(token, slug);
            const name = `${summary.owner}/${summary.name}`;
            saveProject(name, token, "github");
            connected.push(name);
          }
        });
        invalidateAccessCache();
        return NextResponse.json({ connected, opened: connected[connected.length - 1] });
      }

      case "sign-out":
        signOut();
        invalidateAccessCache();
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    const reason = error instanceof GitHubAccessError ? error.reason : undefined;
    return NextResponse.json({ error: (error as Error).message, reason }, { status: 400 });
  }
}
