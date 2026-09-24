import { NextResponse } from "next/server";
import { z } from "zod";
import {
  connectRepository,
  getBoardData,
  getRepoIdentity,
} from "@/lib/board-service";
import {
  clearStoredCredentials,
  getAuthProvider,
  writeStoredCredentials,
} from "@/lib/github/auth-provider";
import { GitHubClient } from "@/lib/github/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = getRepoIdentity();
  const token = await getAuthProvider().getToken();
  const provider = getAuthProvider();

  let live = null;
  if (token && identity.configured) {
    try {
      const gh = await GitHubClient.create();
      live = await gh.getRepo();
    } catch (error) {
      return NextResponse.json({
        connected: false,
        error: (error as Error).message,
        authKind: provider.kind,
        stored: identity.stored,
      });
    }
  }

  return NextResponse.json({
    connected: Boolean(token && identity.configured),
    authKind: provider.kind,
    authLabel: provider.label,
    tokenSource: process.env.GITHUB_PAT ? "env" : token ? "file" : null,
    repo: identity.configured,
    stored: identity.stored,
    live,
    markdownSource: getBoardData().markdownSource,
  });
}

const connectSchema = z.object({
  token: z.string().min(10, "Token looks too short"),
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "Use owner/name"),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  try {
    const summary = await connectRepository(parsed.data.token, parsed.data.repo);
    writeStoredCredentials({
      token: parsed.data.token,
      repo: parsed.data.repo,
      savedAt: new Date().toISOString(),
    });
    return NextResponse.json({ connected: true, repo: summary });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  clearStoredCredentials();
  return NextResponse.json({ connected: false });
}
