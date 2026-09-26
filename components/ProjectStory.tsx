"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronsLeft,
  ExternalLink,
  Flag,
  GitBranch,
  GitMerge,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  ScanSearch,
  X,
} from "lucide-react";
import { api, useResource } from "@/lib/client/api";
import { buildStory, storyPositions, type StoryEdge, type StoryNode } from "@/lib/client/story";
import { ActorAvatar } from "@/components/Actor";
import { BOARD_COLORS } from "@/components/labelColor";
import { RelativeTime, Skeleton, Tooltip, formatDate } from "@/components/ui";

/* Branch colours: the board palette without the greens. */
const BRANCH_COLORS = BOARD_COLORS.filter((c) => !["green", "teal", "slate"].includes(c.key)).map((c) => c.value);
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.4;

interface Body {
  node: StoryNode;
  ax: number;
  ay: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
  size: number;
}

function sizeOf(n: StoryNode): number {
  const count = n.commits.length;
  if (n.kind === "start" || n.kind === "merge" || n.kind === "fork" || n.kind === "now" || n.kind === "earlier") return 34;
  if (n.lane === 0) return Math.min(18 + Math.sqrt(count) * 5, 40);
  return Math.min(16 + Math.sqrt(count) * 4, 32);
}

function headline(n: StoryNode, mainBranch: string): string {
  const count = n.commits.length;
  switch (n.kind) {
    case "start":
      return "The project starts";
    case "earlier":
      return "Earlier history";
    case "fork":
      return count === 1 ? n.commits[0].message : `${count} commits`;
    case "merge":
      return `Merged ${n.commits[0].message.match(/from [^/\s]+\/(\S+)/)?.[1] ?? "a branch"}`;
    case "tip":
      return `${n.branch}, still open`;
    case "now":
      return `Now, on ${mainBranch}`;
    default:
      return count === 1 ? n.commits[0].message : `${count} commits on ${n.branch}`;
  }
}

