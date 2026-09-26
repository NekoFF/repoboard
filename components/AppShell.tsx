"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KeyRound, Menu as MenuIcon, RefreshCw, Search } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sidebar } from "@/components/shell/Sidebar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ShortcutsDialog } from "@/components/shell/ShortcutsDialog";
import { ToolRail } from "@/components/shell/ToolRail";
import { ShellContext, type SidebarBoard, type SidebarDoc } from "@/components/shell/ShellContext";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { ConnectionContext, type ConnectionStatus } from "@/components/ConnectionState";
import { Logo, ToastHost, TooltipProvider } from "@/components/ui";
import { api, useResource, type ProjectInfo } from "@/lib/client/api";
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

/** Phones and narrow windows: the sidebar becomes a drawer behind a menu button. */
function MobileBar({ onSearch }: { onSearch: () => void }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="rb-glass flex h-12 shrink-0 items-center gap-2 px-3 md:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="rb-icon-btn" aria-label="Open navigation">
          <MenuIcon className="size-5" />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="rb-fade-in fixed inset-0 z-[70] bg-black/30" />
          <Dialog.Content className="rb-sheet-in rb-glass fixed inset-y-0 left-0 z-[71] flex focus:outline-none" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Suspense>
              <Sidebar />
            </Suspense>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Logo size={20} />
      <span className="flex-1 text-sm font-semibold text-ink">RepoBoard</span>
      <button className="rb-icon-btn" onClick={onSearch} aria-label="Search">
        <Search className="size-4" />
      </button>
    </div>
  );
}

export function AppShell({
  repo,
  viewer,
  connected,
  projects,
  docs,
  boards,
  managedByEnvironment,
  children,
}: {
  repo: string | null;
  viewer: string | null;
  connected: boolean;
  projects: ProjectInfo[];
  docs: SidebarDoc[];
  boards: SidebarBoard[];
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
      "g b": () => router.push("/boards"),
      "g m": () => router.push("/me"),
      "g d": () => router.push("/docs"),
      "g c": () => router.push("/repository"),
      "g a": () => router.push("/activity"),
      "g s": () => router.push("/settings"),
    },
    { enabled: unlocked },
  );

  const collaborators = useResource(api.people, [repo], { enabled: unlocked });
  const people = useMemo(
    () =>
      Array.from(
        new Set([...(viewer ? [viewer] : []), ...(collaborators.data?.people ?? []).map((p) => p.login)].map((l) => l.toLowerCase())),
      ),
    [viewer, collaborators.data],
  );

  const shell = useMemo(
    () => ({
      repo,
      viewer,
      people,
      connected: unlocked,
      projects,
      docs,
      boards,
      managedByEnvironment,
      openPalette,
      openShortcuts,
    }),
    [repo, viewer, people, unlocked, projects, docs, boards, managedByEnvironment, openPalette, openShortcuts],
  );

  const showingSettings = pathname === "/settings";

  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastHost>
          <ShellContext.Provider value={shell}>
            <ConnectionContext.Provider value={{ status, retry }}>
              {unlocked ? (
                // Panels on a desk: navigation recessed on the left, the work
                // floating over it, tools in a pill on the right edge.
                <div className="rb-desk flex h-[100dvh] w-full flex-col overflow-hidden md:flex-row md:p-3">
                  <MobileBar onSearch={() => openPalette()} />
                  {/* The navigation reaches well under the main panel, so its own
                      rounded corner is hidden and the two top edges read as one. */}
                  <div className="rb-panel-back rb-glass hidden pr-[60px] md:flex">
                    <Suspense>
                      <Sidebar />
                    </Suspense>
                  </div>
<div className="relative z-10 flex min-w-0 flex-1 overflow-hidden bg-surface md:rb-panel-main md:-ml-[60px]">
                    <main className="rb-page relative flex min-w-0 flex-1 flex-col overflow-hidden">
                      {children}
                      <ToolRail />
                    </main>
                  </div>
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
