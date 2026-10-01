import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-plan-"));
process.env.DATABASE_URL = `file:${path.join(scratch, "board.db")}`;
const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { drizzle } = await import("drizzle-orm/better-sqlite3");
const sqlite = new Database(path.join(scratch, "board.db"));
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
sqlite.close();

const plan = await import("@/lib/plan");

type Files = Map<string, string>;

/** A client over a few files, recording what it was asked. */
function fake(name: string, files: Files, calls: string[]) {
  return {
    owner: "o",
    repo: name,
    getFile: async (p: string, ref?: string) => {
      calls.push(`${name} get ${p}${ref ? `@${ref}` : ""}`);
      const content = files.get(p);
      if (content == null) throw Object.assign(new Error("Not Found"), { status: 404 });
      return { path: p, content, sha: `sha-${content.length}` };
    },
    getFileBytes: async (p: string) => ({ bytes: Buffer.from(files.get(p) ?? ""), sha: "x" }),
    putFile: async (args: { path: string }) => (calls.push(`${name} put ${args.path}`), { commitSha: `${name}-c`, contentSha: "s" }),
    listMarkdownFiles: async () => [...files.keys()].filter((p) => p.endsWith(".md")),
    listFiles: async () => [...files.keys()],
    headCommit: async () => `${name}-head`,
    commitChanges: async (args: { edits: { path: string }[]; adds: { path: string }[] }) => {
      calls.push(`${name} commit ${[...args.edits, ...args.adds].map((f) => f.path).join(",")}`);
      return { commitSha: `${name}-commit` };
    },
    createFiles: async (args: { files: { path: string }[] }) => {
      calls.push(`${name} create ${args.files.map((f) => f.path).join(",")}`);
      return { commitSha: `${name}-create` };
    },
    getRepo: async () => ({ owner: "o", name, defaultBranch: "main", visibility: "private", htmlUrl: "", pushedAt: null, role: "manager" }),
  };
}

