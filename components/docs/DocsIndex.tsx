"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookMarked,
  Check,
  FilePlus2,
  FileSearch,
  FileText,
  Lightbulb,
  ListChecks,
  Pin,
  RefreshCw,
  Scale,
  SquareKanban,
  Waypoints,
} from "lucide-react";
import type { TrackedDoc, WorkspaceFile } from "@/lib/docs-service";
import { api, useResource } from "@/lib/client/api";
import { PageHeader } from "@/components/PageHeader";
import { DiffStat } from "@/components/DiffView";
import { DocWriteDialog } from "@/components/DocWriteDialog";
import {
  EmptyState,
  Modal,
  ProgressBar,
  RelativeTime,
  RowSkeleton,
  Segmented,
  Spinner,
  Tooltip,
  percent,
  useToast,
} from "@/components/ui";
import { DocsGraph } from "@/components/docs/DocsGraph";
import { DOCUMENT_TEMPLATES, KIND_FOLDER, TEMPLATES, WORKSPACE_DIR, templatePath, type DocKind } from "@/lib/templates";

const GROUPS: { kind: DocKind; title: string; blurb: string; icon: React.ReactNode }[] = [
  {
    kind: "checklist",
    title: "Checklists",
    blurb: "What must be done and checked — nothing on these gets lost.",
    icon: <ListChecks className="size-4" />,
  },
  {
    kind: "note",
    title: "Notes",
    blurb: "How to run things, where they live — the project's memory.",
    icon: <BookMarked className="size-4" />,
  },
  {
    kind: "decision",
    title: "Decisions",
    blurb: "What was chosen and why, with sources.",
    icon: <Scale className="size-4" />,
  },
  {
    kind: "document",
    title: "Other files",
    blurb: "Markdown files elsewhere in the repository that you track.",
    icon: <FileText className="size-4" />,
  },
];

function DocRow({ doc }: { doc: TrackedDoc }) {
  return (
    <Link
      href={`/docs?path=${encodeURIComponent(doc.path)}`}
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-hover"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-base font-medium text-ink">
          {doc.title}
          {doc.role === "board" && (
            <Tooltip content="The board's columns follow this file">
              <SquareKanban className="size-3.5 text-faint" />
            </Tooltip>
          )}
          {doc.pinned && doc.kind !== "checklist" && <Pin className="size-3 text-faint" />}
        </p>
        <p className="truncate font-mono text-2xs text-faint">{doc.path}</p>
      </div>
      {doc.review > 0 && (
        <span className="hidden shrink-0 rounded-sm bg-state-review/10 px-1.5 py-0.5 text-2xs font-medium text-state-review sm:inline">
          {doc.review} to check
        </span>
      )}
      {doc.total > 0 ? (
        <div className="flex w-44 shrink-0 items-center gap-3">
          <ProgressBar counts={{ done: doc.done, review: doc.review, doing: doc.doing, total: doc.total }} height={5} />
          <span className="w-9 text-right text-xs tabular-nums text-muted">{percent(doc.done, doc.total)}%</span>
        </div>
      ) : (
        <span className="w-44 shrink-0 text-right text-xs text-faint">
          {doc.snapshotAt ? <>Read <RelativeTime value={doc.snapshotAt} /></> : "Not read yet"}
        </span>
      )}
    </Link>
  );
}

