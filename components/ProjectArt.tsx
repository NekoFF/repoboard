"use client";

import { useEffect, useRef } from "react";

/**
 * A project's cover: a small scene in square pixels — sky, sea, city,
 * aurora… — in the project's colour. The banner on Overview moves slowly;
 * the small marks (project menu, Settings) hold still. A family of its own,
 * apart from the boards' smooth pictures (BoardArt), so a project and its
 * boards never look alike.
 *
 * Every scene draws on a grid of `cols × rows` cells at time `t` (seconds),
 * from a palette made of one hue; the same seed always gives the same scene.
 */

export const PROJECT_ART: { key: string; name: string }[] = [
  { key: "clouds", name: "Clouds" },
  { key: "night", name: "Night" },
  { key: "sunset", name: "Sunset" },
  { key: "peaks", name: "Peaks" },
  { key: "sea", name: "Sea" },
  { key: "rain", name: "Rain" },
  { key: "snow", name: "Snow" },
  { key: "city", name: "City" },
  { key: "forest", name: "Forest" },
  { key: "dunes", name: "Dunes" },
  { key: "aurora", name: "Aurora" },
  { key: "grid", name: "Horizon" },
  { key: "life", name: "Life" },
  { key: "blocks", name: "Blocks" },
  { key: "bubbles", name: "Bubbles" },
  { key: "fireworks", name: "Fireworks" },
];

/** Hues a project can take; `null` picks one from the name. */
export const PROJECT_HUES = [212, 256, 290, 330, 8, 28, 45, 95, 150, 175, 196, 225];

