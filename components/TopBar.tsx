"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

export function TopBar({
  owner,
  repo,
  defaultBranch,
  lastSync,
  connected,
  actions,
}: {
  owner: string | null;
  repo: string | null;
  defaultBranch: string | null;
  lastSync: string | null;
  connected: boolean;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const [pulling, setPulling] = useState(false);

  const pull = async () => {
    setPulling(true);
    try {
      await fetch("/api/board?refresh=1", { cache: "no-store" });
      router.refresh();
    } finally {
      setPulling(false);
    }
  };

  return (
    <header className="flex h-[68px] w-full shrink-0 items-center gap-[10px] border-b border-border bg-surface px-[18px]">
      <div className="flex min-w-0 flex-1 items-center gap-[10px]">
        <span className="text-[15px] font-semibold text-ink">
          {owner ?? "RepoBoard"}
        </span>
        <span className="text-[14px] text-muted">/</span>
        <span className="truncate text-[14px] font-medium text-ink">
          {repo ?? "not connected"}
        </span>
        {defaultBranch && <span className="rb-pill">{defaultBranch}</span>}
        {connected ? (
          <span className="inline-flex items-center rounded-sm bg-success-bg px-2 py-1 text-[11px] font-medium text-success-fg">
            ✓ {lastSync ? `Synced ${lastSync}` : "GitHub connected"}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-sm bg-warn-bg px-2 py-1 text-[11px] font-medium text-warn-fg">
            Not connected
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button className="rb-btn" onClick={pull} disabled={pulling}>
          {pulling ? "Pulling…" : "Pull"}
        </button>
        {actions}
      </div>
    </header>
  );
}
