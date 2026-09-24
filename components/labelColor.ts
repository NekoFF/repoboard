/**
 * Labels get a stable colour derived from their name, so the same label looks
 * the same on every card without anyone having to pick colours.
 */
const PALETTE = [
  "#4f46e5", // indigo
  "#2e7847", // green
  "#b8731a", // amber
  "#ad332e", // red
  "#0e7490", // teal
  "#7c3aed", // violet
  "#b45309", // bronze
  "#1d4ed8", // blue
];

export function labelColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
