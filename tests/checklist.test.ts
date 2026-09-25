import { describe, expect, it } from "vitest";
import { addItem, findByText, locate, normalise, progress, removeItem, setDone } from "@/lib/checklist";

const tree = normalise([
  {
    id: "home",
    text: "Home screen",
    done: false,
    children: [
      { id: "bm", text: "Bookmarks", done: false },
      { id: "hist", text: "History", done: false, children: [{ id: "clear", text: "Clear history", done: false }] },
    ],
  },
  { id: "web", text: "WebView", done: true },
]);

describe("checklist tree", () => {
  it("numbers items by their place in the tree", () => {
    expect(locate(tree, "clear")?.number).toBe("1.2.1");
    expect(locate(tree, "clear")?.path.map((p) => p.text)).toEqual(["Home screen", "History"]);
    expect(locate(tree, "web")?.number).toBe("2");
  });

  it("counts every level", () => {
    expect(progress(tree)).toEqual({ done: 1, total: 5 });
  });

  it("ticks children with their parent and reopens ancestors with a child", () => {
    const done = setDone(tree, "home", true);
    expect(progress(done)).toEqual({ done: 5, total: 5 });
    const reopened = setDone(done, "clear", false);
    expect(locate(reopened, "clear")?.item.done).toBe(false);
    expect(locate(reopened, "hist")?.item.done).toBe(false);
    expect(locate(reopened, "home")?.item.done).toBe(false);
    expect(locate(reopened, "bm")?.item.done).toBe(true);
  });

  it("adds under a parent and removes anywhere", () => {
    const added = addItem(tree, "bm", { id: "sync", text: "Sync bookmarks", done: false });
    expect(locate(added, "sync")?.number).toBe("1.1.1");
    expect(locate(removeItem(added, "hist"), "clear")).toBeNull();
  });

  it("reads old flat checklists and finds items by text", () => {
    const flat = normalise([{ id: "a", text: "One", done: true }]);
    expect(flat[0]).toMatchObject({ text: "One", done: true, children: [], comments: [] });
    expect(findByText(tree, "clear HISTORY")?.id).toBe("clear");
  });
});
