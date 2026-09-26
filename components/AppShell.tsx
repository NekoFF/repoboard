"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu as MenuIcon, Search } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Sidebar } from "@/components/shell/Sidebar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ShortcutsDialog } from "@/components/shell/ShortcutsDialog";
import { ToolRail } from "@/components/shell/ToolRail";
import { DesktopBar } from "@/components/shell/DesktopBar";
import { SyncAgent } from "@/components/shell/SyncAgent";
import { ShellContext, type SidebarBoard, type SidebarDoc } from "@/components/shell/ShellContext";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { ConnectionContext, type ConnectionStatus } from "@/components/ConnectionState";
import { Logo, ToastHost, TooltipProvider } from "@/components/ui";
import { api, useResource, type AccessProblem, type ProjectInfo } from "@/lib/client/api";
import { ConnectScreen } from "@/components/connect/ConnectScreen";
import { ProjectUnavailable } from "@/components/connect/ProjectUnavailable";
import { openProject } from "@/lib/client/project";
import { useHotkeys } from "@/lib/client/hotkeys";

/** Phones and narrow windows: the sidebar becomes a drawer behind a menu button. */
function MobileBar({ onSearch }: { onSearch: () => void }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  // Documents differ only in ?path=…, so the query closes the drawer too.
  useEffect(() => setOpen(false), [pathname, search]);
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
  problem: serverProblem,
  sync,
  children,
}: {
  repo: string | null;
  viewer: string | null;
  connected: boolean;
  projects: ProjectInfo[];
  docs: SidebarDoc[];
  boards: SidebarBoard[];
  managedByEnvironment: boolean;
  /** Why the open project did not open, when the server could not open it. */
  problem: AccessProblem | null;
  /** Automatic sync of the boards for the open project. */
  sync: { autoSync: boolean; syncedAt: number | null };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<ConnectionStatus>(connected ? "connected" : "disconnected");
  const [check, setCheck] = useState(0);
  const [problem, setProblem] = useState<AccessProblem | null>(serverProblem);
  useEffect(() => setProblem(serverProblem), [serverProblem]);
  const lastCheckAt = useRef(Date.now());
  const retry = useCallback(() => setCheck((value) => value + 1), []);
  const [palette, setPalette] = useState<{ open: boolean; query: string }>({ open: false, query: "" });
  const [shortcuts, setShortcuts] = useState(false);

  // The server verified the token for this render; re-check only when the tab
  // comes back after a while, so an expired token is noticed without polling.
  // A new token or another project comes with a fresh page: start trusting it again.
  useEffect(() => setCheck(0), [repo]);

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
      .then((result) => {
        if (cancelled) return;
        setProblem(result.access);
        setStatus(result.connected ? "connected" : "error");
      })
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

  // Projects are shared by every window on this computer (the browser, the
  // desktop app): when one of them connects or switches a project, the others
  // pick it up the next time they are looked at, instead of showing one
  // project's name over another's data.
  const projectKey = projects.map((p) => `${p.repo.toLowerCase()}${p.active ? "*" : ""}`).join(",");
  useEffect(() => {
    if (managedByEnvironment) return;
    let lastLook = 0;
    const look = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastLook < 2_000) return;
      lastLook = Date.now();
      api
        .connection()
        .then((now) => {
          const key = now.projects.map((p) => `${p.repo.toLowerCase()}${p.active ? "*" : ""}`).join(",");
          if (key === projectKey) return;
          const active = (list: { repo: string; active: boolean }[]) => list.find((p) => p.active)?.repo.toLowerCase() ?? null;
          if (active(now.projects) !== active(projects)) openProject();
          else router.refresh();
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
    };
  }, [projectKey, projects, managedByEnvironment, router]);

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
      "g i": () => router.push("/inbox"),
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
  const showingConnect = pathname === "/connect";

  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastHost>
          <ShellContext.Provider value={shell}>
            <ConnectionContext.Provider value={{ status, retry }}>
              {/* In the desktop app: a strip to drag the window by, where its buttons sit. */}
              <div className="rb-desktop-titlebar" aria-hidden />
              <DesktopBar />
              <SyncAgent enabled={unlocked && sync.autoSync} syncedAt={sync.syncedAt} />
              {showingConnect ? (
                // Connecting stands before the app, whether a project is open or not.
                children
              ) : unlocked ? (
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
              ) : projects.length === 0 && !problem ? (
                <ConnectScreen connectedRepos={[]} canClose={false} />
              ) : (
                <ProjectUnavailable problem={problem} projects={projects} />
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
