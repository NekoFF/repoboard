import { describe, expect, it } from "vitest";
import { groupEvents, summarise, type InboxEvent } from "@/lib/client/inbox";

const MIN = 60_000;
let n = 0;
const ev = (actor: string, at: number, type = "card_updated", taskId: string | null = "t1"): InboxEvent => ({
  id: `e${++n}`,
  type,
  message: "changed something",
  taskId,
  actor,
  actorKind: actor === "Claude" ? "agent" : "person",
  createdAt: at,
});

describe("inbox grouping", () => {
  it("folds a burst of one agent's work into one entry, even with a teammate in between", () => {
    const t = 1_000 * MIN;
    const burst = Array.from({ length: 60 }, (_, i) => ev("Claude", t - i * MIN, i < 12 ? "card_created" : "card_moved", `t${i % 14}`));
    const events = [...burst.slice(0, 30), ev("sam", t - 30 * MIN + 1), ...burst.slice(30)].sort((a, b) => b.createdAt - a.createdAt);
    const entries = groupEvents(events);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "group", actor: "Claude" });
    expect(entries[0].kind === "group" && entries[0].events).toHaveLength(60);
    expect(entries[1]).toMatchObject({ kind: "event" });
  });

  it("keeps a few changes as rows and splits bursts at a long pause", () => {
    const t = 1_000 * MIN;
    const entries = groupEvents([ev("Claude", t), ev("Claude", t - MIN), ev("Claude", t - 90 * MIN), ev("Claude", t - 91 * MIN), ev("Claude", t - 92 * MIN)]);
    expect(entries.map((e) => e.kind)).toEqual(["event", "event", "group"]);
  });

  it("says what a burst did in a line", () => {
    const events = [
      ...Array.from({ length: 12 }, (_, i) => ev("Claude", i, "card_created", `c${i}`)),
      ...Array.from({ length: 3 }, (_, i) => ev("Claude", i, "card_moved", `c${i}`)),
      ev("Claude", 0, "comment", "c1"),
    ];
    expect(summarise(events)).toEqual({ did: "created 12 cards, moved 3, commented 1 time", cards: 12 });
    expect(summarise([ev("Claude", 0, "card_moved")]).did).toBe("moved 1 card");
  });
});
