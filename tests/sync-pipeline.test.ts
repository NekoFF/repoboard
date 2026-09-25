import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * End-to-end test of the sync pipeline against a fake GitHub. Covers the two
 * directions (markdown → board, board → markdown) and the conflict guarantee,
 * without touching the network or a real repository.
 */

const TMP_DB = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-test-")),
  "test.db",
);
process.env.DATABASE_URL = `file:${TMP_DB}`;
process.env.GITHUB_REPO = "acme/demo";

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { drizzle } = await import("drizzle-orm/better-sqlite3");
const sqlite = new Database(TMP_DB);
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
sqlite.close();

const service = await import("@/lib/board-service");
const { db } = await import("@/lib/db/client");
const { markdownSources, tasks } = await import("@/db/schema");

const INITIAL = `# Roadmap

## Todo

- [ ] Phone input pairing

## In Progress

- [ ] Private mode cookie isolation

## Review

## Done

- [x] D-pad focus memory
`;

/** In-memory stand-in for the Contents API, including its SHA behaviour. */
class FakeGitHub {
  content = INITIAL;
  sha = "sha_0";
  commits: { message: string; content: string }[] = [];
  private counter = 0;

  async getFile(filePath: string) {
    return { path: filePath, content: this.content, sha: this.sha };
  }

  async putFile(args: {
    path: string;
    content: string;
    expectedSha: string;
    message: string;
  }) {
    if (args.expectedSha !== this.sha) {
      throw new Error("409 sha mismatch (GitHub would reject this)");
    }
    this.content = args.content;
    this.counter += 1;
    this.sha = `sha_${this.counter}`;
    this.commits.push({ message: args.message, content: args.content });
    return { commitSha: `commit_${this.counter}`, contentSha: this.sha };
  }

  /** Simulates somebody editing the file directly on github.com. */
  editRemotely(content: string) {
    this.content = content;
    this.counter += 1;
    this.sha = `sha_remote_${this.counter}`;
  }
}

let github: FakeGitHub;
const factory = async () => github;

beforeEach(() => {
  db.delete(tasks).run();
  db.delete(markdownSources).run();
  github = new FakeGitHub();

  service.ensureBootstrap({
    owner: "acme",
    name: "demo",
    defaultBranch: "main",
    visibility: "private",
  });

  const data = service.getBoardData();
  service.setMarkdownSource(data.repository!.id, "ROADMAP.md");
});

describe("GitHub → board", () => {
  it("backfills task ids, commits them back, and creates cards per heading", async () => {
    const result = await service.syncFromMarkdown(factory);

    expect(result.idsAssigned).toBe(3);
    expect(result.committedIds).toBe(true);
    expect(result.created).toBe(3);
    expect(github.commits).toHaveLength(1);
    expect(github.commits[0].message).toContain("add stable task ids");

    const board = service.getBoardData();
    const byColumn = (name: string) => {
      const column = board.columns.find((c) => c.name === name)!;
      return board.tasks.filter((t) => t.columnId === column.id);
    };

    expect(byColumn("Todo").map((t) => t.title)).toEqual([
      "Phone input pairing",
    ]);
    expect(byColumn("In Progress").map((t) => t.title)).toEqual([
      "Private mode cookie isolation",
    ]);
    expect(byColumn("Done").map((t) => t.title)).toEqual(["D-pad focus memory"]);
    expect(board.tasks.every((t) => t.markdownTaskId)).toBe(true);
  });

  it("is idempotent: a second sync creates nothing and writes nothing", async () => {
    await service.syncFromMarkdown(factory);
    const second = await service.syncFromMarkdown(factory);

    expect(second.created).toBe(0);
    expect(second.idsAssigned).toBe(0);
    expect(second.committedIds).toBe(false);
    expect(github.commits).toHaveLength(1);
    expect(service.getBoardData().tasks).toHaveLength(3);
  });

  it("picks up a task added directly on GitHub", async () => {
    await service.syncFromMarkdown(factory);
    github.editRemotely(
      github.content.replace(
        "## Review\n",
        "## Review\n\n- [ ] Session restore edge cases\n",
      ),
    );

    const result = await service.syncFromMarkdown(factory);
    expect(result.created).toBe(1);
    expect(
      service.getBoardData().tasks.map((t) => t.title),
    ).toContain("Session restore edge cases");
  });
});

