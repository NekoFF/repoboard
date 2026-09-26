"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  Copy,
  ExternalLink,
  FileDown,
  FileText,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  SquareKanban,
  Trash2,
} from "lucide-react";
import type { DocItem } from "@/lib/markdown/document";
import type { DocEdit } from "@/lib/markdown/document";
import type { ItemNote, ItemState } from "@/lib/markdown/format";
import { api, useResource } from "@/lib/client/api";
import { useHotkeys } from "@/lib/client/hotkeys";
import { useShell } from "@/components/shell/ShellContext";
import { PageHeader } from "@/components/PageHeader";
import { Markdown } from "@/components/Markdown";
import { DocChecklist, type ChecklistFilter } from "@/components/docs/DocChecklist";
import { DocWriteDialog } from "@/components/DocWriteDialog";
import { ProofDialog, type ProofAttachment, type ProofDraft } from "@/components/docs/ProofDialog";
import {
  EmptyState,
  Menu,
  MenuItem,
  MenuSeparator,
  ProgressBar,
  RelativeTime,
  Segmented,
  Skeleton,
  Spinner,
  StatusIcon,
  Tooltip,
  percent,
  useToast,
} from "@/components/ui";
import { kindOfPath } from "@/lib/templates";

type Mode = "checklist" | "read" | "edit";

function Stat({ status, count, label }: { status: "done" | "review" | "doing" | "todo"; count: number; label: string }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      <StatusIcon status={status} size={13} />
      <span className="tabular-nums text-ink">{count}</span> {label}
    </span>
  );
}

