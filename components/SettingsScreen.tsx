"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardData, RepoHeader } from "@/lib/board-service";
import { TopBar } from "@/components/TopBar";

export function SettingsScreen({
  data,
  header,
  connected,
  authLabel,
  tokenSource,
  repoSlug,
}: {
  data: BoardData;
  header: RepoHeader;
  connected: boolean;
  authLabel: string;
  tokenSource: string | null;
  repoSlug: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState(repoSlug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/repo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, repo }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not connect");
        return;
      }
      setResult(
        `Connected ${body.repo.owner}/${body.repo.name} · default branch ${body.repo.defaultBranch} · ${body.repo.visibility}`,
      );
      setToken("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await fetch("/api/repo", { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSync={null}
        connected={connected}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-semibold text-ink">Settings</h1>
          <p className="text-[12px] text-muted">
            RepoBoard runs entirely on your machine. The token is stored in
            .repoboard/credentials.json (0600) or read from GITHUB_PAT — never in
            source control, never sent anywhere but github.com.
          </p>
        </div>

        <div className="rb-card flex max-w-[620px] flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-ink">
              GitHub connection
            </span>
            {connected ? (
              <span className="inline-flex items-center rounded-sm bg-success-bg px-2 py-1 text-[11px] font-medium text-success-fg">
                connected
              </span>
            ) : (
              <span className="rb-pill">not connected</span>
            )}
          </div>

          <p className="text-[11px] text-muted">
            Auth provider: {authLabel}
            {tokenSource ? ` · token from ${tokenSource}` : ""}
          </p>

          <form className="flex flex-col gap-2" onSubmit={connect}>
            <label className="text-[12px] font-medium text-ink">
              Repository
              <input
                className="rb-input mt-1"
                placeholder="owner/name"
                value={repo}
                onChange={(event) => setRepo(event.target.value)}
                required
              />
            </label>

            <label className="text-[12px] font-medium text-ink">
              Fine-grained personal access token
              <input
                type="password"
                className="rb-input mt-1"
                placeholder="github_pat_…"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
              />
            </label>

            <p className="text-[11px] text-muted">
              Needs repository permissions: Contents (read &amp; write), Metadata
              (read), Pull requests (read), Issues (read).
            </p>

            <div className="flex items-center gap-2">
              <button className="rb-btn-primary" disabled={busy}>
                {busy ? "Checking…" : "Connect repository"}
              </button>
              {connected && (
                <button
                  type="button"
                  className="rb-btn"
                  onClick={disconnect}
                  disabled={busy}
                >
                  Disconnect
                </button>
              )}
            </div>
          </form>

          {error && (
            <div className="rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn-fg">
              {error}
            </div>
          )}
          {result && (
            <div className="rounded-lg bg-success-bg p-3 text-[12px] text-success-fg">
              {result}
            </div>
          )}
        </div>

        {data.repository && (
          <div className="rb-card flex max-w-[620px] flex-col gap-2 p-4">
            <span className="text-[14px] font-semibold text-ink">
              Repository status
            </span>
            <dl className="grid grid-cols-2 gap-1 text-[12px]">
              <dt className="text-muted">owner / name</dt>
              <dd className="text-ink">
                {data.repository.owner}/{data.repository.name}
              </dd>
              <dt className="text-muted">default branch</dt>
              <dd className="text-ink">{data.repository.defaultBranch}</dd>
              <dt className="text-muted">visibility</dt>
              <dd className="text-ink">{data.repository.visibility}</dd>
              <dt className="text-muted">latest sync</dt>
              <dd className="text-ink">
                {data.repository.lastSyncAt
                  ? new Date(data.repository.lastSyncAt).toLocaleString()
                  : "never"}
              </dd>
              <dt className="text-muted">markdown source</dt>
              <dd className="text-ink">
                {data.markdownSource?.path ?? "not selected"}
              </dd>
            </dl>
          </div>
        )}
      </div>
    </>
  );
}