describe("board → GitHub", () => {
  it("previews a move without writing anything", async () => {
    await service.syncFromMarkdown(factory);
    const card = service
      .getBoardData()
      .tasks.find((t) => t.title === "Private mode cookie isolation")!;

    const commitsBefore = github.commits.length;
    const preview = await service.previewMarkdownMove(card.id, "Done", factory);

    expect(preview.summary).toContain("to Done");
    expect(preview.conflict).toBeNull();
    expect(preview.diff.some((d) => d.type === "add")).toBe(true);
    expect(github.commits).toHaveLength(commitsBefore);
  });

  it("commits the move and ticks the checkbox in the file", async () => {
    await service.syncFromMarkdown(factory);
    const card = service
      .getBoardData()
      .tasks.find((t) => t.title === "Private mode cookie isolation")!;

    const preview = await service.previewMarkdownMove(card.id, "Done", factory);
    const written = await service.commitMarkdownMove(
      {
        taskId: card.id,
        targetHeading: "Done",
        expectedSha: preview.baseSha,
      },
      factory,
    );

    expect(written.commitSha).toBeTruthy();
    expect(github.commits.at(-1)!.message).toBe(
      'RepoBoard: move "Private mode cookie isolation" to Done',
    );

    const section = (heading: string) =>
      github.content.split(`## ${heading}`)[1].split("\n## ")[0];

    expect(section("Done")).toContain("- [x] Private mode cookie isolation");
    expect(section("In Progress")).not.toContain(
      "Private mode cookie isolation",
    );
  });

  it("stores the new sha so the next write is not a false conflict", async () => {
    await service.syncFromMarkdown(factory);
    const card = service
      .getBoardData()
      .tasks.find((t) => t.title === "Phone input pairing")!;

    const preview = await service.previewMarkdownMove(
      card.id,
      "In Progress",
      factory,
    );
    await service.commitMarkdownMove(
      { taskId: card.id, targetHeading: "In Progress", expectedSha: preview.baseSha },
      factory,
    );

    const source = db.select().from(markdownSources).get()!;
    expect(source.lastKnownSha).toBe(github.sha);

    const next = await service.previewMarkdownMove(card.id, "Done", factory);
    expect(next.conflict).toBeNull();
  });
});

describe("conflicts", () => {
  it("flags a preview when the remote moved ahead", async () => {
    await service.syncFromMarkdown(factory);
    const card = service
      .getBoardData()
      .tasks.find((t) => t.title === "Phone input pairing")!;

    github.editRemotely(`${github.content}\n<!-- edited on github -->\n`);

    const preview = await service.previewMarkdownMove(card.id, "Done", factory);
    expect(preview.conflict).not.toBeNull();
    expect(preview.conflict!.currentSha).toBe(github.sha);
    expect(preview.conflict!.remoteContent).toContain("edited on github");
  });

  it("refuses to commit against a stale sha and leaves the file untouched", async () => {
    await service.syncFromMarkdown(factory);
    const card = service
      .getBoardData()
      .tasks.find((t) => t.title === "Phone input pairing")!;

    const preview = await service.previewMarkdownMove(card.id, "Done", factory);
    github.editRemotely(`${github.content}\n<!-- somebody else -->\n`);
    const contentAtConflict = github.content;

    await expect(
      service.commitMarkdownMove(
        { taskId: card.id, targetHeading: "Done", expectedSha: preview.baseSha },
        factory,
      ),
    ).rejects.toThrow("Remote file changed since preview");

    expect(github.content).toBe(contentAtConflict);
    expect(
      service.getActivity(50).some((e) => e.type === "conflict_detected"),
    ).toBe(true);
  });

  it("writes only when the user explicitly forces it", async () => {
    await service.syncFromMarkdown(factory);
    const card = service
      .getBoardData()
      .tasks.find((t) => t.title === "Phone input pairing")!;

    const preview = await service.previewMarkdownMove(card.id, "Done", factory);
    github.editRemotely(`${github.content}\n<!-- somebody else -->\n`);

    const written = await service.commitMarkdownMove(
      {
        taskId: card.id,
        targetHeading: "Done",
        expectedSha: preview.baseSha,
        force: true,
      },
      factory,
    );

    expect(written.commitSha).toBeTruthy();
    expect(github.content).toContain("- [x] Phone input pairing");
    // the other person's edit survives, because the write is rebased on the
    // freshly fetched remote content rather than on the stale preview
    expect(github.content).toContain("somebody else");
  });
});

describe("batched moves", () => {
  it("collects every divergence between the board and the file", async () => {
    await service.syncFromMarkdown(factory);
    const board = service.getBoardData();
    const done = board.columns.find((c) => c.name === "Done")!;
    const review = board.columns.find((c) => c.name === "Review")!;

    const a = board.tasks.find((t) => t.title === "Phone input pairing")!;
    const b = board.tasks.find(
      (t) => t.title === "Private mode cookie isolation",
    )!;
    service.moveTaskLocally(a.id, done.id, 0);
    service.moveTaskLocally(b.id, review.id, 0);

    const pending = await service.pendingMarkdownMoves(factory);
    expect(pending!.moves).toHaveLength(2);
    expect(pending!.moves.map((m) => m.to).sort()).toEqual(["Done", "Review"]);
  });

  it("writes several moves as one commit", async () => {
    await service.syncFromMarkdown(factory);
    const board = service.getBoardData();
    const done = board.columns.find((c) => c.name === "Done")!;
    const commitsBefore = github.commits.length;

    for (const title of ["Phone input pairing", "Private mode cookie isolation"]) {
      const card = board.tasks.find((t) => t.title === title)!;
      service.moveTaskLocally(card.id, done.id, 0);
    }

    const preview = await service.previewAllPending(factory);
    expect(preview!.summary).toContain("2 task(s) moved");
    expect(github.commits).toHaveLength(commitsBefore); // preview writes nothing

    await service.commitAllPending({ expectedSha: preview!.baseSha }, factory);

    expect(github.commits).toHaveLength(commitsBefore + 1);
    const doneSection = github.content.split("## Done")[1];
    expect(doneSection).toContain("- [x] Phone input pairing");
    expect(doneSection).toContain("- [x] Private mode cookie isolation");
  });

  it("reports nothing pending once the file matches the board", async () => {
    await service.syncFromMarkdown(factory);
    const pending = await service.pendingMarkdownMoves(factory);
    expect(pending!.moves).toHaveLength(0);
  });
});
