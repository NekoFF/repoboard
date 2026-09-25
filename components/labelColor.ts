/**
 * Labels get a stable colour derived from their name, so the same label looks
 * the same on every card without anyone having to pick colours. Only the dot
 * is coloured; the text stays neutral so a board full of labels stays calm.
 * The values are CSS colours that read on both themes.
 */
const PALETTE = [
  "hsl(236 58% 60%)",
  "hsl(152 48% 42%)",
  "hsl(36 80% 50%)",
  "hsl(2 62% 56%)",
  "hsl(190 60% 42%)",
  "hsl(268 52% 62%)",
  "hsl(24 70% 52%)",
  "hsl(212 70% 54%)",
  "hsl(330 55% 58%)",
];

export function labelColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/** GitHub labels like "type:bug" or "good-first-issue" read better without the prefix and dashes. */
export function displayLabel(label: string): string {
  return label.replace(/^[^:]+:/, "").replace(/[-_]/g, " ");
}
