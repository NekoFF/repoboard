import { NextResponse } from "next/server";
import { getActivity } from "@/lib/board-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return NextResponse.json({ events: getActivity(limit) });
}
