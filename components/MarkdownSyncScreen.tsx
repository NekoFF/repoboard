"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { TopBar } from "@/components/TopBar";
import {
  EmptyState,
  RelativeTime,
  Skeleton,
  Spinner,
  useToast,
} from "@/components/ui";
import { api, useResource } from "@/lib/client/api";

export function MarkdownSyncScreen({
  data,
  header,
  connected,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"sync" | "source" | null>(null);
  const [fileQuery, setFileQuery] = useState("");

  const state = useResource(api.markdownState, [], { enabled: connected });

  const source = state.data?.source ?? null;
  const parsedTasks = state.data?.tasks ?? [];
  const headings = state.data?.headings ?? [];
  const columns = state.data?.columns ?? [];

  const filteredFiles = useMemo(() => {
    const files = state.data?.files ?? [];
    const q = fileQuery.trim().toLowerCase();
    // Roadmap-shaped names first — that is what people are almost always after.
    const ranked = [...files].sort((a, b) => {
      const score = (name: string) =>
        /roadmap|todo|plan|backlog/i.test(name) ? 0 : 1;
      return score(a) - score(b) || a.localeCompare(b);
    });
    return q ? ranked.filter((f) => f.toLowerCase().includes(q)) : ranked;
  }, [state.data?.files, fileQuery]);

  const mapped = useMemo(() => {
    const cardByMarkdownId = new Map(
      data.tasks
        .filter((t) => t.markdownTaskId)
        .map((t) => [t.markdownTaskId!, t]),
    );
    return parsedTasks.map((task) => ({
      ...task,
      card: task.id ? cardByMarkdownId.get(task.id) : undefined,
      columnKnown: columns.includes(task.heading),
    }));
  }, [parsedTasks, data.tasks, columns]);

  const withoutId = mapped.filter((t) => !t.id).length;
  const unknownHeadings = headings.filter(
    (h) => !columns.includes(h) && mapped.some((t) => t.heading === h),
  );

  const setSource = async (path: string) => {
    if (!path) return;
    setBusy("source");
    try {
      await api.markdownAction({ action: "set-source", path });
      toast.push({ kind: "success", message: `Source set to ${path}` });
      state.reload();
      router.refresh();
    } catch (error) {
      toast.push({
        kind: "error",
        message: "Could not set the source",
        detail: (error as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      const result = await api.markdownAction<{
        created: number;
        updated: number;
        idsAssigned: number;
        committedIds: boolean;
        path: string;
      }>({ action: "sync" });
      toast.push({
        kind: "success",
        message: `Synced ${result.path}`,
        detail:
          `${result.created} created · ${result.updated} updated` +
          (result.committedIds
            ? ` · ${result.idsAssigned} id(s) committed back to GitHub`
            : ""),
      });
      state.reload();
      router.refresh();
    } catch (error) {
      toast.push({
        kind: "error",
        message: "Sync failed",
        detail: (error as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSyncAt={header.lastSyncAt}
        connected={connected}
        actions={
          <button
            className="rb-btn-primary"
            onClick={sync}
            disabled={!source || busy !== null}
          >
            {busy === "sync" ? <Spinner /> : null}
            {busy === "sync" ? "Syncing" : "Sync now"}
          </button>
        }
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-ink">
              Markdown sync
            </h1>
            <p className="text-[12px] text-muted">
              A file in the repository is the roadmap; the board is a view of it.
              Every write back is previewed first.
            </p>
          </div>
        </div>

        {!connected && (
          <EmptyState
            icon="⌘"
            title="Not connected"
            body="Add a token in Settings to pick a markdown file."
          />
        )}

        {connected && state.error && (
          <div className="flex items-center gap-2 rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
            {state.error}
            <button className="rb-btn-ghost ml-auto" onClick={state.reload}>
              Retry
            </button>
          </div>
        )}

        {connected && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-ink">Source</span>
              <select
                className="rb-input w-[240px] py-1.5 text-[12px]"
                value={source?.path ?? ""}
                disabled={busy !== null || state.loading}
                onChange={(event) => setSource(event.target.value)}
              >
                <option value="">
                  {state.loading ? "Loading files…" : "Pick a markdown file…"}
                </option>
                {filteredFiles.map((file) => (
                  <option key={file} value={file}>
                    {file}
                  </option>
                ))}
              </select>
              {(state.data?.files.length ?? 0) > 12 && (
                <input
                  className="rb-input w-[140px] py-1.5 text-[12px]"
                  placeholder="filter files"
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.target.value)}
                />
              )}
            </div>

            <span className="text-[11.5px] text-muted">
              base SHA{" "}
              <code className="font-mono text-ink">
                {source?.lastKnownSha?.slice(0, 7) ?? "not synced yet"}
              </code>
              {state.data?.current && (
                <>
                  {" · remote "}
                  <code className="font-mono text-ink">
                    {state.data.current.sha.slice(0, 7)}
                  </code>
                </>
              )}
            </span>

            <div className="flex-1" />

            {state.data?.remoteDrift ? (
              <span className="rb-pill-warn">Remote moved ahead</span>
            ) : source?.lastKnownSha ? (
              <span className="rb-pill-ok">In sync</span>
            ) : (
              <span className="rb-pill">Never synced</span>
            )}
            <span className="text-[11px] text-muted">
              checked <RelativeTime value={state.updatedAt} />
            </span>
          </div>
        )}

        {connected && !source && !state.loading && (
          <EmptyState
            icon="M"
            title="No markdown source selected"
            body="Pick any .md file in the repository. Headings become columns, checkboxes become card state, and RepoBoard adds an invisible id to each task so cards survive edits."
          />
        )}

        {connected && source && (
          <>
            {unknownHeadings.length > 0 && (
              <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
                Tasks live under {unknownHeadings.map((h) => `“${h}”`).join(", ")},
                which {unknownHeadings.length === 1 ? "does" : "do"} not match a
                board column. Those tasks are ignored until a column with the
                same name exists.
              </div>
            )}

            <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-3">
              <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-[14px]">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-ink">
                    {source.path}
                  </h2>
                  <span className="rb-pill">{parsedTasks.length} tasks</span>
                </div>
                {state.loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <pre className="max-h-[420px] overflow-auto rounded-md bg-code-bg p-3 font-mono text-[11.5px] leading-relaxed text-code-fg">
                    {state.data?.current?.content ?? "—"}
                  </pre>
                )}
              </section>

              <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-[14px]">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-ink">
                    Parsed tasks
                  </h2>
                  {withoutId > 0 && (
                    <span className="rb-pill-warn">{withoutId} without id</span>
                  )}
                </div>

                {state.loading && <Skeleton className="h-40 w-full" />}

                {!state.loading && mapped.length === 0 && (
                  <p className="py-2 text-[12px] text-muted">
                    The parser found no checkbox tasks in this file.
                  </p>
                )}

                <div className="flex max-h-[420px] flex-col gap-1 overflow-auto">
                  {columns.map((column) => {
                    const items = mapped.filter((t) => t.heading === column);
                    if (items.length === 0) return null;
                    return (
                      <div key={column} className="flex flex-col gap-1 py-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                          {column} · {items.length}
                        </p>
                        {items.map((task, index) => (
                          <div
                            key={`${task.id ?? task.title}-${index}`}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-pill"
                          >
                            <span
                              className={`text-[11px] ${
                                task.done ? "text-success-fg" : "text-muted"
                              }`}
                            >
                              {task.done ? "[x]" : "[ ]"}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                              {task.title}
                            </span>
                            {task.card ? (
                              <button
                                className="rb-pill hover:bg-ink hover:text-white"
                                onClick={() =>
                                  router.push(`/board?card=${task.card!.id}`)
                                }
                              >
                                on board
                              </button>
                            ) : task.id ? (
                              <span className="rb-pill">not imported</span>
                            ) : (
                              <span
                                className="rb-pill-warn"
                                title="Gets an id on the next sync"
                              >
                                no id
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-[14px]">
                <h2 className="text-[13px] font-semibold text-ink">
                  How this file maps
                </h2>

                <div className="flex flex-col gap-1.5">
                  {columns.map((column) => {
                    const count = mapped.filter(
                      (t) => t.heading === column,
                    ).length;
                    const present = headings.includes(column);
                    return (
                      <div
                        key={column}
                        className="flex items-center gap-2 rounded-md bg-pill px-2.5 py-2"
                      >
                        <span className="font-mono text-[11px] text-muted">
                          ## {column}
                        </span>
                        <span className="text-[12px] text-muted">→</span>
                        <span className="flex-1 text-[12px] font-medium text-ink">
                          {column}
                        </span>
                        <span
                          className={present ? "rb-pill" : "rb-pill-warn"}
                          title={
                            present
                              ? `${count} task(s) under this heading`
                              : "Heading missing from the file"
                          }
                        >
                          {present ? count : "missing"}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 rounded-md bg-pill px-2.5 py-2">
                    <span className="font-mono text-[11px] text-muted">
                      - [x]
                    </span>
                    <span className="text-[12px] text-muted">→</span>
                    <span className="flex-1 text-[12px] font-medium text-ink">
                      Card completed
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-md bg-pill px-2.5 py-2">
                    <span className="font-mono text-[11px] text-muted">
                      &lt;!-- rb:task_… --&gt;
                    </span>
                    <span className="text-[12px] text-muted">→</span>
                    <span className="flex-1 text-[12px] font-medium text-ink">
                      Stable card identity
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-[12px] font-medium text-ink">
                    Writing back
                  </p>
                  <p className="text-[11.5px] leading-relaxed text-muted">
                    Drag a card between columns on the board. RepoBoard re-fetches
                    this file, checks its SHA against{" "}
                    <code className="font-mono">
                      {source.lastKnownSha?.slice(0, 7) ?? "—"}
                    </code>
                    , shows the diff, and only then commits. If the remote moved,
                    it refuses and offers local / remote / compare.
                  </p>
                  <button
                    className="rb-btn w-fit"
                    onClick={() => router.push("/board")}
                  >
                    Go to board
                  </button>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
