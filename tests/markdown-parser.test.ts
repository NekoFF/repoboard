import { describe, it, expect } from "vitest";
import {
  parseMarkdown,
  ensureTaskIds,
  moveTask,
  parseTaskLine,
  tasksByHeading,
} from "@/lib/markdown/parser";

const ROADMAP = `# Roadmap

## Todo

- [ ] Phone input pairing <!-- rb:task_aaa1 -->
- [ ] Reader mode baseline

## In Progress

- [ ] Private mode cookie isolation <!-- rb:task_bbb2 -->

## Review

- [ ] Session restore edge cases <!-- rb:task_ccc3 -->

## Done

- [x] D-pad focus memory <!-- rb:task_ddd4 -->
`;

describe("parseTaskLine", () => {
  it("reads checkbox state, title and id", () => {
    expect(parseTaskLine("- [ ] Hello <!-- rb:task_x1 -->")).toEqual({
      done: false,
      title: "Hello",
      id: "task_x1",
    });
    expect(parseTaskLine("- [x] Done thing")).toEqual({
      done: true,
      title: "Done thing",
      id: null,
    });
  });

  it("ignores non-task lines", () => {
    expect(parseTaskLine("Just a paragraph")).toBeNull();
    expect(parseTaskLine("- a plain bullet")).toBeNull();
  });
});

describe("parseMarkdown", () => {
  it("assigns every task to its heading", () => {
    const { tasks } = parseMarkdown(ROADMAP);
    expect(tasks).toHaveLength(5);
    expect(tasks.map((t) => t.heading)).toEqual([
      "Todo",
      "Todo",
      "In Progress",
      "Review",
      "Done",
    ]);
    expect(tasks[4].done).toBe(true);
  });

  it("does not treat fenced code blocks as tasks", () => {
    const withCode = `## Todo

\`\`\`md
- [ ] not a real task
\`\`\`

- [ ] a real task
`;
    const { tasks } = parseMarkdown(withCode);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("a real task");
  });

  it("groups tasks by column heading", () => {
    const grouped = tasksByHeading(ROADMAP);
    expect(grouped["Todo"]).toHaveLength(2);
    expect(grouped["In Progress"]).toHaveLength(1);
    expect(grouped["Done"]).toHaveLength(1);
  });
});

describe("ensureTaskIds", () => {
  it("adds ids only where they are missing and leaves the rest byte-identical", () => {
    const result = ensureTaskIds(ROADMAP);
    expect(result.changed).toBe(true);
    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0].title).toBe("Reader mode baseline");

    const reparsed = parseMarkdown(result.content);
    expect(reparsed.tasks.every((t) => t.id)).toBe(true);
    // pre-existing ids untouched
    expect(result.content).toContain("rb:task_aaa1");
    expect(result.content).toContain("rb:task_bbb2");
  });

  it("is a no-op when every task already has an id", () => {
    const once = ensureTaskIds(ROADMAP).content;
    const twice = ensureTaskIds(once);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once);
  });
});

describe("moveTask", () => {
  it("moves In Progress → Done and ticks the checkbox", () => {
    const result = moveTask(ROADMAP, "task_bbb2", "Done");
    expect(result.changed).toBe(true);
    expect(result.summary).toBe('Move "Private mode cookie isolation" to Done');

    const tasks = parseMarkdown(result.content).tasks;
    const moved = tasks.find((t) => t.id === "task_bbb2")!;
    expect(moved.heading).toBe("Done");
    expect(moved.done).toBe(true);

    // the In Progress section no longer holds it
    expect(tasks.filter((t) => t.heading === "In Progress")).toHaveLength(0);
  });

  it("unticks the checkbox when moving back out of Done", () => {
    const result = moveTask(ROADMAP, "task_ddd4", "Todo");
    const moved = parseMarkdown(result.content).tasks.find(
      (t) => t.id === "task_ddd4",
    )!;
    expect(moved.heading).toBe("Todo");
    expect(moved.done).toBe(false);
  });

  it("moves upwards without corrupting line indices", () => {
    const result = moveTask(ROADMAP, "task_ddd4", "Todo");
    const tasks = parseMarkdown(result.content).tasks;
    expect(tasks).toHaveLength(5);
    expect(tasks.map((t) => t.title)).toContain("Phone input pairing");
    expect(tasks.map((t) => t.title)).toContain("D-pad focus memory");
  });

  it("preserves unrelated content verbatim", () => {
    const result = moveTask(ROADMAP, "task_bbb2", "Done");
    expect(result.content).toContain("# Roadmap");
    expect(result.content).toContain("- [ ] Phone input pairing");
    expect(result.content).toContain("## Review");
  });

  it("refuses unknown tasks and unknown headings", () => {
    expect(moveTask(ROADMAP, "task_nope", "Done").changed).toBe(false);
    expect(moveTask(ROADMAP, "task_bbb2", "Archived").changed).toBe(false);
  });

  it("is a no-op when the card is dropped back into its own column", () => {
    const result = moveTask(ROADMAP, "task_bbb2", "In Progress");
    expect(result.changed).toBe(false);
    expect(result.content).toBe(ROADMAP);
  });
});