export function hashOf(text: string): number {
  let h = 2166136261;
  for (const ch of text.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

/** The project's look: what was chosen, or a stable pick from its name. */
export function projectLook(repo: string | null, look?: { art?: string | null; hue?: number | null } | null) {
  const seed = hashOf(repo ?? "?");
  const art = look?.art && PROJECT_ART.some((a) => a.key === look.art) ? look.art : PROJECT_ART[seed % PROJECT_ART.length].key;
  const hue = typeof look?.hue === "number" ? look.hue : PROJECT_HUES[(seed >>> 5) % PROJECT_HUES.length];
  return { art, hue, seed };
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scene {
  cols: number;
  rows: number;
  t: number;
  h: number;
  dark: boolean;
  /** Fills one cell. */
  px: (x: number, y: number, color: string) => void;
  /** Fills a run of cells. */
  rect: (x: number, y: number, w: number, h: number, color: string) => void;
  /** A value fixed for the scene, from its seed. */
  r: (i: number) => number;
  /** Kept between frames, for scenes that evolve. */
  memo: Record<string, unknown>;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%${a < 1 ? ` / ${a}` : ""})`;

/** A top-to-bottom sky in bands, the way pixel art does gradients. */
function bands(s: Scene, top: [number, number], bottom: [number, number], steps = 6) {
  for (let i = 0; i < steps; i += 1) {
    const f = i / (steps - 1);
    const y0 = Math.floor((i / steps) * s.rows);
    const y1 = Math.floor(((i + 1) / steps) * s.rows);
    s.rect(0, y0, s.cols, y1 - y0, hsl(s.h, top[0] + (bottom[0] - top[0]) * f, top[1] + (bottom[1] - top[1]) * f));
  }
}

function cloud(s: Scene, cx: number, base: number, size: number, color: string, shade: string) {
  const lumps = [
    { x: 0, rx: size, ry: size * 0.8 },
    { x: -size * 0.9, rx: size * 0.65, ry: size * 0.5 },
    { x: size * 0.95, rx: size * 0.7, ry: size * 0.45 },
  ];
  for (let x = Math.floor(cx - size * 1.7); x <= Math.ceil(cx + size * 1.7); x += 1) {
    for (let y = 0; y <= Math.ceil(size); y += 1) {
      if (lumps.some((l) => ((x + 0.5 - cx - l.x) / l.rx) ** 2 + ((y + 0.5) / l.ry) ** 2 <= 1)) {
        s.px(x, base - y, y === 0 ? shade : color);
      }
    }
  }
}

const SCENES: Record<string, (s: Scene) => void> = {
  clouds(s) {
    bands(s, s.dark ? [55, 22] : [80, 56], s.dark ? [45, 34] : [85, 78]);
    const n = Math.max(2, Math.round(s.cols / 16));
    for (let i = 0; i < n; i += 1) {
      const size = 2 + s.r(i) * Math.max(2, s.rows / 5);
      const speed = 0.6 + s.r(i + 9) * 0.8;
      const span = s.cols + size * 4;
      const x = ((s.r(i + 3) * span - s.t * speed) % span + span) % span - size * 2;
      cloud(s, x, Math.round(s.rows * (0.35 + s.r(i + 5) * 0.45)), size, hsl(s.h, 30, s.dark ? 80 : 98), hsl(s.h, 30, s.dark ? 66 : 88));
    }
  },
  night(s) {
    bands(s, [60, s.dark ? 8 : 14], [55, s.dark ? 20 : 30]);
    const stars = Math.round((s.cols * s.rows) / 18);
    for (let i = 0; i < stars; i += 1) {
      const on = Math.sin(s.t * (0.8 + s.r(i + 40) * 1.6) + s.r(i + 80) * 9) > -0.2;
      if (on) s.px(Math.floor(s.r(i) * s.cols), Math.floor(s.r(i + 200) * s.rows * 0.85), hsl(s.h + 30, 60, s.r(i + 7) > 0.8 ? 96 : 78));
    }
    const m = Math.max(2, Math.round(s.rows / 5));
    const mx = Math.round(s.cols * 0.78);
    const my = Math.round(s.rows * 0.3);
    for (let x = -m; x <= m; x += 1) for (let y = -m; y <= m; y += 1) {
      if (x * x + y * y <= m * m && (x - m * 0.45) ** 2 + (y + m * 0.2) ** 2 > m * m * 0.7) s.px(mx + x, my + y, hsl(50, 80, 90));
    }
  },
  sunset(s) {
    const horizon = Math.round(s.rows * 0.62);
    for (let y = 0; y < horizon; y += 1) {
      const f = y / horizon;
      s.rect(0, y, s.cols, 1, hsl(s.h + 20 + f * 25, 70, s.dark ? 30 + f * 24 : 58 + f * 22));
    }
    const r = Math.max(2, Math.round(s.rows / 4));
    const sy = horizon - Math.round(r * 0.3 + Math.sin(s.t * 0.25) * 1.2);
    const sx = Math.round(s.cols / 2);
    for (let x = -r; x <= r; x += 1) for (let y = -r; y <= 0; y += 1) if (x * x + y * y <= r * r) s.px(sx + x, sy + y, hsl(45, 95, 70));
    for (let y = horizon; y < s.rows; y += 1) {
      const f = (y - horizon) / (s.rows - horizon);
      s.rect(0, y, s.cols, 1, hsl(s.h + 15, 45, s.dark ? 20 - f * 6 : 36 - f * 10));
      const w = Math.max(1, Math.round(r * (1.2 - f) + Math.sin(s.t * 1.5 + y) * 1.5));
      if ((y + Math.floor(s.t * 2)) % 2 === 0) s.rect(sx - w, y, w * 2, 1, hsl(45, 90, 70, 0.7));
    }
  },
  peaks(s) {
    bands(s, [55, s.dark ? 20 : 78], [45, s.dark ? 34 : 90], 5);
    const layers = [
      { l: s.dark ? 30 : 62, amp: 0.45, speed: 0.15, off: 0 },
      { l: s.dark ? 22 : 48, amp: 0.35, speed: 0.35, off: 3 },
      { l: s.dark ? 14 : 34, amp: 0.22, speed: 0.7, off: 7 },
    ];
    layers.forEach((layer, i) => {
      for (let x = 0; x < s.cols; x += 1) {
        const u = (x + s.t * layer.speed + layer.off * 11) / Math.max(6, s.cols / 5);
        const ridge = Math.abs(((u % 2) + 2) % 2 - 1);
        const bump = 0.5 + 0.5 * Math.sin(u * 2.3 + i);
        const top = Math.round(s.rows * (1 - layer.amp * (0.5 + ridge * 0.6 + bump * 0.2)) - i);
        s.rect(x, top, 1, s.rows - top, hsl(s.h + 10, 28, layer.l));
        if (i === 0 && ridge > 0.72) s.px(x, top, hsl(s.h, 20, 96));
      }
    });
  },
  sea(s) {
    bands(s, [60, s.dark ? 24 : 82], [50, s.dark ? 34 : 90], 4);
    const top = Math.round(s.rows * 0.42);
    for (let y = top; y < s.rows; y += 1) {
      const f = (y - top) / (s.rows - top);
      s.rect(0, y, s.cols, 1, hsl(s.h, 60, s.dark ? 30 - f * 12 : 58 - f * 18));
      const shift = s.t * (1 + f * 2) + y * 3;
      for (let x = 0; x < s.cols; x += 1) {
        if (Math.sin((x + shift) * 0.55 + y * 1.7) > 0.86) s.px(x, y, hsl(s.h - 10, 60, s.dark ? 60 : 88));
      }
    }
  },
  rain(s) {
    bands(s, [38, s.dark ? 18 : 54], [38, s.dark ? 28 : 70], 4);
    const drops = Math.round(s.cols * 0.9);
    for (let i = 0; i < drops; i += 1) {
      const x = Math.floor(s.r(i) * s.cols);
      const len = 1 + Math.floor(s.r(i + 50) * 2);
      const y = Math.floor((s.r(i + 100) * s.rows + s.t * (10 + s.r(i + 7) * 8)) % (s.rows + len)) - len;
      s.rect(x, y, 1, len, hsl(s.h, 60, s.dark ? 70 : 92, 0.85));
    }
    s.rect(0, s.rows - 1, s.cols, 1, hsl(s.h, 30, s.dark ? 30 : 55));
  },
  snow(s) {
    bands(s, [30, s.dark ? 16 : 70], [30, s.dark ? 26 : 86], 4);
    const flakes = Math.round(s.cols * 0.8);
    for (let i = 0; i < flakes; i += 1) {
      const y = Math.floor((s.r(i + 100) * s.rows + s.t * (1.5 + s.r(i + 7) * 2)) % s.rows);
      const x = Math.floor((s.r(i) * s.cols + Math.sin(s.t * 0.8 + i) * 1.4 + s.cols) % s.cols);
      s.px(x, y, hsl(s.h, 20, 98));
    }
    for (let x = 0; x < s.cols; x += 1) {
      const h = 1 + Math.round((Math.sin(x * 0.4) + 1) * 0.8);
      s.rect(x, s.rows - h, 1, h, hsl(s.h, 20, s.dark ? 84 : 97));
    }
  },
  city(s) {
    bands(s, [50, s.dark ? 12 : 42], [60, s.dark ? 26 : 70], 5);
    let x = 0;
    let i = 0;
    while (x < s.cols) {
      const w = 3 + Math.floor(s.r(i) * 5);
      const h = Math.round(s.rows * (0.3 + s.r(i + 30) * 0.5));
      s.rect(x, s.rows - h, w, h, hsl(s.h + 10, 28, s.dark ? 9 + (i % 3) * 3 : 18 + (i % 3) * 5));
      for (let wx = x + 1; wx < x + w - 1; wx += 2) {
        for (let wy = s.rows - h + 2; wy < s.rows - 1; wy += 2) {
          const k = wx * 31 + wy * 17;
          if (Math.sin(k + Math.floor(s.t / 3 + s.r(k % 97) * 5) * 1.7) > 0.35) s.px(wx, wy, hsl(45, 90, 72));
        }
      }
      x += w + (s.r(i + 60) > 0.7 ? 1 : 0);
      i += 1;
    }
  },
  forest(s) {
    bands(s, [40, s.dark ? 14 : 70], [40, s.dark ? 24 : 84], 4);
    for (let row = 0; row < 3; row += 1) {
      const base = s.rows - 1 - row * 2;
      const step = 4 + row;
      for (let tx = -2 + (row * 3) % step; tx < s.cols + 2; tx += step) {
        const h = Math.round(s.rows * (0.35 + 0.25 * s.r(tx * 7 + row)) - row * 2);
        for (let y = 0; y < h; y += 1) {
          const half = Math.floor(((h - y) / h) * (step * 0.55));
          s.rect(tx - half, base - y, half * 2 + 1, 1, hsl(140 + (s.h - 140) * 0.2, 38, (s.dark ? 12 : 24) + row * 7));
        }
      }
    }
    for (let i = 0; i < Math.round(s.cols / 8); i += 1) {
      const on = Math.sin(s.t * 1.3 + i * 2.1) > 0.3;
      const fx = Math.floor((s.r(i) * s.cols + Math.sin(s.t * 0.4 + i) * 2 + s.cols) % s.cols);
      const fy = Math.floor(s.rows * (0.5 + s.r(i + 9) * 0.4) + Math.cos(s.t * 0.5 + i) * 1.5);
      if (on) s.px(fx, fy, hsl(60, 90, 75));
    }
  },
  dunes(s) {
    bands(s, [60, s.dark ? 22 : 74], [70, s.dark ? 34 : 88], 4);
    const layers = [0.55, 0.7, 0.85];
    layers.forEach((level, i) => {
      for (let x = 0; x < s.cols; x += 1) {
        const top = Math.round(s.rows * level + Math.sin((x + s.t * (0.3 + i * 0.3)) / (4 + i * 2) + i * 2) * (2 + i));
        s.rect(x, top, 1, s.rows - top, hsl(s.h + 10, 55, (s.dark ? 30 : 70) - i * 9));
      }
    });
  },
  aurora(s) {
    s.rect(0, 0, s.cols, s.rows, hsl(s.h + 20, 50, s.dark ? 7 : 13));
    for (let band = 0; band < 3; band += 1) {
      for (let x = 0; x < s.cols; x += 1) {
        const top = Math.round(s.rows * (0.2 + band * 0.12) + Math.sin(x / (5 + band * 2) + s.t * (0.5 + band * 0.2) + band) * (2 + band));
        const len = Math.round(s.rows * 0.35 + Math.sin(x / 3 + s.t) * 2);
        for (let y = 0; y < len; y += 1) {
          const fade = 1 - y / len;
          if ((x + y + band) % 2 === 0 || fade > 0.6) s.px(x, top + y, hsl(s.h + band * 40, 80, 55 + band * 5, 0.25 + fade * 0.55));
        }
      }
    }
    for (let i = 0; i < s.cols / 3; i += 1) s.px(Math.floor(s.r(i) * s.cols), Math.floor(s.r(i + 90) * s.rows * 0.3), hsl(0, 0, 90, 0.8));
  },
  grid(s) {
    const horizon = Math.round(s.rows * 0.48);
    for (let y = 0; y < horizon; y += 1) s.rect(0, y, s.cols, 1, hsl(s.h + 40 - (y / horizon) * 30, 70, (s.dark ? 12 : 22) + (y / horizon) * 30));
    const r = Math.max(2, Math.round(s.rows / 4));
    for (let x = -r; x <= r; x += 1) for (let y = -r; y <= 0; y += 1) {
      if (x * x + y * y <= r * r && (horizon + y) % 3 !== 0) s.px(Math.round(s.cols / 2) + x, horizon - 1 + y, hsl(40, 95, 65));
    }
    s.rect(0, horizon, s.cols, s.rows - horizon, hsl(s.h + 60, 50, s.dark ? 8 : 14));
    const phase = (s.t * 0.6) % 1;
    for (let k = 0; k < 8; k += 1) {
      const d = (k + phase) / 8;
      const y = horizon + Math.round((s.rows - horizon) * d * d);
      s.rect(0, y, s.cols, 1, hsl(s.h, 90, 60, 0.8));
    }
    for (let k = -8; k <= 8; k += 1) {
      for (let y = horizon; y < s.rows; y += 1) {
        const f = (y - horizon) / (s.rows - horizon);
        s.px(Math.round(s.cols / 2 + k * (1 + f * s.cols * 0.09)), y, hsl(s.h, 90, 60, 0.8));
      }
    }
  },
  life(s) {
    s.rect(0, 0, s.cols, s.rows, hsl(s.h, 30, s.dark ? 12 : 94));
    // Conway's life, from the seed, a few generations a second; it starts over when it settles.
    const generation = Math.floor(s.t * 2.5) % 120;
    const seedGrid = () => Array.from({ length: s.rows }, (_, y) => Array.from({ length: s.cols }, (_, x) => s.r(x * 131 + y * 17) > 0.62));
    const memo = s.memo as { gen?: number; grid?: boolean[][]; size?: string };
    const size = `${s.cols}x${s.rows}`;
    if (memo.size !== size || memo.gen === undefined || generation < memo.gen) {
      memo.grid = seedGrid();
      memo.gen = 0;
      memo.size = size;
    }
    let grid = memo.grid!;
    for (let g = memo.gen!; g < generation; g += 1) {
      grid = grid.map((row, y) =>
        row.map((alive, x) => {
          let n = 0;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            if ((dx || dy) && grid[(y + dy + s.rows) % s.rows][(x + dx + s.cols) % s.cols]) n += 1;
          }
          return n === 3 || (alive && n === 2);
        }),
      );
    }
    memo.grid = grid;
    memo.gen = generation;
    grid.forEach((row, y) => row.forEach((alive, x) => alive && s.px(x, y, hsl(s.h + ((x + y) % 5) * 6, 65, s.dark ? 60 : 50))));
  },
  blocks(s) {
    s.rect(0, 0, s.cols, s.rows, hsl(s.h, 35, s.dark ? 12 : 92));
    const w = 3;
    const colsOf = Math.floor(s.cols / w);
    for (let c = 0; c < colsOf; c += 1) {
      const height = Math.floor(s.r(c) * (s.rows / 2));
      for (let y = 0; y < height; y += 1) s.rect(c * w, s.rows - 1 - y, w - 1, 1, hsl(s.h + (Math.floor(y / 2) % 4) * 30, 60, s.dark ? 45 : 62));
      const fall = (s.t * (2 + s.r(c + 40) * 2) + s.r(c + 20) * s.rows * 3) % (s.rows * 3);
      if (fall < s.rows - height - 2) s.rect(c * w, Math.floor(fall), w - 1, 2, hsl(s.h + (c % 4) * 30, 70, s.dark ? 60 : 55));
    }
  },
  bubbles(s) {
    bands(s, [65, s.dark ? 24 : 60], [70, s.dark ? 12 : 34], 5);
    const n = Math.round(s.cols * 0.5);
    for (let i = 0; i < n; i += 1) {
      const size = s.r(i + 30) > 0.8 ? 2 : 1;
      const y = s.rows - 1 - Math.floor((s.r(i + 100) * s.rows + s.t * (2 + s.r(i + 7) * 3)) % (s.rows + 2));
      const x = Math.floor(s.r(i) * s.cols + Math.sin(s.t + i) * 1.2);
      s.rect(x, y, size, size, hsl(s.h - 20, 60, 88, 0.85));
    }
  },
  fireworks(s) {
    s.rect(0, 0, s.cols, s.rows, hsl(s.h + 20, 50, s.dark ? 7 : 13));
    for (let i = 0; i < 3; i += 1) {
      const period = 3 + i;
      const phase = ((s.t + i * 1.3) % period) / period;
      const cx = Math.floor(s.cols * (0.2 + ((i * 0.33 + Math.floor((s.t + i * 1.3) / period) * 0.17) % 0.6)));
      const cy = Math.floor(s.rows * (0.3 + (i % 2) * 0.15));
      if (phase < 0.25) {
        s.px(cx, Math.floor(s.rows - (s.rows - cy) * (phase / 0.25)), hsl(45, 90, 80));
        continue;
      }
      const burst = (phase - 0.25) / 0.75;
      const rad = burst * Math.max(3, s.rows / 3);
      for (let a = 0; a < 12; a += 1) {
        const ang = (a / 12) * Math.PI * 2;
        s.px(Math.round(cx + Math.cos(ang) * rad), Math.round(cy + Math.sin(ang) * rad + burst * burst * 2), hsl(s.h + i * 70, 90, 65, 1 - burst * 0.8));
      }
    }
  },
};

/**
 * `cells` is how many cells run across; the banner uses its width, a mark a
 * handful, so small ones still read as pixels.
 */
export function ProjectArt({
  repo,
  look,
  still,
  cellSize = 7,
  className = "",
}: {
  repo: string | null;
  look?: { art?: string | null; hue?: number | null } | null;
  still?: boolean;
  /** Pixels per cell (on screen). */
  cellSize?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { art, hue, seed } = projectLook(repo, look);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = SCENES[art] ?? SCENES.clouds;
    const fixed = mulberry(seed);
    const values = Array.from({ length: 512 }, () => fixed());
    const memo: Record<string, unknown> = {};
    let cols = 0;
    let rows = 0;
    let cw = 1;
    let ch = 1;

    const layout = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.max(1, Math.round(rect.width * dpr));
      el.height = Math.max(1, Math.round(rect.height * dpr));
      cols = Math.max(6, Math.round(rect.width / cellSize));
      rows = Math.max(4, Math.round(rect.height / cellSize));
      cw = el.width / cols;
      ch = el.height / rows;
    };

    const paint = (t: number) => {
      const dark = document.documentElement.classList.contains("dark");
      const scene: Scene = {
        cols,
        rows,
        t,
        h: hue,
        dark,
        px: (x, y, color) => {
          if (x < 0 || y < 0 || x >= cols || y >= rows) return;
          ctx.fillStyle = color;
          ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
        },
        rect: (x, y, w, h, color) => {
          ctx.fillStyle = color;
          ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(w * cw), Math.ceil(h * ch));
        },
        r: (i) => values[((Math.floor(i) % 512) + 512) % 512],
        memo,
      };
      ctx.clearRect(0, 0, el.width, el.height);
      draw(scene);
    };

    layout();
    // A still picture is a moment a few seconds in, so every scene has something in it.
    paint(4.2);
    if (still || reduce) {
      const resize = new ResizeObserver(() => {
        layout();
        paint(4.2);
      });
      resize.observe(el);
      return () => resize.disconnect();
    }

    let frame = 0;
    let last = 0;
    let visible = true;
    const start = performance.now() - 4200;
    const tick = (now: number) => {
      // Pixel scenes step rather than glide: 12 frames a second is plenty.
      if (visible && now - last > 80) {
        last = now;
        paint((now - start) / 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const seen = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    seen.observe(el);
    const resize = new ResizeObserver(layout);
    resize.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      resize.disconnect();
    };
  }, [art, hue, seed, still, cellSize]);

  return <canvas ref={canvas} className={`block h-full w-full ${className}`} aria-hidden />;
}
