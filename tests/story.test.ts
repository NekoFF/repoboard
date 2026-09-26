import { describe, expect, it } from "vitest";
import { buildStory, mergeInfo, storyPositions, type StoryCommit } from "@/lib/client/story";

const H = 3_600_000;
const c = (sha: string, hour: number, parents: string[], message = sha, heads: string[] = []): StoryCommit => ({
  sha,
  message,
  author: "alex",
  date: hour * H,
  parents,
  heads,
});

// root → a → (b: branch feat/x with x1, x2) → merge m → d (main) ; open branch y off d
const history = [
  c("root", 0, [], "Initial commit"),
  c("a", 10, ["root"]),
  c("x1", 12, ["a"], "Start x (RB-4)"),
  c("x2", 14, ["x1"]),
  c("b", 13, ["a"]),
  c("m", 20, ["b", "x2"], "Merge pull request #7 from lumen/feat/x"),
  c("d", 30, ["m"], "d", ["main"]),
  c("y1", 32, ["d"], "y1", ["feat/y"]),
];

describe("the life of a project", () => {
  const story = buildStory(history, "main");
  const byKind = (k: string) => story.nodes.filter((n) => n.kind === k);

  it("reads merge messages", () => {
    expect(mergeInfo("Merge pull request #5 from lumen/design/tab-strip")).toEqual({ pr: 5, branch: "design/tab-strip" });
    expect(mergeInfo("Merge branch 'hotfix'")).toEqual({ pr: null, branch: "hotfix" });
    expect(mergeInfo("Fix it")).toEqual({ pr: null, branch: null });
  });

  it("draws the main line from the first commit to now", () => {
    expect(byKind("start")).toHaveLength(1);
    expect(byKind("now")[0].commits[0].sha).toBe("d");
    expect(story.nodes.filter((n) => n.lane === 0).every((n) => n.branch === "main")).toBe(true);
  });

  it("finds a merged branch, its fork and merge, and its PR and cards", () => {
    const x = story.branches.find((b) => b.name === "feat/x")!;
    expect(x).toMatchObject({ pr: 7, open: false, commits: 2 });
    expect(x.lane).not.toBe(0);
    expect(byKind("merge")[0].pr).toBe(7);
    expect(story.edges.some((e) => e.kind === "fork" && e.branch === "feat/x")).toBe(true);
    expect(story.edges.some((e) => e.kind === "merge" && e.branch === "feat/x")).toBe(true);
    expect(story.nodes.find((n) => n.commits.some((cm) => cm.sha === "x1"))?.cards).toEqual([4]);
  });

  it("marks a branch that is not merged yet as open, ending in its tip", () => {
    const y = story.branches.find((b) => b.name === "feat/y")!;
    expect(y.open).toBe(true);
    expect(byKind("tip")[0].branch).toBe("feat/y");
  });

  it("puts branches that overlap in time on different lanes", () => {
    const overlapping = buildStory(
      [
        c("r", 0, [], "r"),
        c("p1", 5, ["r"], "p1", ["one"]),
        c("q1", 6, ["r"], "q1", ["two"]),
        c("h", 8, ["r"], "h", ["main"]),
      ],
      "main",
    );
    const lanes = overlapping.branches.map((b) => b.lane);
    expect(new Set(lanes).size).toBe(2);
    expect(lanes.every((l) => l !== 0)).toBe(true);
  });

  it("groups long stretches of work into one node per month", () => {
    const long = [c("r", 0, [], "r")];
    for (let i = 1; i <= 40; i += 1) long.push(c(`w${i}`, i, [long[long.length - 1].sha]));
    long[long.length - 1].heads = ["main"];
    const s = buildStory(long, "main");
    expect(s.nodes.length).toBeLessThan(6);
    expect(s.nodes.reduce((n, node) => n + node.commits.length, 0)).toBe(41);
  });

  it("says when history goes back further than was read", () => {
    const s = buildStory([c("a", 1, ["missing"]), c("b", 2, ["a"], "b", ["main"])], "main");
    expect(s.nodes[0].kind).toBe("earlier");
  });

  it("places nodes left to right in time, with compressed gaps", () => {
    const pos = storyPositions(story.nodes);
    const xs = [...story.nodes].sort((a, b) => a.time - b.time).map((n) => pos.get(n.id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.max(...xs)).toBeLessThan(story.nodes.length * 200);
  });
});
