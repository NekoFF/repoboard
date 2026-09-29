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

  it("creates the documents agents proposed in one commit, and they no longer wait", async () => {
    const hub = fakeGitHub();
    const commits: { files: { path: string }[]; message: string }[] = [];
    const gh = { ...hub.gh, createFiles: async (args: { files: { path: string }[]; message: string }) => (commits.push(args), { commitSha: "new" }) };
    const factory = async () => gh as never;
    const sqlite = new Database(path.join(scratch, "board.db"));
    const repo = (sqlite.prepare("SELECT id FROM repositories LIMIT 1").get() as { id: string }).id;
    const add = sqlite.prepare("INSERT INTO doc_proposals (id, repository_id, path, edits, content, author, summary, created_at) VALUES (?,?,?,?,?,?,?,?)");
    add.run("p1", repo, ".repoboard/checklists/cra.md", null, "# CRA\n\n- [ ] SBOM published\n", "Claude", "New checklist: CRA", Date.now());
    add.run("p2", repo, ".repoboard/notes/tv.md", null, "# TV\n", "Claude", "New note: TV", Date.now());
    // Exists already: shown, not created again.
    add.run("p3", repo, ".repoboard/checklists/release-1.0.md", null, "# Release\n", "Claude", "New checklist: Release", Date.now());
    sqlite.close();

    const preview = await docs.previewProposedDocs(["p1", "p2", "p3"], factory);
    expect(preview.files.map((f) => f.path)).toEqual([".repoboard/checklists/cra.md", ".repoboard/notes/tv.md"]);
    expect(preview.existing).toEqual([".repoboard/checklists/release-1.0.md"]);

    const done = await docs.createProposedDocs(["p1", "p2"], factory);
    expect(done.paths).toHaveLength(2);
    expect(commits).toHaveLength(1);
    expect(commits[0].message).toBe("RepoBoard: create 2 documents proposed by Claude");
    expect(docs.listProposals().map((p) => p.id)).toEqual(["p3"]);
  });

  it("writes agents' documents by itself only when the project allows it, and only inside .repoboard/", async () => {
    const hub = fakeGitHub();
    const commits: string[] = [];
    const gh = {
      ...hub.gh,
      createFiles: async (args: { files: { path: string }[] }) => (commits.push(`create ${args.files.map((f) => f.path).join(",")}`), { commitSha: "n" }),
      putFile: async (args: { path: string; content: string }) => {
        commits.push(`put ${args.path}`);
        hub.files.set(args.path, args.content);
        return { commitSha: "e", contentSha: `sha-${args.content.length}` };
      },
    };
    const factory = async () => gh as never;
    const sqlite = new Database(path.join(scratch, "board.db"));
    const repo = (sqlite.prepare("SELECT id FROM repositories LIMIT 1").get() as { id: string }).id;
    sqlite.prepare("DELETE FROM doc_proposals").run();
    const add = sqlite.prepare("INSERT INTO doc_proposals (id, repository_id, path, edits, content, author, summary, created_at) VALUES (?,?,?,?,?,?,?,?)");
    add.run("n1", repo, ".repoboard/notes/tv.md", null, "# TV\n", "Claude", "New note: TV", Date.now());
    add.run("e1", repo, ".repoboard/checklists/release-1.0.md", JSON.stringify([{ type: "add", section: null, title: "Store listing", details: ["Verify: no warnings"] }]), null, "Claude", "Add the check", Date.now());
    add.run("o1", repo, "docs/PLAN.md", JSON.stringify([{ type: "add", section: null, title: "Outside" }]), null, "Claude", "Outside", Date.now());
    sqlite.close();

    // Waiting for review: nothing is written.
    expect(await docs.applyProposals(factory)).toEqual({ applied: 0, kept: 0 });
    expect(commits).toEqual([]);

    docs.setAgentDocsMode("direct");
    const result = await docs.applyProposals(factory);
    expect(result.applied).toBe(2);
    expect(commits).toEqual(["create .repoboard/notes/tv.md", "put .repoboard/checklists/release-1.0.md"]);
    expect(hub.files.get(".repoboard/checklists/release-1.0.md")).toContain("- [ ] Store listing\n  - Verify: no warnings");
    // Outside .repoboard/ it still waits for the person.
    expect(docs.listProposals().map((p) => p.id)).toEqual(["o1"]);
    docs.setAgentDocsMode("review");
  });

  it("renames a screenshot named in letters the checks refuse, and its proof follows", async () => {
    const sqlite = new Database(path.join(scratch, "board.db"));
    const repo = (sqlite.prepare("SELECT id FROM repositories LIMIT 1").get() as { id: string }).id;
    sqlite.prepare("DELETE FROM doc_proposals").run();
    const old = ".repoboard/evidence/licenses-в-apk-нет-логотипов-1.png";
    const edits = [{ type: "proof", line: 3, title: "Нет логотипов", state: "review", by: "Claude", checked: false, proofs: [{ kind: "image", path: "../evidence/licenses-в-apk-нет-логотипов-1.png", alt: "Screenshot" }] }];
    sqlite
      .prepare("INSERT INTO doc_proposals (id, repository_id, path, edits, content, author, summary, created_at, attachments) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("abcdef123456", repo, ".repoboard/checklists/licenses.md", JSON.stringify(edits), null, "Claude", "Mark", Date.now(), JSON.stringify([{ path: old, base64: "iVBORw0KGgo=" }]));
    sqlite.close();
    const [p] = docs.listProposals();
    expect(p.attachments[0].path).toBe(".repoboard/evidence/licenses-abcdef12-1.png");
    const proof = p.edits![0] as { proofs: { path: string }[] };
    expect(proof.proofs[0].path).toBe("../evidence/licenses-abcdef12-1.png");
  });
});
