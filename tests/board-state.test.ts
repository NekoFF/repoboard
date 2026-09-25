import { describe, it, expect } from "vitest";
import {
  mergeBoardState,
  describeChanges,
  serialiseBoardState,
  parseBoardState,
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
