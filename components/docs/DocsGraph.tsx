"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, FileText, Info, Lightbulb, ListChecks, Maximize2, Minus, Plus } from "lucide-react";
import type { TrackedDoc } from "@/lib/docs-service";
import { Tooltip, percent } from "@/components/ui";

type Kind = TrackedDoc["kind"] | "missing";

interface SimNode {
  id: string;
  title: string;
  kind: Kind;
  done: number;
  review: number;
  total: number;
  /** Diameter in world units. */
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Held by the pointer: the simulation keeps it here. */
  fixed: boolean;
}

interface Link {
  source: SimNode;
  target: SimNode;
}

const REST = 190;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.6;

function build(docs: TrackedDoc[]) {
  const nodes = new Map<string, SimNode>();
  const place = (i: number, n: number, spread: number) => {
    // A golden-angle spiral: deterministic, evenly spread, no two on one spot.
    const angle = i * 2.399963;
    const r = spread * Math.sqrt((i + 0.5) / Math.max(n, 1));
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  };
  docs.forEach((d, i) => {
    const size = d.kind === "checklist" ? 46 + Math.min(Math.sqrt(d.total) * 4, 22) : 40;
    nodes.set(d.path, {
      id: d.path,
      title: d.title,
      kind: d.kind,
      done: d.done,
      review: d.review,
      total: d.total,
      size,
      ...place(i, docs.length, 220),
      vx: 0,
      vy: 0,
      fixed: false,
    });
  });
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    for (const target of d.links) {
      if (target === d.path) continue;
      if (!nodes.has(target)) {
        const i = nodes.size;
        nodes.set(target, {
          id: target,
          title: target.split("/").pop()!.replace(/\.md$/i, ""),
          kind: "missing",
          done: 0,
          review: 0,
          total: 0,
          size: 24,
          ...place(i, docs.length + 4, 320),
          vx: 0,
          vy: 0,
          fixed: false,
        });
      }
      const key = [d.path, target].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: nodes.get(d.path)!, target: nodes.get(target)! });
    }
  }
  return { nodes: [...nodes.values()], links };
}

