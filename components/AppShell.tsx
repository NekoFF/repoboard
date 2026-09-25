"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { Spinner, ToastHost } from "@/components/ui";
import { ConnectionContext, type ConnectionStatus } from "@/components/ConnectionState";
import { api } from "@/lib/client/api";

function ConnectionGate({ status, retry }: { status: ConnectionStatus; retry: () => void }) {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-canvas">
      <header className="flex h-[58px] items-center border-b border-border bg-surface px-5">
        <span className="grid size-7 place-items-center rounded-md bg-active text-[12px] font-semibold text-white">R</span>
        <span className="ml-2.5 text-[14px] font-semibold text-ink">RepoBoard</span>
      </header>
      <div className="flex flex-1 items-center justify-center p-5">
        <div className="rb-card w-full max-w-[420px] p-6 sm:p-8">
          {status === "checking" ? (
            <>
              <Spinner className="text-muted" />
              <h1 className="mt-4 text-[20px] font-semibold text-ink">Checking GitHub access</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">Your board will open after the connection is verified.</p>
            </>
          ) : (
            <>
              <span className="grid size-9 place-items-center rounded-lg bg-pill text-[18px] text-ink" aria-hidden>⌁</span>
              <h1 className="mt-4 text-[20px] font-semibold text-ink">{status === "error" ? "Connection needs attention" : "Connect GitHub to start"}</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                {status === "error"
                  ? "RepoBoard could not verify access to GitHub. The token may have expired, or GitHub may be unavailable."
                  : "Add a GitHub token and choose a repository to access your board."}
              </p>
              <div className="mt-5 flex items-center gap-2">
                <Link href="/settings" className="rb-btn-primary">{status === "error" ? "Check connection" : "Connect repository"}</Link>
                {status === "error" && <button className="rb-btn" onClick={retry}>Try again</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  repo,
  connected,
  children,
}: {
  repo: string | null;
  connected: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [status, setStatus] = useState<ConnectionStatus>(connected ? "checking" : "disconnected");
  const [check, setCheck] = useState(0);
  const lastCheckAt = useRef(0);
  const retry = useCallback(() => setCheck((value) => value + 1), []);

  useEffect(() => {
    if (!connected) {
      setStatus("disconnected");
      return;
    }
    let cancelled = false;
    // Keep the board mounted while refreshing an already verified connection.
    lastCheckAt.current = Date.now();
    api.branches()
      .then(() => { if (!cancelled) setStatus("connected"); })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [connected, check]);

  useEffect(() => {
    if (!connected) return;
    const recheckIfStale = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheckAt.current < 5 * 60_000) return;
      lastCheckAt.current = Date.now();
      retry();
    };
    const onFocus = () => recheckIfStale();
    const onVisible = () => recheckIfStale();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(recheckIfStale, 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [connected, retry]);

  const unlocked = status === "connected";
  const showingSettings = pathname === "/settings";

  return (
    <ToastHost>
      <ConnectionContext.Provider value={{ status, retry }}>
        {unlocked ? (
          <div className="flex h-screen w-full overflow-hidden bg-canvas">
            <Sidebar repo={repo} connected />
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">{children}</main>
          </div>
        ) : showingSettings ? (
          <main className="flex h-screen min-w-0 flex-col overflow-hidden bg-surface">{children}</main>
        ) : (
          <ConnectionGate status={status} retry={retry} />
        )}
        {unlocked && <CommandPalette connected />}
      </ConnectionContext.Provider>
    </ToastHost>
  );
}
