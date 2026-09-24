import { describe, it, expect } from "vitest";
import {
  checkWriteSafety,
  buildDiff,
  diffStats,
  commitMessageForMove,
} from "@/lib/markdown/sync";
import { moveTask } from "@/lib/markdown/parser";

describe("checkWriteSafety", () => {
  it("allows a write when the remote SHA still matches the fetched one", () => {
    expect(checkWriteSafety("7ac12ef", "7ac12ef")).toEqual({ ok: true });
  });

  it("blocks the write when GitHub moved ahead", () => {
    const result = checkWriteSafety("7ac12ef", "91b302c");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("sha_mismatch");
      expect(result.expectedSha).toBe("7ac12ef");
      expect(result.currentSha).toBe("91b302c");
    }
  });

  it("blocks the write when there is no fetched base at all", () => {
    const result = checkWriteSafety(null, "91b302c");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_base");
  });

  it("never reports ok for an empty expected sha", () => {
    expect(checkWriteSafety("", "abc").ok).toBe(false);
    expect(checkWriteSafety(undefined, "abc").ok).toBe(false);
  });
});

describe("buildDiff", () => {
  const before = `## In Progress

- [ ] Private mode cookie isolation <!-- rb:task_b -->

## Done

- [x] D-pad focus memory <!-- rb:task_d -->
`;

  it("shows the moved line as one deletion and one addition", () => {
    const after = moveTask(before, "task_b", "Done").content;
    const diff = buildDiff(before, after);
    const stats = diffStats(diff);

    expect(stats.deletions).toBeGreaterThan(0);
    expect(stats.additions).toBeGreaterThan(0);
    expect(
      diff.some(
        (d) => d.type === "del" && d.text.includes("- [ ] Private mode"),
      ),
    ).toBe(true);
    expect(
      diff.some(
        (d) => d.type === "add" && d.text.includes("- [x] Private mode"),
      ),
    ).toBe(true);
  });

  it("returns no add/del rows for identical content", () => {
    const stats = diffStats(buildDiff(before, before));
    expect(stats).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("commitMessageForMove", () => {
  it("formats the RepoBoard commit subject", () => {
    expect(
      commitMessageForMove('Move "Private mode cookie isolation" to Done'),
    ).toBe('RepoBoard: move "Private mode cookie isolation" to Done');
  });
});