export function DocScreen({ path }: { path: string }) {
  const router = useRouter();
  const toast = useToast();
  const { repo, viewer } = useShell();
  const doc = useResource(() => api.doc(path), [path]);
  const [mode, setMode] = useState<Mode>("checklist");
  const [filter, setFilter] = useState<ChecklistFilter>("all");
  const [edits, setEdits] = useState<DocEdit[]>([]);
  // Screenshots proving items, committed together with the edits.
  const [attachments, setAttachments] = useState<ProofAttachment[]>([]);
  const [proving, setProving] = useState<DocItem | null>(null);
  const [printing, setPrinting] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const data = doc.data;
  const parsed = data?.parsed;
  const author = viewer ?? "me";

  // A file without checkboxes is a note: open it for reading.
  useEffect(() => {
    if (parsed && parsed.items.length === 0 && mode === "checklist") setMode("read");
  }, [parsed, mode]);

  // Moving to another document starts clean.
  useEffect(() => {
    setEdits([]);
    setAttachments([]);
    setRaw(null);
    setMode("checklist");
    setFilter("all");
  }, [path]);

  const states = useMemo(() => {
    const map = new Map<number, ItemState>();
    for (const e of edits) if (e.type === "state" || e.type === "proof") map.set(e.line, e.state);
    return map;
  }, [edits]);
  const pendingProofs = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of edits) if (e.type === "proof") map.set(e.line, (map.get(e.line) ?? 0) + e.proofs.length);
    return map;
  }, [edits]);

  const addProof = useCallback((draft: ProofDraft) => {
    // A proof replaces a plain tick of the same item; it carries the state itself.
    setEdits((prev) => [
      ...prev.filter((e) => !((e.type === "state" || e.type === "proof") && e.line === draft.edit.line)),
      draft.edit,
    ]);
    setAttachments((prev) => [...prev, ...draft.attachments]);
    setProving(null);
  }, []);
  const pendingNotes = useMemo(() => {
    const map = new Map<number, ItemNote[]>();
    for (const e of edits) {
      if (e.type !== "note") continue;
      map.set(e.line, [...(map.get(e.line) ?? []), { author: e.author, date: e.date ?? null, text: e.text }]);
    }
    return map;
  }, [edits]);
  const pendingAdds = useMemo(
    () => edits.flatMap((e) => (e.type === "add" ? [{ section: e.section, title: e.title }] : [])),
    [edits],
  );

  const setState = useCallback((item: DocItem, state: ItemState) => {
    setEdits((prev) => {
      const rest = prev.filter((e) => !(e.type === "state" && e.line === item.line));
      // Setting it back to what the file says is simply undoing the change.
      if (state === item.state) return rest;
      if (prev.some((e) => e.type === "proof" && e.line === item.line)) return prev;
      return [...rest, { type: "state", line: item.line, title: item.text, id: item.id, state }];
    });
  }, []);

  const addNote = useCallback(
    (item: DocItem, text: string) =>
      setEdits((prev) => [
        ...prev,
        { type: "note", line: item.line, title: item.text, id: item.id, author, text, date: new Date().toISOString().slice(0, 10) },
      ]),
    [author],
  );

  const addItem = useCallback(
    (section: string | null, title: string) => setEdits((prev) => [...prev, { type: "add", section, title }]),
    [],
  );

  const createCard = async (item: DocItem) => {
    try {
      const board = await api.board();
      const column = board.columns[0];
      if (!column) throw new Error("The board has no columns yet");
      const section = parsed?.sections[item.section]?.heading;
      const result = (await api.boardAction({
        action: "create",
        columnId: column.id,
        title: item.title,
        description: `From [[${path}]]${section ? ` — ${section}` : ""}.`,
        labels: item.tags,
        priority: item.priority,
        dueDate: item.due ? Date.parse(`${item.due}T00:00:00Z`) : null,
      })) as { id: string };
      toast.push({
        kind: "success",
        message: "Card created",
        detail: item.title,
        action: { label: "Open", run: () => router.push(`/board/card/${result.id}`) },
      });
    } catch (error) {
      toast.push({ kind: "error", message: "Could not create the card", detail: (error as Error).message });
    }
  };

  const pendingEdits: DocEdit[] =
    mode === "edit" && raw !== null && data && raw !== data.content ? [{ type: "replace", content: raw }] : edits;
  const pendingCount = mode === "edit" ? (pendingEdits.length ? 1 : 0) : edits.length;

  useHotkeys({
    e: () => {
      if (data) {
        setRaw(raw ?? data.content);
        setMode("edit");
      }
    },
    "mod+Enter": () => pendingCount > 0 && setReviewing(true),
  });

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.push({ kind: "success", message });
      router.refresh();
      doc.reload();
    } catch (error) {
      toast.push({ kind: "error", message: "That did not work", detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Export: the document alone, laid out for paper, through the browser's
  // own "Save as PDF" — the result looks like the text, not like the app.
  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const run = async () => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".rb-print-root img"));
      await Promise.race([
        Promise.all(images.map((img) => (img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true }))))),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (cancelled) return;
      const before = document.title;
      document.title = parsed?.title ?? path.split("/").pop() ?? "Document";
      const done = () => {
        document.title = before;
        setPrinting(false);
      };
      window.addEventListener("afterprint", done, { once: true });
      window.print();
      // Some browsers do not send afterprint; print() has returned by now anyway.
      setTimeout(done, 1000);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [printing, parsed, path]);

  const kind = kindOfPath(path);
  const tracked = data?.tracked ?? null;
  const githubUrl = repo ? `https://github.com/${repo}/blob/HEAD/${path.split("/").map(encodeURIComponent).join("/")}` : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-1.5">
            <Link href="/docs" className="text-muted hover:text-ink">
              Documents
            </Link>
            <span className="text-faint">/</span>
            <span className="truncate">{parsed?.title ?? path.split("/").pop()}</span>
          </span>
        }
        icon={<FileText className="size-4" />}
        actions={
          <>
            {!tracked && data && (
              <button className="rb-btn rb-btn-sm" disabled={busy} onClick={() => act(() => api.trackDoc(path), "Tracking this document")}>
                <Pin className="size-3.5" /> Track
              </button>
            )}
            <Tooltip content="Reload from GitHub">
              <button className="rb-icon-btn" onClick={doc.reload} aria-label="Reload" disabled={doc.loading || doc.refreshing}>
                {doc.refreshing ? <Spinner /> : <RefreshCw className="size-4" />}
              </button>
            </Tooltip>
            {data && kind === "document" && (
              <Tooltip content="Export as PDF">
                <button className="rb-icon-btn" onClick={() => setPrinting(true)} aria-label="Export as PDF" disabled={printing}>
                  <FileDown className="size-4" />
                </button>
              </Tooltip>
            )}
            {githubUrl && (
              <Tooltip content="Open on GitHub">
                <a className="rb-icon-btn" href={githubUrl} target="_blank" rel="noreferrer noopener" aria-label="Open on GitHub">
                  <ExternalLink className="size-4" />
                </a>
              </Tooltip>
            )}
            <Menu
              align="end"
              trigger={
                <button className="rb-icon-btn" aria-label="More">
                  <MoreHorizontal className="size-4" />
                </button>
              }
            >
              {data && kind !== "document" && (
                <MenuItem icon={<FileDown className="size-3.5" />} onSelect={() => setPrinting(true)}>
                  Export as PDF
                </MenuItem>
              )}
              <MenuItem
                icon={<Copy className="size-3.5" />}
                onSelect={() => navigator.clipboard?.writeText(`[[${path}]]`).then(() => toast.push({ kind: "success", message: "Link copied", detail: `[[${path}]]` }))}
              >
                Copy link for other documents
              </MenuItem>
              {tracked && (
                <MenuItem
                  icon={tracked.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  onSelect={() => act(() => api.pinDoc(tracked.id, !tracked.pinned), tracked.pinned ? "Removed from the sidebar" : "Pinned to the sidebar")}
                >
                  {tracked.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                </MenuItem>
              )}
              {tracked?.role !== "board" && (
                <MenuItem
                  icon={<SquareKanban className="size-3.5" />}
                  onSelect={() =>
                    act(() => api.markdownAction({ action: "set-source", path }), "The board now follows this file")
                  }
                >
                  Drive the board from this file
                </MenuItem>
              )}
              {tracked && tracked.role !== "board" && !path.startsWith(".repoboard/") && (
                <>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 className="size-3.5" />} onSelect={() => act(() => api.untrackDoc(tracked.id), "Stopped tracking")}>
                    Stop tracking
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        }
      >
        <Segmented
          size="sm"
          value={mode}
          onChange={(next) => {
            if (next === "edit" && data) setRaw(raw ?? data.content);
            setMode(next);
          }}
          options={[
            { value: "checklist", label: <><ListChecks className="size-3.5" /> Checklist</> },
            { value: "read", label: <><BookOpen className="size-3.5" /> Read</> },
            { value: "edit", label: <><Pencil className="size-3.5" /> Edit</>, title: "Edit the file (E)" },
          ]}
        />
        {mode === "checklist" && parsed && parsed.items.length > 0 && (
          <>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: parsed.total },
                { value: "open", label: "Open", count: parsed.total - parsed.done - parsed.review },
                { value: "review", label: "Needs check", count: parsed.review },
                { value: "done", label: "Done", count: parsed.done },
              ]}
            />
          </>
        )}
      </PageHeader>

      <div className="rb-under-header rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        {doc.loading && (
          <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-6 py-10">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {doc.error && !data && (
          <EmptyState
            icon={<FileText className="size-6" />}
            title="Could not open this file"
            body={doc.error}
            action={
              <>
                <button className="rb-btn" onClick={doc.reload}>
                  Try again
                </button>
                <Link className="rb-btn" href="/docs">
                  <ChevronLeft className="size-3.5" /> All documents
                </Link>
              </>
            }
          />
        )}

        {data && parsed && mode !== "edit" && (
          <div className="mx-auto max-w-[860px] px-6 pb-32 pt-9 sm:px-10">
            <div className="mb-10 flex flex-col gap-4">
              <div>
                <p className="mb-1.5 text-xs text-faint">
                  {kind === "document" ? "Document" : kind.charAt(0).toUpperCase() + kind.slice(1)}
                  <span className="mx-2">in</span>
                  <span className="font-mono">{path}</span>
                </p>
                {/* Reading, the file's own first heading is the title; do not say it twice. */}
                {!(mode === "read" && /^\s*(?:<!--[\s\S]*?-->\s*)*#\s/.test(data.content)) && (
                  <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{parsed.title}</h1>
                )}
              </div>
              {parsed.total > 0 && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-baseline gap-3">
                    <span className="text-xl font-semibold tabular-nums text-ink">{percent(parsed.done, parsed.total)}%</span>
                    <span className="text-sm text-muted">
                      {parsed.done} of {parsed.total} done
                    </span>
                  </div>
                  <ProgressBar counts={{ done: parsed.done, review: parsed.review, doing: parsed.doing, total: parsed.total }} height={8} />
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    <Stat status="review" count={parsed.review} label="need your check" />
                    <Stat status="doing" count={parsed.doing} label="in progress" />
                    <Stat status="todo" count={parsed.total - parsed.done - parsed.review - parsed.doing} label="to do" />
                    {tracked?.snapshotAt && (
                      <span className="text-sm text-faint">
                        Read from GitHub <RelativeTime value={tracked.snapshotAt} />
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {mode === "checklist" && parsed.items.length > 0 ? (
              <DocChecklist
                doc={parsed}
                filter={filter}
                states={states}
                pendingNotes={pendingNotes}
                pendingAdds={pendingAdds}
                author={author}
                onState={setState}
                onNote={addNote}
                onAdd={addItem}
                onCreateCard={createCard}
                onProof={setProving}
                docPath={path}
                pendingProofs={pendingProofs}
              />
            ) : (
              <Markdown content={data.content} items={parsed.items} sections={parsed.sections} states={states} onItemState={setState} onItemProof={setProving} basePath={path} className="max-w-none" />
            )}
          </div>
        )}

        {data && mode === "edit" && (
          <div className="flex h-full flex-col">
            <textarea
              className="h-full min-h-[60vh] w-full flex-1 resize-none bg-surface px-6 py-6 font-mono text-sm leading-relaxed text-ink outline-none sm:px-10"
              value={raw ?? data.content}
              onChange={(event) => setRaw(event.target.value)}
              spellCheck={false}
              aria-label={`Edit ${path}`}
            />
          </div>
        )}
      </div>

      {pendingCount > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="rb-pop pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-raised py-2 pl-4 pr-2 shadow-pop">
            <span className="size-2 rounded-full bg-state-review" />
            <span className="text-sm text-ink">
              {mode === "edit" ? "The file has unsaved edits" : `${pendingCount} change${pendingCount === 1 ? "" : "s"} not committed yet`}
            </span>
            <button
              className="rb-btn-ghost"
              onClick={() => {
                setEdits([]);
                setAttachments([]);
                if (data) setRaw(data.content);
              }}
            >
              Discard
            </button>
            <button className="rb-btn-primary rb-btn-sm" onClick={() => setReviewing(true)}>
              Review and commit <span className="text-on-accent/70">⌘↵</span>
            </button>
          </div>
        </div>
      )}

      {printing &&
        data &&
        createPortal(
          <div className="rb-print-root">
            <Markdown content={data.content} basePath={path} className="max-w-none" />
          </div>,
          document.body,
        )}

      {proving && (
        <ProofDialog
          docPath={path}
          item={{ line: proving.line, text: proving.text, title: proving.title, id: proving.id }}
          onClose={() => setProving(null)}
          onDone={addProof}
        />
      )}

      {reviewing && data && (
        <DocWriteDialog
          path={path}
          edits={pendingEdits}
          baseSha={data.sha}
          attachments={mode === "edit" ? undefined : attachments}
          onClose={() => setReviewing(false)}
          onDone={() => {
            setReviewing(false);
            setEdits([]);
            setAttachments([]);
            setRaw(null);
            if (mode === "edit") setMode("checklist");
            doc.reload();
            router.refresh();
          }}
        />
      )}
    </>
  );
}
