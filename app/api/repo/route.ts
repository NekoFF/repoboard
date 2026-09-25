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
import { getVerifiedRepository, invalidateAccessCache } from "@/lib/github/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await getAuthProvider().getToken();
  const provider = getAuthProvider();
  const live = await getVerifiedRepository();
  if (!live) {
    return NextResponse.json({
      connected: false,
      authKind: provider.kind,
      authLabel: provider.label,
      tokenSource: process.env.GITHUB_PAT ? "env" : token ? "file" : null,
    });
  }
  const identity = getRepoIdentity();

  return NextResponse.json({
    connected: true,
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
  if (process.env.GITHUB_PAT || process.env.GITHUB_REPO) {
    return NextResponse.json({ error: "This instance is configured through environment variables. Change those to switch repositories." }, { status: 409 });
  }
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
    invalidateAccessCache();
    return NextResponse.json({ connected: true, repo: summary });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  if (process.env.GITHUB_PAT || process.env.GITHUB_REPO) {
    return NextResponse.json({ error: "This instance is configured through environment variables." }, { status: 409 });
  }
  clearStoredCredentials();
  invalidateAccessCache();
  return NextResponse.json({ connected: false });
}
