"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileText, KanbanSquare } from "lucide-react";
import { api, type ApiError } from "@/lib/client/api";
import type { DocEdit } from "@/lib/markdown/document";
import type { SavePlan } from "@/lib/save-all";
import { DiffStat, DiffView } from "@/components/DiffView";
import { Modal, RowSkeleton, Spinner, useToast } from "@/components/ui";

/**
 * Save everything to GitHub — the cloud button in the tool rail (and "Save
 * to repo" on a board) opens it: the boards, your uncommitted document
 * edits and what agents proposed for the documents, each file with its
 * diff, saved together (lib/save-all.ts).
 */

const EDITS_KEY = "rb-doc-edits:";

/** Your uncommitted edits, as the document pages keep them in this window. */
export function yourDocEdits(): { path: string; edits: DocEdit[] }[] {
  const out: { path: string; edits: DocEdit[] }[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(EDITS_KEY)) continue;
      const edits = (JSON.parse(sessionStorage.getItem(key) ?? "[]") as DocEdit[]).filter(
        (e) => e.type !== "replace" && !(e.type === "proof" && e.proofs.some((p) => p.kind === "image")),
      );
      if (edits.length) out.push({ path: key.slice(EDITS_KEY.length), edits });
    }
  } catch {
    // Storage unavailable: only what the server knows is saved.
  }
  return out;
}

export function openSaveAll() {
  window.dispatchEvent(new Event("rb-save-all"));
}

export function SaveAllHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("rb-save-all", show);
    return () => window.removeEventListener("rb-save-all", show);
  }, []);
  return open ? <SaveAllDialog onClose={() => setOpen(false)} /> : null;
}

function SaveAllDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<SavePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const yours = yourDocEdits();

  const load = () => {
    setPlan(null);
    setError(null);
    api
      .planSaveAll(yourDocEdits())
      .then(setPlan)
      .catch((e) => setError((e as Error).message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const total = (plan?.boards.changes.length ?? 0) + (plan?.documents.filter((d) => !d.error).length ?? 0);

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const seen = Object.fromEntries(plan.documents.map((d) => [d.path, d.baseSha]));
      const result = await api.saveAll(yours, seen);
      // Your edits are in the repository now: the document pages start clean.
      try {
        for (const y of yours) sessionStorage.removeItem(`${EDITS_KEY}${y.path}`);
      } catch {
        /* nothing kept */
      }
      window.dispatchEvent(new Event("rb-doc-saved"));
      window.dispatchEvent(new Event("rb-live"));
      toast.push({
        kind: "success",
        message: "Saved to GitHub",
        detail: [result.boards ? `${result.boards} board change${result.boards === 1 ? "" : "s"}` : null, result.documents ? `${result.documents} document${result.documents === 1 ? "" : "s"}` : null]
          .filter(Boolean)
          .join(", ") || "Everything was already there",
      });
      router.refresh();
      onClose();
    } catch (e) {
      const conflict = (e as ApiError).body?.code === "CONFLICT" || /changed on GitHub/.test((e as Error).message);
      toast.push({ kind: "error", message: conflict ? "Something changed on GitHub meanwhile" : "Could not save", detail: (e as Error).message });
      if (conflict) load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="Save everything to GitHub"
      description={
        plan
          ? plan.documentsBranch === plan.defaultBranch
            ? `Boards and documents in one commit on ${plan.defaultBranch}.`
            : `Boards on ${plan.defaultBranch}, documents on ${plan.documentsBranch}.`
          : "Looking at what is not on GitHub yet…"
      }
      onClose={onClose}
      footer={
        <>
          <button className="rb-btn" onClick={onClose}>
            Not now
          </button>
          <div className="flex-1" />
          <button className="rb-btn-primary" onClick={() => void save()} disabled={busy || !plan || total === 0}>
            {busy ? <Spinner /> : <CloudUpload className="size-4" />} {total ? `Save ${total} change${total === 1 ? "" : "s"}` : "Nothing to save"}
          </button>
        </>
      }
    >
      {error && <p className="text-sm text-danger">{error}</p>}
      {!plan && !error && <RowSkeleton rows={4} />}
      {plan && (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <KanbanSquare className="size-4 text-faint" /> Boards
            </h3>
            {plan.boards.auto ? (
              <p className="text-sm text-muted">The boards sync on their own; they are saved too.</p>
            ) : plan.boards.changes.length ? (
              <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                {plan.boards.changes.map((c, i) => (
                  <li key={i} className="px-3 py-1.5 text-ink">
                    {c}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing new on the boards.</p>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FileText className="size-4 text-faint" /> Documents
            </h3>
            {plan.documents.length ? (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
                {plan.documents.map((d) => (
                  <li key={d.path}>
                    <button className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover" onClick={() => setOpenDoc(openDoc === d.path ? null : d.path)}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs text-ink">{d.path}</span>
                        <span className="block truncate text-xs text-muted">
                          {d.summary}
                          {d.by.length ? ` · by ${d.by.join(", ")}` : ""}
                          {d.screenshots ? ` · ${d.screenshots} screenshot${d.screenshots === 1 ? "" : "s"}` : ""}
                        </span>
                      </span>
                      <DiffStat diff={d.diff} />
                    </button>
                    {openDoc === d.path && (
                      <div className="max-h-80 overflow-auto border-t border-border">
                        <DiffView diff={d.diff} />
                      </div>
                    )}
                    {d.missed.length > 0 && <p className="px-3 pb-2 text-xs text-danger">Left out, the file changed: {d.missed.join("; ")}</p>}
                    {d.error && <p className="px-3 pb-2 text-xs text-danger">Not saved: {d.error}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No document changes waiting.</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
