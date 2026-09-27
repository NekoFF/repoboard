import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { GitLabClient, gitlabBase } from "@/lib/gitlab/client";
import { repoSlug } from "@/lib/github/slug";

/** A GitLab in memory: one project, its files by branch, and the calls it saw. */
function fakeGitLab() {
  const blob = (s: string) => createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
  const files = new Map<string, Map<string, { content: string; commit: string }>>([
    ["main", new Map([[".repoboard/board.json", { content: '{"version":1}', commit: "c1" }]])],
  ]);
  const heads = new Map([["main", "c1"]]);
  let n = 1;
  const calls: string[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    calls.push(`${method} ${url.pathname}`);
    if (auth !== "Bearer glpat-good-key-000000000000") return json(401, { message: "401 Unauthorized" });
    const path = decodeURIComponent(url.pathname.replace(/^\/api\/v4/, ""));
    if (path === "/user") return json(200, { username: "dima" });
    if (path === "/projects/acme/app") {
      return json(200, {
        id: 7,
        path: "app",
        path_with_namespace: "acme/app",
        namespace: { full_path: "acme" },
        default_branch: "main",
        visibility: "private",
        web_url: "https://gitlab.example/acme/app",
        last_activity_at: null,
        description: null,
        permissions: { project_access: { access_level: 30 }, group_access: null },
      });
    }
    if (path.startsWith("/projects/acme/other")) return json(404, { message: "404 Project Not Found" });
    const file = path.match(/^\/projects\/acme\/app\/repository\/files\/(.+)$/);
    if (file) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const branch = url.searchParams.get("ref") ?? body.branch;
      const tree = files.get(branch);
      if (!tree) return json(404, { message: "404 Branch Not Found" });
      const current = tree.get(file[1]);
      if (method === "GET") {
        return current
          ? json(200, { content: Buffer.from(current.content).toString("base64"), blob_id: blob(current.content), last_commit_id: current.commit })
          : json(404, { message: "404 File Not Found" });
      }
      if (method === "PUT" && (!current || body.last_commit_id !== current.commit)) return json(400, { message: "stale" });
      const commit = `c${++n}`;
      tree.set(file[1], { content: body.content, commit });
      heads.set(branch, commit);
      return json(method === "POST" ? 201 : 200, { file_path: file[1], branch });
    }
    const branch = path.match(/^\/projects\/acme\/app\/repository\/branches\/(.+)$/);
    if (branch) {
      return heads.has(branch[1]) ? json(200, { name: branch[1], commit: { id: heads.get(branch[1]) } }) : json(404, { message: "404 Branch Not Found" });
    }
    if (path === "/projects/acme/app/repository/branches" && method === "POST") {
      const name = url.searchParams.get("branch")!;
      files.set(name, new Map(files.get(url.searchParams.get("ref")!)!));
      heads.set(name, heads.get(url.searchParams.get("ref")!)!);
      return json(201, { name });
    }
    return json(404, { message: `not faked: ${method} ${path}` });
  });
  return { fetch, files, calls, blob };
}

describe("GitLab", () => {
  let lab: ReturnType<typeof fakeGitLab>;
  beforeEach(() => {
    lab = fakeGitLab();
    vi.stubGlobal("fetch", lab.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  const base = "https://gitlab.example";
  const key = "glpat-good-key-000000000000";

  it("checks a key and a project, with the role from the access level", async () => {
    const repo = await GitLabClient.probe(key, "acme/app", base);
    expect(repo).toMatchObject({ owner: "acme", name: "app", defaultBranch: "main", visibility: "private", role: "member" });
    await expect(GitLabClient.probe("glpat-wrong-key-000000000000", "acme/app", base)).rejects.toMatchObject({ reason: "expired" });
    await expect(GitLabClient.probe(key, "acme/other", base)).rejects.toMatchObject({ reason: "no_access" });
    await expect(GitLabClient.probe(key, "acme/sub/app", base)).rejects.toThrow(/subgroup/);
    expect(await GitLabClient.viewer(key, base)).toBe("dima");
  });

  it("reads a file with git's blob SHA, and refuses to write over a newer one", async () => {
    const gl = new GitLabClient(key, "acme", "app", base);
    const file = await gl.getFile(".repoboard/board.json");
    expect(file.content).toBe('{"version":1}');
    expect(file.sha).toBe(lab.blob('{"version":1}'));

    await gl.putFile({ path: ".repoboard/board.json", content: '{"version":1,"x":1}', expectedSha: file.sha, message: "save" });
    // The SHA read before that write no longer matches: a conflict, nothing written.
    await expect(
      gl.putFile({ path: ".repoboard/board.json", content: "lost", expectedSha: file.sha, message: "late" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(lab.files.get("main")!.get(".repoboard/board.json")!.content).toBe('{"version":1,"x":1}');
  });

  it("makes the sync branch from the default branch and writes only there", async () => {
    const gl = new GitLabClient(key, "acme", "app", base);
    await gl.ensureBranch("repoboard");
    const onBranch = await gl.getFile(".repoboard/board.json", "repoboard");
    await gl.putFile({ path: ".repoboard/board.json", content: '{"version":1,"sync":true}', expectedSha: onBranch.sha, message: "sync", branch: "repoboard" });
    expect(lab.files.get("repoboard")!.get(".repoboard/board.json")!.content).toContain("sync");
    expect(lab.files.get("main")!.get(".repoboard/board.json")!.content).toBe('{"version":1}');
    // Asking again does not make it twice.
    await gl.ensureBranch("repoboard");
    expect(lab.calls.filter((c) => c === "POST /api/v4/projects/acme%2Fapp/repository/branches")).toHaveLength(1);
  });

  it("takes GitLab addresses as they are copied", () => {
    expect(gitlabBase("gitlab.company.de/")).toBe("https://gitlab.company.de");
    expect(() => gitlabBase("http://gitlab.company.de")).toThrow(/https/);
    expect(repoSlug("https://gitlab.com/acme/app/-/tree/main")).toBe("acme/app");
    expect(repoSlug("git@gitlab.company.de:acme/app.git")).toBe("acme/app");
  });
});
