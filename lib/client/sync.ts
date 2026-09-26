"use client";

import { useSyncExternalStore } from "react";

/**
 * How automatic sync is doing, for whoever shows it (the board header, the
 * tool rail). components/shell/SyncAgent does the work and writes here.
 */
export interface SyncStatus {
  state: "off" | "idle" | "syncing" | "error";
  syncedAt: number | null;
  error: string | null;
}

let status: SyncStatus = { state: "off", syncedAt: null, error: null };
const listeners = new Set<() => void>();

export function setSyncStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  for (const l of listeners) l();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => status,
  );
}

/** Ask the agent to sync now (e.g. from a "Sync now" button). */
export function requestSync(): void {
  window.dispatchEvent(new Event("rb-sync-now"));
}
