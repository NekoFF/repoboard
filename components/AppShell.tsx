"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KeyRound, RefreshCw } from "lucide-react";
import { Sidebar } from "@/components/shell/Sidebar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ShortcutsDialog } from "@/components/shell/ShortcutsDialog";
import { ShellContext, type SidebarDoc } from "@/components/shell/ShellContext";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { ConnectionContext, type ConnectionStatus } from "@/components/ConnectionState";
import { Logo, ToastHost, TooltipProvider } from "@/components/ui";
import { api, type ProjectInfo } from "@/lib/client/api";
import { useHotkeys } from "@/lib/client/hotkeys";

function ConnectionGate({ status, retry }: { status: ConnectionStatus; retry: () => void }) {
  const failed = status === "error";
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-canvas">
      <header className="flex h-14 items-center gap-2.5 px-5">
        <Logo />
        <span className="text-md font-semibold tracking-[-0.01em] text-ink">RepoBoard</span>
      </header>
      <div className="flex flex-1 items-center justify-center p-5">
        <div className="rb-enter w-full max-w-[440px]">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">
            {failed ? "GitHub stopped accepting the token" : "Plan your project inside its repository"}
          </h1>
          <p className="mt-3 text-md leading-relaxed text-muted">
            {failed
              ? "It may have expired or lost access to the repository. Your board is safe on this computer; connect again to open it."
              : "Cards, checklists and roadmaps that live next to your code, in files GitHub already understands. Connect a repository to begin."}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Link href="/settings" className="rb-btn-primary h-9 px-4">
              <KeyRound className="size-4" />
              {failed ? "Update the token" : "Connect a repository"}
            </Link>
            {failed && (
              <button className="rb-btn h-9" onClick={retry}>
                <RefreshCw className="size-3.5" /> Try again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  repo,
  connected,
  projects,
  docs,
  managedByEnvironment,
  children,
}: {
  repo: string | null;
  connected: boolean;
  projects: ProjectInfo[];
  docs: SidebarDoc[];
  managedByEnvironment: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<ConnectionStatus>(connected ? "connected" : "disconnected");
  const [check, setCheck] = useState(0);
  const lastCheckAt = useRef(Date.now());
  const retry = useCallback(() => setCheck((value) => value + 1), []);
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({ open: false, query: "" });
  const [shortcuts, setShortcuts] = useState(false);

  // The server verified the token for this render; re-check only when the tab
  // comes back after a while, so an expired token is noticed without polling.
  useEffect(() => {
    if (!connected) {
      setStatus("disconnected");
      return;
    }
    if (check === 0) {
      setStatus("connected");
      return;
    }
    let cancelled = false;
    lastCheckAt.current = Date.now();
    api
      .connection()
      .then((result) => !cancelled && setStatus(result.connected ? "connected" : "error"))
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [connected, check]);

  useEffect(() => {
    if (!connected) return;
    const recheckIfStale = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheckAt.current < 60_000) return;
      lastCheckAt.current = Date.now();
      retry();
    };
    window.addEventListener("focus", recheckIfStale);
    document.addEventListener("visibilitychange", recheckIfStale);
    return () => {
      window.removeEventListener("focus", recheckIfStale);
      document.removeEventListener("visibilitychange", recheckIfStale);
    };
  }, [connected, retry]);

  const openPalette = useCallback((query = "") => setPalette({ open: true, query }), []);
  const openShortcuts = useCallback(() => setShortcuts(true), []);

  const unlocked = status === "connected";

  useHotkeys(
    {
      "mod+k": () => setPalette((p) => ({ open: !p.open, query: "" })),
      "?": openShortcuts,
      "g o": () => router.push("/"),
      "g b": () => router.push("/board"),
      "g d": () => router.push("/docs"),
      "g c": () => router.push("/repository"),
      "g a": () => router.push("/activity"),
      "g s": () => router.push("/settings"),
    },
    { enabled: unlocked },
  );

  const shell = useMemo(
    () => ({
      repo,
      connected: unlocked,
      projects,
      docs,
      managedByEnvironment,
      openPalette,
      openShortcuts,
    }),
    [repo, unlocked, projects, docs, managedByEnvironment, openPalette, openShortcuts],
  );

  const showingSettings = pathname === "/settings";

  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastHost>
          <ShellContext.Provider value={shell}>
            <ConnectionContext.Provider value={{ status, retry }}>
              {unlocked ? (
                <div className="flex h-screen w-full overflow-hidden bg-canvas">
                  <div className="hidden md:flex">
                    <Suspense>
                      <Sidebar />
                    </Suspense>
                  </div>
                  <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface md:my-1.5 md:mr-1.5 md:rounded-xl md:border md:border-border md:shadow-card">
                    {children}
                  </main>
                </div>
              ) : showingSettings ? (
                <main className="flex h-screen min-w-0 flex-col overflow-auto bg-canvas">{children}</main>
              ) : (
                <ConnectionGate status={status} retry={retry} />
              )}
              {unlocked && (
                <CommandPalette
                  open={palette.open}
                  initialQuery={palette.query}
                  onOpenChange={(open) => setPalette((p) => ({ ...p, open }))}
                />
              )}
              {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
            </ConnectionContext.Provider>
          </ShellContext.Provider>
        </ToastHost>
      </TooltipProvider>
    </ThemeProvider>
  );
}
