import { NextResponse, type NextRequest } from "next/server";

/**
 * The API acts with the user's GitHub token, so only RepoBoard's own pages
 * may call it. Without this, any web page open in the same browser could
 * post to http://127.0.0.1:3000/api/... (a "simple" cross-site request), and
 * a DNS-rebinding page could even read the answers.
 *
 * - The Host must be this machine (127.0.0.1, localhost, ::1). Anything else
 *   is a rebinding attempt — or `npm run dev:lan`, which has to say which
 *   extra hosts it trusts in REPOBOARD_ALLOW_HOSTS.
 * - Writes must be JSON (a cross-site form or text/plain post cannot be) and
 *   come from this same origin when the browser says where they come from.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostname(host: string | null): string | null {
  if (!host) return null;
  const match = host.match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/);
  return match ? match[1].toLowerCase() : null;
}

function trusted(host: string | null): boolean {
  const name = hostname(host);
  if (!name) return false;
  if (LOOPBACK.has(name)) return true;
  const extra = (process.env.REPOBOARD_ALLOW_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(name);
}

const refuse = (message: string) => NextResponse.json({ error: message }, { status: 403 });

export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (!trusted(host)) return refuse("RepoBoard only answers requests to this computer");

  if (request.method !== "GET" && request.method !== "HEAD") {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) return refuse("Requests must be JSON");
    // Only RepoBoard's own client sends it; a cross-site page would need a CORS preflight, which is never granted.
    if (request.headers.get("x-repoboard") !== "1") return refuse("Requests must come from RepoBoard");
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return refuse("Requests from other sites are not accepted");
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        return refuse("Requests from other sites are not accepted");
      }
      if (originHost !== host) return refuse("Requests from other sites are not accepted");
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
