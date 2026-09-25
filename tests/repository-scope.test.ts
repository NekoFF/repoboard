import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const access = vi.hoisted(() => ({ valid: true }));
vi.mock("@/lib/github/access", () => ({
  getVerifiedRepository: async () => access.valid ? { owner: "acme", name: "beta" } : null,
  getViewer: async () => (access.valid ? "tester" : null),
}));

const databaseFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-scope-")), "board.db");
process.env.DATABASE_URL = `file:${databaseFile}`;
process.env.GITHUB_REPO = "acme/alpha";

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { drizzle } = await import("drizzle-orm/better-sqlite3");
const sqlite = new Database(databaseFile);
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
sqlite.close();

const service = await import("@/lib/board-service");
const boardRoute = await import("@/app/api/board/route");
const { getPageContext } = await import("@/lib/page-context");

describe("repository selection", () => {
  it("shows the configured board and rejects IDs from another board", async () => {
    service.ensureBootstrap({ owner: "acme", name: "alpha", defaultBranch: "main", visibility: "private" });
    const alpha = service.getBoardData();
    const alphaTaskId = service.createTask({
      boardId: alpha.boardId!,
      columnId: alpha.columns[0].id,
      title: "Alpha only",
      repositoryId: alpha.repository!.id,
    });
    service.logActivity({ repositoryId: alpha.repository!.id, taskId: alphaTaskId, type: "comment", message: "Alpha note" });
    expect(service.importIssues({
      boardId: alpha.boardId!, columnId: alpha.columns[0].id, repositoryId: alpha.repository!.id,
      issues: [{ number: 1, title: "Alpha issue", labels: [] }],
    }).created).toBe(1);

    service.ensureBootstrap({ owner: "acme", name: "beta", defaultBranch: "main", visibility: "private" });
    process.env.GITHUB_REPO = "acme/beta";

    const beta = service.getBoardData();
    expect(beta.repository?.name).toBe("beta");
    expect(beta.tasks).toHaveLength(0);
    expect(service.getRepoHeader().name).toBe("beta");
    expect(service.getRepoIdentity().stored?.name).toBe("beta");
    expect(service.getActivity()).toHaveLength(1); // beta's board-created event only
    expect(service.importIssues({
      boardId: beta.boardId!, columnId: beta.columns[0].id, repositoryId: beta.repository!.id,
      issues: [{ number: 1, title: "Beta issue", labels: [] }],
    }).created).toBe(1);

    const foreignUpdate = await boardRoute.POST(new Request("http://localhost/api/board", {
      method: "POST", body: JSON.stringify({ action: "update", taskId: alphaTaskId, title: "Wrong board" }),
    }));
    expect(foreignUpdate.status).toBe(404);

    const foreignCreate = await boardRoute.POST(new Request("http://localhost/api/board", {
      method: "POST", body: JSON.stringify({ action: "create", columnId: alpha.columns[0].id, title: "Wrong column" }),
    }));
    expect(foreignCreate.status).toBe(404);

    const response = await boardRoute.GET(new Request("http://localhost/api/board"));
    const visible = await response.json();
    expect(visible.repository.name).toBe("beta");
    expect(visible.tasks.map((task: { title: string }) => task.title)).toEqual(["Beta issue"]);

    access.valid = false;
    const denied = await boardRoute.GET(new Request("http://localhost/api/board"));
    expect(denied.status).toBe(401);
    expect(JSON.stringify(await denied.json())).not.toContain("Alpha only");
    expect((await getPageContext()).data).toEqual({ repository: null, boardId: null, board: null, columns: [], tasks: [], milestones: [], markdownSource: null });
    expect((await boardRoute.POST(new Request("http://localhost/api/board", {
      method: "POST", body: JSON.stringify({ action: "create", columnId: beta.columns[0].id, title: "No access" }),
    }))).status).toBe(401);
    access.valid = true;

    process.env.GITHUB_REPO = "acme/alpha";
    expect(service.getBoardData().tasks.map((task) => task.title)).toEqual(["Alpha only", "Alpha issue"]);
  });
});

describe("attribution", () => {
  it("records who made a change through the board route", async () => {
    const beta = service.getBoardData();
    const response = await boardRoute.POST(new Request("http://localhost/api/board", {
      method: "POST", body: JSON.stringify({ action: "create", columnId: beta.columns[0].id, title: "Signed work" }),
    }));
    expect(response.status).toBe(200);
    const event = service.getActivity().find((e) => e.message === "created Signed work");
    expect(event).toMatchObject({ actor: "tester", actorKind: "person" });
  });
});

describe("several boards in one project", () => {
  it("keeps cards per board, numbers them across the project, and guards board ids", async () => {
    const primary = service.getBoardData();
    const designId = service.createBoard({ name: "Design", owner: "dima" });
    const design = service.getBoardData(designId);
    expect(design.board).toMatchObject({ name: "Design", owner: "dima", primary: false });
    expect(design.columns.map((c) => c.name)).toEqual(["Todo", "In Progress", "Review", "Done"]);

    const before = Math.max(0, ...primary.tasks.map((t) => t.number ?? 0));
    const card = service.createTask({
      boardId: designId,
      columnId: design.columns[0].id,
      title: "Home screen",
      repositoryId: design.repository!.id,
    });
    const after = service.getBoardData(designId).tasks.find((t) => t.id === card)!;
    expect(after.number).toBe(before + 1);
    expect(service.getBoardData().tasks.some((t) => t.id === card)).toBe(false);
    expect(service.findCardBoard(`RB-${after.number}`)).toEqual({ boardId: designId, taskId: card });

    const boards = service.listBoards();
    expect(boards[0].primary).toBe(true);
    expect(boards.find((b) => b.id === designId)).toMatchObject({ open: 1, done: 0 });

    // A board of another project, or a made-up id, is not reachable.
    expect(service.getBoardData("board_nope").boardId).toBeNull();
    const response = await boardRoute.POST(new Request("http://localhost/api/board", {
      method: "POST", body: JSON.stringify({ action: "create", boardId: "board_nope", columnId: "x", title: "Lost" }),
    }));
    expect(response.status).toBe(404);

    expect(() => service.archiveBoard(primary.boardId!)).toThrow();
    service.archiveBoard(designId);
    expect(service.listBoards().some((b) => b.id === designId)).toBe(false);
  });
});