describe("where the plan is kept", () => {
  it("reads a project that never chose as main", () => {
    expect(plan.planLocationOf(null)).toEqual({ mode: "main", repo: null });
    expect(plan.planLocationOf({ id: "x", planMode: null })).toEqual({ mode: "main", repo: null });
    expect(plan.planLocationOf({ id: "x", planMode: "repo", planRepo: null })).toEqual({ mode: "main", repo: null });
    expect(plan.planLocationOf({ id: "x", planMode: "repo", planRepo: "a/b-plan" })).toEqual({ mode: "repo", repo: "a/b-plan" });
    expect(plan.planLocationOf({ id: "x", planMode: "branch" })).toEqual({ mode: "branch", repo: null });
  });

  it("knows a plan path", () => {
    expect(plan.isPlanPath(".repoboard/checklists/a.md")).toBe(true);
    expect(plan.isPlanPath("/.repoboard/board.json")).toBe(true);
    expect(plan.isPlanPath(".repoboardx/a.md")).toBe(false);
    expect(plan.isPlanPath("docs/PRIVACY.md")).toBe(false);
  });

  it("sends .repoboard/ to the plan and everything else to the code", async () => {
    const calls: string[] = [];
    const code = fake("code", new Map([["PRIVACY.md", "code text"], [".repoboard/old.md", "left behind"]]), calls);
    const place = fake("plan", new Map([[".repoboard/checklists/a.md", "plan text"]]), calls);
    const gh = plan.splitClient(code as never, place as never, "o/plan");
    expect((await gh.getFile(".repoboard/checklists/a.md")).content).toBe("plan text");
    expect((await gh.getFile("PRIVACY.md")).content).toBe("code text");
    // A .repoboard/ left in the code after a move is not read.
    expect(await gh.listMarkdownFiles()).toEqual([".repoboard/checklists/a.md", "PRIVACY.md"]);
    await gh.commitChanges({ message: "m", edits: [{ path: ".repoboard/checklists/a.md", content: "", expectedSha: "" }, { path: "PRIVACY.md", content: "", expectedSha: "" }], adds: [] });
    expect(calls.filter((c) => c.includes("commit"))).toEqual(["plan commit .repoboard/checklists/a.md", "code commit PRIVACY.md"]);
    expect(await gh.headCommit()).toBe("code-head");
    expect(await gh.watchKey()).toBe("plan-head+code-head");
  });

  it("parses location notes, and ignores broken ones", () => {
    expect(plan.parseLocationNote(plan.locationNote({ for: "a/b", mode: "repo" }))).toEqual({ for: "a/b", mode: "repo", movedTo: null });
    expect(plan.parseLocationNote(plan.locationNote({ for: "a/b", mode: "main", movedTo: { mode: "repo", repo: "a/b-plan" } }))?.movedTo).toEqual({ mode: "repo", repo: "a/b-plan" });
    expect(plan.parseLocationNote("{not json")).toBeNull();
    expect(plan.parseLocationNote(JSON.stringify({ mode: "elsewhere" }))?.mode).toBeNull();
  });

  describe("finding the plan on another computer", () => {
    const note = (o: object) => JSON.stringify(o);
    const open = (repos: Record<string, Files>, calls: string[]) => async (slug: string) => {
      if (!repos[slug]) {
        const missing = fake(slug, new Map(), calls);
        return { ...missing, getRepo: async () => Promise.reject(Object.assign(new Error("Not Found"), { status: 404 })) };
      }
      return fake(slug, repos[slug], calls);
    };

    it("follows a note left in main", async () => {
      const calls: string[] = [];
      const code = fake("code", new Map([[plan.LOCATION_FILE, note({ for: "a/b", movedTo: { mode: "repo", repo: "a/b-plan" } })]]), calls);
      const found = await plan.findPlan({ code, slug: "a/b", current: { mode: "main", repo: null }, open: open({ "a/b-plan": new Map() }, calls), fresh: false });
      expect(found).toEqual({ kind: "found", location: { mode: "repo", repo: "a/b-plan" }, how: "the note in main" });
    });

    it("says when the plan is in a repository it cannot open", async () => {
      const calls: string[] = [];
      const code = fake("code", new Map([[plan.LOCATION_FILE, note({ for: "a/b", movedTo: { mode: "repo", repo: "a/b-plan" } })]]), calls);
      const found = await plan.findPlan({ code, slug: "a/b", current: { mode: "main", repo: null }, open: open({}, calls), fresh: true });
      expect(found).toEqual({ kind: "blocked", repo: "a/b-plan" });
    });

    it("takes a <name>-plan repository only when nothing of the plan is here yet", async () => {
      const calls: string[] = [];
      const code = fake("code", new Map(), calls);
      const repos = { "a/b-plan": new Map([[plan.LOCATION_FILE, note({ for: "a/b", mode: "repo" })]]) };
      expect(await plan.findPlan({ code, slug: "a/b", current: { mode: "main", repo: null }, open: open(repos, calls), fresh: false })).toBeNull();
      expect(await plan.findPlan({ code, slug: "a/b", current: { mode: "main", repo: null }, open: open(repos, calls), fresh: true })).toMatchObject({
        kind: "found",
        location: { mode: "repo", repo: "a/b-plan" },
      });
    });

    it("never takes another project's plan", async () => {
      const calls: string[] = [];
      const code = fake("code", new Map(), calls);
      const repos = { "a/b-plan": new Map([[plan.LOCATION_FILE, note({ for: "a/other", mode: "repo" })]]) };
      expect(await plan.findPlan({ code, slug: "a/b", current: { mode: "main", repo: null }, open: open(repos, calls), fresh: true })).toBeNull();
    });

    it("leaves a project with nothing anywhere as it is", async () => {
      const calls: string[] = [];
      const code = fake("code", new Map([[".repoboard/board.json", "{}"]]), calls);
      expect(await plan.findPlan({ code, slug: "a/b", current: { mode: "main", repo: null }, open: open({}, calls), fresh: false })).toBeNull();
    });

    it("follows a plan that moved on from its own repository", async () => {
      const calls: string[] = [];
      const code = fake("code", new Map(), calls);
      const repos = { "a/b-plan": new Map([[plan.LOCATION_FILE, note({ for: "a/b", movedTo: { mode: "branch", repo: null } })]]) };
      expect(await plan.findPlan({ code, slug: "a/b", current: { mode: "repo", repo: "a/b-plan" }, open: open(repos, calls), fresh: false })).toMatchObject({
        kind: "found",
        location: { mode: "branch" },
      });
    });
  });
});
