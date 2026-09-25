import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { markdownSources, type DocSnapshot } from "@/db/schema";
import { GitHubClient } from "@/lib/github/client";
import { activeRepository, logActivity, type MarkdownGitHub } from "@/lib/board-service";
import {
  applyDocEdits,
  parseDocument,
  SNAPSHOT_VERSION,
  toSnapshot,
  type DocEdit,
  type ParsedDocument,
} from "@/lib/markdown/document";
import { buildDiff, type DiffLine } from "@/lib/markdown/sync";
import {
  kindOfPath,
  templateById,
  templatePath,
  WORKSPACE_DIR,
  WORKSPACE_README,
  type DocKind,
} from "@/lib/templates";

/**
 * Documents: markdown files in the repository that RepoBoard keeps an eye on.
 *
 * A policy checklist, a release plan, a roadmap — the things that must not get
 * lost. The file on GitHub is always the truth; the database only remembers
 * which files are tracked and the last parsed copy, so progress can be shown
 * without waiting for the network.
 *
 * Writes follow the same rule as everything else: preview first, compare the
 * SHA, never overwrite a file that moved without the person saying so.
 */

type DocsGitHub = MarkdownGitHub & {
  listMarkdownFiles?: () => Promise<string[]>;
  createFiles?: (args: { files: { path: string; content: string }[]; message: string }) => Promise<{ commitSha: string }>;
};
type ClientFactory = () => Promise<DocsGitHub>;
const defaultClientFactory: ClientFactory = () => GitHubClient.create();

export interface TrackedDoc {
  id: string;
  path: string;
  role: "board" | "checklist";
  /** Where it lives: .repoboard/checklists → checklist, notes → note … */
  kind: DocKind;
  pinned: boolean;
  title: string;
  total: number;
  done: number;
  doing: number;
  review: number;
  sections: DocSnapshot["sections"];
  items: DocSnapshot["items"];
  links: string[];
  sha: string | null;
  snapshotAt: number | null;
  /** The stored copy predates fields RepoBoard now reads; read it again. */
  stale: boolean;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function toTracked(row: typeof markdownSources.$inferSelect): TrackedDoc {
  const snap = row.snapshot;
  return {
    id: row.id,
    path: row.path,
    role: row.role,
    kind: kindOfPath(row.path),
    pinned: row.pinned,
    title: snap?.title ?? fileName(row.path),
    total: snap?.total ?? 0,
    done: snap?.done ?? 0,
    doing: snap?.doing ?? 0,
    review: snap?.review ?? 0,
    sections: snap?.sections ?? [],
    items: snap?.items ?? [],
    links: snap?.links ?? [],
    sha: row.snapshotSha,
    snapshotAt: row.snapshotAt?.getTime() ?? null,
    stale: (snap?.version ?? 1) < SNAPSHOT_VERSION,
  };
}

function requireRepository() {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  return repository;
}

export function listDocs(): TrackedDoc[] {
  const repository = activeRepository();
  if (!repository) return [];
  return db
    .select()
    .from(markdownSources)
    .where(eq(markdownSources.repositoryId, repository.id))
    .orderBy(asc(markdownSources.path))
    .all()
    .map(toTracked)
    // The board's own source first, then alphabetical.
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "board" ? -1 : 1));
}

function findRow(repositoryId: string, path: string) {
  return db
    .select()
    .from(markdownSources)
    .where(and(eq(markdownSources.repositoryId, repositoryId), eq(markdownSources.path, path)))
    .get();
}

function saveSnapshot(repositoryId: string, path: string, parsed: ParsedDocument, sha: string) {
  const row = findRow(repositoryId, path);
  if (!row) return;
  db.update(markdownSources)
    .set({ snapshot: toSnapshot(parsed), snapshotSha: sha, snapshotAt: new Date() })
    .where(eq(markdownSources.id, row.id))
    .run();
}

export function trackDoc(path: string, options: { pinned?: boolean; quiet?: boolean } = {}): TrackedDoc {
  const repository = requireRepository();
  const existing = findRow(repository.id, path);
  if (existing) return toTracked(existing);
  const id = randomUUID();
  db.insert(markdownSources)
    .values({
      id,
      repositoryId: repository.id,
      path,
      lastKnownSha: null,
      autoSync: false,
      role: "checklist",
      pinned: options.pinned ?? true,
    })
    .run();
  if (!options.quiet) {
    logActivity({ repositoryId: repository.id, type: "doc_tracked", message: `started tracking ${path}` });
  }
  return toTracked(findRow(repository.id, path)!);
}

/** Stops tracking a checklist. The board's own source is changed on the board, not here. */
export function untrackDoc(id: string): void {
  const repository = requireRepository();
  const row = db.select().from(markdownSources).where(eq(markdownSources.id, id)).get();
  if (!row || row.repositoryId !== repository.id) throw new Error("Document not found");
  if (row.role === "board") throw new Error("This file drives the board. Pick another board source first.");
  db.delete(markdownSources).where(eq(markdownSources.id, id)).run();
  logActivity({ repositoryId: repository.id, type: "doc_untracked", message: `stopped tracking ${row.path}` });
}

