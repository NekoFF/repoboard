import { describe, expect, it } from "vitest";
import { tokenTemplateUrl } from "@/lib/github/token-link";
import { repoSlug } from "@/lib/github/slug";

describe("the token link", () => {
  const url = new URL(tokenTemplateUrl({ owner: "NekoFF", now: new Date("2026-09-26T10:05:00Z") }));

  it("fills in GitHub's new-token page", () => {
    expect(url.origin + url.pathname).toBe("https://github.com/settings/personal-access-tokens/new");
    expect(url.searchParams.get("name")).toBe("RepoBoard 2026-09-26 10:05");
    expect(url.searchParams.get("name")!.length).toBeLessThanOrEqual(40);
    expect(url.searchParams.get("target_name")).toBe("NekoFF");
    expect(url.searchParams.get("expires_in")).toBe("90");
    expect(url.searchParams.get("contents")).toBe("write");
    expect(url.searchParams.get("pull_requests")).toBe("read");
    expect(url.searchParams.get("issues")).toBe("read");
  });

  it("leaves the owner out when it is not a GitHub name", () => {
    expect(new URL(tokenTemplateUrl({ owner: "not a name/" })).searchParams.has("target_name")).toBe(false);
    expect(new URL(tokenTemplateUrl()).searchParams.has("target_name")).toBe(false);
  });
});

describe("repository names people paste", () => {
  it("reads owner/name out of GitHub addresses", () => {
    expect(repoSlug("NekoFF/meridian-tv-browser")).toBe("NekoFF/meridian-tv-browser");
    expect(repoSlug(" https://github.com/NekoFF/meridian-tv-browser/tree/main ")).toBe("NekoFF/meridian-tv-browser");
    expect(repoSlug("https://github.com/NekoFF/meridian-tv-browser.git")).toBe("NekoFF/meridian-tv-browser");
    expect(repoSlug("git@github.com:NekoFF/meridian-tv-browser.git")).toBe("NekoFF/meridian-tv-browser");
    expect(repoSlug("meridian")).toBe("meridian");
  });
});
