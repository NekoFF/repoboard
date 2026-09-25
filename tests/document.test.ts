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

describe("item details and review notes", () => {
  const DOC = `# Release

## Legal

- [?] Impressum reachable from every screen !high #legal
  - Why: German law requires provider identification that is easy to find.
  - Verify: open Settings → About → Legal notice in two taps.
  - A plain remark without a key
  - [ ] Sub-item: add e-mail address
  > codex 2026-09-25: a contact form counts as the second channel.
- [ ] Privacy policy linked in the store listing
`;

  it("reads details, notes, sub-items and the needs-check state", () => {
    const doc = parseDocument(DOC);
    const impressum = doc.items[0];
    expect(impressum.state).toBe("review");
    expect(doc.review).toBe(1);
    expect(impressum.details).toEqual([
      { key: "why", text: "German law requires provider identification that is easy to find." },
      { key: "verify", text: "open Settings → About → Legal notice in two taps." },
      { key: null, text: "A plain remark without a key" },
    ]);
    expect(impressum.notes).toEqual([
      { author: "codex", date: "2026-09-25", text: "a contact form counts as the second channel." },
    ]);
    const sub = doc.items[1];
    expect(sub.title).toBe("Sub-item: add e-mail address");
    expect(sub.parent).toBe(impressum.line);
    expect(doc.items[2].parent).toBeNull();
  });

  it("adds a review note under an item without merging it into an earlier note", () => {
    const doc = parseDocument(DOC);
    const impressum = doc.items[0];
    const result = applyDocEdits(DOC, [
      { type: "note", line: impressum.line, title: impressum.text, author: "claude", text: "Checked §5 DDG: VAT id only if you have one.", date: "2026-09-26" },
    ]);
    const after = parseDocument(result.content);
    expect(after.items[0].notes.map((n) => n.author)).toEqual(["codex", "claude"]);
    expect(result.summary).toBe("Add 1 note");

    const plain = parseDocument(result.content).items.find((i) => i.title.startsWith("Privacy"))!;
    const second = applyDocEdits(result.content, [
      { type: "note", line: plain.line, title: plain.text, author: "gpt", text: "Also needed for Google Play.", date: "2026-09-26" },
    ]);
    const last = parseDocument(second.content).items.find((i) => i.title.startsWith("Privacy"))!;
    expect(last.notes).toEqual([{ author: "gpt", date: "2026-09-26", text: "Also needed for Google Play." }]);
  });
});

describe("links between documents", () => {
  it("collects [[links]] from prose and items, resolving workspace folders", async () => {
    const { wikiLinks } = await import("@/lib/markdown/document");
    const text = "See [[notes/commands]] and [[docs/PLAN.md|the plan]].\n- [ ] Check [[checklists/licenses]]\n```\n[[not/a-link]]\n```\n";
    expect(wikiLinks(text)).toEqual([
      ".repoboard/notes/commands.md",
      "docs/PLAN.md",
      ".repoboard/checklists/licenses.md",
    ]);
  });
});
