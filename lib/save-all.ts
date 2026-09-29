import { GitHubClient } from "@/lib/github/client";
import { BOARD_STATE_PATH } from "@/lib/board-state";
import { activeRepository, boardFileToSave, boardStateStatus, logActivity, syncBoards, syncSettings } from "@/lib/board-service";
import {
  clearProposals,
  documentsBranch,
  listProposals,
  onBranch,
  previewDocEdit,
  previewProposedDocs,
  rememberDocument,
  syncWorkspace,
} from "@/lib/docs-service";
import type { DocEdit } from "@/lib/markdown/document";
import type { DiffLine } from "@/lib/markdown/sync";

/**
 * Everything this computer has that GitHub does not, saved with one button:
 * the boards (board.json, with the activity), the person's uncommitted
 * document edits, and what agents proposed for the documents — new
 * documents and their screenshots included. One commit when the documents
 * live on the default branch; one per branch otherwise. The person sees
 * every file's diff first (planSaveAll), and a document that changed on
 * GitHub since is refused, as in every reviewed write.
 */

export interface SaveAllDocument {
  path: string;
  summary: string;
  creating: boolean;
  diff: DiffLine[];
  /** The file's SHA the diff was made against; null for a new file. */
  baseSha: string | null;
  /** Agents whose proposals are in it. */
  by: string[];
  screenshots: number;
  /** Edits that no longer fit the file: left out, and said. */
  missed: string[];
  /** It could not be prepared: shown with the reason, and not saved; the rest still is. */
  error?: string;
}

export interface SavePlan {
  boards: { changes: string[]; auto: boolean };
  documents: SaveAllDocument[];
  documentsBranch: string;
  defaultBranch: string;
}

/** The person's own uncommitted edits, per document (kept by the document pages). */
export type YourEdits = { path: string; edits: DocEdit[] }[];

async function documentsPlan(yours: YourEdits): Promise<{ documents: SaveAllDocument[]; proposalIds: string[] }> {
  const proposals = listProposals();
  const byPath = new Map<string, { edits: DocEdit[]; ids: string[]; by: Set<string>; attachments: { path: string; base64: string }[] }>();
  const entry = (path: string) => {
    if (!byPath.has(path)) byPath.set(path, { edits: [], ids: [], by: new Set(), attachments: [] });
    return byPath.get(path)!;
  };
  for (const p of proposals) {
    if (!p.edits) continue;
    const e = entry(p.path);
    e.edits.push(...p.edits);
    e.ids.push(p.id);
    e.by.add(p.author);
    e.attachments.push(...p.attachments);
  }
  for (const y of yours) if (y.edits.length) entry(y.path).edits.push(...y.edits);

  const documents: SaveAllDocument[] = [];
  const proposalIds: string[] = [];
  for (const [path, e] of byPath) {
    try {
      const change = await previewDocEdit({ path, edits: e.edits, baseSha: null, attachments: e.attachments.map((a) => a.path) });
      if (!change.changedSomething) continue;
      documents.push({ path, summary: change.summary, creating: false, diff: change.diff, baseSha: change.baseSha, by: [...e.by], screenshots: e.attachments.length, missed: change.missed });
      proposalIds.push(...e.ids);
    } catch (error) {
      // One document that cannot be prepared does not stop the others.
      documents.push({ path, summary: "Could not be prepared", creating: false, diff: [], baseSha: null, by: [...e.by], screenshots: e.attachments.length, missed: [], error: (error as Error).message });
    }
  }
  const created = proposals.filter((p) => p.content != null);
  if (created.length) {
    const { files } = await previewProposedDocs(created.map((p) => p.id));
    for (const f of files) {
      documents.push({ path: f.path, summary: "New document", creating: true, diff: f.diff, baseSha: null, by: [f.author], screenshots: 0, missed: [] });
      proposalIds.push(f.id);
    }
  }
  return { documents, proposalIds };
}

export async function planSaveAll(yours: YourEdits = []): Promise<SavePlan> {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const auto = syncSettings().autoSync;
  const boards = auto ? { changes: [], auto } : { changes: (await boardStateStatus()).changes, auto };
  const { documents } = await documentsPlan(yours);
  return { boards, documents, documentsBranch: documentsBranch() ?? repository.defaultBranch, defaultBranch: repository.defaultBranch };
}

