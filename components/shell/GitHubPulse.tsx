"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/client/api";

/**
 * Keeps what the app shows from GitHub current — branches, commits, pull
 * requests, issues, Project life. Every minute while the app is in view, and
 * when it comes back into view, it asks for a cheap fingerprint of the
 * repository (two requests: branch heads, the issue or pull request changed
 * last); when it moves, "rb-github" tells every resource marked `github: true`
 * to load again. Before, these loaded once per page, and something new on
 * GitHub showed only after a reload.
 */
const EVERY_MS = 60_000;

export function GitHubPulse() {
  const last = useRef<string | null>(null);
  useEffect(() => {
    let running = false;
    let lastLook = 0;
    // The first look happens at once, in view or not: it is what the page's data was loaded against.
    const look = async (first = false) => {
      if (running || (!first && (document.visibilityState !== "visible" || Date.now() - lastLook < 10_000))) return;
      running = true;
      lastLook = Date.now();
      try {
        const { pulse } = await api.pulse();
        if (last.current !== null && pulse !== last.current) window.dispatchEvent(new Event("rb-github"));
        last.current = pulse;
      } catch {
        // Offline or the key ran out: the page says so elsewhere.
      } finally {
        running = false;
      }
    };
    void look(true);
    const again = () => void look();
    const id = window.setInterval(again, EVERY_MS);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, []);
  return null;
}
