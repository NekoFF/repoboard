"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardData, BoardSummary, PendingChange } from "@/lib/board-service";
import type { DocChange, DocView, TrackedDoc, WorkspaceFile } from "@/lib/docs-service";
import type { DocEdit } from "@/lib/markdown/document";
import type {
  BranchSummary,
  CardReference,
  GraphCommit,
  CommitDetail,
  CommitSummary,
  IssueSummary,
  PullRequestSummary,
} from "@/lib/github/client";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly conflict = false,
    /** The full error body, for errors that carry data (e.g. needsIds). */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...init?.headers }
      : init?.headers,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError(
      body.error ?? `Request failed (${response.status})`,
      response.status,
      Boolean(body.conflict),
      body,
    );
  }
  return body as T;
}

/* ------------------------------------------------------------- resources -- */

export interface ProjectInfo {
  repo: string;
  savedAt: string;
  active: boolean;
  open?: number;
  done?: number;
  lastSyncAt?: number | null;
}

export interface ConnectionInfo {
  connected: boolean;
  managedByEnvironment: boolean;
  tokenSource: "env" | "file" | null;
  authLabel: string;
  projects: ProjectInfo[];
  live?: { owner: string; name: string; defaultBranch: string; visibility: string; htmlUrl: string };
}

const post = <T>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", body: JSON.stringify(body) });

