import { NextResponse } from "next/server";
import { getActivity } from "@/lib/board-service";
import { getVerifiedRepository } from "@/lib/github/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await getVerifiedRepository()) {
    return NextResponse.json({ error: "GitHub access required" }, { status: 401 });
  }
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50, 1), 1000);
  return NextResponse.json({ events: getActivity(limit) });
}