/** First run: explain the folder and create it from a few templates in one commit. */
function WorkspaceSetup({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set(["release", "privacy", "licenses", "commands"]));
  const [preview, setPreview] = useState<{ files: WorkspaceFile[]; existing: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const review = async () => {
    setBusy(true);
    try {
      setPreview(await api.previewWorkspace([...chosen], true));
    } catch (error) {
      toast.push({ kind: "error", message: "Could not prepare the files", detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.createWorkspace([...chosen], true);
      toast.push({ kind: "success", message: `Created ${result.paths.length} files in ${WORKSPACE_DIR}/`, detail: "One commit on the default branch." });
      setPreview(null);
      onCreated();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not create the files", detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rb-enter rounded-2xl border border-border bg-canvas p-6 sm:p-8">
      <h2 className="text-xl font-semibold tracking-[-0.015em] text-ink">Give this project a memory</h2>
      <p className="mt-2 max-w-[62ch] text-md leading-relaxed text-muted">
        RepoBoard keeps checklists, notes and decisions in one folder, <code className="font-mono text-sm text-ink">{WORKSPACE_DIR}/</code>,
        inside the repository. It is plain markdown: readable on GitHub, openable in Obsidian, and editable by any AI
        agent that works on the code — so everyone sees the same list of what is done and what is not.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {GROUPS.slice(0, 3).map((g) => (
          <div key={g.kind} className="rounded-xl border border-border bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="text-muted">{g.icon}</span>
              {g.title}
            </p>
            <p className="mt-1 font-mono text-2xs text-faint">
              {WORKSPACE_DIR}/{KIND_FOLDER[g.kind as Exclude<DocKind, "document">]}/
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{g.blurb}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-8 text-sm font-semibold text-ink">Start with</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {TEMPLATES.filter((t) => t.id !== "decision").map((t) => {
          const on = chosen.has(t.id);
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                on ? "border-accent/50 bg-surface" : "border-border bg-transparent hover:bg-surface"
              }`}
              aria-pressed={on}
            >
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border ${
                  on ? "border-accent bg-accent text-on-accent" : "border-border-strong"
                }`}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{t.title}</span>
                <span className="block text-xs text-muted">{t.summary}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-faint">
        A README with the format and the rules for AI agents is always included. The legal checklists are reminders,
        not legal advice.
      </p>

      <div className="mt-6 flex items-center gap-2">
        <button className="rb-btn-primary h-9 px-4" onClick={review} disabled={busy}>
          {busy && !preview ? <Spinner /> : <FilePlus2 className="size-4" />} Review the files
        </button>
      </div>

      {preview && (
        <Modal
          wide
          title={`Create ${WORKSPACE_DIR}/`}
          description="These files are added in one commit on the default branch. Nothing existing is changed."
          onClose={() => setPreview(null)}
          footer={
            <>
              <button className="rb-btn" onClick={() => setPreview(null)}>
                Back
              </button>
              <div className="flex-1" />
              <button className="rb-btn-primary" onClick={create} disabled={busy || preview.files.length === 0}>
                {busy && <Spinner />} Create {preview.files.length} file{preview.files.length === 1 ? "" : "s"}
              </button>
            </>
          }
        >
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {preview.files.map((f) => (
              <li key={f.path} className="flex items-center gap-3 px-3 py-2.5">
                <FileText className="size-4 text-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.path}</span>
                <DiffStat diff={f.diff} />
              </li>
            ))}
          </ul>
          {preview.existing.length > 0 && (
            <p className="mt-3 text-xs text-muted">Already in the repository, left as they are: {preview.existing.join(", ")}</p>
          )}
        </Modal>
      )}
    </section>
  );
}

function NewDocDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string>("blank-checklist");
  const [name, setName] = useState("");
  const [ready, setReady] = useState<{ path: string; content: string } | null>(null);
  // Where a document for people goes; typed by the person, or the template's default.
  const [where, setWhere] = useState<string | null>(null);

  const options = [
    { id: "blank-checklist", title: "Empty checklist", summary: "Your own list of things to do and check.", kind: "checklist" as const },
    { id: "blank-note", title: "Empty note", summary: "Anything worth remembering.", kind: "note" as const },
    ...TEMPLATES,
  ];
  const documents = DOCUMENT_TEMPLATES;
  const chosen = [...options, ...documents].find((o) => o.id === templateId)!;
  const isDocument = chosen.kind === "document";
  const slugName = name.trim().replace(/\s+/g, "-").toLowerCase();
  const folder = chosen.kind === "document" ? "" : `${WORKSPACE_DIR}/${KIND_FOLDER[chosen.kind]}/`;
  const defaultName = "file" in chosen ? chosen.file.replace(/\.md$/, "") : "";
  const fileName = (slugName || defaultName || "untitled");
  const title = name.trim() || ("file" in chosen || chosen.kind === "document" ? chosen.title.replace(/ \(text\)$/, "").replace(/^Empty document$/, "Untitled") : "Untitled");
  const documentPath =
    chosen.kind === "document"
      ? (where ?? (slugName ? chosen.path.replace(/[^/]+\.md$/, `${slugName}.md`) : chosen.path))
      : "";
  const targetPath = isDocument ? documentPath.trim().replace(/^\/+/, "") : `${folder}${fileName}.md`;

  const content =
    "content" in chosen
      ? chosen.content
      : chosen.kind === "checklist"
        ? `# ${title}\n\n## To do\n\n- [ ] First thing\n`
        : `# ${title}\n\n`;

  if (ready) {
    return (
      <DocWriteDialog
        path={ready.path}
        create={ready.content}
        onClose={() => setReady(null)}
        onDone={({ path }) => {
          onClose();
          router.refresh();
          router.push(`/docs?path=${encodeURIComponent(path)}`);
        }}
      />
    );
  }

  return (
    <Modal
      title="New document"
      description="Created in the repository after you review it."
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{isDocument ? "" : targetPath}</span>
          <button
            className="rb-btn-primary"
            disabled={!/\.md$/i.test(targetPath) || targetPath.includes("..")}
            onClick={() => setReady({ path: targetPath, content: "content" in chosen && !name.trim() ? content : content.replace(/^# .*$/m, `# ${title}`) })}
          >
            Review
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          Name
          <input
            autoFocus
            className="rb-input"
            placeholder={"file" in chosen ? chosen.title : "e.g. Store listing"}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="-mb-2 text-xs font-medium text-muted">For the team</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => setTemplateId(o.id)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                o.id === templateId ? "border-ink/50 bg-canvas" : "border-border hover:bg-hover"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                {o.kind === "checklist" ? <ListChecks className="size-3.5 text-muted" /> : o.kind === "note" ? <BookMarked className="size-3.5 text-muted" /> : <Lightbulb className="size-3.5 text-muted" />}
                {o.title}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{o.summary}</span>
            </button>
          ))}
        </div>
        <p className="-mb-2 text-xs font-medium text-muted">For people to read — kept in your project, exported as PDF</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {documents.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setTemplateId(o.id);
                setWhere(null);
              }}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                o.id === templateId ? "border-ink/50 bg-canvas" : "border-border hover:bg-hover"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileText className="size-3.5 text-muted" />
                {o.title}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{o.summary}</span>
            </button>
          ))}
        </div>
        {isDocument && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Where in the project
            <input
              className="rb-input font-mono text-xs"
              value={documentPath}
              onChange={(event) => setWhere(event.target.value)}
              spellCheck={false}
            />
          </label>
        )}
      </div>
    </Modal>
  );
}

