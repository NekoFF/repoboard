import { describe, expect, it } from "vitest";
import { edit } from "@/lib/doc-edit-schema";
import type { DocEdit } from "@/lib/markdown/document";

// Every kind of edit the app and agents make must get through the API as it is.
const kinds: DocEdit[] = [
  { type: "state", line: 3, title: "One", state: "review" },
  { type: "toggle", line: 3, title: "One", done: true },
  { type: "add", section: "Store", title: "Listing complete", details: ["Verify: no warnings", "Source: Play policy"], cards: [7] },
  { type: "add", section: null, title: "Plain" },
  { type: "note", line: 3, title: "One", author: "Claude", text: "Proof: ran it" },
  { type: "card", line: 3, title: "One", card: 12 },
  { type: "replace", content: "# All new\n" },
];

describe("document edits through the API", () => {
  it.each(kinds.map((k) => [k.type, k] as const))("accepts %s as the app sends it", (_type, value) => {
    const parsed = edit.safeParse(value);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // Nothing the app sent is dropped on the way.
    expect(parsed.data).toEqual(value);
  });
});
