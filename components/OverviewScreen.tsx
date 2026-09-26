"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCheck,
  CircleDot,
  ExternalLink,
  Flag,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
} from "lucide-react";
import type { BoardData, BoardSummary, RepoHeader } from "@/lib/board-service";
import { boardHref } from "@/components/labelColor";
import type { TrackedDoc } from "@/lib/docs-service";
import type { DocEdit } from "@/lib/markdown/document";
import { api, useResource } from "@/lib/client/api";
import { useShell } from "@/components/shell/ShellContext";
import { ProjectMark } from "@/components/shell/ProjectSwitcher";
import { DocWriteDialog } from "@/components/DocWriteDialog";
import { ProjectStory } from "@/components/ProjectStory";
import { ProofDialog, type ProofAttachment } from "@/components/docs/ProofDialog";
import { ActorAvatar, ActorName, eventText } from "@/components/Actor";
import { milestoneProgress } from "@/components/MilestonesDialog";
import {
  DueLabel,
  EmptyState,
  PriorityIcon,
  ProgressBar,
  RelativeTime,
  RowSkeleton,
  StatusIcon,
  Tooltip,
  daysUntil,
  percent,
} from "@/components/ui";
import { statusOfColumn, type Status } from "@/lib/status";

interface MapCell {
  key: string;
  title: string;
  status: Status;
  href: string;
}

interface MapGroup {
  key: string;
  label: string;
  href: string;
  cells: MapCell[];
}

const CELL_COLOUR: Record<Status, string> = {
  done: "bg-state-done",
  review: "bg-state-review",
  doing: "bg-state-doing",
  todo: "bg-ink/[0.09]",
  cancelled: "bg-transparent ring-1 ring-inset ring-ink/10",
};

