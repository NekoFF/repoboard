"use client";

import { X } from "lucide-react";
import { ConnectFlow } from "@/components/connect/ConnectFlow";
import { StartFrame } from "@/components/connect/Frame";
import { openProject } from "@/lib/client/project";

/**
 * First start, adding a project, or giving one a new key — one screen, one
 * way to do it. `connectedRepos` are lower-case owner/name.
 */
export function ConnectScreen({
  replacing,
  connectedRepos,
  canClose,
}: {
  replacing?: string | null;
  connectedRepos: string[];
  canClose: boolean;
}) {
  const firstRun = connectedRepos.length === 0;
  const name = replacing?.split("/")[1];
  const title = replacing ? `A new key for ${name}` : firstRun ? "Set up RepoBoard" : "Add a project";
  const lead = replacing
    ? "The old key no longer opens it. Its boards and checklists are safe on this computer."
    : firstRun
      ? "Connect a GitHub repository to start. Its boards, checklists and notes live next to the code."
      : "Connect another GitHub repository. Each project keeps its own boards and key.";

  return (
    <StartFrame>
      <div className="relative">
        {canClose && (
          <button
            type="button"
            className="rb-icon-btn absolute -right-3 -top-3 size-8 rounded-full"
            aria-label="Close"
            onClick={() => (window.history.length > 1 ? window.history.back() : openProject("/"))}
          >
            <X className="size-4" />
          </button>
        )}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        <p className="mt-2 text-md leading-relaxed text-muted">{lead}</p>
      </div>
      <div className="mt-7">
        <ConnectFlow replacing={replacing} connectedRepos={connectedRepos} onConnected={() => openProject("/")} />
      </div>
    </StartFrame>
  );
}
