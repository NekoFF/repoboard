import { describe, expect, it } from "vitest";
import { applyDocEdits, parseDocument } from "@/lib/markdown/document";

const POLICY = `# CRA readiness

Intro text that is not a task.

## Vulnerability handling

- [x] Publish a security contact
- [ ] Coordinated disclosure policy <!-- rb:task_disclose -->
  - [ ] Nested: pick an embargo length

### SBOM

- [ ] Generate an SBOM per release

\`\`\`md
- [ ] this is code, not a task
\`\`\`

## Privacy

> - [ ] quoted item still counts
`;

describe("parseDocument", () => {
  it("finds every checkbox and groups it under the nearest heading", () => {
    const doc = parseDocument(POLICY);
    expect(doc.title).toBe("CRA readiness");
    expect(doc.total).toBe(5);
    expect(doc.done).toBe(1);

    const byHeading = Object.fromEntries(doc.sections.map((s) => [s.heading, s]));
    expect(byHeading["Vulnerability handling"].total).toBe(3);
    expect(byHeading["SBOM"].total).toBe(1);
    expect(byHeading["Privacy"].total).toBe(1);

    const nested = doc.items.find((i) => i.title.startsWith("Nested"));
    expect(nested?.indent).toBe(1);
    expect(doc.items.find((i) => i.id === "task_disclose")?.title).toBe(
      "Coordinated disclosure policy",
    );
    expect(doc.items.some((i) => i.title.includes("code, not a task"))).toBe(false);
  });

  it("falls back to the file name when there is no top heading", () => {
    expect(parseDocument("- [ ] one", "TODO.md").title).toBe("TODO.md");
  });
});

describe("applyDocEdits", () => {
  it("ticks an item by line and title and leaves the rest byte-identical", () => {
    const doc = parseDocument(POLICY);
    const sbom = doc.items.find((i) => i.title.startsWith("Generate"))!;
    const result = applyDocEdits(POLICY, [
      { type: "toggle", line: sbom.line, title: sbom.title, done: true },
    ]);
    expect(result.applied).toBe(1);
    expect(result.summary).toBe("Tick 1 item");
    const before = POLICY.split("\n");
    const after = result.content.split("\n");
    expect(after[sbom.line]).toBe("- [x] Generate an SBOM per release");
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
  });

  it("re-finds an item that moved because someone edited the file meanwhile", () => {
    const doc = parseDocument(POLICY);
    const sbom = doc.items.find((i) => i.title.startsWith("Generate"))!;
    const newer = POLICY.replace("## Vulnerability handling\n", "## Vulnerability handling\n\nA new paragraph.\n");
    const result = applyDocEdits(newer, [
      { type: "toggle", line: sbom.line, title: sbom.title, done: true },
    ]);
    expect(result.applied).toBe(1);
    expect(result.content).toContain("- [x] Generate an SBOM per release");
  });

  it("prefers the stable id over the title", () => {
    const renamed = POLICY.replace("Coordinated disclosure policy", "Disclosure policy (renamed)");
    const result = applyDocEdits(renamed, [
      { type: "toggle", line: 0, title: "Coordinated disclosure policy", id: "task_disclose", done: true },
    ]);
    expect(result.content).toContain("- [x] Disclosure policy (renamed) <!-- rb:task_disclose -->");
  });

  it("reports edits that no longer match anything", () => {
    const result = applyDocEdits(POLICY, [
      { type: "toggle", line: 3, title: "Gone", done: true },
    ]);
    expect(result.applied).toBe(0);
    expect(result.missed).toEqual(["Gone"]);
  });

  it("adds an item at the end of a section, after nested children", () => {
    const result = applyDocEdits(POLICY, [
      { type: "add", section: "Vulnerability handling", title: "Security.txt" },
    ]);
    const lines = result.content.split("\n");
    const nestedAt = lines.findIndex((l) => l.includes("Nested: pick"));
    expect(lines[nestedAt + 1]).toBe("- [ ] Security.txt");
    expect(parseDocument(result.content).sections.find((s) => s.heading === "Vulnerability handling")?.total).toBe(4);
  });

  it("adds under an empty heading and at the end of the file", () => {
    const text = "# Plan\n\n## Later\n\nNothing yet.\n";
    const underHeading = applyDocEdits(text, [{ type: "add", section: "Later", title: "First" }]);
    expect(parseDocument(underHeading.content).sections.find((s) => s.heading === "Later")?.total).toBe(1);

    const atEnd = applyDocEdits(text, [{ type: "add", section: null, title: "Loose end" }]);
    expect(atEnd.content.endsWith("- [ ] Loose end\n")).toBe(true);
  });
});

describe("RepoBoard markdown format", () => {
  const FORMAT = `# Release

- [/] Ship privacy mode !high @neko due:2026-10-01 #privacy RB-12
- [-] Old idea we dropped
- [x] Done thing #release/1.2
- [ ] Fix #42 crash, mail me@example.com, see [[docs/PRIVACY.md]]
`;

  it("reads states and inline metadata without eating issue refs or e-mails", () => {
    const doc = parseDocument(FORMAT);
    expect(doc.total).toBe(3); // cancelled does not count
    expect(doc.cancelled).toBe(1);
    expect(doc.doing).toBe(1);
    const ship = doc.items[0];
    expect(ship).toMatchObject({
      state: "doing",
      title: "Ship privacy mode RB-12",
      priority: 2,
      due: "2026-10-01",
      owners: ["neko"],
      tags: ["privacy"],
      cards: [12],
    });
    expect(doc.items[2].tags).toEqual(["release/1.2"]);
    const fix = doc.items[3];
    expect(fix.tags).toEqual([]);
    expect(fix.owners).toEqual([]);
    expect(fix.links).toEqual(["docs/PRIVACY.md"]);
    expect(fix.title).toContain("#42");
  });

  it("sets any state and keeps the metadata on the line", () => {
    const doc = parseDocument(FORMAT);
    const ship = doc.items[0];
    const result = applyDocEdits(FORMAT, [
      { type: "state", line: ship.line, title: ship.text, state: "done" },
      { type: "state", line: doc.items[3].line, title: doc.items[3].text, state: "cancelled" },
    ]);
    expect(result.summary).toBe("Tick 1 item, cancel 1 item");
    expect(result.content).toContain("- [x] Ship privacy mode !high @neko due:2026-10-01 #privacy RB-12");
    expect(result.content).toContain("- [-] Fix #42 crash");
  });
});
