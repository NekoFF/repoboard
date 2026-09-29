"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { setSyncStatus } from "@/lib/client/sync";

/**
 * Keeps the boards in step with GitHub when the project has automatic sync
 * on: once when the app opens, when the window is looked at again, every
 * minute while it is in view, and a few seconds after a change here — so a
 * second computer, or a teammate, sees the same boards without a button.
 * When something arrived, the page refreshes to show it.
 */
export function SyncAgent({ enabled, syncedAt }: { enabled: boolean; syncedAt: number | null }) {
  const router = useRouter();
  const running = useRef(false);
  const again = useRef(false);

  // Not syncing on its own yet: take the boards from GitHub — and start syncing
  // when another computer already does (lib/board-service.ts adoptBoards).
  useEffect(() => {
    if (enabled) return;
    let last = 0;
    const adopt = async () => {
      if (Date.now() - last < 5 * 60_000 || document.visibilityState !== "visible") return;
      last = Date.now();
      try {
        const result = await api.boardAdopt();
        if (result.autoSync || result.pulled > 0) {
          router.refresh();
          window.dispatchEvent(new Event("rb-live"));
        }
      } catch {
        // Offline or no access: the page says so elsewhere.
      }
    };
    void adopt();
    window.addEventListener("focus", adopt);
    return () => window.removeEventListener("focus", adopt);
  }, [enabled, router]);

  useEffect(() => {
    if (!enabled) {
      setSyncStatus({ state: "off", error: null });
      return;
    }
    setSyncStatus({ state: "idle", syncedAt, error: null });
    let lastRun = 0;
    let changeTimer: number | undefined;

    const run = async () => {
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      lastRun = Date.now();
      setSyncStatus({ state: "syncing" });
      try {
        const result = await api.syncNow();
        setSyncStatus({ state: "idle", syncedAt: result.syncedAt, error: null });
        if (result.pulled > 0) router.refresh();
      } catch (err) {
        setSyncStatus({ state: "error", error: (err as Error).message });
      } finally {
        running.current = false;
        if (again.current) {
          again.current = false;
          void run();
        }
      }
    };

    const onLook = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRun > 15_000) void run();
    };
    const onChange = () => {
      window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(() => void run(), 4_000);
    };
    const onNow = () => void run();
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastRun > 55_000) void run();
    }, 10_000);

    void run();
    window.addEventListener("focus", onLook);
    document.addEventListener("visibilitychange", onLook);
    window.addEventListener("rb-boards-changed", onChange);
    window.addEventListener("rb-sync-now", onNow);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(changeTimer);
      window.removeEventListener("focus", onLook);
      document.removeEventListener("visibilitychange", onLook);
      window.removeEventListener("rb-boards-changed", onChange);
      window.removeEventListener("rb-sync-now", onNow);
    };
    // syncedAt only seeds the status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, router]);

  return null;
}
