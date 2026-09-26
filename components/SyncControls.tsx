"use client";

import { useState } from "react";
import { AlertCircle, Check, CloudUpload, GitBranch } from "lucide-react";
import { Modal, RelativeTime, Spinner, Tooltip, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { requestSync, useSyncStatus } from "@/lib/client/sync";

/** In the board header when sync is on: when it last synced; press to sync now. */
export function SyncChip() {
  const status = useSyncStatus();
  const tip =
    status.state === "error"
      ? `Sync failed: ${status.error ?? "unknown error"}. Press to try again.`
      : "The boards sync on their own through the repoboard branch. Press to sync now.";
  return (
    <Tooltip content={tip}>
      <button
        className={`rb-btn rb-btn-sm ${status.state === "error" ? "border-danger/40 text-danger" : ""}`}
        onClick={requestSync}
        aria-label="Sync now"
      >
        {status.state === "syncing" ? (
          <Spinner />
        ) : status.state === "error" ? (
          <AlertCircle className="size-3.5" />
        ) : (
          <Check className="size-3.5 text-state-done" />
        )}
        {status.state === "syncing" ? (
          "Syncing"
        ) : status.state === "error" ? (
          "Sync failed"
        ) : status.syncedAt ? (
          <>
            Synced <RelativeTime value={status.syncedAt} />
          </>
        ) : (
          "Synced"
        )}
      </button>
    </Tooltip>
  );
}

/**
 * Turning automatic sync on or off, saying plainly what it writes and where:
 * board.json only, on a branch of its own, never the code.
 */
export function AutoSyncDialog({ on, onClose, onChanged }: { on: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const change = async () => {
    setBusy(true);
    try {
      const result = await api.setAutoSync(!on);
      toast.push({
        kind: "success",
        message: on ? "Automatic sync is off" : "Automatic sync is on",
        detail: !on && result.pulled ? `${result.pulled} change${result.pulled === 1 ? "" : "s"} came in from GitHub` : undefined,
      });
      onChanged();
    } catch (err) {
      toast.push({ kind: "error", message: "Could not change sync", detail: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <Modal
      title={on ? "Automatic sync is on" : "Sync the boards automatically"}
      description={
        on
          ? "Boards, cards and their order travel between computers and teammates on their own."
          : "Your other computers and your teammates see the same boards, without pressing Save or Sync."
      }
      onClose={onClose}
      footer={
        <>
          <button className="rb-btn" onClick={onClose}>
            {on ? "Keep it on" : "Not now"}
          </button>
          <div className="flex-1" />
          <button className={on ? "rb-btn" : "rb-btn-primary"} onClick={change} disabled={busy}>
            {busy && <Spinner />} {on ? "Turn off" : "Turn on"}
          </button>
        </>
      }
    >
      <ul className="flex flex-col gap-3 text-sm text-muted">
        <li className="flex gap-3">
          <GitBranch className="mt-0.5 size-4 shrink-0 text-ink" />
          <span>
            RepoBoard keeps <span className="font-mono text-xs text-ink">.repoboard/board.json</span> on a branch of its own,{" "}
            <span className="font-mono text-xs text-ink">repoboard</span>, made from your main branch the first time. Your code
            and its history are never touched.
          </span>
        </li>
        <li className="flex gap-3">
          <CloudUpload className="mt-0.5 size-4 shrink-0 text-ink" />
          <span>
            A few seconds after a change here, and every minute while the app is open, it merges what others changed — card by
            card, the newer edit wins — and saves the result.
          </span>
        </li>
        <li className="flex gap-3">
          <Check className="mt-0.5 size-4 shrink-0 text-ink" />
          <span>Checklists and documents still go through the review you know, commit by commit.</span>
        </li>
      </ul>
    </Modal>
  );
}
