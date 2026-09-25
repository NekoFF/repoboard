"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardData, PendingChange } from "@/lib/board-service";
import type {
  BranchSummary,
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
    );
  }
  return body as T;
}

/* ------------------------------------------------------------- resources -- */

export const api = {
  board: () => request<BoardData>("/api/board"),

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

  importIssues: (numbers: number[], columnId: string) =>
    request<{ created: number; skipped: number }>("/api/board", {
      method: "POST",
      body: JSON.stringify({ action: "import-issues", numbers, columnId }),
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
