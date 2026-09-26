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

/** Board colours by name, so a board keeps its colour in both themes. */
export const BOARD_COLORS: { key: string; value: string; hue: number; sat: number }[] = [
  { key: "blue", value: "hsl(221 70% 58%)", hue: 221, sat: 70 },
  { key: "violet", value: "hsl(262 56% 62%)", hue: 262, sat: 56 },
  { key: "pink", value: "hsl(330 58% 60%)", hue: 330, sat: 58 },
  { key: "orange", value: "hsl(24 78% 56%)", hue: 24, sat: 78 },
  { key: "amber", value: "hsl(40 84% 50%)", hue: 40, sat: 84 },
  { key: "green", value: "hsl(150 46% 42%)", hue: 150, sat: 46 },
  { key: "teal", value: "hsl(184 58% 40%)", hue: 184, sat: 58 },
  { key: "slate", value: "hsl(215 14% 50%)", hue: 215, sat: 14 },
];

function hashOf(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

function boardEntry(key: string | null | undefined, fallbackName: string) {
  return BOARD_COLORS.find((c) => c.key === key) ?? BOARD_COLORS[hashOf(fallbackName) % BOARD_COLORS.length];
}

export function boardColor(key: string | null | undefined, fallbackName = ""): string {
  return boardEntry(key, fallbackName).value;
}

/** Hue and saturation of a board's colour; the theme decides the lightness. */
export function boardTone(key: string | null | undefined, fallbackName = ""): { hue: number; sat: number } {
  const { hue, sat } = boardEntry(key, fallbackName);
  return { hue, sat };
}

/** A stable number from a board's id, to vary its picture. */
export function boardSeed(id: string): number {
  return hashOf(id);
}

/** Where a board lives: the primary board is /board, the others /board/<id>. */
export function boardHref(board: { id: string; primary: boolean }): string {
  return board.primary ? "/board" : `/board/${encodeURIComponent(board.id)}`;
}
