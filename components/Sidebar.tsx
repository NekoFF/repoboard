"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

const NAV = [
  { href: "/", icon: "⌂", label: "Overview", tab: null },
  { href: "/board", icon: "▦", label: "Board", tab: null },
  { href: "/repository", icon: "⌘", label: "Repository", tab: null },
  { href: "/repository?tab=branches", icon: "⑂", label: "Branches", tab: "branches" },
  { href: "/repository?tab=pulls", icon: "↗", label: "Pull Requests", tab: "pulls" },
  { href: "/repository?tab=commits", icon: "◆", label: "Commits", tab: "commits" },
  { href: "/repository?tab=issues", icon: "○", label: "Issues", tab: "issues" },
  { href: "/markdown-sync", icon: "M", label: "Markdown Sync", tab: null },
  { href: "/activity", icon: "↺", label: "Activity", tab: null },
];

export function Sidebar(props: { repo: string | null; connected: boolean }) {
  return (
    <Suspense fallback={<SidebarShell {...props} nav={<NavList active={null} />} />}>
      <SidebarWithNav {...props} />
    </Suspense>
  );
}

function SidebarWithNav({
  repo,
  connected,
}: {
  repo: string | null;
  connected: boolean;
}) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");

  // The repository screen backs five nav entries, so the active one is decided
  // by path *and* tab — otherwise every repository entry lights up at once.
  const active = NAV.findIndex((item) => {
    const base = item.href.split("?")[0];
    if (base === "/") return pathname === "/";
    if (base !== pathname && !pathname.startsWith(`${base}/`)) return false;
    if (base === "/repository") return (item.tab ?? null) === (tab ?? null);
    return true;
  });

  return (
    <SidebarShell
      repo={repo}
      connected={connected}
      nav={<NavList active={active} />}
    />
  );
}

function NavList({ active }: { active: number | null }) {
  return (
    <nav className="flex flex-col gap-[2px]">
      {NAV.map((item, index) => {
        const isActive = active === index;
        return (
          <Link
            key={item.label}
            href={item.href}
            className={`flex items-center gap-[10px] rounded-md px-[10px] py-2 ${
              isActive ? "bg-active text-white" : "text-ink hover:bg-pill"
            }`}
          >
            <span
              className={`w-3 text-[12px] font-medium ${
                isActive ? "text-white" : "text-muted"
              }`}
            >
              {item.icon}
            </span>
            <span className="text-[13px]">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarShell({
  repo,
  connected,
  nav,
}: {
  repo: string | null;
  connected: boolean;
  nav: ReactNode;
}) {
  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col gap-[14px] overflow-y-auto border-r border-border bg-surface p-[18px]">
      <div className="flex items-center gap-[10px]">
        <div className="flex size-7 items-center justify-center rounded-md bg-active text-[12px] font-semibold text-white">
          R
        </div>
        <span className="text-[16px] font-semibold text-ink">RepoBoard</span>
      </div>

      <Link
        href="/settings"
        className="flex flex-col gap-[2px] rounded-lg bg-pill p-[10px] transition-opacity hover:opacity-80"
      >
        <span className="truncate text-[13px] font-semibold text-ink">
          {repo ?? "No repository"}
        </span>
        <span className="text-[11px] text-muted">
          {connected ? "GitHub connected" : "Not connected"}
        </span>
      </Link>

      {nav}

      <div className="flex-1" />

      <Link
        href="/settings"
        className="flex items-center gap-[10px] p-2 text-ink hover:opacity-70"
      >
        <span className="w-3 text-[12px] font-medium text-muted">⚙</span>
        <span className="text-[13px]">Settings</span>
      </Link>
    </aside>
  );
}
