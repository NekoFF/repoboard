"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TrackedDoc } from "@/lib/docs-service";
import { percent } from "@/components/ui";

interface Node {
  id: string;
  title: string;
  kind: TrackedDoc["kind"] | "missing";
  done: number;
  total: number;
  x: number;
  y: number;
}

const W = 900;
const H = 560;

/**
 * Documents and the [[links]] between them, laid out by a small force
 * simulation (no dependency, deterministic, computed once per change). Links
 * to files that do not exist yet show as dashed ghosts — a gap to fill.
 */
function layout(docs: TrackedDoc[]) {
  const nodes = new Map<string, Node>();
  docs.forEach((d, i) => {
    const angle = (i / Math.max(docs.length, 1)) * Math.PI * 2;
    nodes.set(d.path, {
      id: d.path,
      title: d.title,
      kind: d.kind,
      done: d.done,
      total: d.total,
      x: W / 2 + Math.cos(angle) * 180,
      y: H / 2 + Math.sin(angle) * 140,
    });
  });
  const edges: [string, string][] = [];
  for (const d of docs) {
    for (const target of d.links) {
      if (target === d.path) continue;
      if (!nodes.has(target)) {
        const n = nodes.size;
        nodes.set(target, {
          id: target,
          title: target.split("/").pop()!.replace(/\.md$/i, ""),
          kind: "missing",
          done: 0,
          total: 0,
          x: W / 2 + Math.cos(n) * 240,
          y: H / 2 + Math.sin(n) * 180,
        });
      }
      edges.push([d.path, target]);
    }
  }

  const list = [...nodes.values()];
  for (let step = 0; step < 320; step += 1) {
    const cooling = 1 - step / 320;
    for (const a of list) {
      let fx = (W / 2 - a.x) * 0.004;
      let fy = (H / 2 - a.y) * 0.006;
      for (const b of list) {
        if (a === b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 100);
        fx += (dx / Math.sqrt(d2)) * (9000 / d2);
        fy += (dy / Math.sqrt(d2)) * (9000 / d2);
      }
      for (const [from, to] of edges) {
        const other = from === a.id ? nodes.get(to) : to === a.id ? nodes.get(from) : null;
        if (!other) continue;
        const dx = other.x - a.x;
        const dy = other.y - a.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        fx += (dx / d) * (d - 130) * 0.03;
        fy += (dy / d) * (d - 130) * 0.03;
      }
      a.x = Math.min(W - 60, Math.max(60, a.x + fx * cooling * 4));
      a.y = Math.min(H - 40, Math.max(30, a.y + fy * cooling * 4));
    }
  }
  return { nodes: list, edges, byId: nodes };
}

const radius = (n: Node) => (n.kind === "missing" ? 6 : 9 + Math.min(Math.sqrt(n.total) * 2.2, 14));

export function DocsGraph({ docs }: { docs: TrackedDoc[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const { nodes, edges, byId } = useMemo(() => layout(docs), [docs]);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [a, b] of edges) {
      map.set(a, (map.get(a) ?? new Set()).add(b));
      map.set(b, (map.get(b) ?? new Set()).add(a));
    }
    return map;
  }, [edges]);
  const lit = (id: string) => !hover || hover === id || neighbours.get(hover)?.has(id);

  if (nodes.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Documents and the links between them">
        {edges.map(([a, b], i) => {
          const from = byId.get(a)!;
          const to = byId.get(b)!;
          const on = !hover || hover === a || hover === b;
          return (
            <line
              key={i}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              strokeWidth={on && hover ? 1.8 : 1.2}
              strokeDasharray={to.kind === "missing" ? "4 4" : undefined}
              style={{ stroke: `rgb(var(--ink) / ${on ? (hover ? 0.45 : 0.18) : 0.05})`, transition: "stroke 120ms" }}
            />
          );
        })}
        {nodes.map((n) => {
          const r = radius(n);
          const c = 2 * Math.PI * (r + 3);
          const ratio = n.total ? n.done / n.total : 0;
          const opacity = lit(n.id) ? 1 : 0.25;
          const fill =
            n.kind === "missing"
              ? "rgb(var(--canvas))"
              : n.kind === "checklist"
                ? "rgb(var(--surface))"
                : n.kind === "decision"
                  ? "rgb(var(--state-review) / 0.18)"
                  : "rgb(var(--ink) / 0.08)";
          return (
            <g
              key={n.id}
              transform={`translate(${n.x} ${n.y})`}
              style={{ opacity, transition: "opacity 120ms", cursor: n.kind === "missing" ? "default" : "pointer" }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => n.kind !== "missing" && router.push(`/docs?path=${encodeURIComponent(n.id)}`)}
            >
              <title>
                {n.kind === "missing" ? `${n.id} — linked, not written yet` : `${n.title}${n.total ? ` — ${percent(n.done, n.total)}% done` : ""}`}
              </title>
              {n.kind === "decision" ? (
                <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} transform="rotate(45)" style={{ fill, stroke: "rgb(var(--state-review) / 0.6)" }} strokeWidth={1.5} />
              ) : n.kind === "note" || n.kind === "document" ? (
                <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.45} style={{ fill, stroke: "rgb(var(--ink) / 0.3)" }} strokeWidth={1.2} />
              ) : (
                <circle
                  r={r}
                  strokeDasharray={n.kind === "missing" ? "3 3" : undefined}
                  style={{ fill, stroke: `rgb(var(--ink) / ${n.kind === "missing" ? 0.35 : 0.25})` }}
                  strokeWidth={1.2}
                />
              )}
              {n.kind === "checklist" && n.total > 0 && (
                <circle
                  r={r + 3}
                  fill="none"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeDasharray={`${c * ratio} ${c}`}
                  transform="rotate(-90)"
                  style={{ stroke: "rgb(var(--state-done))" }}
                />
              )}
              <text
                y={r + 17}
                textAnchor="middle"
                className="select-none"
                style={{ fill: `rgb(var(--${n.kind === "missing" ? "faint" : "ink"}))`, fontSize: 12, fontWeight: hover === n.id ? 600 : 500 }}
              >
                {n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full border border-ink/25 bg-surface ring-2 ring-state-done/70" /> Checklist, ring is progress</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] border border-ink/30 bg-ink/10" /> Note</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rotate-45 rounded-[2px] border border-state-review/60 bg-state-review/20" /> Decision</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-full border border-dashed border-ink/40" /> Linked but not written yet</span>
      </div>
    </div>
  );
}
