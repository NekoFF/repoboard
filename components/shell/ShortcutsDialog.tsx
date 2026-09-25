"use client";

import { Modal } from "@/components/ui";
import { modKey } from "@/lib/client/hotkeys";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      [`${modKey()} K`, "Search and run commands"],
      ["G O", "Go to overview"],
      ["G B", "Go to board"],
      ["G D", "Go to documents"],
      ["G C", "Go to code"],
      ["G A", "Go to activity"],
      ["?", "Show this list"],
    ],
  },
  {
    title: "Board",
    keys: [
      ["C", "New card"],
      ["/", "Filter cards"],
      ["↑ ↓ ← →", "Move the selection"],
      ["Enter", "Open the selected card"],
      ["X", "Mark the selected card done"],
      ["1 – 4", "Send the selected card to that column"],
      ["S", "Sync with the markdown file"],
    ],
  },
  {
    title: "Documents",
    keys: [
      ["E", "Edit the document"],
      [`${modKey()} Enter`, "Review changes"],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-1">
            <h3 className="pb-1 text-xs font-medium text-faint">{group.title}</h3>
            {group.keys.map(([keys, what]) => (
              <div key={what} className="flex h-7 items-center gap-3">
                <span className="min-w-0 flex-1 text-sm text-ink">{what}</span>
                <span className="flex shrink-0 gap-1">
                  {keys.split(" ").map((k, i) => (
                    <kbd key={i} className="rb-kbd">
                      {k}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
