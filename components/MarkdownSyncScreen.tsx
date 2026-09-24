"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { TopBar } from "@/components/TopBar";

interface MarkdownState {
  source: BoardData["markdownSource"];
  files: string[];
  current: { content: string; sha: string } | null;
  remoteDrift: boolean;
  columns: string[];
}

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
  const [state, setState] = useState<MarkdownState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/markdown", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "Could not load markdown state");
      else setState(body as MarkdownState);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) load();
    else setLoading(false);
  }, [connected, load]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/markdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Request failed");
        return null;
      }
      return body;
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (path: string) => {
    if (!path) return;
    await post({ action: "set-source", path });
    await load();
    router.refresh();
  };

  const syncNow = async () => {
    const result = await post({ action: "sync" });
    if (result) {
      setMessage(
        `Synced ${result.path}: ${result.created} card(s) created, ${result.updated} updated` +
          (result.idsAssigned
            ? `, ${result.idsAssigned} task id(s) written back to GitHub`
            : ""),
      );
      await load();
      router.refresh();
    }
  };

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSync={null}
        connected={connected}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
        <div className="flex w-full items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-[24px] font-semibold text-ink">Markdown Sync</h1>
            <p className="text-[12px] text-muted">
              {state?.source?.path ?? "ROADMAP.md"} ↔ board cards. Preview every
              GitHub write before committing.
            </p>
          </div>
          <span className="rb-pill">
            Auto sync: {state?.source?.autoSync ? "On" : "Off"}
          </span>
        </div>

        {!connected && (
          <div className="rb-card p-4 text-[12px] text-muted">
            Connect a repository in Settings first.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-lg border border-border bg-success-bg p-3 text-[12px] text-success-fg">
            {message}
          </div>
        )}

        {connected && (
          <div className="flex w-full flex-wrap items-center gap-[10px] rounded-lg border border-border bg-surface p-3">
            <select
              className="rb-input max-w-[280px]"
              value={state?.source?.path ?? ""}
              onChange={(event) => chooseFile(event.target.value)}
              disabled={busy || loading}
            >
              <option value="">Pick a markdown file…</option>
              {(state?.files ?? []).map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>

            <span className="text-[12px] text-muted">
              Last fetched SHA{" "}
              {state?.source?.lastKnownSha?.slice(0, 7) ?? "— none yet"}
            </span>

            <div className="flex-1" />

            {state?.remoteDrift ? (
              <span className="inline-flex items-center rounded-sm bg-warn-bg px-2 py-1 text-[11px] font-medium text-warn-fg">
                Remote moved ahead
              </span>
            ) : (
              <span className="inline-flex items-center rounded-sm bg-success-bg px-2 py-1 text-[11px] font-medium text-success-fg">
                No conflicts
              </span>
            )}

            <button
              className="rb-btn-primary"
              onClick={syncNow}
              disabled={busy || !state?.source}
            >
              {busy ? "Working…" : "Sync now"}
            </button>
          </div>
        )}

        {connected && (
          <div className="flex min-h-0 w-full flex-1 gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-xl border border-border p-[14px]">
              <span className="text-[14px] font-semibold text-ink">
                {state?.source?.path ?? "No file selected"}
              </span>
              <span className="rb-pill w-fit">GitHub → parser → cards</span>
              <pre className="max-h-[420px] flex-1 overflow-auto rounded-md bg-code-bg p-3 text-[12px] leading-relaxed text-code-fg">
                {state?.current?.content ?? "—"}
              </pre>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-xl border border-border p-[14px]">
              <span className="text-[14px] font-semibold text-ink">Mappings</span>
              {(state?.columns ?? []).map((column) => (
                <div
                  key={column}
                  className="flex items-center gap-2 rounded-md bg-pill p-[10px]"
                >
                  <span className="rb-pill">{column}</span>
                  <span className="text-[12px] font-medium text-muted">→</span>
                  <span className="text-[12px] font-medium text-ink">
                    Column: {column}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-md bg-pill p-[10px]">
                <span className="rb-pill">[x] checkbox</span>
                <span className="text-[12px] font-medium text-muted">→</span>
                <span className="text-[12px] font-medium text-ink">
                  Card completed
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-md bg-pill p-[10px]">
                <span className="rb-pill">&lt;!-- rb:task_x --&gt;</span>
                <span className="text-[12px] font-medium text-muted">→</span>
                <span className="text-[12px] font-medium text-ink">
                  Stable card identity
                </span>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-xl border border-border p-[14px]">
              <span className="text-[14px] font-semibold text-ink">
                Pending changes
              </span>
              <span className="rb-pill w-fit">Local → GitHub</span>
              <p className="text-[12px] text-muted">
                Nothing queued. Drag a card between columns on the board — the
                diff preview opens before anything is written to GitHub.
              </p>
            </div>
          </div>
        )}

        {state?.remoteDrift && (
          <div className="flex w-full flex-col gap-[7px] rounded-lg border border-warn-border bg-warn-bg p-3">
            <p className="text-[13px] font-semibold text-warn-fg">
              Remote file changed since your last fetch
            </p>
            <p className="text-[12px] text-ink">
              Expected SHA {state.source?.lastKnownSha?.slice(0, 7) ?? "—"} ·
              GitHub now has {state.current?.sha.slice(0, 7)}. RepoBoard will not
              overwrite it. Run Sync now to pull the remote version first.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
