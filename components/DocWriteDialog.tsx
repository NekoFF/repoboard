"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  attachments,
  onClose,
  onDone,
}: {
  path: string;
  edits?: DocEdit[];
  baseSha?: string | null;
  /** New file content: the dialog creates the file instead of editing it. */
  create?: string;
  /** Screenshots proving items: committed in the same commit as the edits. */
  attachments?: { path: string; base64: string; url: string }[];
  onClose: () => void;
  onDone: (result: { path: string }) => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<DocChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState(false);

  // Callers often pass a new array each render; the preview is fetched again
  // only when what it describes changes, and a slower older answer never
  // replaces a newer one.
  const key = JSON.stringify([path, edits, baseSha, create, attachments?.map((a) => a.path)]);
  const latest = useRef(0);
  const load = useCallback(() => {
    setError(null);
    const ticket = ++latest.current;
    const request =
      create !== undefined
        ? api.previewDocCreate(path, create)
        : api.previewDocEdit(path, edits ?? [], baseSha ?? null, attachments);
    request
      .then((result) => ticket === latest.current && setPreview(result))
      .catch((err: Error) => ticket === latest.current && setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

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
        const result = await api.commitDocEdit(path, edits ?? [], preview.baseSha, Boolean(preview.conflict), attachments);
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

          {attachments && attachments.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted">
                Also adds {attachments.length} screenshot{attachments.length === 1 ? "" : "s"}, in the same commit
              </span>
              <div className="flex flex-wrap gap-3">
                {attachments.map((a) => (
                  <figure key={a.path} className="flex w-40 flex-col gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt="" className="h-24 w-40 rounded-lg object-cover ring-1 ring-border" />
                    <figcaption className="truncate font-mono text-2xs text-faint" title={a.path}>
                      {a.path.split("/").pop()}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted">
            Commit message: <code className="font-mono text-ink">{message}</code>
          </p>
        </div>
      )}
    </Modal>
  );
}
