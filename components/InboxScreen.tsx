"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDot, GitMerge, GitPullRequest, Inbox, Sparkles, X } from "lucide-react";
import type { BoardData, BoardSummary, BoardTask } from "@/lib/board-service";
import { api, useResource } from "@/lib/client/api";
import { orderAfterMove, useCommitMove } from "@/lib/client/moves";
import { statusOfColumn } from "@/lib/status";
import { PageHeader } from "@/components/PageHeader";
import { ActorAvatar, ActorName, eventText } from "@/components/Actor";
import { useShell } from "@/components/shell/ShellContext";
import { EmptyState, Logo, RelativeTime, RowSkeleton, useToast } from "@/components/ui";

/** When the person last looked at the Inbox, per project — a convenience kept in this browser. */
export const seenKey = (repo: string | null) => `rb-inbox-seen:${repo ?? ""}`;
const dismissedKey = (repo: string | null) => `rb-inbox-dismissed:${repo ?? ""}`;

/** The first time, "last looked" is three days ago — not the whole history as new. */
function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || Date.now() - 3 * 86_400_000;
  } catch {
    return Date.now() - 3 * 86_400_000;
  }
}

interface Move {
  key: string;
  task: BoardTask;
  board: { info: BoardSummary; data: BoardData };
  toColumnId: string;
  toColumn: string;
  why: string;
  icon: React.ReactNode;
  url: string;
}

/** One suggested move, made through the same path as every other move. */
function MoveRow({ move, onDone, onDismiss }: { move: Move; onDone: () => void; onDismiss: () => void }) {
  const commitMove = useCommitMove(move.board.data);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-muted">{move.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          Move <Link href={`/board/card/${move.task.id}`} className="font-medium hover:underline">
            {move.task.number != null ? `RB-${move.task.number} ` : ""}
            {move.task.title}
          </Link>{" "}
          to {move.toColumn}?
        </p>
        <p className="truncate text-xs text-faint">
          <a href={move.url} target="_blank" rel="noreferrer noopener" className="hover:text-muted">
            {move.why}
          </a>
          {move.board.info.primary ? "" : `, on ${move.board.info.name}`}
        </p>
      </div>
      <button
        className="rb-btn rb-btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await commitMove(move.task.id, move.toColumnId, orderAfterMove(move.board.data, move.task.id, move.toColumnId));
          setBusy(false);
          onDone();
        }}
      >
        Move
      </button>
      <button className="rb-icon-btn size-7" onClick={onDismiss} aria-label="Not now">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The Inbox: what happened while you were away, and what GitHub suggests.
 *
 * - Suggestions: a merged pull request that names a card still open, an open
 *   one that names a card nobody started, an issue that is on no board yet.
 *   Nothing moves by itself — one click, through the usual reviewed path.
 * - Since you last looked: what agents and teammates did, newest first.
 */
