import { describe, it, expect } from "vitest";
import {
  mergeBoardState,
  describeChanges,
  serialiseBoardState,
  parseBoardState,
  mergeBoardFile,
  describeFileChanges,
  type BoardState,
  type BoardStateBoard,
  type BoardStateCard,
} from "@/lib/board-state";

const card = (over: Partial<BoardStateCard> = {}): BoardStateCard => ({
  id: "a",
  number: 1,
  column: "Todo",
  position: 0,
  title: "A card",
  description: null,
  assignee: null,
  dueDate: null,
  checklist: [],
  labels: [],
  branches: [],
  pullRequests: [],
  issues: [],
  markdownTaskId: null,
  updatedAt: 1000,
  deletedAt: null,
  ...over,
});

describe("merge", () => {
  it("takes cards that only exist on the other side", () => {
    const result = mergeBoardState([card({ id: "a" })], [card({ id: "b" })]);
    expect(result.cards.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(result.added).toBe(1);
  });

  it("keeps the newer edit of the same card", () => {
    const result = mergeBoardState(
      [card({ id: "a", title: "mine", updatedAt: 2000 })],
      [card({ id: "a", title: "theirs", updatedAt: 1000 })],
    );
    expect(result.cards[0].title).toBe("mine");
    expect(result.updated).toBe(0);
  });

  it("lets a newer remote edit win and reports it", () => {
    const result = mergeBoardState(
      [card({ id: "a", title: "mine", updatedAt: 1000 })],
      [card({ id: "a", title: "theirs", updatedAt: 5000 })],
    );
    expect(result.cards[0].title).toBe("theirs");
    expect(result.overriddenLocally).toEqual(["a"]);
  });

  it("does not resurrect a card the other side deleted more recently", () => {
    const result = mergeBoardState(
      [card({ id: "a", updatedAt: 1000 })],
      [card({ id: "a", updatedAt: 2000, deletedAt: 2000 })],
    );
    expect(result.cards[0].deletedAt).toBe(2000);
  });

  it("merging twice changes nothing the second time", () => {
    const local = [card({ id: "a", updatedAt: 1000 })];
    const remote = [card({ id: "b", updatedAt: 2000 })];
    const once = mergeBoardState(local, remote).cards;
    const twice = mergeBoardState(once, remote).cards;
    expect(twice).toHaveLength(2);
    expect(twice.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
});

describe("serialisation", () => {
  it("round-trips", () => {
    const state = { version: 1 as const, columns: ["Todo"], cards: [card()] };
    expect(parseBoardState(serialiseBoardState(state))).toEqual(state);
  });

  it("is byte-identical regardless of card order, so an unchanged board is not a change", () => {
    const a = { version: 1 as const, columns: ["Todo"], cards: [card({ id: "b" }), card({ id: "a" })] };
    const b = { version: 1 as const, columns: ["Todo"], cards: [card({ id: "a" }), card({ id: "b" })] };
    expect(serialiseBoardState(a)).toBe(serialiseBoardState(b));
  });

  it("refuses content that is not a board", () => {
    expect(parseBoardState("not json")).toBeNull();
    expect(parseBoardState('{"version":99}')).toBeNull();
  });
});

describe("describeChanges", () => {
  it("names moves, renames, additions and deletions in words", () => {
    const remote = [card({ id: "a", column: "Todo", title: "A" })];
    const local = [
      card({ id: "a", column: "Done", title: "A", updatedAt: 2000 }),
      card({ id: "b", title: "New one" }),
    ];
    const lines = describeChanges(local, remote);
    expect(lines).toContain("A: Todo → Done");
    expect(lines).toContain("added: New one");
  });

  it("points out cards that exist only on GitHub", () => {
    const lines = describeChanges([], [card({ id: "z", title: "Theirs" })]);
    expect(lines).toContain("only on GitHub: Theirs");
  });
});

const board = (over: Partial<BoardStateBoard> = {}): BoardStateBoard => ({
  id: "board_max",
  name: "Max",
  description: null,
  color: "violet",
  art: "waves",
  owner: "max",
  updatedAt: 1000,
  position: 1,
  archivedAt: null,
  columns: ["Todo", "Done"],
  cards: [],
  ...over,
});
const file = (over: Partial<BoardState> = {}): BoardState => ({ version: 1, columns: ["Todo"], cards: [], ...over });

describe("several boards in one file", () => {
  it("brings in a board only the repository has, with its cards", () => {
    const remote = file({ boards: [board({ cards: [card({ id: "m1", title: "Onboarding" })] })] });
    const merged = mergeBoardFile(file(), remote);
    expect(merged.newBoards).toEqual(["Max"]);
    expect(merged.state.boards?.[0].cards.map((c) => c.id)).toEqual(["m1"]);
    expect(merged.added).toBe(1);
  });

  it("keeps a board only this machine has", () => {
    const merged = mergeBoardFile(file({ boards: [board()] }), file());
    expect(merged.state.boards?.map((b) => b.name)).toEqual(["Max"]);
  });

  it("takes the newer name, colour and picture of a board", () => {
    const mine = file({ boards: [board({ name: "Max", updatedAt: 1000 })] });
    const theirs = file({ boards: [board({ name: "Max (intern)", art: "rings", updatedAt: 2000 })] });
    expect(mergeBoardFile(mine, theirs).state.boards?.[0]).toMatchObject({ name: "Max (intern)", art: "rings" });
    expect(mergeBoardFile(theirs, mine).state.boards?.[0]).toMatchObject({ name: "Max (intern)" });
  });

  it("merges each board's cards one by one", () => {
    const mine = file({ boards: [board({ cards: [card({ id: "x", title: "Mine", updatedAt: 3000 })] })] });
    const theirs = file({ boards: [board({ cards: [card({ id: "x", title: "Theirs", updatedAt: 2000 }), card({ id: "y" })] })] });
    const cards = mergeBoardFile(mine, theirs).state.boards?.[0].cards ?? [];
    expect(cards.find((c) => c.id === "x")?.title).toBe("Mine");
    expect(cards.map((c) => c.id).sort()).toEqual(["x", "y"]);
  });

  it("describes new, archived and edited boards, naming the board of each card change", () => {
    const remote = file({ boards: [board({ id: "b2", name: "Design", updatedAt: 1000 })] });
    const local = file({
      boards: [
        board({ cards: [card({ id: "c", title: "First task" })] }),
        board({ id: "b2", name: "Design", archivedAt: 5000, updatedAt: 5000 }),
      ],
    });
    const lines = describeFileChanges(local, remote);
    expect(lines).toContain("new board: Max");
    expect(lines).toContain("Max: added: First task");
    expect(lines).toContain("archived the board Design");
  });

  it("reads a file from before there were several boards", () => {
    const old = parseBoardState(JSON.stringify({ version: 1, columns: ["Todo"], cards: [card()] }));
    expect(old?.boards).toBeUndefined();
    expect(mergeBoardFile(file(), old).state.cards).toHaveLength(1);
  });

  it("writes the same bytes for the same boards in any order", () => {
    const a = file({ boards: [board({ id: "b", cards: [card({ id: "2" }), card({ id: "1" })] }), board({ id: "a" })] });
    const b = file({ boards: [board({ id: "a" }), board({ id: "b", cards: [card({ id: "1" }), card({ id: "2" })] })] });
    expect(serialiseBoardState(a)).toBe(serialiseBoardState(b));
  });

  it("keeps the repository's milestones on a machine that has none", () => {
    const remote = file({ milestones: [{ name: "Public beta", description: null, dueDate: null }] });
    expect(mergeBoardFile(file({ milestones: [] }), remote).state.milestones?.map((m) => m.name)).toEqual(["Public beta"]);
  });

  it("gives a never-edited main board the repository's name", () => {
    const fresh = { name: "Main board", description: null, color: null, art: null, owner: null, updatedAt: 0 };
    const shared = { ...fresh, name: "Project board" };
    expect(mergeBoardFile(file({ board: fresh }), file({ board: shared })).state.board?.name).toBe("Project board");
  });
});