export const api = {
  connection: () => request<ConnectionInfo>("/api/repo"),

  connectRepository: (token: string, repo: string) =>
    post<{
      connected: boolean;
      repo: { owner: string; name: string; defaultBranch: string; visibility: string };
      projects: ProjectInfo[];
    }>("/api/repo", { token, repo }),

  switchProject: (repo: string) =>
    post<{ switched: string; projects: ProjectInfo[] }>("/api/repo", { action: "switch", repo }),

  removeProject: (repo: string) =>
    post<{ removed: string; projects: ProjectInfo[] }>("/api/repo", { action: "remove", repo }),

  disconnectRepository: () =>
    request<{ connected: boolean; projects: ProjectInfo[] }>("/api/repo", { method: "DELETE" }),

  /* documents */
  docs: () => request<{ docs: TrackedDoc[] }>("/api/docs"),
  doc: (path: string) => request<DocView>(`/api/docs?path=${encodeURIComponent(path)}`),
  markdownFiles: () => request<{ files: string[] }>("/api/docs?files=1"),
  trackDoc: (path: string) => post<TrackedDoc>("/api/docs", { action: "track", path }),
  untrackDoc: (id: string) => post<{ ok: true }>("/api/docs", { action: "untrack", id }),
  pinDoc: (id: string, pinned: boolean) => post<{ ok: true }>("/api/docs", { action: "pin", id, pinned }),
  refreshDocs: () => post<{ refreshed: number; failed: string[] }>("/api/docs", { action: "refresh" }),
  syncWorkspace: () =>
    post<{ exists: boolean; added: string[]; removed: string[] }>("/api/docs", { action: "sync-workspace" }),
  previewWorkspace: (templates: string[], readme: boolean) =>
    post<{ files: WorkspaceFile[]; existing: string[] }>("/api/docs", { action: "workspace-preview", templates, readme }),
  createWorkspace: (templates: string[], readme: boolean) =>
    post<{ commitSha: string; paths: string[] }>("/api/docs", { action: "workspace-create", templates, readme }),
  previewDocEdit: (path: string, edits: DocEdit[], baseSha: string | null, attachments?: { path: string }[]) =>
    post<DocChange>("/api/docs", { action: "preview", path, edits, baseSha, attachments: attachments?.map((a) => a.path) }),
  commitDocEdit: (
    path: string,
    edits: DocEdit[],
    expectedSha: string,
    force?: boolean,
    attachments?: { path: string; base64: string }[],
  ) =>
    post<{ commitSha: string; contentSha: string; summary: string }>("/api/docs", {
      action: "commit",
      path,
      edits,
      expectedSha,
      force,
      attachments: attachments?.map(({ path: p, base64 }) => ({ path: p, base64 })),
    }),
  /** Every file in the repository, for pointing at where something is written. */
  repoFiles: () => request<{ files: string[] }>("/api/docs?all=1"),
  /** A text file as it is now, to show the lines a proof points at. */
  repoText: (path: string) => request<{ path: string; content: string; sha: string }>(`/api/docs?text=${encodeURIComponent(path)}`),
  /** Where the browser can load an image or PDF from the repository. */
  rawUrl: (path: string) => `/api/docs?raw=${encodeURIComponent(path)}`,
  previewDocCreate: (path: string, content: string) =>
    post<DocChange>("/api/docs", { action: "create-preview", path, content }),
  createDoc: (path: string, content: string) =>
    post<{ commitSha: string; path: string }>("/api/docs", { action: "create", path, content }),

  refs: () => request<{ refs: CardReference[] }>("/api/github?resource=refs"),
  graph: () => request<{ commits: GraphCommit[] }>("/api/github?resource=graph"),
  /** The project's history for the timeline: the default branch far back, the others recent. */
  story: () => request<{ commits: GraphCommit[]; defaultBranch: string }>("/api/github?resource=story"),
  people: () => request<{ people: { login: string; avatarUrl: string }[] }>("/api/github?resource=people"),

  board: (boardId?: string | null) =>
    request<BoardData>(`/api/board${boardId ? `?board=${encodeURIComponent(boardId)}` : ""}`),
  boards: () => request<{ boards: BoardSummary[] }>("/api/board?list=1"),
  createBoard: (fields: { name: string; description?: string | null; color?: string | null; art?: string | null; owner?: string | null }) =>
    post<{ id: string }>("/api/board", { action: "board-create", ...fields }),
  updateBoard: (boardId: string, fields: { name?: string; description?: string | null; color?: string | null; art?: string | null; owner?: string | null }) =>
    post<{ ok: true }>("/api/board", { action: "board-update", boardId, ...fields }),
  archiveBoard: (boardId: string) => post<{ ok: true }>("/api/board", { action: "board-archive", boardId }),

  boardAction: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/board", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  branches: () =>
    request<{ branches: BranchSummary[] }>("/api/github?resource=branches"),

  commits: (branch?: string) =>
    request<{ commits: CommitSummary[] }>(
      `/api/github?resource=commits${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`,
    ),

  commit: (sha: string) =>
    request<{ commit: CommitDetail }>(`/api/github?resource=commit&sha=${sha}`),

  pulls: () =>
    request<{ pulls: PullRequestSummary[] }>("/api/github?resource=pulls"),

  issues: () =>
    request<{ issues: IssueSummary[] }>("/api/github?resource=issues"),

  activity: (limit = 60) =>
    request<{
      events: {
        id: string;
        type: string;
        message: string;
        taskId: string | null;
        actor: string | null;
        actorKind: "person" | "agent" | null;
        createdAt: number;
      }[];
    }>(`/api/activity?limit=${limit}`),

  markdownState: () =>
    request<{
      source: BoardData["markdownSource"];
      files: string[];
      current: { content: string; sha: string } | null;
      remoteDrift: boolean;
      columns: string[];
      tasks: { id: string | null; title: string; heading: string; done: boolean }[];
      headings: string[];
    }>("/api/markdown"),

  markdownAction: <T>(payload: Record<string, unknown>) =>
    request<T>("/api/markdown", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  preview: (taskId: string, targetHeading: string) =>
    request<PendingChange>("/api/markdown", {
      method: "POST",
      body: JSON.stringify({ action: "preview", taskId, targetHeading }),
    }),

  boardStatus: () =>
    request<{ tracked: boolean; changes: string[]; sha: string | null }>(
      "/api/board",
      { method: "POST", body: JSON.stringify({ action: "board-status" }) },
    ),

  boardPush: () =>
    request<{ commitSha: string; changes: string[] }>("/api/board", {
      method: "POST",
      body: JSON.stringify({ action: "board-push" }),
    }),

  boardPull: () =>
    request<{ added: number; updated: number }>("/api/board", {
      method: "POST",
      body: JSON.stringify({ action: "board-pull" }),
    }),

  pending: () =>
    request<{
      moves: {
        taskId: string;
        title: string;
        from: string;
        to: string;
      }[];
      baseSha: string;
      conflict: boolean;
    }>("/api/markdown", {
      method: "POST",
      body: JSON.stringify({ action: "pending" }),
    }),

  previewAll: () =>
    request<PendingChange>("/api/markdown", {
      method: "POST",
      body: JSON.stringify({ action: "preview-all" }),
    }),

  importIssues: (numbers: number[], columnId: string, boardId?: string | null) =>
    request<{ created: number; skipped: number }>("/api/board", {
      method: "POST",
      body: JSON.stringify({ action: "import-issues", numbers, columnId, boardId }),
    }),
};

/* ----------------------------------------------------------------- hooks -- */

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True while refreshing data that is already on screen. */
  refreshing: boolean;
  reload: () => void;
  updatedAt: number | null;
}

/**
 * Small fetch hook with the three states every screen needs (loading, error
 * with retry, refreshing) plus optional polling. Deliberately tiny — the app
 * has one server and no cache-invalidation story worth a library.
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean; pollMs?: number } = {},
): Resource<T> {
  const { enabled = true, pollMs } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const hasData = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    if (hasData.current) setRefreshing(true);
    else setLoading(true);

    loaderRef
      .current()
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
        hasData.current = true;
        setUpdatedAt(Date.now());
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, ...deps]);

  useEffect(() => {
    if (!pollMs || !enabled) return;
    const id = setInterval(() => setNonce((n) => n + 1), pollMs);
    return () => clearInterval(id);
  }, [pollMs, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, refreshing, reload, updatedAt };
}
