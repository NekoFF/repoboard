"use client";

import { useEffect, useState } from "react";
import type { PendingChange } from "@/lib/board-service";
import { api, ApiError } from "@/lib/client/api";
import { Modal, Skeleton, Spinner, useToast } from "@/components/ui";

type Resolution = "local" | "remote" | "manual";

/**
 * The only door between the board and a GitHub write. It always shows the diff
 * first, and when the remote SHA has moved it refuses to write until the user
 * picks a resolution.
 */
export function MarkdownWriteDialog({
  taskId,
  targetHeading,
  onDiscard,
  onDone,
}: {
  taskId: string;
  targetHeading: string;
  onDiscard: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<PendingChange | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .preview(taskId, targetHeading)
      .then((value) => !cancelled && setPreview(value))
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [taskId, targetHeading]);

  const commit = async (force: boolean) => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await api.markdownAction({
        action: "commit",
        taskId,
        targetHeading,
        expectedSha: preview.baseSha,
        force,
      });
      toast.push({
        kind: "success",
        message: "Committed to GitHub",
        detail: preview.summary,
      });
      onDone();
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message);
      if (apiError.conflict) {
        // Somebody wrote between preview and commit: re-fetch so the diff on
        // screen describes the file as it is now, not as it was.
        const fresh = await api.preview(taskId, targetHeading).catch(() => null);
        if (fresh) setPreview(fresh);
      }
    } finally {
      setBusy(false);
    }
  };

  const takeRemote = async () => {
    setBusy(true);
    try {
      await api.markdownAction({ action: "sync" });
      toast.push({
        kind: "info",
        message: "Took the remote version",
        detail: "The board was rebuilt from the file on GitHub.",
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stats = preview
    ? {
        additions: preview.diff.filter((d) => d.type === "add").length,
        deletions: preview.diff.filter((d) => d.type === "del").length,
      }
    : null;

  return (
    <Modal
      wide
      onClose={onDiscard}
      title={
        <div className="flex items-center gap-2">
          <span>Review GitHub write</span>
          <span className="rb-pill">Local → GitHub</span>
          {stats && (
            <span className="text-[11px] font-normal">
              <span className="text-success-fg">+{stats.additions}</span>{" "}
              <span className="text-danger-fg">−{stats.deletions}</span>
            </span>
          )}
        </div>
      }
      footer={
        <>
          <button className="rb-btn" onClick={onDiscard} disabled={busy}>
            Discard move
          </button>
          <div className="flex-1" />
          {preview?.conflict && resolution === "remote" ? (
            <button className="rb-btn-primary" onClick={takeRemote} disabled={busy}>
              {busy ? <Spinner /> : null} Use remote & re-sync
            </button>
          ) : (
            <button
              className="rb-btn-primary"
              onClick={() => commit(Boolean(preview?.conflict))}
              disabled={
                busy ||
                !preview?.changedSomething ||
                (Boolean(preview?.conflict) && !resolution)
              }
              title={
                preview?.conflict && !resolution
                  ? "Pick how to resolve the conflict first"
                  : undefined
              }
            >
              {busy ? <Spinner /> : null}
              {preview?.conflict ? "Commit using local" : "Commit change"}
            </button>
          )}
        </>
      }
    >
      {loading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
          {error}
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-medium text-ink">{preview.summary}</p>

          {preview.conflict && (
            <div className="flex flex-col gap-2 rounded-lg border border-warn-border bg-warn-bg p-3">
              <p className="text-[13px] font-semibold text-warn-fg">
                Remote file changed since your last fetch
              </p>
              <p className="text-[12px] leading-relaxed text-ink">
                You based this on{" "}
                <code className="font-mono">
                  {preview.conflict.expectedSha?.slice(0, 7) ?? "—"}
                </code>
                , GitHub now has{" "}
                <code className="font-mono">
                  {preview.conflict.currentSha.slice(0, 7)}
                </code>
                . Nothing is written until you choose.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(
                  [
                    ["local", "Use local", "Apply my move on top of the remote file"],
                    ["remote", "Use remote", "Throw away my move, rebuild the board"],
                    ["manual", "Compare", "Show both versions side by side"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    title={hint}
                    className={`rb-btn ${
                      resolution === value ? "border-ink bg-pill" : ""
                    }`}
                    onClick={() => setResolution(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {resolution === "manual" && preview.conflict ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">
                  Local (your move applied)
                </span>
                <pre className="max-h-[40vh] overflow-auto rounded-md bg-code-bg p-3 font-mono text-[11px] leading-relaxed text-code-fg">
                  {preview.after}
                </pre>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">
                  Remote (github.com)
                </span>
                <pre className="max-h-[40vh] overflow-auto rounded-md bg-code-bg p-3 font-mono text-[11px] leading-relaxed text-code-fg">
                  {preview.conflict.remoteContent}
                </pre>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              {preview.diff.length === 0 ? (
                <p className="p-3 text-[12px] text-muted">
                  This move does not change the file.
                </p>
              ) : (
                <div className="max-h-[45vh] overflow-auto font-mono text-[11.5px] leading-relaxed">
                  {preview.diff.map((line, index) => (
                    <div
                      key={index}
                      className={`flex gap-2 px-3 py-[3px] ${
                        line.type === "add"
                          ? "bg-success-bg/60 text-success-fg"
                          : line.type === "del"
                            ? "bg-warn-bg/40 text-danger-fg"
                            : "text-muted"
                      }`}
                    >
                      <span className="select-none opacity-60">
                        {line.type === "add"
                          ? "+"
                          : line.type === "del"
                            ? "−"
                            : " "}
                      </span>
                      <span className="whitespace-pre-wrap">{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted">
            Commit message:{" "}
            <code className="font-mono text-ink">
              RepoBoard: {preview.summary.charAt(0).toLowerCase()}
              {preview.summary.slice(1)}
            </code>
          </p>
        </div>
      )}
    </Modal>
  );
}
