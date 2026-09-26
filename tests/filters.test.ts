import { describe, expect, it } from "vitest";
import { addToken, applyFilter, parseFilter, removeToken, token } from "@/lib/client/filters";
import type { BoardTask } from "@/lib/board-service";

const columns = [
  { id: "c1", name: "Todo", position: 0 },
  { id: "c2", name: "In Progress", position: 1 },
  { id: "c4", name: "Done", position: 3 },
];
const milestones = [{ id: "m1", name: "Public beta", description: null, dueDate: null, position: 0 }];

function card(patch: Partial<BoardTask>): BoardTask {
  return {
    id: Math.random().toString(36),
    number: 1,
    columnId: "c1",
    title: "Card",
    description: null,
    assignee: null,
    dueDate: null,
    position: 0,
    priority: 0,
    milestoneId: null,
    updatedAt: 0,
    checklist: [],
    markdownTaskId: null,
    labels: [],
    branches: [],
    commits: [],
    pullRequests: [],
    issues: [],
    ...patch,
  };
}

const NOW = Date.UTC(2026, 8, 25, 12);
const DAY = 86_400_000;
const tasks = [
  card({ title: "Privacy mode", labels: ["privacy"], assignee: "neko", priority: 2, milestoneId: "m1", number: 12 }),
  card({ title: "Crash on start", labels: ["bug"], columnId: "c2", dueDate: NOW - 2 * DAY, number: 13 }),
  card({ title: "Old thing", columnId: "c4", dueDate: NOW - 5 * DAY, number: 14 }),
  card({ title: "Soon", dueDate: Date.UTC(2026, 8, 28), number: 15 }),
];
const data = { columns, milestones };
const titles = (q: string) => applyFilter(tasks, parseFilter(q), data, NOW).map((t) => t.title);

describe("board filter", () => {
  it("matches words, operators and quoted values", () => {
    expect(titles("privacy")).toEqual(["Privacy mode"]);
    expect(titles("label:bug")).toEqual(["Crash on start"]);
    expect(titles("@neko !high")).toEqual(["Privacy mode"]);
    expect(titles('milestone:"Public beta"')).toEqual(["Privacy mode"]);
    expect(titles("rb-13")).toEqual(["Crash on start"]);
  });

  it("understands status and due-date operators", () => {
    expect(titles("is:open")).toEqual(["Privacy mode", "Crash on start", "Soon"]);
    expect(titles("is:done")).toEqual(["Old thing"]);
    expect(titles("is:doing")).toEqual(["Crash on start"]);
    // Done cards are never "overdue".
    expect(titles("due:overdue")).toEqual(["Crash on start"]);
    expect(titles("due:week")).toEqual(["Soon"]);
    expect(titles("due:none")).toEqual(["Privacy mode"]);
  });

  it("adds and removes tokens without duplicating them", () => {
    let q = addToken("crash", token.label("bug"));
    q = addToken(q, token.label("bug"));
    expect(q).toBe("crash label:bug");
    q = addToken(q, token.milestone("Public beta"));
    expect(q).toBe('crash label:bug milestone:"Public beta"');
    expect(removeToken(q, "label:bug")).toBe('crash milestone:"Public beta"');
  });
});

describe("query chips", () => {
  it("separates operators from free text and puts them back together", async () => {
    const { splitQuery, joinQuery, describeToken } = await import("@/lib/client/filters");
    const parts = splitQuery('crash label:bug @neko milestone:"Public beta" on start');
    expect(parts.operators).toEqual(["label:bug", "@neko", 'milestone:"Public beta"']);
    expect(parts.text).toBe("crash on start");
    expect(joinQuery(parts.operators, "new text")).toBe('label:bug @neko milestone:"Public beta" new text');
    expect(describeToken('milestone:"Public beta"')).toEqual({ key: "Milestone", value: "Public beta" });
  });
});