function Section({
  title,
  icon,
  href,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  href?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rb-card flex min-w-0 flex-col gap-3 p-5">
      <div className="flex h-7 items-center gap-2">
        <span className="text-muted">{icon}</span>
        <h2 className="text-md font-semibold text-ink">{title}</h2>
        <div className="flex-1" />
        {action}
        {href && (
          <Link href={href} className="rb-btn-ghost">
            View all <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function docHref(path: string, line?: number) {
  return `/docs?path=${encodeURIComponent(path)}${line != null ? `#line-${line}` : ""}`;
}

export function OverviewScreen({
  data,
  header,
  docs,
  boards,
  connected,
}: {
  data: BoardData;
  header: RepoHeader;
  docs: TrackedDoc[];
  /** Every board with its cards, primary first. */
  boards: { info: BoardSummary; data: BoardData }[];
  connected: boolean;
}) {
  const router = useRouter();
  const { repo } = useShell();
  const [verify, setVerify] = useState<{ path: string; edits: DocEdit[]; sha: string | null; attachments: ProofAttachment[] } | null>(null);
  // "I checked it" asks for proof first (optional), then shows the change.
  const [checking, setChecking] = useState<{ doc: TrackedDoc; item: TrackedDoc["items"][number] } | null>(null);

  const commits = useResource(() => api.commits(), [], { enabled: connected });
  const pulls = useResource(api.pulls, [], { enabled: connected });
  const issues = useResource(api.issues, [], { enabled: connected });
  const activity = useResource(() => api.activity(14), []);

  // Refresh the document snapshots quietly, then re-render with fresh numbers.
  useEffect(() => {
    if (!connected) return;
    api
      .syncWorkspace()
      .then(() => api.refreshDocs())
      .then((r) => r.refreshed > 0 && router.refresh())
      .catch(() => null);
  }, [connected, router]);

  // Every board of the project, each card with its board and state.
  const cards = useMemo(
    () =>
      boards.flatMap(({ info, data: b }) => {
        const status = new Map(b.columns.map((c) => [c.id, statusOfColumn(c.name)]));
        const order = new Map(b.columns.map((c, i) => [c.id, i]));
        return [...b.tasks]
          .sort((x, y) => (order.get(x.columnId) ?? 0) - (order.get(y.columnId) ?? 0) || x.position - y.position)
          .map((task) => ({ task, board: info, status: status.get(task.columnId) ?? ("todo" as Status) }));
      }),
    [boards],
  );
  const checklists = docs.filter((d) => d.total > 0 && d.role !== "board");
  // Milestones of every board, soonest first.
  const allMilestones = useMemo(
    () =>
      boards
        .flatMap(({ info, data: board }) => board.milestones.map((m) => ({ m, info, board })))
        .sort((a, b) => (a.m.dueDate ?? Infinity) - (b.m.dueDate ?? Infinity)),
    [boards],
  );

  const groups = useMemo<MapGroup[]>(() => {
    const fromBoards: MapGroup[] = boards.map(({ info }) => ({
      key: info.id,
      label: info.name,
      href: boardHref(info),
      cells: cards
        .filter((c) => c.board.id === info.id)
        .map(({ task, status }) => ({
          key: task.id,
          title: `${task.number != null ? `RB-${task.number} ` : ""}${task.title}`,
          status,
          href: `/board/card/${task.id}`,
        })),
    }));
    const fromDocs = checklists.map((doc) => ({
      key: doc.id,
      label: doc.title,
      href: docHref(doc.path),
      cells: doc.items.map((item, i) => ({
        key: `${doc.id}-${i}`,
        title: item.title,
        status: (item.state ?? (item.done ? "done" : "todo")) as Status,
        href: docHref(doc.path, item.line),
      })),
    }));
    return [...fromBoards, ...fromDocs].filter((g) => g.cells.length > 0);
  }, [boards, cards, checklists]);

  const all = groups.flatMap((g) => g.cells).filter((c) => c.status !== "cancelled");
  const count = (s: Status) => all.filter((c) => c.status === s).length;
  const totals = { total: all.length, done: count("done"), review: count("review"), doing: count("doing") };

  // Things waiting for a person: checklist items marked [?] and cards in review.
  const toCheck = useMemo(() => {
    const items = checklists.flatMap((doc) =>
      doc.items
        .filter((i) => i.state === "review")
        .map((i) => ({ kind: "doc" as const, doc, item: i })),
    );
    const inReview = cards
      .filter((c) => c.status === "review")
      .map((c) => ({ kind: "card" as const, task: c.task, board: c.board }));
    return [...items, ...inReview];
  }, [checklists, cards]);

  const upcoming = useMemo(() => {
    const dueCards = cards
      .filter((c) => c.task.dueDate != null && c.status !== "done")
      .map(({ task: t, board, status }) => ({ key: t.id, title: t.title, due: t.dueDate!, href: `/board/card/${t.id}`, source: board.name, priority: t.priority, status }));
    const items = checklists.flatMap((doc) =>
      doc.items
        .filter((i) => i.due && i.state !== "done" && i.state !== "cancelled")
        .map((i) => ({
          key: `${doc.id}-${i.line}`,
          title: i.title,
          due: Date.parse(`${i.due}T00:00:00Z`),
          href: docHref(doc.path, i.line),
          source: doc.title,
          priority: i.priority ?? 0,
          status: (i.state ?? "todo") as Status,
        })),
    );
    return [...dueCards, ...items].filter((u) => daysUntil(u.due) <= 14).sort((a, b) => a.due - b.due).slice(0, 8);
  }, [cards, checklists]);

  const openPulls = (pulls.data?.pulls ?? []).filter((p) => p.state === "open");
  const openIssues = (issues.data?.issues ?? []).filter((i) => i.state === "open");
  const [owner, name] = (repo ?? `${header.owner ?? ""}/${header.name ?? ""}`).split("/");

  return (
    <div className="rb-overview rb-scroll-thin rb-clear-rail min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-5 pb-20 pt-8 sm:px-8">
        {/* ----------------------------------------------------- header -- */}
        <header className="flex flex-wrap items-center gap-4 px-1 pb-2">
          <ProjectMark repo={repo} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] text-ink">{name || "Your project"}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
              <span>{owner}</span>
              {header.defaultBranch && <span className="font-mono text-xs">{header.defaultBranch}</span>}
              {header.lastSyncAt && (
                <span>
                  Synced <RelativeTime value={header.lastSyncAt} />
                </span>
              )}
            </p>
          </div>
          {repo && (
            <a className="rb-btn rb-glass" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer noopener">
              GitHub <ExternalLink className="size-3.5" />
            </a>
          )}
        </header>

        <ProjectStory repo={repo} connected={connected} card />

        {/* ------------------------------------------------------- hero -- */}
        {totals.total === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-7" />}
            title="Nothing tracked yet"
            body="Add cards to the board, or create checklists for the things that must not be forgotten — a release, the privacy policy, licences."
            action={
              <>
                <Link className="rb-btn-primary" href="/docs">
                  Set up checklists
                </Link>
                <Link className="rb-btn" href="/board?new=1">
                  New card
                </Link>
              </>
            }
          />
        ) : (
          <section className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
            <div className="rb-card flex flex-col gap-3 p-6">
              <p className="text-[64px] font-semibold leading-none tracking-[-0.04em] text-ink tabular-nums">
                {percent(totals.done, totals.total)}
                <span className="text-[32px] text-faint">%</span>
              </p>
              <p className="text-md text-muted">
                {totals.done} of {totals.total} things done, across {boards.length} board{boards.length === 1 ? "" : "s"} and{" "}
                {checklists.length} checklist{checklists.length === 1 ? "" : "s"}.
              </p>
              <ProgressBar counts={totals} height={8} className="mt-1" />
              <div className="mt-1 flex flex-col gap-1.5 text-sm">
                {(
                  [
                    ["review", "need your check"],
                    ["doing", "in progress"],
                    ["todo", "to do"],
                  ] as const
                ).map(([s, label]) =>
                  count(s) ? (
                    <span key={s} className="flex items-center gap-2 text-muted">
                      <StatusIcon status={s} size={13} />
                      <span className="tabular-nums text-ink">{count(s)}</span> {label}
                    </span>
                  ) : null,
                )}
              </div>
            </div>

            {/* The item map: one square per thing, so nothing hides in a total. */}
            <div className="rb-card flex flex-col gap-4 p-6">
              {groups.map((group) => {
                const open = group.cells.filter((c) => c.status !== "cancelled");
                const done = open.filter((c) => c.status === "done").length;
                return (
                  <div key={group.key} className="flex flex-col gap-1.5">
                    <Link href={group.href} className="group flex items-baseline gap-2 text-xs">
                      <span className="font-medium text-ink group-hover:underline">{group.label}</span>
                      <span className="tabular-nums text-faint">
                        {done}/{open.length}
                      </span>
                    </Link>
                    <div className="flex flex-wrap gap-[3px]">
                      {group.cells.map((cell) => (
                        <Tooltip key={cell.key} content={cell.title}>
                          <Link
                            href={cell.href}
                            aria-label={cell.title}
                            className={`size-3.5 rounded-[3px] transition-transform duration-100 hover:scale-125 ${CELL_COLOUR[cell.status]}`}
                          />
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ------------------------------------------- needs your check -- */}
        {toCheck.length > 0 && (
          <Section title="Needs your check" icon={<CheckCheck className="size-4" />}>
            <div className="-mx-1 flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-surface/70 ring-1 ring-state-review/25">
              {toCheck.map((entry) =>
                entry.kind === "doc" ? (
                  <div key={`${entry.doc.id}-${entry.item.line}`} className="flex items-center gap-3 px-4 py-3">
                    <StatusIcon status="review" size={16} />
                    <Link href={docHref(entry.doc.path, entry.item.line)} className="min-w-0 flex-1">
                      <p className="truncate text-base text-ink">{entry.item.title}</p>
                      <p className="truncate text-xs text-faint">{entry.doc.title}</p>
                    </Link>
                    <button
                      className="rb-btn rb-btn-sm"
                      onClick={() => setChecking({ doc: entry.doc, item: entry.item })}
                    >
                      <CheckCheck className="size-3.5" /> I checked it
                    </button>
                  </div>
                ) : (
                  <Link key={entry.task.id} href={`/board/card/${entry.task.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                    <StatusIcon status="review" size={16} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base text-ink">{entry.task.title}</p>
                      <p className="text-xs text-faint">
                        {entry.board.name}
                        {entry.task.number != null ? `, RB-${entry.task.number}` : ""}
                      </p>
                    </div>
                    <ArrowUpRight className="size-4 text-faint" />
                  </Link>
                ),
              )}
            </div>
          </Section>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ---------------------------------------------- coming up -- */}
          <Section title="Coming up" icon={<CalendarClock className="size-4" />}>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">Nothing is due in the next two weeks.</p>
            ) : (
              <div className="flex flex-col">
                {upcoming.map((u) => (
                  <Link key={u.key} href={u.href} className="-mx-2 flex h-10 items-center gap-3 rounded-md px-2 hover:bg-hover">
                    <StatusIcon status={u.status} />
                    {u.priority > 0 && <PriorityIcon priority={u.priority} />}
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.title}</span>
                    <span className="hidden max-w-[140px] truncate text-xs text-faint sm:inline">{u.source}</span>
                    <DueLabel value={u.due} className="w-16 shrink-0 text-right text-xs font-medium" />
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* --------------------------------------------- checklists -- */}
          <Section title="Checklists" icon={<ListChecks className="size-4" />} href="/docs">
            {checklists.length === 0 ? (
              <p className="text-sm text-muted">
                No checklists yet. <Link href="/docs" className="text-ink underline decoration-ink/30 underline-offset-2">Create the first ones</Link> — a release, the privacy policy, licences.
              </p>
            ) : (
              <div className="flex flex-col">
                {checklists.map((doc) => (
                  <Link key={doc.id} href={docHref(doc.path)} className="-mx-2 flex h-11 items-center gap-4 rounded-md px-2 hover:bg-hover">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{doc.title}</span>
                    {doc.review > 0 && <span className="whitespace-nowrap text-2xs font-medium text-state-review">{doc.review} to check</span>}
                    <span className="w-28 shrink-0">
                      <ProgressBar counts={{ done: doc.done, review: doc.review, doing: doc.doing, total: doc.total }} height={5} />
                    </span>
                    <span className="w-9 text-right text-xs tabular-nums text-muted">{percent(doc.done, doc.total)}%</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* --------------------------------------------- milestones -- */}
          {allMilestones.length > 0 && (
            <Section title="Milestones" icon={<Flag className="size-4" />}>
              <div className="flex flex-col gap-4">
                {allMilestones.map(({ m, info, board }) => {
                  const p = milestoneProgress(board, m.id);
                  return (
                    <Link key={m.id} href={`${boardHref(info)}?q=${encodeURIComponent(`milestone:"${m.name}"`)}`} className="-mx-2 flex flex-col gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                      <span className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                          {m.name}
                          {boards.length > 1 && <span className="ml-2 text-xs font-normal text-faint">{info.name}</span>}
                        </span>
                        <span className="text-xs tabular-nums text-muted">
                          {p.done}/{p.total}
                        </span>
                        {m.dueDate && <DueLabel value={m.dueDate} className="text-xs" />}
                      </span>
                      <ProgressBar counts={p} height={5} />
                    </Link>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ----------------------------------------------- activity -- */}
          <Section title="Recently" icon={<CircleDot className="size-4" />} href="/activity">
            {activity.loading ? (
              <RowSkeleton rows={4} />
            ) : (
              <ol className="flex flex-col">
                {(activity.data?.events ?? []).slice(0, 7).map((e) => (
                  <li key={e.id} className="flex items-center gap-2.5 py-1.5 text-sm">
                    {e.actor && <ActorAvatar name={e.actor} kind={e.actorKind} size={18} />}
                    <span className="min-w-0 flex-1 truncate text-muted">
                      {e.actor && (
                        <span className="mr-1.5">
                          <ActorName name={e.actor} kind={e.actorKind} />
                        </span>
                      )}
                      {eventText(e.message, e.actor)}
                    </span>
                    <RelativeTime value={e.createdAt} className="shrink-0 text-xs text-faint" />
                  </li>
                ))}
                {activity.data?.events.length === 0 && <li className="text-sm text-muted">No activity yet.</li>}
              </ol>
            )}
          </Section>

          {/* ------------------------------------------------- github -- */}
          <Section title="On GitHub" icon={<GitPullRequest className="size-4" />} href="/repository">
            <div className="flex flex-col gap-1">
              <p className="pb-1 text-sm text-muted">
                {pulls.loading ? "…" : openPulls.length} open pull request{openPulls.length === 1 ? "" : "s"},{" "}
                {issues.loading ? "…" : openIssues.length} open issue{openIssues.length === 1 ? "" : "s"}
              </p>
              {openPulls.slice(0, 3).map((pr) => (
                <Link key={pr.number} href={`/repository?tab=pulls`} className="-mx-2 flex h-9 items-center gap-2.5 rounded-md px-2 hover:bg-hover">
                  <GitPullRequest className={`size-3.5 ${pr.draft ? "text-faint" : "text-state-done"}`} />
                  <span className="font-mono text-xs text-faint">#{pr.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{pr.title}</span>
                  {pr.checks && (
                    <span className={`text-2xs tabular-nums ${pr.checks.passed === pr.checks.total ? "text-state-done" : "text-state-doing"}`}>
                      {pr.checks.passed}/{pr.checks.total}
                    </span>
                  )}
                </Link>
              ))}
              {(commits.data?.commits ?? []).slice(0, 4).map((c) => (
                <div key={c.sha} className="-mx-2 flex h-9 items-center gap-2.5 px-2">
                  <GitCommitHorizontal className="size-3.5 text-faint" />
                  <span className="font-mono text-xs text-faint">{c.sha.slice(0, 7)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{c.message}</span>
                  <RelativeTime value={c.date} className="shrink-0 text-xs text-faint" />
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      {checking && (
        <ProofDialog
          docPath={checking.doc.path}
          item={{
            line: checking.item.line,
            text: checking.item.text ?? checking.item.title,
            title: checking.item.title,
            id: null,
          }}
          onClose={() => setChecking(null)}
          onDone={(draft) => {
            setVerify({ path: checking.doc.path, sha: checking.doc.sha, edits: [draft.edit], attachments: draft.attachments });
            setChecking(null);
          }}
        />
      )}

      {verify && (
        <DocWriteDialog
          path={verify.path}
          edits={verify.edits}
          baseSha={verify.sha}
          attachments={verify.attachments}
          onClose={() => setVerify(null)}
          onDone={() => {
            setVerify(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
