import type { Status } from "@/lib/status";
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/status";

/**
 * The state icon is the product's one piece of vocabulary: an empty ring is
 * waiting, a filling ring is under way, a solid mark is finished. It is drawn,
 * not fetched from an icon set, so it can carry the fill level.
 */
export function StatusIcon({
  status,
  size = 14,
  className = "",
  title,
}: {
  status: Status;
  size?: number;
  className?: string;
  title?: string;
}) {
  const colour = {
    todo: "text-state-todo",
    doing: "text-state-doing",
    review: "text-state-review",
    done: "text-state-done",
    cancelled: "text-state-cancelled",
  }[status];

  const label = title ?? STATUS_LABEL[status];
  // The fill is a pie drawn as a fat stroke on a small circle.
  const pie = 1.75;
  const pieC = 2 * Math.PI * pie;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={`shrink-0 ${colour} ${className}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {status === "done" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.3 7.2 6.2 9l3.6-3.8" fill="none" stroke="rgb(var(--surface))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === "cancelled" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M5 5l4 4M9 5 5 9" stroke="rgb(var(--surface))" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {status !== "todo" && (
            <circle
              cx="7"
              cy="7"
              r={pie}
              fill="none"
              stroke="currentColor"
              strokeWidth={pie * 2}
              strokeDasharray={`${pieC * (status === "doing" ? 0.5 : 0.75)} ${pieC}`}
              transform="rotate(-90 7 7)"
            />
          )}
        </>
      )}
    </svg>
  );
}

/** Signal-strength bars, with a solid mark for urgent. */
export function PriorityIcon({
  priority,
  size = 14,
  className = "",
}: {
  priority: number;
  size?: number;
  className?: string;
}) {
  const label = PRIORITY_LABEL[priority] ?? PRIORITY_LABEL[0];
  if (priority === 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className={`shrink-0 text-danger ${className}`} role="img" aria-label={label}>
        <title>{label}</title>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4" stroke="rgb(var(--surface))" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.1" r="0.95" fill="rgb(var(--surface))" />
      </svg>
    );
  }
  const filled = priority === 0 ? 0 : 5 - priority; // high 3, medium 2, low 1
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={`shrink-0 text-muted ${className}`} role="img" aria-label={label}>
      <title>{label}</title>
      {priority === 0 ? (
        <g fill="currentColor" opacity="0.7">
          <rect x="1.5" y="6.25" width="2.5" height="1.5" rx="0.6" />
          <rect x="5.75" y="6.25" width="2.5" height="1.5" rx="0.6" />
          <rect x="10" y="6.25" width="2.5" height="1.5" rx="0.6" />
        </g>
      ) : (
        [0, 1, 2].map((i) => (
          <rect
            key={i}
            x={1.5 + i * 4.25}
            y={9 - i * 3}
            width="2.75"
            height={3 + i * 3}
            rx="0.7"
            fill="currentColor"
            opacity={i < filled ? 1 : 0.22}
          />
        ))
      )}
    </svg>
  );
}

export interface ProgressCounts {
  done: number;
  review?: number;
  doing?: number;
  total: number;
}

/**
 * Where a set of items stands, as one strip: done, then in review, then in
 * progress, then the rest. Used for documents, sections, milestones and the
 * whole project, so "how far along are we" always looks the same.
 */
export function ProgressBar({
  counts,
  className = "",
  height = 6,
}: {
  counts: ProgressCounts;
  className?: string;
  height?: number;
}) {
  const { total } = counts;
  const part = (n = 0) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div
      className={`flex w-full overflow-hidden rounded-full bg-ink/[0.07] ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={counts.done}
      aria-label={`${counts.done} of ${total} done`}
    >
      <span className="h-full bg-state-done transition-[width] duration-300" style={{ width: part(counts.done) }} />
      <span className="h-full bg-state-review transition-[width] duration-300" style={{ width: part(counts.review) }} />
      <span className="h-full bg-state-doing transition-[width] duration-300" style={{ width: part(counts.doing) }} />
    </div>
  );
}

export function percent(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** Compact ring for tight spots (card footers, sidebar rows). */
export function ProgressRing({
  done,
  total,
  size = 14,
  className = "",
}: {
  done: number;
  total: number;
  size?: number;
  className?: string;
}) {
  const r = 5;
  const c = 2 * Math.PI * r;
  const ratio = total ? done / total : 0;
  const complete = total > 0 && done === total;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={`shrink-0 ${complete ? "text-state-done" : "text-muted"} ${className}`}
      role="img"
      aria-label={`${done} of ${total} done`}
    >
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.22" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke={complete ? "currentColor" : "rgb(var(--state-done))"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - ratio)}
        transform="rotate(-90 7 7)"
        style={{ transition: "stroke-dashoffset 240ms ease" }}
      />
    </svg>
  );
}

/** The brand mark: a ticked box, because that is the whole job. */
export function Logo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="rgb(var(--ink))" />
      <path d="M7 12.4l3.2 3.1L17 8.6" fill="none" stroke="rgb(var(--state-done))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