export async function saveAll(
  yours: YourEdits,
  /** Each document's SHA as the person saw it: a newer file means a new review. */
  seen: Record<string, string | null>,
): Promise<{ commits: string[]; boards: number; documents: number }> {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const planned = await documentsPlan(yours);
  const documents = planned.documents.filter((d) => !d.error);
  const { proposalIds } = planned;
  for (const d of documents) {
    if (d.path in seen && seen[d.path] !== d.baseSha) {
      const error = new Error(`${d.path} changed on GitHub since you looked. Look at the changes again.`);
      (error as Error & { code?: string }).code = "CONFLICT";
      throw error;
    }
  }

  const raw = await GitHubClient.create();
  if (!raw.commitChanges) throw new Error("This host cannot commit several files at once");
  const docsBranch = documentsBranch();
  const docsClient = onBranch(raw, docsBranch);
  const auto = syncSettings().autoSync;
  // Boards on the default branch (automatic sync keeps them on its own branch instead).
  const boardFile = auto ? null : await boardFileToSave();

  // The documents' new text, and the files that are new: documents and screenshots.
  const proposals = listProposals().filter((p) => proposalIds.includes(p.id));
  const docEdits: { path: string; content: string; expectedSha: string }[] = [];
  const docAdds: { path: string; base64: string }[] = [];
  const contents = new Map<string, string>();
  for (const d of documents) {
    if (d.creating) {
      const content = proposals.find((p) => p.path === d.path && p.content != null)?.content ?? "";
      docAdds.push({ path: d.path, base64: Buffer.from(content, "utf8").toString("base64") });
      contents.set(d.path, content);
    } else {
      const edits = [...proposals.filter((p) => p.path === d.path).flatMap((p) => p.edits ?? []), ...(yours.find((y) => y.path === d.path)?.edits ?? [])];
      const change = await previewDocEdit({ path: d.path, edits, baseSha: d.baseSha });
      docEdits.push({ path: d.path, content: change.after, expectedSha: change.baseSha });
      contents.set(d.path, change.after);
    }
  }
  for (const p of proposals) docAdds.push(...p.attachments);

  const boardEdit = boardFile?.sha ? [{ path: BOARD_STATE_PATH, content: boardFile.content, expectedSha: boardFile.sha }] : [];
  const boardAdd = boardFile && !boardFile.sha ? [{ path: BOARD_STATE_PATH, base64: Buffer.from(boardFile.content, "utf8").toString("base64") }] : [];
  const parts = [
    boardFile ? `${boardFile.changes.length || "the activity of"} board change${boardFile.changes.length === 1 ? "" : "s"}` : null,
    documents.length ? `${documents.length} document${documents.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const message = `RepoBoard: save ${parts.join(" and ") || "everything"}`;
  const commits: string[] = [];
  const hasDocs = docEdits.length + docAdds.length > 0;
  const hasBoards = boardEdit.length + boardAdd.length > 0;
  if (!docsBranch || docsBranch === repository.defaultBranch) {
    // One commit for all of it.
    if (hasDocs || hasBoards) {
      commits.push((await raw.commitChanges({ message, edits: [...boardEdit, ...docEdits], adds: [...boardAdd, ...docAdds] })).commitSha);
    }
  } else {
    if (hasBoards) commits.push((await raw.commitChanges({ message: `RepoBoard: save ${parts[0]}`, edits: boardEdit, adds: boardAdd })).commitSha);
    if (hasDocs) commits.push((await docsClient.commitChanges!({ message: `RepoBoard: save ${parts.at(-1)}`, edits: docEdits, adds: docAdds })).commitSha);
  }
  if (auto) await syncBoards();

  for (const [path, content] of contents) rememberDocument(path, content);
  clearProposals(proposalIds);
  if (docAdds.length) await syncWorkspace().catch(() => null);
  logActivity({ repositoryId: repository.id, type: "doc_changed", message: `saved everything to GitHub: ${parts.join(" and ") || "nothing new"}` });
  return { commits, boards: boardFile?.changes.length ?? 0, documents: documents.length };
}