function TrackFileDialog({ tracked, onClose }: { tracked: Set<string>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const files = useResource(api.markdownFiles, []);
  const [query, setQuery] = useState("");
  const list = (files.data?.files ?? []).filter((f) => f.toLowerCase().includes(query.toLowerCase()));

  const track = async (path: string) => {
    try {
      await api.trackDoc(path);
      toast.push({ kind: "success", message: `Tracking ${path}` });
      onClose();
      router.refresh();
      router.push(`/docs?path=${encodeURIComponent(path)}`);
    } catch (error) {
      toast.push({ kind: "error", message: "Could not track the file", detail: (error as Error).message });
    }
  };

  return (
    <Modal title="Track a file" description="Pick any markdown file in the repository — a roadmap, a TODO, a spec." onClose={onClose}>
      <input autoFocus className="rb-input" placeholder="Filter files…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-lg border border-border">
        {files.loading && <RowSkeleton rows={6} />}
        {files.error && <p className="p-3 text-sm text-danger">{files.error}</p>}
        {list.map((path) => (
          <button
            key={path}
            onClick={() => (tracked.has(path) ? router.push(`/docs?path=${encodeURIComponent(path)}`) : track(path))}
            className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-hover"
          >
            <FileText className="size-4 shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{path}</span>
            {tracked.has(path) && <span className="text-2xs text-faint">tracked</span>}
          </button>
        ))}
        {files.data && list.length === 0 && <p className="p-3 text-sm text-muted">No markdown files match.</p>}
      </div>
    </Modal>
  );
}

export function DocsIndex({ docs: initial }: { docs: TrackedDoc[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [docs, setDocs] = useState(initial);
  const [dialog, setDialog] = useState<null | "new" | "track">(null);
  const [view, setView] = useState<"list" | "graph">("list");
  const [syncing, setSyncing] = useState(true);
  const [workspaceExists, setWorkspaceExists] = useState(initial.some((d) => d.path.startsWith(`${WORKSPACE_DIR}/`)));

  useEffect(() => setDocs(initial), [initial]);

  useEffect(() => {
    if (params.get("new")) setDialog("new");
    else if (params.get("add")) setDialog("track");
  }, [params]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await api.syncWorkspace();
      setWorkspaceExists(result.exists);
      await api.refreshDocs().catch(() => null);
      const fresh = await api.docs();
      setDocs(fresh.docs);
      if (result.added.length || result.removed.length) router.refresh();
    } catch {
      /* offline: the stored list is still shown */
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, docs: docs.filter((d) => d.kind === g.kind) })),
    [docs],
  );

  return (
    <>
      <PageHeader
        title="Documents"
        icon={<FileText className="size-4" />}
        meta={docs.length ? `${docs.length} tracked` : undefined}
        actions={
          <>
            <Tooltip content="Look for new files on GitHub">
              <button className="rb-icon-btn" onClick={sync} disabled={syncing} aria-label="Refresh">
                {syncing ? <Spinner /> : <RefreshCw className="size-4" />}
              </button>
            </Tooltip>
            <button className="rb-btn rb-btn-sm" onClick={() => setDialog("track")}>
              <FileSearch className="size-3.5" /> Track a file
            </button>
            <button className="rb-btn-primary rb-btn-sm" onClick={() => setDialog("new")}>
              <FilePlus2 className="size-3.5" /> New document
            </button>
          </>
        }
      >
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: <><ListChecks className="size-3.5" /> List</> },
            { value: "graph", label: <><Waypoints className="size-3.5" /> Graph</>, title: "How documents link to each other" },
          ]}
        />
      </PageHeader>
      <div className="rb-under-header rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        {/* The graph is a work surface and takes the width; the list is for reading. */}
        <div className={`mx-auto flex flex-col gap-10 ${view === "graph" ? "max-w-none px-4 pb-4 pt-4" : "max-w-[960px] px-6 pb-20 pt-9 sm:px-10"}`}>
          {!workspaceExists && !syncing && <WorkspaceSetup onCreated={sync} />}

          {view === "graph" && docs.length > 0 && (
            <DocsGraph docs={docs} />
          )}

          {view === "list" && grouped.map((group) =>
            group.docs.length === 0 ? null : (
              <section key={group.kind}>
                <div className="mb-3 flex items-baseline gap-3">
                  <h2 className="flex items-center gap-2 text-md font-semibold text-ink">
                    <span className="text-muted">{group.icon}</span>
                    {group.title}
                  </h2>
                  <p className="hidden text-sm text-faint sm:block">{group.blurb}</p>
                </div>
                <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                  {group.docs.map((doc) => (
                    <DocRow key={doc.id} doc={doc} />
                  ))}
                </div>
              </section>
            ),
          )}

          {docs.length === 0 && workspaceExists && !syncing && (
            <EmptyState icon={<FileText className="size-6" />} title="No documents yet" body="Create one or track an existing file." />
          )}
          {syncing && docs.length === 0 && <RowSkeleton rows={4} />}
        </div>
      </div>

      {dialog === "new" && (
        <NewDocDialog
          onClose={() => {
            setDialog(null);
            router.replace("/docs");
          }}
        />
      )}
      {dialog === "track" && (
        <TrackFileDialog
          tracked={new Set(docs.map((d) => d.path))}
          onClose={() => {
            setDialog(null);
            router.replace("/docs");
          }}
        />
      )}
    </>
  );
}

export { templatePath };
