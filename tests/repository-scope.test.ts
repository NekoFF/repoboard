import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const access = vi.hoisted(() => ({ valid: true, role: "manager" as "manager" | "member" | "viewer" }));
vi.mock("@/lib/github/access", () => ({
  getVerifiedRepository: async () => access.valid ? { owner: "acme", name: "beta", role: access.role } : null,
  getViewer: async () => (access.valid ? "tester" : null),
  currentWho: async () => (access.valid ? { login: "tester", role: access.role } : null),
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

describe("roles from GitHub", () => {
  const post = (body: Record<string, unknown>) =>
    boardRoute.POST(new Request("http://localhost/api/board", { method: "POST", body: JSON.stringify(body) }));

  it("lets a member make boards for themselves only, and change only those", async () => {
    access.role = "member";
    try {
      expect((await post({ action: "board-create", name: "For Max", owner: "max" })).status).toBe(403);
      expect((await post({ action: "board-create", name: "Design" })).status).toBe(200); // becomes their own
      const own = service.listBoards().find((b) => b.name === "Design" && b.owner === "tester");
      expect(own).toBeTruthy();
      const other = service.createBoard({ name: "Max's", owner: "max" });
      expect((await post({ action: "board-update", boardId: other, name: "Mine now" })).status).toBe(403);
      expect((await post({ action: "board-update", boardId: own!.id, owner: "max" })).status).toBe(403);
      expect((await post({ action: "board-update", boardId: own!.id, name: "My design" })).status).toBe(200);
    } finally {
      access.role = "manager";
    }
  });

  it("keeps a viewer from changing anything, and hides boards kept to their owner", async () => {
    const hidden = service.createBoard({ name: "Private", owner: "max", visibility: "owner" });
    expect(service.listBoards({ login: "kim", role: "member" }).some((b) => b.id === hidden)).toBe(false);
    expect(service.listBoards({ login: "max", role: "member" }).some((b) => b.id === hidden)).toBe(true);
    expect(service.listBoards({ login: "boss", role: "manager" }).some((b) => b.id === hidden)).toBe(true);

    access.role = "viewer";
    try {
      const data = service.getBoardData();
      expect((await post({ action: "create", columnId: data.columns[0].id, title: "Nope" })).status).toBe(403);
      expect((await post({ action: "board-create", name: "Nope" })).status).toBe(403);
      // Looking is fine.
      expect((await post({ action: "board-status" })).status).not.toBe(403);
    } finally {
      access.role = "manager";
    }
  });
});
