"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PendingChange } from "@/lib/board-service";

type Resolution = "local" | "remote" | "manual";

/**
 * Every board → GitHub write passes through here. A write is only ever sent
 * after the user has seen the diff, and never at all while the remote SHA is
 * ahead of the copy the edit was based on.
 */
export function MarkdownWriteDialog({
  taskId,
  targetHeading,
  onClose,
}: {
  taskId: string;
  targetHeading: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<PendingChange | null>(null);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/markdown", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "preview", taskId, targetHeading }),
        });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error ?? "Could not build a preview");
        } else {
          setPreview(body as PendingChange);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, targetHeading]);

  const commit = async (force: boolean) => {
    if (!preview) return;
    setCommitting(true);
    setError(null);
    try {
      const response = await fetch("/api/markdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          taskId,
          targetHeading,
          expectedSha: preview.baseSha,
          force,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Commit failed");
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setCommitting(false);
    }
  };

  const acceptRemote = async () => {
    // Discard the local move and let the next sync rebuild cards from GitHub.
    await fetch("/api/markdown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    });
    router.refresh();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-ink">
            Pending changes
          </span>
          <span className="rb-pill">Local → GitHub</span>
          <div className="flex-1" />
          <button className="rb-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && (
          <p className="text-[12px] text-muted">Fetching the file from GitHub…</p>
        )}

        {error && (
          <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
            {error}
          </div>
        )}

        {preview?.conflict && (
          <div className="flex flex-col gap-[7px] rounded-lg border border-warn-border bg-warn-bg p-3">
            <p className="text-[13px] font-semibold text-warn-fg">
              Remote file changed since your last fetch
            </p>
            <p className="text-[12px] text-ink">
              Expected SHA {preview.conflict.expectedSha?.slice(0, 7) ?? "—"} ·
              GitHub now has {preview.conflict.currentSha.slice(0, 7)}.
              RepoBoard will not overwrite it. Review the diff first.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                className={`rb-btn ${resolution === "local" ? "border-ink" : ""}`}
                onClick={() => setResolution("local")}
              >
                Use local
              </button>
              <button
                className={`rb-btn ${resolution === "remote" ? "border-ink" : ""}`}
                onClick={() => setResolution("remote")}
              >
                Use remote
              </button>
              <button
                className={`rb-btn ${resolution === "manual" ? "border-ink" : ""}`}
                onClick={() => setResolution("manual")}
              >
                Merge manually
              </button>
            </div>
          </div>
        )}

        {preview && (
          <>
            <p className="text-[12px] font-medium text-ink">{preview.summary}</p>

            {resolution === "manual" ? (
              <div className="grid flex-1 grid-cols-2 gap-3 overflow-hidden">
                <div className="flex flex-col gap-1 overflow-hidden">
                  <span className="text-[11px] font-medium text-muted">
                    Local (your move)
                  </span>
                  <pre className="flex-1 overflow-auto rounded-md bg-code-bg p-3 text-[11px] leading-relaxed text-code-fg">
                    {preview.after}
                  </pre>
                </div>
                <div className="flex flex-col gap-1 overflow-hidden">
                  <span className="text-[11px] font-medium text-muted">
                    Remote (GitHub)
                  </span>
                  <pre className="flex-1 overflow-auto rounded-md bg-code-bg p-3 text-[11px] leading-relaxed text-code-fg">
                    {preview.conflict?.remoteContent ?? preview.before}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex max-h-[45vh] flex-col gap-[5px] overflow-auto rounded-md bg-pill p-3 text-[12px]">
                {preview.diff.length === 0 && (
                  <span className="text-muted">No textual change</span>
                )}
                {preview.diff.map((line, index) => (
                  <span
                    key={index}
                    className={
                      line.type === "add"
                        ? "text-success-fg"
                        : line.type === "del"
                          ? "text-danger-fg"
                          : "text-muted"
                    }
                  >
                    {line.type === "add"
                      ? "+ "
                      : line.type === "del"
                        ? "- "
                        : "  "}
                    {line.text}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button className="rb-btn" onClick={onClose}>
                Discard
              </button>
              <div className="flex-1" />
              {preview.conflict && resolution === "remote" ? (
                <button
                  className="rb-btn-primary"
                  onClick={acceptRemote}
                  disabled={committing}
                >
                  Take remote & re-sync
                </button>
              ) : (
                <button
                  className="rb-btn-primary"
                  onClick={() => commit(Boolean(preview.conflict))}
                  disabled={
                    committing || (Boolean(preview.conflict) && !resolution)
                  }
                >
                  {committing
                    ? "Committing…"
                    : preview.conflict
                      ? "Commit anyway (use local)"
                      : "Commit change"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
