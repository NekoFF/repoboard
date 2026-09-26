"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Spinner } from "@/components/ui";

/**
 * What the desktop app adds to the strip at the top of the window: back and
 * forward (there is no browser around it to provide them), a two-finger
 * swipe on the trackpad for the same, and a quiet pill when a new version is
 * out. Renders nothing in a browser.
 */

type UpdateState =
  | { state: "idle" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; progress?: number }
  | { state: "ready"; version: string }
  | { state: "failed"; version: string; error?: string };

interface DesktopBridge {
  platform: "mac" | "win" | "linux";
  updates?: {
    state: () => Promise<UpdateState>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    subscribe: (callback: (state: UpdateState) => void) => () => void;
  };
}

interface NavigationLike extends EventTarget {
  canGoBack: boolean;
  canGoForward: boolean;
}

function bridge(): DesktopBridge | null {
  return typeof window === "undefined" ? null : ((window as unknown as { repoboardDesktop?: DesktopBridge }).repoboardDesktop ?? null);
}

/** Can a scrollable box under the pointer still move this way? Then the swipe is scrolling, not going back. */
function scrollsSideways(target: EventTarget | null, dx: number): boolean {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const overflow = getComputedStyle(el).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const atStart = el.scrollLeft <= 0;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    if ((dx < 0 && !atStart) || (dx > 0 && !atEnd)) return true;
  }
  return false;
}

export function DesktopBar() {
  const [desktop, setDesktop] = useState<DesktopBridge | null>(null);
  const [nav, setNav] = useState({ back: false, forward: false });
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });

  useEffect(() => setDesktop(bridge()), []);

  // Whether there is somewhere to go back or forward to.
  useEffect(() => {
    if (!desktop) return;
    const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
    const read = () =>
      setNav(
        navigation
          ? { back: navigation.canGoBack, forward: navigation.canGoForward }
          : { back: window.history.length > 1, forward: true },
      );
    read();
    navigation?.addEventListener("currententrychange", read);
    window.addEventListener("popstate", read);
    return () => {
      navigation?.removeEventListener("currententrychange", read);
      window.removeEventListener("popstate", read);
    };
  }, [desktop]);

  // Two fingers across the trackpad, past the edge of anything that scrolls: back or forward.
  useEffect(() => {
    if (desktop?.platform !== "mac") return;
    let sum = 0;
    let quietUntil = 0;
    let reset: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) return;
      if (Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.5) {
        sum = 0;
        return;
      }
      if (Date.now() < quietUntil || scrollsSideways(event.target, event.deltaX)) {
        sum = 0;
        return;
      }
      sum += event.deltaX;
      window.clearTimeout(reset);
      reset = window.setTimeout(() => (sum = 0), 220);
      if (Math.abs(sum) > 180) {
        // The swipe's momentum keeps sending events: let it pass.
        quietUntil = Date.now() + 700;
        if (sum < 0) window.history.back();
        else window.history.forward();
        sum = 0;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.clearTimeout(reset);
    };
  }, [desktop]);

  useEffect(() => {
    const updates = desktop?.updates;
    if (!updates) return;
    void updates.state().then(setUpdate);
    return updates.subscribe(setUpdate);
  }, [desktop]);

  if (!desktop) return null;

  const pill = (() => {
    const updates = desktop.updates;
    if (!updates || update.state === "idle") return null;
    const mac = desktop.platform === "mac";
    if (update.state === "available" || update.state === "failed") {
      return (
        <button type="button" className="rb-desktop-pill" onClick={() => void updates.download()} title={update.state === "failed" ? update.error : undefined}>
          {update.state === "failed" ? <RotateCw className="size-3" /> : <ArrowDownToLine className="size-3" />}
          {update.state === "failed" ? "Update failed — try again" : `Update to ${update.version}`}
        </button>
      );
    }
    if (update.state === "downloading") {
      return (
        <span className="rb-desktop-pill">
          <Spinner /> Downloading {update.progress ? `${Math.round(update.progress * 100)}%` : "…"}
        </span>
      );
    }
    return (
      <button type="button" className="rb-desktop-pill rb-desktop-pill-ready" onClick={() => void updates.install()}>
        {mac ? `Open RepoBoard ${update.version}` : `Restart to update`}
      </button>
    );
  })();

  return (
    <div className="rb-desktop-bar">
      <div className="rb-desktop-nav">
        <button
          type="button"
          className="rb-desktop-navbtn"
          onClick={() => window.history.back()}
          disabled={!nav.back}
          aria-label="Back"
          title={desktop.platform === "mac" ? "Back  ⌘[" : "Back  Alt+←"}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          className="rb-desktop-navbtn"
          onClick={() => window.history.forward()}
          disabled={!nav.forward}
          aria-label="Forward"
          title={desktop.platform === "mac" ? "Forward  ⌘]" : "Forward  Alt+→"}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      {pill && <div className="rb-desktop-update">{pill}</div>}
    </div>
  );
}