export function setDocPinned(id: string, pinned: boolean): void {
  const repository = requireRepository();
  const row = db.select().from(markdownSources).where(eq(markdownSources.id, id)).get();
  if (!row || row.repositoryId !== repository.id) throw new Error("Document not found");
  db.update(markdownSources).set({ pinned }).where(eq(markdownSources.id, id)).run();
}

export interface DocView {
  path: string;
  content: string;
  sha: string;
  parsed: ParsedDocument;
  tracked: TrackedDoc | null;
}

export async function readDoc(
  path: string,
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<DocView> {
  const repository = requireRepository();
  const gh = await clientFactory();
  const file = await gh.getFile(path);
  const parsed = parseDocument(file.content, fileName(path));
  saveSnapshot(repository.id, path, parsed, file.sha);
  const row = findRow(repository.id, path);
  return { path, content: file.content, sha: file.sha, parsed, tracked: row ? toTracked(row) : null };
}

/** Re-reads every tracked file. Files that fail (deleted, offline) keep their last snapshot. */
export async function refreshDocs(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ refreshed: number; failed: string[] }> {
  const repository = requireRepository();
  const docs = listDocs();
  const gh = await clientFactory();
  const failed: string[] = [];
  let refreshed = 0;
  await Promise.all(
    docs.map(async (doc) => {
      try {
        const file = await gh.getFile(doc.path);
        if (file.sha !== doc.sha || doc.stale) {
          saveSnapshot(repository.id, doc.path, parseDocument(file.content, fileName(doc.path)), file.sha);
          refreshed += 1;
        }
      } catch {
        failed.push(doc.path);
      }
    }),
  );
  return { refreshed, failed };
}

/* ---------------------------------------------------------------- writes -- */

export interface DocChange {
  path: string;
  summary: string;
  changedSomething: boolean;
  diff: DiffLine[];
  before: string;
  after: string;
  /** SHA of the file the preview was computed against; send it back to commit. */
  baseSha: string;
  /** True when the file is being created. */
  creating: boolean;
  missed: string[];
  conflict: null | { expectedSha: string | null; currentSha: string; remoteContent: string };
}

function commitMessage(path: string, summary: string, creating: boolean): string {
  if (creating) return `RepoBoard: create ${path}`;
  if (summary === "Edit") return `RepoBoard: edit ${path}`;
  return `RepoBoard: ${summary.charAt(0).toLowerCase()}${summary.slice(1)} in ${path}`;
}

/**
 * Computes what a set of edits would do to the file as it is on GitHub right
 * now. `baseSha` is the version the person was looking at; if GitHub has moved
 * on, the preview says so and the commit needs an explicit go-ahead.
 */
export async function previewDocEdit(
  args: { path: string; edits: DocEdit[]; baseSha: string | null },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<DocChange> {
  requireRepository();
  const gh = await clientFactory();
  const file = await gh.getFile(args.path);
  const result = applyDocEdits(file.content, args.edits);
  const moved = Boolean(args.baseSha) && args.baseSha !== file.sha;
  return {
    path: args.path,
    summary: result.summary,
    changedSomething: result.content !== file.content,
    diff: buildDiff(file.content, result.content),
    before: file.content,
    after: result.content,
    baseSha: file.sha,
    creating: false,
    missed: result.missed,
    conflict: moved
      ? { expectedSha: args.baseSha, currentSha: file.sha, remoteContent: file.content }
      : null,
  };
}

export async function commitDocEdit(
  args: { path: string; edits: DocEdit[]; expectedSha: string; force?: boolean },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ commitSha: string; contentSha: string; summary: string }> {
  const repository = requireRepository();
  const gh = await clientFactory();
  const file = await gh.getFile(args.path);

  if (!args.force && file.sha !== args.expectedSha) {
    logActivity({
      repositoryId: repository.id,
      type: "conflict_detected",
      message: `was stopped: ${args.path} changed on GitHub meanwhile (${args.expectedSha.slice(0, 7)} → ${file.sha.slice(0, 7)})`,
    });
    const error = new Error("The file changed on GitHub since the preview");
    (error as Error & { code?: string }).code = "CONFLICT";
    throw error;
  }

  const result = applyDocEdits(file.content, args.edits);
  if (result.content === file.content) {
    return { commitSha: "", contentSha: file.sha, summary: "Nothing to commit" };
  }

  const message = commitMessage(args.path, result.summary, false);
  const written = await gh.putFile({
    path: args.path,
    content: result.content,
    // The SHA of the copy we just rebased onto: GitHub refuses the write if it
    // moved again in the last few milliseconds.
    expectedSha: file.sha,
    message,
  });

  saveSnapshot(repository.id, args.path, parseDocument(result.content, fileName(args.path)), written.contentSha);
  logActivity({ repositoryId: repository.id, type: "doc_changed", message });
  return { ...written, summary: result.summary };
}

export async function previewDocCreate(
  args: { path: string; content: string },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<DocChange> {
  requireRepository();
  const path = normaliseNewPath(args.path);
  const gh = await clientFactory();
  const exists = await gh.getFile(path).then(
    () => true,
    () => false,
  );
  if (exists) throw new Error(`${path} already exists — open it instead`);
  return {
    path,
    summary: `Create ${path}`,
    changedSomething: true,
    diff: buildDiff("", args.content),
    before: "",
    after: args.content,
    baseSha: "",
    creating: true,
    missed: [],
    conflict: null,
  };
}

export async function commitDocCreate(
  args: { path: string; content: string },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ commitSha: string; contentSha: string; path: string }> {
  const repository = requireRepository();
  const path = normaliseNewPath(args.path);
  const gh = await clientFactory();
  // No expected SHA: the Contents API refuses to create over an existing file.
  const written = await gh.putFile({ path, content: args.content, message: commitMessage(path, "", true) });
  trackDoc(path);
  saveSnapshot(repository.id, path, parseDocument(args.content, fileName(path)), written.contentSha);
  logActivity({ repositoryId: repository.id, type: "doc_changed", message: `created ${path}` });
  return { ...written, path };
}

export function normaliseNewPath(raw: string): string {
  let path = raw.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!path) throw new Error("Give the file a name");
  if (path.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Use a plain path inside the repository, like docs/PLAN.md");
  }
  if (!/\.md$/i.test(path)) path = `${path}.md`;
  return path;
}

/* ------------------------------------------------------------ workspace -- */

const inWorkspace = (path: string) =>
  path.startsWith(`${WORKSPACE_DIR}/`) && /\.md$/i.test(path);

/**
 * Everything under .repoboard/ is tracked without anyone asking: that folder
 * exists to be tracked. Checklists are pinned to the sidebar; notes and
 * decisions live on the Documents screen. Files deleted on GitHub are dropped.
 */
export async function syncWorkspace(
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ exists: boolean; added: string[]; removed: string[] }> {
  const repository = requireRepository();
  const gh = await clientFactory();
  if (!gh.listMarkdownFiles) return { exists: false, added: [], removed: [] };
  const files = (await gh.listMarkdownFiles()).filter(inWorkspace);
  const present = new Set(files);
  const tracked = listDocs();
  const known = new Set(tracked.map((d) => d.path));

  const added: string[] = [];
  for (const path of files) {
    if (known.has(path)) continue;
    trackDoc(path, { pinned: kindOfPath(path) === "checklist", quiet: true });
    added.push(path);
  }
  const removed: string[] = [];
  for (const doc of tracked) {
    if (inWorkspace(doc.path) && !present.has(doc.path) && doc.role !== "board") {
      db.delete(markdownSources).where(eq(markdownSources.id, doc.id)).run();
      removed.push(doc.path);
    }
  }
  if (added.length) {
    logActivity({
      repositoryId: repository.id,
      type: "doc_tracked",
      message: `found ${added.length} new file${added.length === 1 ? "" : "s"} in ${WORKSPACE_DIR}/`,
    });
  }
  if (added.length) await refreshDocs(clientFactory);
  return { exists: files.length > 0, added, removed };
}

export interface WorkspaceFile {
  path: string;
  content: string;
  diff: DiffLine[];
}

function templateFiles(ids: string[], withReadme: boolean): WorkspaceFile[] {
  const files: { path: string; content: string }[] = [];
  if (withReadme) files.push({ path: `${WORKSPACE_DIR}/README.md`, content: WORKSPACE_README });
  for (const id of ids) {
    const template = templateById(id);
    if (template) files.push({ path: templatePath(template), content: template.content });
  }
  return files.map((f) => ({ ...f, diff: buildDiff("", f.content) }));
}

/** What setting up the workspace would add. Nothing is written here. */
export async function previewWorkspace(
  args: { templates: string[]; readme: boolean },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ files: WorkspaceFile[]; existing: string[] }> {
  requireRepository();
  const gh = await clientFactory();
  const files = templateFiles(args.templates, args.readme);
  const all = gh.listMarkdownFiles ? await gh.listMarkdownFiles() : [];
  const existing = files.map((f) => f.path).filter((p) => all.includes(p));
  return { files: files.filter((f) => !existing.includes(f.path)), existing };
}

export async function createWorkspace(
  args: { templates: string[]; readme: boolean },
  clientFactory: ClientFactory = defaultClientFactory,
): Promise<{ commitSha: string; paths: string[] }> {
  const repository = requireRepository();
  const gh = await clientFactory();
  if (!gh.createFiles) throw new Error("This GitHub client cannot create files");
  const { files } = await previewWorkspace(args, clientFactory);
  if (files.length === 0) throw new Error("Those files already exist");
  const message =
    files.length === 1
      ? `RepoBoard: create ${files[0].path}`
      : `RepoBoard: set up ${WORKSPACE_DIR}/ (${files.length} files)`;
  const result = await gh.createFiles({ files: files.map(({ path, content }) => ({ path, content })), message });
  logActivity({ repositoryId: repository.id, type: "doc_changed", message });
  await syncWorkspace(clientFactory);
  return { commitSha: result.commitSha, paths: files.map((f) => f.path) };
}
