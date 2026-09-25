"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { RelativeTime, Spinner, useToast } from "@/components/ui";

export function TopBar({
  owner,
  repo,
  defaultBranch,
  lastSyncAt,
  connected,
  actions,
}: {
  owner: string | null;
  repo: string | null;
  defaultBranch: string | null;
  lastSyncAt: number | null;
  connected: boolean;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pulling, setPulling] = useState(false);

  const pull = async () => {
    setPulling(true);
    try {
      router.refresh();
      toast.push({ kind: "info", message: "Refreshed from GitHub" });
    } finally {
      setPulling(false);
    }
  };

  return (
    <header className="flex h-[58px] w-full shrink-0 items-center gap-2.5 border-b border-border bg-surface px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[12px] text-muted">{owner ?? "Local"}</span>
        <span className="text-[12px] text-muted/60">/</span>
        <span className="truncate text-[12px] font-semibold text-ink">{repo ?? "No repository"}</span>
        {defaultBranch && (
          <span className="rb-pill ml-1 hidden font-mono sm:inline-flex">{defaultBranch}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {connected ? (
          <span className="rb-pill-ok" title="Token accepted by GitHub">
            <span aria-hidden>✓</span>
            {lastSyncAt ? (
              <>
                Synced <RelativeTime value={lastSyncAt} />
              </>
            ) : (
              "Connected"
            )}
          </span>
        ) : (
          <span className="rb-pill-warn hidden sm:inline-flex">Not connected</span>
        )}
        {connected && (
          <button
            className="rb-btn-ghost"
            onClick={pull}
            disabled={pulling}
            title="Re-read live GitHub data"
          >
            {pulling ? <Spinner /> : null}
            {pulling ? "Pulling" : "Pull"}
          </button>
        )}
        {actions}
      </div>
    </header>
  );
}
