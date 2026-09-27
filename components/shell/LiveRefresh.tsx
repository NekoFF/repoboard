"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

/**
 * Keeps open pages current without a reload: every few seconds it asks the
 * server whether the project's boards changed — a teammate's sync, an agent
 * working through the MCP server — and if so refreshes the page's data and
 * tells live resources to load again ("rb-live"). It waits while the person
 * is dragging or typing, so nothing moves under their hands. The reload
 * button and ⌘R still work as before.
 */
const EVERY_MS = 3000;

export function LiveRefresh() {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const waiting = useRef(false);
  const pressed = useRef(false);

  useEffect(() => {
    const down = () => (pressed.current = true);
    const up = () => (pressed.current = false);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    // Let go outside the window: no pointerup arrives, the blur says it.
    window.addEventListener("blur", up);

    const busy = () => {
      if (pressed.current) return true;
      const el = document.activeElement as HTMLElement | null;
      return Boolean(el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"));
    };
    const apply = () => {
      if (busy()) return;
      waiting.current = false;
      router.refresh();
      window.dispatchEvent(new Event("rb-live"));
    };
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { version } = await api.liveVersion();
        if (last.current !== null && version !== last.current) waiting.current = true;
        last.current = version;
      } catch {
        // Offline or the key ran out: the page says so elsewhere.
      }
      if (waiting.current) apply();
    };
    void look();
    const id = window.setInterval(look, EVERY_MS);
    document.addEventListener("visibilitychange", look);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", up);
    };
  }, [router]);

  return null;
}
