import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A home of its own: never the real ~/.repoboard.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-renew-"));
process.env.HOME = scratch;
delete process.env.GITHUB_PAT;
delete process.env.GITHUB_REPO;

const auth = await import("@/lib/github/auth-provider");

describe("signing in with GitHub lasts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renews the eight-hour token before it runs out, for every project opened with it", async () => {
    auth.saveProject("acme/tv", "old-token", "github");
    auth.saveProject("acme/key", "a-key", "key");
    auth.setActiveProject("acme/tv");
    auth.saveAccount("dima", "old-token", { refreshToken: "r1", expiresAt: Date.now() + 60_000, refreshExpiresAt: Date.now() + 1e10 });

    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "r1" });
      return new Response(JSON.stringify({ access_token: "new-token", expires_in: 28800, refresh_token: "r2", refresh_token_expires_in: 15811200 }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    // Two requests at once: one renewal (a refresh token works once).
    const [a, b] = await Promise.all([auth.getAuthProvider().getToken(), auth.getAuthProvider().getToken()]);
    expect([a, b]).toEqual(["new-token", "new-token"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.tokenFor("acme/tv")).toBe("new-token");
    expect(auth.tokenFor("acme/key")).toBe("a-key");
    // Fresh for hours now: no more asking.
    await auth.getAuthProvider().getToken();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("leaves tokens that do not expire alone", async () => {
    auth.saveAccount("dima", "forever");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await auth.renewAccountIfNeeded();
    expect(fetch).not.toHaveBeenCalled();
  });
});
