import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/github/access", () => ({
  getVerifiedRepository: async () => ({ owner: "acme", name: "docs", role: "manager" }),
  getViewer: async () => "tester",
  currentWho: async () => ({ login: "tester", role: "manager" }),
}));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-docs-watch-"));
process.env.DATABASE_URL = `file:${path.join(scratch, "board.db")}`;
process.env.HOME = scratch;
process.env.GITHUB_REPO = "acme/docs";

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { drizzle } = await import("drizzle-orm/better-sqlite3");
const sqlite = new Database(path.join(scratch, "board.db"));
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
sqlite.close();

const board = await import("@/lib/board-service");
const docs = await import("@/lib/docs-service");

function fakeGitHub() {
  let head = "c1";
  const files = new Map([[".repoboard/checklists/release-1.0.md", "# Release 1.0\n\n- [ ] Tests pass\n"]]);
  const calls: string[] = [];
  const gh = {
    headCommit: async (branch?: string) => (calls.push(`head ${branch ?? "-"}`), head),
    listMarkdownFiles: async (branch?: string) => (calls.push(`list ${branch ?? "-"}`), [...files.keys()]),
    getFile: async (p: string, ref?: string) => {
      calls.push(`get ${p} ${ref ?? "-"}`);
      const content = files.get(p);
      if (content == null) throw Object.assign(new Error("Not Found"), { status: 404 });
      return { path: p, content, sha: `sha-${content.length}` };
    },
    putFile: async (args: { branch?: string }) => (calls.push(`put ${args.branch ?? "-"}`), { commitSha: "w", contentSha: "x" }),
  };
  return { gh, calls, files, move: (sha: string) => (head = sha) };
}

describe("documents follow GitHub", () => {
  it("reads again only when the branch has a new commit, and says where from", async () => {
    board.ensureBootstrap({ owner: "acme", name: "docs", defaultBranch: "main", visibility: "private" });
    const hub = fakeGitHub();
    const factory = async () => hub.gh as never;

    const first = await docs.watchDocs({}, factory);
    expect(first).toMatchObject({ branch: "main", commit: "c1", changed: true, added: [".repoboard/checklists/release-1.0.md"] });
    expect(docs.docsStatus()).toMatchObject({ branch: "main", commit: "c1" });

    hub.calls.length = 0;
    const quiet = await docs.watchDocs({}, factory);
    expect(quiet.changed).toBe(false);
    expect(hub.calls).toEqual(["head -"]); // one look, nothing read

    hub.files.set(".repoboard/checklists/privacy.md", "# Privacy\n\n- [ ] Impressum\n");
    hub.move("c2");
    const next = await docs.watchDocs({}, factory);
    expect(next).toMatchObject({ commit: "c2", changed: true, added: [".repoboard/checklists/privacy.md"] });
  });

  it("points every read and write at the documents' branch", async () => {
    const hub = fakeGitHub();
    const onFeature = docs.onBranch(hub.gh as never, "feature/remote") as unknown as typeof hub.gh;
    await onFeature.headCommit();
    await onFeature.listMarkdownFiles();
    await onFeature.getFile(".repoboard/checklists/release-1.0.md");
    await onFeature.putFile({});
    expect(hub.calls).toEqual(["head feature/remote", "list feature/remote", "get .repoboard/checklists/release-1.0.md feature/remote", "put feature/remote"]);
    // No branch chosen: the client as it is.
    expect(docs.onBranch(hub.gh as never, null)).toBe(hub.gh);
  });
});