function edgePath(a: Body, b: Body, kind: StoryEdge["kind"]): string {
  if (kind === "main" || kind === "branch") return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  // Leaving and joining the main line: an S-curve with level ends.
  const mid = (a.x + b.x) / 2;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${mid.toFixed(1)} ${a.y.toFixed(1)}, ${mid.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function NodeIcon({ node }: { node: StoryNode }) {
  const cls = "size-3.5";
  if (node.kind === "start") return <Flag className={`${cls} text-ink`} />;
  if (node.kind === "earlier") return <ChevronsLeft className={`${cls} text-muted`} />;
  if (node.kind === "merge") return <GitMerge className={`${cls} text-ink`} />;
  if (node.kind === "fork") return <GitBranch className={`${cls} text-ink`} />;
  if (node.kind === "now") return <span className="size-2.5 rounded-full bg-accent" />;
  if (node.commits.length > 1) return <span className="text-[10px] font-semibold tabular-nums text-ink">{node.commits.length}</span>;
  return null;
}

/**
 * The life of the project, read from GitHub: the main line from the first
 * commit to now, branches leaving it and coming back, the ones still open.
 * Pull any point and it springs back; point at one for a glass card with what
 * happened there, click it for every commit. Scroll sideways or drag to move
 * along the years; pinch or ⌘-scroll to zoom.
 */
export function ProjectStory({
  repo,
  connected,
  height = 340,
  card = false,
}: {
  repo: string | null;
  connected: boolean;
  height?: number;
  /** Shown as an Overview card: a heading and a few facts above the picture. */
  card?: boolean;
}) {
  const data = useResource(api.story, [repo], { enabled: connected });
  const pulls = useResource(api.pulls, [repo], { enabled: connected });
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, HTMLElement>());
  const edgeEls = useRef<(SVGPathElement | null)[]>([]);
  const twinEls = useRef<(SVGPathElement | null)[]>([]);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const frame = useRef(0);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);

  const story = useMemo(() => {
    if (!data.data) return null;
    return buildStory(
      data.data.commits.map((c) => ({
        sha: c.sha,
        message: c.message,
        author: c.author,
        date: c.date ? Date.parse(c.date) : 0,
        parents: c.parents,
        heads: c.heads,
      })),
      data.data.defaultBranch,
    );
  }, [data.data]);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    story?.branches.forEach((b, i) => map.set(b.name, BRANCH_COLORS[i % BRANCH_COLORS.length]));
    return (branch: string) => map.get(branch) ?? "rgb(var(--ink) / 0.55)";
  }, [story]);

  const openPrTitle = useMemo(() => {
    const map = new Map<string, { number: number; title: string }>();
    for (const pr of pulls.data?.pulls ?? []) if (pr.state === "open") map.set(pr.head, { number: pr.number, title: pr.title });
    return map;
  }, [pulls.data]);

  const bodies = useMemo(() => {
    if (!story) return new Map<string, Body>();
    const pos = storyPositions(story.nodes);
    return new Map(
      story.nodes.map((node) => {
        const p = pos.get(node.id)!;
        // They start on the main line and spring out to their lanes.
        return [node.id, { node, ax: p.x, ay: p.y, x: p.x, y: 0, vx: 0, vy: 0, fixed: false, size: sizeOf(node) }];
      }),
    );
  }, [story]);

  const edges = useMemo(
    () => (story?.edges ?? []).map((e) => ({ edge: e, a: bodies.get(e.from)!, b: bodies.get(e.to)! })).filter((e) => e.a && e.b),
    [story, bodies],
  );
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { edge } of edges) {
      map.set(edge.from, (map.get(edge.from) ?? new Set()).add(edge.to));
      map.set(edge.to, (map.get(edge.to) ?? new Set()).add(edge.from));
    }
    return map;
  }, [edges]);

  /* --------------------------------------------------- springs, off React -- */

  const paint = useCallback(() => {
    for (const b of bodies.values()) {
      const el = nodeEls.current.get(b.node.id);
      if (el) el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
    }
    edges.forEach(({ edge, a, b }, i) => {
      const d = edgePath(a, b, edge.kind);
      edgeEls.current[i]?.setAttribute("d", d);
      twinEls.current[i]?.setAttribute("d", d);
    });
  }, [bodies, edges]);

  const run = useCallback(() => {
    if (frame.current) return;
    const tick = () => {
      let energy = 0;
      for (const b of bodies.values()) {
        if (b.fixed) continue;
        b.vx += (b.ax - b.x) * 0.045;
        b.vy += (b.ay - b.y) * 0.045;
      }
      // Each link wants to keep its shape, so a pulled point drags its neighbours a little.
      for (const { a, b } of edges) {
        const dx = b.x - a.x - (b.ax - a.ax);
        const dy = b.y - a.y - (b.ay - a.ay);
        if (!a.fixed) {
          a.vx += dx * 0.05;
          a.vy += dy * 0.05;
        }
        if (!b.fixed) {
          b.vx -= dx * 0.05;
          b.vy -= dy * 0.05;
        }
      }
      for (const b of bodies.values()) {
        if (b.fixed) continue;
        b.vx *= 0.8;
        b.vy *= 0.8;
        b.x += b.vx;
        b.y += b.vy;
        energy += Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.ax - b.x) * 0.02 + Math.abs(b.ay - b.y) * 0.02;
      }
      paint();
      const dragging = [...bodies.values()].some((b) => b.fixed);
      if (energy > 0.02 || dragging) frame.current = requestAnimationFrame(tick);
      else frame.current = 0;
    };
    frame.current = requestAnimationFrame(tick);
  }, [bodies, edges, paint]);

  const applyView = useCallback(() => {
    const el = box.current;
    const w = world.current;
    if (!el || !w) return;
    const { x, y, k } = view.current;
    const cx = el.clientWidth / 2 + x;
    const cy = el.clientHeight / 2 + y;
    w.style.transform = `translate(${cx}px, ${cy}px) scale(${k})`;
    el.style.backgroundPosition = `${cx}px ${cy}px`;
    el.style.backgroundSize = `${22 * k}px ${22 * k}px`;
  }, []);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || bodies.size === 0) return;
    const list = [...bodies.values()];
    const minX = Math.min(...list.map((b) => b.ax)) - 70;
    const maxX = Math.max(...list.map((b) => b.ax)) + 70;
    const minY = Math.min(...list.map((b) => b.ay)) - 70;
    const maxY = Math.max(...list.map((b) => b.ay)) + 80;
    const k = Math.min(Math.max(Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY)), MIN_ZOOM), 1.3);
    view.current = { x: (-(minX + maxX) / 2) * k, y: (-(minY + maxY) / 2) * k, k };
    applyView();
    setZoom(k);
  }, [bodies, applyView]);

  // It opens on the recent past at a readable size, now at the right edge;
  // older history is a drag or a sideways scroll away.
  const showLatest = useCallback(() => {
    const el = box.current;
    if (!el || bodies.size === 0) return;
    const list = [...bodies.values()];
    const minX = Math.min(...list.map((b) => b.ax)) - 70;
    const maxX = Math.max(...list.map((b) => b.ax));
    const minY = Math.min(...list.map((b) => b.ay)) - 70;
    const maxY = Math.max(...list.map((b) => b.ay)) + 80;
    const fitK = Math.min(el.clientWidth / (maxX + 70 - minX), el.clientHeight / (maxY - minY));
    const k = Math.min(Math.max(Math.min(el.clientHeight / (maxY - minY), 1.05), fitK, MIN_ZOOM), 1.05);
    const all = (maxX + 70 - minX) * k <= el.clientWidth;
    view.current = {
      k,
      x: all ? (-(minX + maxX + 70) / 2) * k : el.clientWidth / 2 - 110 - maxX * k,
      y: (-(minY + maxY) / 2) * k,
    };
    applyView();
    setZoom(k);
  }, [bodies, applyView]);

  useEffect(() => {
    showLatest();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const b of bodies.values()) b.y = b.ay;
      paint();
      return;
    }
    run();
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [bodies, showLatest, run, paint]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => showLatest());
    observer.observe(el);
    return () => observer.disconnect();
  }, [showLatest, full]);

  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  /* -------------------------------------------------------- interaction -- */

  const zoomAt = (factor: number, clientX?: number) => {
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX ?? rect.left + el.clientWidth / 2) - rect.left - el.clientWidth / 2;
    const { x, y, k } = view.current;
    const next = Math.min(Math.max(k * factor, MIN_ZOOM), MAX_ZOOM);
    view.current = { k: next, x: px - ((px - x) * next) / k, y: (y * next) / k };
    applyView();
    setZoom(next);
  };

  // Sideways scrolling moves along time, pinch or ⌘/Ctrl-scroll zooms; plain
  // vertical scrolling is left to the page (full screen: it moves along time).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX);
      } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey || full) {
        event.preventDefault();
        view.current = { ...view.current, x: view.current.x - (event.deltaX || event.deltaY) };
        applyView();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const drag = useRef<
    | null
    | { mode: "node"; body: Body; moved: boolean; dx: number; dy: number; id: number }
    | { mode: "pan"; startX: number; startY: number; x: number; y: number; id: number; moved: boolean }
  >(null);

  const toWorld = (clientX: number, clientY: number) => {
    const el = box.current!;
    const rect = el.getBoundingClientRect();
    const { x, y, k } = view.current;
    return { x: (clientX - rect.left - el.clientWidth / 2 - x) / k, y: (clientY - rect.top - el.clientHeight / 2 - y) / k };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-story-ui]")) return;
    try {
      box.current?.setPointerCapture(event.pointerId);
    } catch {
      /* not a live pointer */
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-node]");
    const body = target ? bodies.get(target.dataset.node!) : undefined;
    if (body) {
      const at = toWorld(event.clientX, event.clientY);
      body.fixed = true;
      drag.current = { mode: "node", body, moved: false, dx: at.x - body.x, dy: at.y - body.y, id: event.pointerId };
      run();
    } else {
      drag.current = { mode: "pan", startX: event.clientX, startY: event.clientY, x: view.current.x, y: view.current.y, id: event.pointerId, moved: false };
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    if (d.mode === "node") {
      const at = toWorld(event.clientX, event.clientY);
      const x = at.x - d.dx;
      const y = at.y - d.dy;
      if (Math.abs(x - d.body.x) + Math.abs(y - d.body.y) > 1.5) d.moved = true;
      d.body.x = x;
      d.body.y = y;
      setHover(null);
    } else {
      const dx = event.clientX - d.startX;
      const dy = event.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      view.current = { ...view.current, x: d.x + dx, y: d.y + dy };
      applyView();
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (d.mode === "node") {
      // Let go: it springs back to where it belongs.
      d.body.fixed = false;
      run();
      if (!d.moved) setOpen((o) => (o === d.body.node.id ? null : d.body.node.id));
    } else if (!d.moved) {
      setOpen(null);
    }
  };

  /* ------------------------------------------------------------- render -- */

  const lit = (id: string) => !hover || hover === id || Boolean(neighbours.get(hover)?.has(id));
  const hovered = hover ? bodies.get(hover) : undefined;
  const opened = open ? bodies.get(open)?.node : undefined;
  const firstOfBranch = useMemo(() => {
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const n of [...(story?.nodes ?? [])].sort((a, b) => a.time - b.time)) {
      if (n.lane === 0 || seen.has(n.branch)) continue;
      seen.add(n.branch);
      out.add(n.id);
    }
    return out;
  }, [story]);
  // Dates under the main line's landmarks, skipping ones that would crowd.
  const dated = useMemo(() => {
    const out = new Set<string>();
    let lastX = -Infinity;
    for (const b of [...bodies.values()].filter((b) => b.node.lane === 0).sort((a, b) => a.ax - b.ax)) {
      if (b.node.kind === "work" && b.node.commits.length < 5) continue;
      if (b.ax - lastX < 90) continue;
      out.add(b.node.id);
      lastX = b.ax;
    }
    return out;
  }, [bodies]);

  const tooltip = (() => {
    if (!hovered || !box.current || !story) return null;
    const el = nodeEls.current.get(hovered.node.id);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const host = box.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - host.left;
    const below = rect.top - host.top < 170;
    const y = below ? rect.bottom - host.top + hovered.size * 0.5 * view.current.k + 10 : rect.top - host.top - hovered.size * 0.5 * view.current.k - 10;
    const n = hovered.node;
    const authors = [...new Set(n.commits.map((c) => c.author).filter(Boolean) as string[])];
    const openPr = n.kind === "tip" ? openPrTitle.get(n.branch) : undefined;
    const from = n.commits[0].date;
    const to = n.commits[n.commits.length - 1].date;
    return (
      <div
        data-story-ui
        className="rb-story-card pointer-events-none absolute z-20 w-[280px]"
        style={{ left: Math.min(Math.max(x, 150), (box.current.clientWidth ?? 0) - 150), top: y, translate: below ? "-50% 0" : "-50% -100%" }}
      >
        <p className="flex items-center gap-2 text-2xs font-medium text-muted">
          <span className="size-2 rounded-full" style={{ backgroundColor: n.lane === 0 ? "rgb(var(--ink) / 0.6)" : colorOf(n.branch) }} />
          <span className="truncate">{n.branch}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {formatDate(from, { day: "numeric", month: "short", year: "numeric" })}
            {to - from > 86_400_000 && ` – ${formatDate(to, { day: "numeric", month: "short" })}`}
          </span>
        </p>
        <p className="mt-1.5 text-sm font-semibold leading-snug text-ink">{headline(n, story.mainBranch)}</p>
        {openPr && (
          <p className="mt-1 text-xs text-muted">
            Pull request <span className="font-mono">#{openPr.number}</span>: {openPr.title}
          </p>
        )}
        {n.pr && n.kind === "merge" && <p className="mt-1 text-xs text-muted">Pull request <span className="font-mono">#{n.pr}</span></p>}
        {n.commits.length > 1 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
            {n.commits
              .slice(-3)
              .reverse()
              .map((c) => (
                <li key={c.sha} className="truncate">
                  {c.message}
                </li>
              ))}
            {n.commits.length > 3 && <li className="text-faint">and {n.commits.length - 3} more</li>}
          </ul>
        )}
        <div className="mt-2.5 flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {authors.slice(0, 4).map((a) => (
              <span key={a} className="rounded-full ring-2 ring-[rgb(var(--glass))]">
                <ActorAvatar name={a} size={18} />
              </span>
            ))}
          </span>
          <span className="truncate text-2xs text-faint">{authors.join(", ")}</span>
          {n.cards.length > 0 && (
            <span className="ml-auto flex shrink-0 gap-1">
              {n.cards.slice(0, 3).map((card) => (
                <span key={card} className="rounded-sm bg-pill px-1 font-mono text-2xs text-muted">
                  RB-{card}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    );
  })();

  const shell = full
    ? "fixed inset-3 z-[70] rounded-[22px] shadow-[0_30px_80px_-20px_rgb(var(--shadow)/0.45)]"
    : "relative rounded-2xl";

  if (!connected) return null;

  const canvas = (
      <div
        ref={box}
        className={`rb-story ${shell} touch-none select-none overflow-hidden`}
        style={full ? undefined : { height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="The history of the project: branches and merges over time"
      >
        {data.loading && !story && (
          <div className="absolute inset-0 flex items-center gap-6 px-10">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="size-8 rounded-full" />
            ))}
          </div>
        )}
        {data.error && !story && (
          <p className="absolute inset-0 grid place-items-center text-sm text-muted">Could not read the history: {data.error}</p>
        )}
        {story && story.nodes.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-sm text-muted">No commits yet. The story starts with the first push.</p>
        )}

        <div ref={world} className="absolute left-0 top-0 origin-top-left will-change-transform">
          <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
            {edges.map(({ edge, a, b }, i) => {
              const color = edge.kind === "main" ? "rgb(var(--ink) / 0.28)" : colorOf(edge.branch);
              const on = hover != null && (edge.from === hover || edge.to === hover);
              const dim = hover != null && !on;
              const dashed = edge.kind === "fork" || edge.kind === "merge";
              return (
                <g key={`${edge.from}-${edge.to}`} style={{ opacity: dim ? 0.25 : 1, transition: "opacity 160ms" }}>
                  <path
                    ref={(el) => {
                      edgeEls.current[i] = el;
                    }}
                    d={edgePath(a, b, edge.kind)}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={dashed ? "5 6" : undefined}
                    style={{
                      stroke: color,
                      strokeWidth: edge.kind === "main" ? 3.5 : edge.open && edge.kind === "branch" ? 5 : dashed ? 2 : 2.6,
                    }}
                    className={on && dashed ? "rb-story-flow" : undefined}
                  />
                  {/* An open branch is drawn as a double line, like a track still being laid. */}
                  {edge.open && edge.kind === "branch" && (
                    <path
                      ref={(el) => {
                        twinEls.current[i] = el;
                      }}
                      d={edgePath(a, b, edge.kind)}
                      fill="none"
                      style={{ stroke: "rgb(var(--canvas))", strokeWidth: 1.6 }}
                      className="rb-story-twin"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {[...bodies.values()].map((b) => {
            const n = b.node;
            const color = n.lane === 0 ? null : colorOf(n.branch);
            return (
              <div
                key={n.id}
                ref={(el) => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                data-node={n.id}
                className="absolute left-0 top-0"
                style={{ transform: `translate3d(${b.x}px, ${b.y}px, 0)` }}
              >
                <button
                  type="button"
                  className={`rb-story-node ${hover === n.id || open === n.id ? "rb-story-node-on" : ""} ${lit(n.id) ? "" : "opacity-30"} ${
                    n.kind === "tip" || n.kind === "now" ? "rb-story-live" : ""
                  }`}
                  style={{ width: b.size, height: b.size, ["--branch" as string]: color ?? "rgb(var(--ink) / 0.35)" }}
                  onPointerEnter={() => !drag.current && setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(event) => event.key === "Enter" && setOpen(n.id)}
                  aria-label={`${headline(n, story?.mainBranch ?? "main")}, ${formatDate(n.time, { day: "numeric", month: "short", year: "numeric" })}`}
                >
                  <NodeIcon node={n} />
                </button>
                {firstOfBranch.has(n.id) && (
                  <span
                    className="rb-story-branch"
                    style={{ ["--branch" as string]: color ?? undefined, top: n.lane < 0 ? undefined : b.size / 2 + 8, bottom: n.lane < 0 ? b.size / 2 + 8 : undefined }}
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: color ?? undefined }} />
                    {n.branch}
                  </span>
                )}
                {dated.has(n.id) && (
                  <span className="rb-story-date" style={{ top: b.size / 2 + 10 }}>
                    {n.kind === "now" ? "Now" : formatDate(n.time, { day: "numeric", month: "short" })}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {tooltip}

        {opened && story && (
          <aside data-story-ui className="rb-glass-strong rb-pop absolute bottom-3 right-3 top-3 z-30 flex w-[min(360px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl">
            <div className="flex items-start gap-2 p-4 pb-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-2xs font-medium text-muted">
                  <span className="size-2 rounded-full" style={{ backgroundColor: opened.lane === 0 ? "rgb(var(--ink) / 0.6)" : colorOf(opened.branch) }} />
                  {opened.branch}
                </p>
                <p className="mt-1 text-md font-semibold leading-snug text-ink">{headline(opened, story.mainBranch)}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {opened.commits.length} commit{opened.commits.length === 1 ? "" : "s"}, <RelativeTime value={opened.time} />
                </p>
              </div>
              <button className="rb-icon-btn -mr-1 -mt-1" onClick={() => setOpen(null)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            {(opened.cards.length > 0 || opened.pr) && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                {opened.pr && repo && (
                  <a className="rb-chip" href={`https://github.com/${repo}/pull/${opened.pr}`} target="_blank" rel="noreferrer noopener">
                    <GitMerge className="size-3.5 text-faint" /> #{opened.pr}
                  </a>
                )}
                {opened.cards.map((card) => (
                  <Link key={card} className="rb-chip font-mono" href={`/board/card/RB-${card}`}>
                    RB-{card}
                  </Link>
                ))}
              </div>
            )}
            <ol className="rb-scroll-thin min-h-0 flex-1 overflow-y-auto border-t border-border px-2 py-2">
              {[...opened.commits].reverse().map((c) => (
                <li key={c.sha}>
                  <a
                    href={repo ? `https://github.com/${repo}/commit/${c.sha}` : undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-hover"
                  >
                    {c.author && <ActorAvatar name={c.author} size={20} />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug text-ink">{c.message}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-2xs text-faint">
                        <span className="font-mono">{c.sha.slice(0, 7)}</span>
                        <span>{c.author}</span>
                        <RelativeTime value={c.date} />
                      </span>
                    </span>
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-faint opacity-0 group-hover:opacity-100" />
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        )}

        {story && story.nodes.length > 0 && (
          <>
            <div data-story-ui className="rb-glass absolute left-3 top-3 hidden flex-wrap items-center gap-x-4 gap-y-1 rounded-full px-4 py-2 text-xs text-muted md:flex">
              <span className="flex items-center gap-1.5">
                <span className="h-[3px] w-4 rounded-full bg-ink/30" /> {story.mainBranch}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[2.5px] w-4 rounded-full" style={{ backgroundColor: BRANCH_COLORS[0] }} /> Branch
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed" style={{ borderColor: BRANCH_COLORS[1] }} /> Leaves, merges
              </span>
              <span className="flex items-center gap-1.5">
                <span className="relative h-[5px] w-4 rounded-full" style={{ backgroundColor: BRANCH_COLORS[2] }}>
                  <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 bg-canvas" />
                </span>
                Still open
              </span>
            </div>
            <div data-story-ui className="rb-glass absolute right-3 top-3 flex items-center gap-0.5 rounded-full p-1" style={opened ? { right: "calc(min(360px, 100% - 24px) + 24px)" } : undefined}>
              <Tooltip content="Zoom out">
                <button className="rb-icon-btn size-7 rounded-full" onClick={() => zoomAt(1 / 1.3)} aria-label="Zoom out" disabled={zoom <= MIN_ZOOM + 0.01}>
                  <Minus className="size-3.5" />
                </button>
              </Tooltip>
              <span className="w-10 text-center text-2xs tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
              <Tooltip content="Zoom in">
                <button className="rb-icon-btn size-7 rounded-full" onClick={() => zoomAt(1.3)} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM - 0.01}>
                  <Plus className="size-3.5" />
                </button>
              </Tooltip>
              <Tooltip content="Show the whole history">
                <button className="rb-icon-btn size-7 rounded-full" onClick={fit} aria-label="Show the whole history">
                  <ScanSearch className="size-3.5" />
                </button>
              </Tooltip>
              <Tooltip content={full ? "Back" : "Full screen"}>
                <button className="rb-icon-btn size-7 rounded-full" onClick={() => setFull((f) => !f)} aria-label={full ? "Leave full screen" : "Full screen"}>
                  {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
              </Tooltip>
            </div>
          </>
        )}
      </div>
  );

  // Full screen lives on <body>: a glass card around it would otherwise hold
  // a fixed element inside itself (backdrop-filter makes a containing block).
  const overlay =
    full &&
    createPortal(
      <>
        <div className="rb-scrim rb-fade-in fixed inset-0 z-[69]" onClick={() => setFull(false)} />
        {canvas}
      </>,
      document.body,
    );
  if (!card) return overlay || canvas;

  const openBranches = story?.branches.filter((b) => b.open).length ?? 0;
  const truncated = story?.nodes[0]?.kind === "earlier";
  return (
    <>
      {overlay}
      <section className="rb-card flex flex-col gap-2 p-2">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-1 pt-2">
          <GitBranch className="size-4 text-muted" />
          <h2 className="text-md font-semibold text-ink">Project life</h2>
          {story && story.nodes.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className="rb-chip pointer-events-none">
                {truncated ? "Since" : "Started"} {formatDate(story.first, { month: "long", year: "numeric" })}
              </span>
              <span className="rb-chip pointer-events-none tabular-nums">
                {story.total}
                {truncated ? "+" : ""} commits
              </span>
              <span className="rb-chip pointer-events-none tabular-nums">
                {story.branches.length} branch{story.branches.length === 1 ? "" : "es"}
                {openBranches > 0 && <span className="text-accent">, {openBranches} open</span>}
              </span>
            </span>
          )}
        </header>
        {full ? <div className="rounded-2xl bg-canvas/60" style={{ height }} /> : canvas}
      </section>
    </>
  );
}