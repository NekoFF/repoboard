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
      // Give the refresh a beat so the button state reads as a real action.
      await new Promise((resolve) => setTimeout(resolve, 400));
      toast.push({ kind: "info", message: "Refreshed from GitHub" });
    } finally {
      setPulling(false);
    }
  };

  return (
    <header className="flex h-[68px] w-full shrink-0 items-center gap-2.5 border-b border-border bg-surface/95 px-[18px] backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {owner ?? "RepoBoard"}
        </span>
        <span className="text-[14px] text-muted">/</span>
        <span className="truncate text-[14px] font-medium text-ink">
          {repo ?? "no repository"}
        </span>
        {defaultBranch && (
          <span className="rb-pill font-mono">{defaultBranch}</span>
        )}
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
          <span className="rb-pill-warn">Not connected</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          className="rb-btn"
          onClick={pull}
          disabled={pulling}
          title="Re-read live GitHub data"
        >
          {pulling ? <Spinner /> : null}
          {pulling ? "Pulling" : "Pull"}
        </button>
        {actions}
      </div>
    </header>
  );
}
