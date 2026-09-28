"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

/**
 * Follows GitHub for the documents: every minute while the app is in view,
 * and whenever it comes back into view, one look at the default branch's
 * newest commit (lib/docs-service.ts watchDocs). A new commit reads the files
 * again; what changed shows without a reload. The result goes out as
 * "rb-docs-status" for the "Read from main at …" line (DocsSource).
 */
const EVERY_MS = 60_000;

export function checkDocs(force = false) {
  return api.watchDocs(force).then((result) => {
    window.dispatchEvent(new CustomEvent("rb-docs-status", { detail: result }));
    return result;
  });
}

export function DocsWatch() {
  const router = useRouter();
  useEffect(() => {
    let running = false;
    const look = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const result = await checkDocs();
        if (result.changed) {
          router.refresh();
          window.dispatchEvent(new Event("rb-live"));
        }
      } catch {
        // Offline or the key ran out: the page says so elsewhere.
      } finally {
        running = false;
      }
    };
    void look();
    const id = window.setInterval(look, EVERY_MS);
    document.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
    };
  }, [router]);
  return null;
}