/** One step of a small force simulation: repulsion, springs, a pull to the middle, no overlaps. */
function step(nodes: SimNode[], links: Link[], alpha: number) {
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = (i - j) * 0.5;
        dy = 0.5;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      const push = (26000 * alpha) / d2;
      // Room for the labels under the nodes, not only the nodes themselves.
      const min = (a.size + b.size) / 2 + 70;
      const overlap = d < min ? ((min - d) / d) * 0.5 : 0;
      const fx = (dx / d) * push + dx * overlap;
      const fy = (dy / d) * push + dy * overlap;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
  for (const { source: s, target: t } of links) {
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const rest = t.kind === "missing" || s.kind === "missing" ? REST * 0.75 : REST;
    const k = ((d - rest) / d) * 0.06 * alpha;
    s.vx += dx * k;
    s.vy += dy * k;
    t.vx -= dx * k;
    t.vy -= dy * k;
  }
  for (const n of nodes) {
    n.vx -= n.x * 0.005 * alpha;
    n.vy -= n.y * 0.008 * alpha;
    if (n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= 0.62;
    n.vy *= 0.62;
    n.x += n.vx;
    n.y += n.vy;
  }
}

/** A gentle curve between two nodes, always bending the same way. */
function curve(a: SimNode, b: SimNode): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bend = 0.12;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${(mx - dy * bend).toFixed(1)} ${(my + dx * bend).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

const KIND_ICON: Record<Exclude<Kind, "checklist" | "missing">, { icon: typeof BookMarked; tone: string }> = {
  note: { icon: BookMarked, tone: "text-accent" },
  decision: { icon: Lightbulb, tone: "text-state-review" },
  document: { icon: FileText, tone: "text-state-doing" },
};

function NodeFace({ node }: { node: SimNode }) {
  if (node.kind === "missing") {
    return <span className="rb-graph-ghost" />;
  }
  if (node.kind === "checklist") {
    const r = node.size / 2 + 4;
    const c = 2 * Math.PI * r;
    const done = node.total ? node.done / node.total : 0;
    const review = node.total ? node.review / node.total : 0;
    return (
      <span className="rb-graph-disc">
        <svg className="absolute -inset-[5px] overflow-visible" width={node.size + 10} height={node.size + 10} aria-hidden>
          <g transform={`translate(${node.size / 2 + 5} ${node.size / 2 + 5}) rotate(-90)`}>
            <circle r={r} fill="none" strokeWidth={3} style={{ stroke: "rgb(var(--ink) / 0.08)" }} />
            <circle
              r={r}
              fill="none"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${c * done} ${c}`}
              style={{ stroke: "rgb(var(--state-done))" }}
            />
            {review > 0 && (
              <circle
                r={r}
                fill="none"
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`0 ${c * done} ${c * review} ${c}`}
                style={{ stroke: "rgb(var(--state-review))" }}
              />
            )}
          </g>
        </svg>
        {node.total > 0 ? (
          <span className="text-[11px] font-semibold tabular-nums text-ink">{percent(node.done, node.total)}%</span>
        ) : (
          <ListChecks className="size-4 text-muted" />
        )}
      </span>
    );
  }
  const { icon: Icon, tone } = KIND_ICON[node.kind];
  return (
    <span className="rb-graph-disc rounded-[30%]">
      <Icon className={`size-4 ${tone}`} />
    </span>
  );
}

/**
 * Documents and the [[links]] between them, alive: a force simulation you can
 * pull at, pan and zoom. Nodes are glass over a softly moving light; pointing
 * at one lights its links and dims the rest. Links to files that do not exist
 * yet are dashed ghosts — a gap to fill.
 */
export function DocsGraph({ docs }: { docs: TrackedDoc[] }) {
  const router = useRouter();
  const { nodes, links } = useMemo(() => build(docs), [docs]);
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, HTMLElement>());
  const edgeEls = useRef<(SVGPathElement | null)[]>([]);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const alpha = useRef(1);
  const frame = useRef(0);
  const fitted = useRef(false);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { source, target } of links) {
      map.set(source.id, (map.get(source.id) ?? new Set()).add(target.id));
      map.set(target.id, (map.get(target.id) ?? new Set()).add(source.id));
    }
    return map;
  }, [links]);

  /* ------------------------------------------------ drawing, off React -- */

  const paint = useCallback(() => {
    for (const n of nodes) {
      const el = nodeEls.current.get(n.id);
      if (el) el.style.transform = `translate3d(${n.x}px, ${n.y}px, 0)`;
    }
    links.forEach((l, i) => edgeEls.current[i]?.setAttribute("d", curve(l.source, l.target)));
  }, [nodes, links]);

  const applyView = useCallback(() => {
    const el = box.current;
    const w = world.current;
    if (!el || !w) return;
    const { x, y, k } = view.current;
    const cx = el.clientWidth / 2 + x;
    const cy = el.clientHeight / 2 + y;
    w.style.transform = `translate(${cx}px, ${cy}px) scale(${k})`;
    // The dot grid moves and scales with the world, so panning feels like moving over a surface.
    el.style.backgroundPosition = `${cx}px ${cy}px`;
    el.style.backgroundSize = `${22 * k}px ${22 * k}px`;
  }, []);

  const fit = useCallback(
    (animate = true) => {
      const el = box.current;
      if (!el || nodes.length === 0) return;
      const pad = 90;
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      const minX = Math.min(...xs) - pad;
      const maxX = Math.max(...xs) + pad;
      const minY = Math.min(...ys) - pad;
      const maxY = Math.max(...ys) + pad + 30;
      const k = Math.min(Math.max(Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY)), MIN_ZOOM), 1.4);
      const target = { x: (-(minX + maxX) / 2) * k, y: (-(minY + maxY) / 2) * k, k };
      if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        view.current = target;
        applyView();
        setZoom(k);
        return;
      }
      const from = { ...view.current };
      const start = performance.now();
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      const run = (now: number) => {
        const t = Math.min((now - start) / 420, 1);
        const e = ease(t);
        view.current = {
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          k: from.k + (target.k - from.k) * e,
        };
        applyView();
        if (t < 1) requestAnimationFrame(run);
        else setZoom(target.k);
      };
      requestAnimationFrame(run);
    },
    [nodes, applyView],
  );

  const heat = useCallback(
    (to = 0.6) => {
      alpha.current = Math.max(alpha.current, to);
      if (frame.current) return;
      const loop = () => {
        step(nodes, links, alpha.current);
        paint();
        alpha.current *= 0.975;
        if (!fitted.current && alpha.current < 0.12) {
          fitted.current = true;
          fit();
        }
        if (alpha.current > 0.004) frame.current = requestAnimationFrame(loop);
        else frame.current = 0;
      };
      frame.current = requestAnimationFrame(loop);
    },
    [nodes, links, paint, fit],
  );

  useEffect(() => {
    fitted.current = false;
    applyView();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No bloom: settle first, then show it still.
      for (let i = 0; i < 300; i += 1) step(nodes, links, Math.max(0.02, 1 - i / 300));
      paint();
      fitted.current = true;
      fit(false);
      return;
    }
    alpha.current = 1;
    heat(1);
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [nodes, links, heat, paint, fit, applyView]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => applyView());
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyView]);

  /* -------------------------------------------------------- interaction -- */

  const toWorld = (clientX: number, clientY: number) => {
    const el = box.current!;
    const rect = el.getBoundingClientRect();
    const { x, y, k } = view.current;
    return {
      x: (clientX - rect.left - el.clientWidth / 2 - x) / k,
      y: (clientY - rect.top - el.clientHeight / 2 - y) / k,
    };
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX ?? rect.left + el.clientWidth / 2) - rect.left - el.clientWidth / 2;
    const py = (clientY ?? rect.top + el.clientHeight / 2) - rect.top - el.clientHeight / 2;
    const { x, y, k } = view.current;
    const next = Math.min(Math.max(k * factor, MIN_ZOOM), MAX_ZOOM);
    // Keep the point under the pointer where it is.
    view.current = { k: next, x: px - ((px - x) * next) / k, y: py - ((py - y) * next) / k };
    applyView();
    setZoom(next);
  };

  // Wheel zooms (and pinches on a trackpad); the page must not scroll meanwhile.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
        zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.012 : 0.0018)), event.clientX, event.clientY);
      } else {
        view.current = { ...view.current, x: view.current.x - event.deltaX };
        applyView();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const drag = useRef<
    | null
    | { mode: "node"; node: SimNode; moved: boolean; dx: number; dy: number; id: number }
    | { mode: "pan"; startX: number; startY: number; x: number; y: number; id: number }
  >(null);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-node]");
    if ((event.target as HTMLElement).closest("[data-graph-ui]")) return;
    try {
      box.current?.setPointerCapture(event.pointerId);
    } catch {
      /* not a live pointer (a synthetic event); dragging still works inside the box */
    }
    if (target) {
      const node = nodes.find((n) => n.id === target.dataset.node);
      if (!node) return;
      const at = toWorld(event.clientX, event.clientY);
      node.fixed = true;
      drag.current = { mode: "node", node, moved: false, dx: at.x - node.x, dy: at.y - node.y, id: event.pointerId };
    } else {
      drag.current = { mode: "pan", startX: event.clientX, startY: event.clientY, x: view.current.x, y: view.current.y, id: event.pointerId };
      box.current?.classList.add("cursor-grabbing");
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    if (d.mode === "node") {
      const at = toWorld(event.clientX, event.clientY);
      const x = at.x - d.dx;
      const y = at.y - d.dy;
      if (Math.abs(x - d.node.x) + Math.abs(y - d.node.y) > 1.5) d.moved = true;
      d.node.x = x;
      d.node.y = y;
      heat(0.35);
      paint();
    } else {
      view.current = { ...view.current, x: d.x + event.clientX - d.startX, y: d.y + event.clientY - d.startY };
      applyView();
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    box.current?.classList.remove("cursor-grabbing");
    if (d.mode === "node") {
      d.node.fixed = false;
      heat(0.3);
      if (!d.moved && d.node.kind !== "missing") router.push(`/docs?path=${encodeURIComponent(d.node.id)}`);
    }
  };

  const lit = (id: string) => !hover || hover === id || Boolean(neighbours.get(hover)?.has(id));

  if (nodes.length === 0) return null;

  return (
    <div
      ref={box}
      className="rb-graph relative h-[calc(100dvh-150px)] min-h-[480px] touch-none select-none overflow-hidden rounded-2xl"
      data-hovering={hover ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="Documents and the links between them. Drag to move, scroll to zoom."
    >
      {/* Light moving slowly behind the glass. */}
      <span className="rb-graph-glow" style={{ left: "8%", top: "4%", ["--glow" as string]: "var(--accent)", animationDuration: "26s" }} />
      <span className="rb-graph-glow" style={{ right: "6%", top: "30%", ["--glow" as string]: "var(--state-review)", animationDuration: "31s", animationName: "rb-drift-2" }} />

      <div ref={world} className="absolute left-0 top-0 origin-top-left will-change-transform">
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
          <defs>
            <linearGradient id="rb-edge-lit" gradientUnits="userSpaceOnUse" x1="-400" y1="0" x2="400" y2="0">
              <stop offset="0" style={{ stopColor: "rgb(var(--accent))" }} />
              <stop offset="1" style={{ stopColor: "rgb(var(--state-review))" }} />
            </linearGradient>
          </defs>
          {links.map((l, i) => {
            const on = hover != null && (l.source.id === hover || l.target.id === hover);
            const ghost = l.target.kind === "missing" || l.source.kind === "missing";
            return (
              <g key={`${l.source.id}-${l.target.id}`}>
                <path
                  ref={(el) => {
                    edgeEls.current[i] = el;
                  }}
                  d={curve(l.source, l.target)}
                  fill="none"
                  className={`rb-graph-edge ${on ? "rb-graph-edge-on" : ""} ${hover && !on ? "opacity-20" : ""}`}
                  strokeDasharray={ghost && !on ? "4 5" : undefined}
                />
              </g>
            );
          })}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            ref={(el) => {
              if (el) nodeEls.current.set(n.id, el);
              else nodeEls.current.delete(n.id);
            }}
            data-node={n.id}
            className="absolute left-0 top-0"
            style={{ transform: `translate3d(${n.x}px, ${n.y}px, 0)` }}
          >
            <button
              type="button"
              className={`rb-graph-node group ${hover === n.id ? "rb-graph-node-on" : ""} ${lit(n.id) ? "" : "rb-graph-node-dim"} ${
                n.kind === "missing" ? "cursor-default" : "cursor-pointer"
              }`}
              style={{ width: n.size, height: n.size }}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && n.kind !== "missing") router.push(`/docs?path=${encodeURIComponent(n.id)}`);
              }}
              aria-label={
                n.kind === "missing"
                  ? `${n.id}: linked, not written yet`
                  : `${n.title}${n.total ? `, ${percent(n.done, n.total)}% done` : ""}`
              }
            >
              <NodeFace node={n} />
              <span className={`rb-graph-label ${n.kind === "missing" ? "text-faint" : "text-ink"}`}>
                {n.title.length > 30 ? `${n.title.slice(0, 29)}…` : n.title}
              </span>
            </button>
          </div>
        ))}
      </div>

      {/* Legend and controls: glass pills floating in the corners. */}
      <div data-graph-ui className="rb-glass absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-full px-4 py-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full ring-2 ring-state-done/80" /> Checklist
        </span>
        <span className="flex items-center gap-1.5">
          <BookMarked className="size-3.5 text-accent" /> Note
        </span>
        <span className="flex items-center gap-1.5">
          <Lightbulb className="size-3.5 text-state-review" /> Decision
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="size-3.5 text-state-doing" /> Document
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full border border-dashed border-ink/40" /> Not written yet
        </span>
        <Tooltip content="Link documents by writing [[notes/commands]] anywhere in their text.">
          <span className="grid size-5 place-items-center text-faint">
            <Info className="size-3.5" />
          </span>
        </Tooltip>
      </div>
      <div data-graph-ui className="rb-glass absolute bottom-3 right-3 flex items-center gap-0.5 rounded-full p-1">
        <Tooltip content="Zoom out">
          <button className="rb-icon-btn size-7 rounded-full" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom out" disabled={zoom <= MIN_ZOOM + 0.01}>
            <Minus className="size-3.5" />
          </button>
        </Tooltip>
        <span className="w-10 text-center text-2xs tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
        <Tooltip content="Zoom in">
          <button className="rb-icon-btn size-7 rounded-full" onClick={() => zoomAt(1.25)} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM - 0.01}>
            <Plus className="size-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Show everything">
          <button
            className="rb-icon-btn size-7 rounded-full"
            onClick={() => {
              heat(0.5);
              fit();
            }}
            aria-label="Show everything"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
