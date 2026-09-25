import { describe, expect, it } from "vitest";
import { layoutGraph } from "@/lib/client/graph";

describe("commit graph layout", () => {
  it("keeps a straight history in one lane", () => {
    const layout = layoutGraph([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(layout.lanes).toEqual([0, 0, 0]);
    expect(layout.width).toBe(1);
    expect(layout.edges.every((e) => e.viaLane === 0)).toBe(true);
  });

  it("opens a lane for a branch and closes it at the merge", () => {
    //   m  (merge of b2 into a2)
    //   |\
    //   a2 b2
    //   |  b1
    //   | /
    //   a1
    const layout = layoutGraph([
      { sha: "m", parents: ["a2", "b2"] },
      { sha: "b2", parents: ["b1"] },
      { sha: "a2", parents: ["a1"] },
      { sha: "b1", parents: ["a1"] },
      { sha: "a1", parents: [] },
    ]);
    expect(layout.lanes[0]).toBe(0); // m
    expect(layout.lanes[2]).toBe(0); // a2 stays on the main line
    expect(layout.lanes[1]).toBe(1); // b2 on the branch lane
    expect(layout.lanes[4]).toBe(0); // a1 back on the main line
    expect(layout.width).toBe(2);
    const merge = layout.edges.find((e) => e.merge)!;
    expect(merge).toMatchObject({ fromRow: 0, toRow: 1, viaLane: 1 });
  });

  it("ignores parents outside the loaded history", () => {
    const layout = layoutGraph([{ sha: "x", parents: ["not-loaded"] }]);
    expect(layout.edges).toEqual([]);
  });
});

describe("main line", () => {
  it("keeps the default branch in lane 0 even when a side branch is newer", () => {
    // side branch d1 was committed after c3 but both come from m1.
    const layout = layoutGraph(
      [
        { sha: "m2", parents: ["c3", "d1"] },
        { sha: "d1", parents: ["m1"] },
        { sha: "c3", parents: ["m1"] },
        { sha: "m1", parents: ["c1"] },
        { sha: "c1", parents: [] },
      ],
      "m2",
    );
    expect(layout.lanes).toEqual([0, 1, 0, 0, 0]);
  });
});
