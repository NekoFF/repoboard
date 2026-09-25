"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, GitCommitHorizontal } from "lucide-react";
import type { DocChange } from "@/lib/docs-service";
import type { DocEdit } from "@/lib/markdown/document";
import { api, ApiError } from "@/lib/client/api";
import { DiffStat, DiffView } from "@/components/DiffView";
import { Modal, Skeleton, Spinner, useToast } from "@/components/ui";

/**
 * The door between a document and GitHub. It always shows the diff against
 * the file as it is on GitHub right now; if someone changed the file since it
 * was opened, it says so and waits for an explicit decision.
 */
export function DocWriteDialog({
  path,
  edits,
  baseSha,
  create,
  onClose,
  onDone,
}: {
  path: string;
  edits?: DocEdit[];
  baseSha?: string | null;
  /** New file content: the dialog creates the file instead of editing it. */
  create?: string;
  onClose: () => void;
  onDone: (result: { path: string }) => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<DocChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState(false);

  const load = useCallback(() => {
    setError(null);
    const request =
      create !== undefined
        ? api.previewDocCreate(path, create)
        : api.previewDocEdit(path, edits ?? [], baseSha ?? null);
    request.then(setPreview).catch((err: Error) => setError(err.message));
  }, [path, edits, baseSha, create]);

  useEffect(load, [load]);

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (create !== undefined) {
        const result = await api.createDoc(preview.path, create);
        toast.push({ kind: "success", message: `Created ${result.path}` });
        onDone({ path: result.path });
      } else {
        // Committing against the SHA the preview was computed on: if GitHub
        // moved again in between, the server refuses and we show the new diff.
        const result = await api.commitDocEdit(path, edits ?? [], preview.baseSha, Boolean(preview.conflict));
        toast.push({ kind: "success", message: "Committed to GitHub", detail: result.summary });
        onDone({ path });
      }
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message);
      if (apiError.conflict) load();
    } finally {
      setBusy(false);
    }
  };

  const message = preview
    ? preview.creating
      ? `RepoBoard: create ${preview.path}`
      : preview.summary === "Edit"
        ? `RepoBoard: edit ${preview.path}`
        : `RepoBoard: ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1)} in ${preview.path}`
    : "";

  return (
    <Modal
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          {create !== undefined ? "Create file on GitHub" : "Review changes"}
          {preview && <DiffStat diff={preview.diff} />}
        </span>
      }
      description={<span className="font-mono text-xs">{path}</span>}
      footer={
        <>
          <button className="rb-btn" onClick={onClose} disabled={busy}>
            Keep editing
          </button>
          <div className="flex-1" />
          <button
            className="rb-btn-primary"
            onClick={commit}
            disabled={busy || !preview?.changedSomething}
          >
            {busy ? <Spinner /> : <GitCommitHorizontal className="size-3.5" />}
            {preview?.conflict ? "Apply on top and commit" : create !== undefined ? "Create file" : "Commit"}
          </button>
        </>
      }
    >
      {!preview && !error && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-3">
          {preview.conflict && (
            <div className="flex flex-col gap-2 rounded-lg border border-warn-border bg-warn-bg p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-warn-fg">
                <AlertTriangle className="size-4" /> The file changed on GitHub while you were working
              </p>
              <p className="text-sm text-ink">
                You started from{" "}
                <code className="font-mono text-xs">{preview.conflict.expectedSha?.slice(0, 7) ?? "—"}</code>, GitHub
                now has <code className="font-mono text-xs">{preview.conflict.currentSha.slice(0, 7)}</code>. The diff
                below applies your changes on top of the newer version, so nothing anyone else wrote is lost. Nothing is
                written until you commit.
              </p>
              <button className="rb-btn rb-btn-sm w-fit" onClick={() => setCompare((v) => !v)}>
                {compare ? "Show the diff" : "Compare both versions"}
              </button>
            </div>
          )}

          {preview.missed.length > 0 && (
            <p className="rounded-lg border border-border bg-pill p-3 text-sm text-muted">
              {preview.missed.length} change{preview.missed.length === 1 ? "" : "s"} no longer matched anything in the
              file and will be skipped: {preview.missed.join(", ")}.
            </p>
          )}

          {compare && preview.conflict ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">With your changes</span>
                <pre className="max-h-[45vh] overflow-auto rounded-lg border border-border bg-code-bg p-3 text-xs leading-relaxed">
                  {preview.after}
                </pre>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">On GitHub now</span>
                <pre className="max-h-[45vh] overflow-auto rounded-lg border border-border bg-code-bg p-3 text-xs leading-relaxed">
                  {preview.conflict.remoteContent}
                </pre>
              </div>
            </div>
          ) : (
            <DiffView diff={preview.diff} />
          )}

          <p className="text-xs text-muted">
            Commit message: <code className="font-mono text-ink">{message}</code>
          </p>
        </div>
      )}
    </Modal>
  );
}