export function InboxScreen({ boards }: { boards: { info: BoardSummary; data: BoardData }[] }) {
  const router = useRouter();
  const toast = useToast();
  const { repo, viewer, connected } = useShell();
  const refs = useResource(api.refs, [], { enabled: connected });
  const issues = useResource(api.issues, [], { enabled: connected });
  const activity = useResource(() => api.activity(200), []);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState<number | null>(null);

  // What was new when the page opened stays marked for this visit; the
  // Inbox counts as read from now on.
  useEffect(() => {
    setSeenAt(readNumber(seenKey(repo)));
    try {
      setDismissed(new Set(JSON.parse(localStorage.getItem(dismissedKey(repo)) ?? "[]")));
      localStorage.setItem(seenKey(repo), String(Date.now()));
      window.dispatchEvent(new CustomEvent("rb:inbox-seen"));
    } catch {
      /* private mode: nothing is remembered, everything still shows */
    }
  }, [repo]);

  const dismiss = (key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      try {
        localStorage.setItem(dismissedKey(repo), JSON.stringify([...next].slice(-400)));
      } catch {
        /* not remembered */
      }
      return next;
    });
  };

  const byNumber = useMemo(() => {
    const map = new Map<number, { task: BoardTask; board: { info: BoardSummary; data: BoardData } }>();
    for (const board of boards) for (const task of board.data.tasks) if (task.number != null) map.set(task.number, { task, board });
    return map;
  }, [boards]);

  const moves = useMemo<Move[]>(() => {
    const out: Move[] = [];
    const seen = new Set<string>();
    for (const ref of refs.data?.refs ?? []) {
      if (ref.kind !== "pull") continue;
      const found = byNumber.get(ref.card);
      if (!found) continue;
      const { task, board } = found;
      const status = statusOfColumn(board.data.columns.find((c) => c.id === task.columnId)?.name);
      const column = (want: ReturnType<typeof statusOfColumn>) => board.data.columns.find((c) => statusOfColumn(c.name) === want);
      let target: { id: string; name: string } | undefined;
      let why = "";
      let icon: React.ReactNode = <GitPullRequest className="size-4" />;
      if (ref.state === "merged" && status !== "done" && status !== "cancelled") {
        target = column("done");
        why = `Pull request ${ref.ref} was merged: ${ref.title}`;
        icon = <GitMerge className="size-4 text-state-review" />;
      } else if (ref.state === "open" && status === "todo") {
        target = column("doing");
        why = `Pull request ${ref.ref} is open: ${ref.title}`;
      }
      if (!target || target.id === task.columnId) continue;
      const key = `move:${task.id}:${target.id}:${ref.ref}`;
      if (seen.has(`${task.id}:${target.id}`) || dismissed.has(key)) continue;
      seen.add(`${task.id}:${target.id}`);
      out.push({ key, task, board, toColumnId: target.id, toColumn: target.name, why, icon, url: ref.url });
    }
    return out;
  }, [refs.data, byNumber, dismissed]);

  const linked = useMemo(() => new Set(boards.flatMap((b) => b.data.tasks.flatMap((t) => t.issues))), [boards]);
  const main = boards.find((b) => b.info.primary) ?? boards[0];
  const newIssues = (issues.data?.issues ?? []).filter(
    (i) => i.state === "open" && !linked.has(i.number) && !dismissed.has(`issue:${i.number}`),
  );

  const events = (activity.data?.events ?? []).filter((e) => !viewer || e.actor?.toLowerCase() !== viewer.toLowerCase());
  const fresh = seenAt == null ? [] : events.filter((e) => e.createdAt > seenAt);
  const earlier = seenAt == null ? events.slice(0, 20) : events.filter((e) => e.createdAt <= seenAt).slice(0, 20);
  const nothing = moves.length === 0 && newIssues.length === 0 && fresh.length === 0;

  const importIssue = async (number: number) => {
    if (!main) return;
    const column = main.data.columns[0];
    if (!column) return;
    setImporting(number);
    try {
      await api.importIssues([number], column.id, main.info.id);
      toast.push({ kind: "success", message: `Issue #${number} is on ${main.info.name}`, detail: `In ${column.name}` });
      router.refresh();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not import the issue", detail: (error as Error).message });
    } finally {
      setImporting(null);
    }
  };

  const eventRow = (e: (typeof events)[number], isNew: boolean) => {
    const card = boards.flatMap((b) => b.data.tasks).find((t) => t.id === e.taskId);
    return (
      <li key={e.id} className={`flex items-start gap-3 px-4 py-2.5 ${isNew ? "bg-accent/[0.04]" : ""}`}>
        {/* Events without a person are RepoBoard's own (setting up a board, a sync). */}
        {e.actor ? <ActorAvatar name={e.actor} kind={e.actorKind} size={20} /> : <Logo size={20} />}
        <div className="min-w-0 flex-1 text-sm">
          <p className="text-muted">
            {e.actor && (
              <span className="mr-1.5">
                <ActorName name={e.actor} kind={e.actorKind} />
              </span>
            )}
            {eventText(e.message, e.actor)}
          </p>
          {card && (
            <Link href={`/board/card/${card.id}`} className="mt-0.5 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-faint hover:text-ink">
              {card.number != null && <span className="font-mono">RB-{card.number}</span>} {card.title}
            </Link>
          )}
        </div>
        <RelativeTime value={e.createdAt} className="shrink-0 text-xs text-faint" />
        {isNew && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-label="New" />}
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Inbox" icon={<Inbox className="size-4" />} />
      <div className="rb-under-header rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-6 pb-20 pt-8 sm:px-10">
          {(moves.length > 0 || newIssues.length > 0) && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-ink">From GitHub</h2>
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {moves.map((move) => (
                  <MoveRow key={move.key} move={move} onDone={() => dismiss(move.key)} onDismiss={() => dismiss(move.key)} />
                ))}
                {newIssues.slice(0, 12).map((issue) => (
                  <div key={issue.number} className="flex items-center gap-3 px-4 py-3">
                    <CircleDot className="size-4 text-state-done" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        <span className="font-mono text-xs text-faint">#{issue.number}</span> {issue.title}
                      </p>
                      <p className="truncate text-xs text-faint">Open issue, on no board yet</p>
                    </div>
                    {main && (
                      <button className="rb-btn rb-btn-sm" disabled={importing === issue.number} onClick={() => importIssue(issue.number)}>
                        Add to {main.info.name}
                      </button>
                    )}
                    <button className="rb-icon-btn size-7" onClick={() => dismiss(`issue:${issue.number}`)} aria-label="Not now">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="flex items-baseline gap-2 text-sm font-semibold text-ink">
              Since you last looked
              {fresh.length > 0 && <span className="text-xs font-normal tabular-nums text-accent">{fresh.length} new</span>}
            </h2>
            {activity.loading ? (
              <RowSkeleton rows={4} />
            ) : fresh.length === 0 ? (
              <p className="text-sm text-muted">Nothing new from agents or teammates.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {fresh.map((e) => eventRow(e, true))}
              </ol>
            )}
          </section>

          {earlier.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-muted">Earlier</h2>
              <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {earlier.map((e) => eventRow(e, false))}
              </ol>
            </section>
          )}

          {nothing && !activity.loading && earlier.length === 0 && (
            <EmptyState icon={<Sparkles className="size-6" />} title="All caught up" body="When an agent or a teammate changes something, or GitHub has news for a card, it shows up here." />
          )}
        </div>
      </div>
    </>
  );
}

/** How many things others did since the Inbox was last opened — for the sidebar. */
export function useInboxCount(): number {
  const { repo, viewer, connected } = useShell();
  const activity = useResource(() => api.activity(100), [repo], { enabled: connected, pollMs: 60_000 });
  const [seenAt, setSeenAt] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setSeenAt(readNumber(seenKey(repo)));
    read();
    window.addEventListener("rb:inbox-seen", read);
    return () => window.removeEventListener("rb:inbox-seen", read);
  }, [repo]);
  if (seenAt == null) return 0;
  return (activity.data?.events ?? []).filter(
    (e) => e.createdAt > seenAt && (!viewer || e.actor?.toLowerCase() !== viewer.toLowerCase()),
  ).length;
}
