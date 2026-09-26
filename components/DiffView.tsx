import type { DiffLine } from "@/lib/markdown/sync";

export function diffStats(diff: DiffLine[]) {
  return {
    additions: diff.filter((d) => d.type === "add").length,
    deletions: diff.filter((d) => d.type === "del").length,
  };
}

export function DiffStat({ diff }: { diff: DiffLine[] }) {
  const { additions, deletions } = diffStats(diff);
  return (
    <span className="font-mono text-xs tabular-nums">
      <span className="text-state-done">+{additions}</span> <span className="text-danger">−{deletions}</span>
    </span>
  );
}

/** A unified diff, the way GitHub shows it: green in, red out, context grey. */
export function DiffView({ diff, maxHeight = "45vh" }: { diff: DiffLine[]; maxHeight?: string }) {
  if (diff.length === 0) {
    return <p className="rounded-lg border border-border p-3 text-sm text-muted">No change to the file.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-code-bg">
      <div className="overflow-auto font-mono text-xs leading-[1.7]" style={{ maxHeight }}>
        {diff.map((line, index) => (
          <div
            key={index}
            className={`flex gap-3 px-3 ${
              line.type === "add"
                ? "bg-state-done/10 text-ink"
                : line.type === "del"
                  ? "bg-danger/10 text-muted line-through decoration-danger/40"
                  : "text-faint"
            }`}
          >
            <span
              className={`w-3 shrink-0 select-none text-center ${
                line.type === "add" ? "text-state-done" : line.type === "del" ? "text-danger" : ""
              }`}
            >
              {line.type === "add" ? "+" : line.type === "del" ? "−" : ""}
            </span>
            <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
