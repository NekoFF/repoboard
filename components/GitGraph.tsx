"use client";

import Link from "next/link";
import { useMemo } from "react";
import { GitBranch } from "lucide-react";
import type { GraphCommit } from "@/lib/github/client";
import type { BoardTask } from "@/lib/board-service";
import { layoutGraph } from "@/lib/client/graph";
import { RelativeTime } from "@/components/ui";

const ROW = 40;
const LANE = 18;
const PAD = 14;

// Lane 0 is the default branch: drawn in ink. Others get calm, distinct hues.
const LANE_COLOURS = [
  "rgb(var(--ink) / 0.55)",
  "hsl(236 58% 60%)",
  "hsl(152 48% 42%)",
  "hsl(36 80% 50%)",
  "hsl(330 55% 58%)",
  "hsl(190 60% 42%)",
  "hsl(268 52% 62%)",
  "hsl(2 62% 56%)",
];
const colour = (lane: number) => LANE_COLOURS[lane % LANE_COLOURS.length];

const x = (lane: number) => PAD + lane * LANE;
const y = (row: number) => row * ROW + ROW / 2;

/**
 * The repository's history as lines: where work split off, where it came
 * back. Each row is one commit; card references in the message link to the
 * card, and branch tips are labelled.
 */
export function GitGraph({
  commits,
  cardsByNumber,
  onOpen,
  mainBranch,
}: {
  commits: GraphCommit[];
  mainBranch?: string | null;
  cardsByNumber: Map<number, BoardTask>;
  onOpen: (sha: string) => void;
}) {
  const mainHead = commits.find((c) => mainBranch && c.heads.includes(mainBranch))?.sha ?? commits[0]?.sha;
  const layout = useMemo(() => layoutGraph(commits, mainHead), [commits, mainHead]);
  const width = PAD * 2 + (layout.width - 1) * LANE;
  const height = commits.length * ROW;

  const paths = layout.edges.map((e, i) => {
    const x1 = x(e.fromLane);
    const y1 = y(e.fromRow);
    const xv = x(e.viaLane);
    const x2 = x(e.toLane);
    const y2 = y(e.toRow);
    let d = `M ${x1} ${y1}`;
    if (xv !== x1) d += ` C ${x1} ${y1 + ROW * 0.45}, ${xv} ${y1 + ROW * 0.3}, ${xv} ${y1 + ROW * 0.75}`;
    if (xv !== x2) {
      d += ` L ${xv} ${y2 - ROW * 0.75} C ${xv} ${y2 - ROW * 0.3}, ${x2} ${y2 - ROW * 0.45}, ${x2} ${y2}`;
    } else {
      d += ` L ${x2} ${y2}`;
    }
    return <path key={i} d={d} fill="none" style={{ stroke: colour(e.viaLane) }} strokeWidth={2} strokeLinecap="round" />;
  });

  return (
    <div className="relative">
      <svg width={width} height={height} className="pointer-events-none absolute left-4 top-0 lg:left-5" aria-hidden>
        {paths}
        {commits.map((c, r) => {
          const lane = layout.lanes[r];
          const merge = c.parents.length > 1;
          return (
            <circle
              key={c.sha}
              cx={x(lane)}
              cy={y(r)}
              r={merge ? 4 : 5}
              style={{ fill: merge ? "rgb(var(--surface))" : colour(lane), stroke: colour(lane) }}
              strokeWidth={merge ? 2 : 0}
            />
          );
        })}
      </svg>
      <ol>
        {commits.map((c, r) => {
          const refs = [...c.message.matchAll(/\bRB-(\d{1,6})\b/gi)].map((m) => Number(m[1]));
          return (
            <li key={c.sha}>
              <button
                onClick={() => onOpen(c.sha)}
                className="flex w-full items-center gap-3 border-b border-border pr-4 text-left transition-colors hover:bg-hover lg:pr-5"
                style={{ height: ROW, paddingLeft: width + 24 }}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {c.heads.map((h) => (
                    <span
                      key={h}
                      className="mr-2 inline-flex h-5 items-center gap-1 rounded-full border px-2 align-middle font-mono text-2xs font-medium"
                      style={{ borderColor: colour(layout.lanes[r]), color: colour(layout.lanes[r]) }}
                    >
                      <GitBranch className="size-3" />
                      {h}
                    </span>
                  ))}
                  <span className={c.parents.length > 1 ? "text-muted" : ""}>{c.message}</span>
                </span>
                {refs.map((n) => {
                  const card = cardsByNumber.get(n);
                  return card ? (
                    <Link
                      key={n}
                      href={`/board/card/${card.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="hidden max-w-[150px] shrink-0 truncate rounded-sm bg-pill px-1.5 py-0.5 text-2xs text-muted hover:text-ink md:inline"
                      title={card.title}
                    >
                      <span className="font-mono">RB-{n}</span> {card.title}
                    </Link>
                  ) : null;
                })}
                <span className="hidden w-24 shrink-0 truncate text-xs text-faint sm:inline">{c.author}</span>
                <span className="w-16 shrink-0 font-mono text-2xs text-faint">{c.sha.slice(0, 7)}</span>
                <RelativeTime value={c.date} className="w-16 shrink-0 text-right text-xs text-faint" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
