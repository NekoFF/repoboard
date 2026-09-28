import { NextResponse } from "next/server";
import { getActivity, inboxSeenAt, markInboxSeen } from "@/lib/board-service";
import { currentWho, getVerifiedRepository } from "@/lib/github/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await getVerifiedRepository()) {
    return NextResponse.json({ error: "GitHub access required" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 1000);
  // With the events: when the Inbox was last looked at, so "new" means new on every window.
  return NextResponse.json({ events: getActivity(limit, params.get("task"), await currentWho()), seenAt: inboxSeenAt() });
}

/** The Inbox was looked at: anyone who can see the project may say so. */
export async function POST(request: Request) {
  if (!await getVerifiedRepository()) {
    return NextResponse.json({ error: "GitHub access required" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { seen?: unknown } | null;
  if (body?.seen !== true) return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
  markInboxSeen();
  return NextResponse.json({ ok: true, seenAt: inboxSeenAt() });
}
