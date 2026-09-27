"use client";

import { useEffect, useRef } from "react";

/**
 * A sky of square pixels: clouds built from even blocks drift across a blue
 * field, and part around the pointer as if it were a breath of wind. The
 * picture on the welcome screen's banner. Holds still under reduced motion.
 */

const CELL = 8;

interface Cloud {
  /** Cells relative to the cloud's corner, in grid units. */
  cells: [number, number, number][]; // x, y, shade 0..1
  x: number;
  y: number;
  speed: number;
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

/**
 * A cloud: a big rounded lump in the middle, smaller ones either side, all
 * sitting on one flat underside — the way a cloud is drawn in pixels.
 */
function makeCloud(rand: () => number, width: number): Cloud {
  const big = { cx: 0, rx: 4 + rand() * 2.5, ry: 5 + rand() * 2 };
  const lumps = [
    big,
    { cx: -(big.rx * 0.9 + rand() * 1.5), rx: 3 + rand() * 1.5, ry: 3.2 + rand() * 1.2 },
    { cx: big.rx * 0.95 + rand() * 2, rx: 3.2 + rand() * 2, ry: 2.8 + rand() * 1.6 },
  ];
  if (rand() > 0.5) lumps.push({ cx: -big.rx * 0.35, rx: 2.6 + rand() * 1.2, ry: big.ry + 0.8 + rand() });
  const cells: [number, number, number][] = [];
  const left = Math.floor(Math.min(...lumps.map((l) => l.cx - l.rx)));
  const right = Math.ceil(Math.max(...lumps.map((l) => l.cx + l.rx)));
  const top = Math.ceil(Math.max(...lumps.map((l) => l.ry)));
  for (let x = left; x <= right; x += 1) {
    for (let y = 0; y <= top; y += 1) {
      const inside = lumps.some((l) => ((x + 0.5 - l.cx) / l.rx) ** 2 + ((y + 0.5) / l.ry) ** 2 <= 1);
      if (!inside) continue;
      // Lit from above: the top rows are brightest, the underside a little grey.
      const shade = y === 0 ? 0.78 : y === 1 ? 0.9 : 0.97 + rand() * 0.03;
      cells.push([x - left, -y, shade]);
    }
  }
  return { cells, x: rand() * width, y: 0, speed: 0.1 + rand() * 0.2 };
}

export function PixelSky({ className = "", seed = 7 }: { className?: string; seed?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rand = mulberry(seed);
    let width = 0;
    let height = 0;
    let clouds: Cloud[] = [];
    const pointer = { x: -1e4, y: -1e4 };
    // How far each drawn cell is pushed by the pointer, eased so it glides back.
    const push = new Map<string, { dx: number; dy: number }>();

    const layout = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rows = Math.floor(height / CELL);
      const count = Math.max(3, Math.round(width / 150));
      clouds = Array.from({ length: count }, (_, i) => {
        const c = makeCloud(rand, width);
        c.y = Math.round(rows * (0.42 + ((i * 0.29) % 0.5)));
        c.x = (i / count) * width + rand() * 60;
        return c;
      });
    };

    const dark = () => document.documentElement.classList.contains("dark");

    const draw = () => {
      const night = dark();
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, night ? "hsl(222 62% 20%)" : "hsl(212 88% 56%)");
      sky.addColorStop(1, night ? "hsl(228 48% 33%)" : "hsl(205 90% 76%)");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // A faint grid, so the sky itself reads as pixels too.
      ctx.fillStyle = night ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.05)";
      for (let x = 0; x < width; x += CELL * 2) ctx.fillRect(x, 0, 1, height);

      for (const cloud of clouds) {
        for (const [cx, cy, shade] of cloud.cells) {
          const gx = Math.round(cloud.x / CELL) + cx;
          const gy = cloud.y + cy;
          const px = gx * CELL;
          const py = gy * CELL;
          const key = `${gx},${gy}`;
          const d = Math.hypot(px + CELL / 2 - pointer.x, py + CELL / 2 - pointer.y);
          const current = push.get(key) ?? { dx: 0, dy: 0 };
          let tx = 0;
          let ty = 0;
          if (d < 70) {
            const f = (1 - d / 70) * 16;
            tx = ((px - pointer.x) / (d || 1)) * f;
            ty = ((py - pointer.y) / (d || 1)) * f;
          }
          current.dx += (tx - current.dx) * 0.18;
          current.dy += (ty - current.dy) * 0.18;
          push.set(key, current);
          const light = night ? 62 + shade * 26 : 70 + shade * 30;
          ctx.fillStyle = `hsl(212 45% ${Math.min(light, 100)}%)`;
          ctx.globalAlpha = night ? 0.72 : 0.97;
          ctx.fillRect(Math.round(px + current.dx), Math.round(py + current.dy), CELL - 1, CELL - 1);
        }
      }
      ctx.globalAlpha = 1;
    };

    let frame = 0;
    const tick = () => {
      for (const c of clouds) {
        c.x -= c.speed;
        const w = Math.max(...c.cells.map(([x]) => x)) * CELL;
        if (c.x + w < -20) c.x = width + rand() * 80;
      }
      draw();
      frame = requestAnimationFrame(tick);
    };

    layout();
    draw();
    if (!still) frame = requestAnimationFrame(tick);

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    };
    const onLeave = () => {
      pointer.x = -1e4;
      pointer.y = -1e4;
    };
    const resize = new ResizeObserver(() => {
      layout();
      draw();
    });
    resize.observe(el);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [seed]);

  return <canvas ref={canvas} className={`block h-full w-full ${className}`} aria-hidden />;
}
