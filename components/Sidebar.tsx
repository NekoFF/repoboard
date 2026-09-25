"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type IconName = "overview" | "board" | "repository" | "markdown" | "activity" | "settings";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    board: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
    repository: <><path d="M6 3v12a3 3 0 0 0 3 3h6" /><circle cx="6" cy="3" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M18 8v8" /></>,
    markdown: <><path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
    activity: <><path d="M3 12h4l2-5 4 10 2-5h6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-[17px] shrink-0" aria-hidden>{paths[name]}</svg>;
}

const NAV: { href: string; icon: IconName; label: string }[] = [
  { href: "/", icon: "overview", label: "Overview" },
  { href: "/board", icon: "board", label: "Board" },
  { href: "/repository", icon: "repository", label: "Repository" },
  { href: "/markdown-sync", icon: "markdown", label: "Markdown sync" },
  { href: "/activity", icon: "activity", label: "Activity" },
];

export function Sidebar({ repo, connected }: { repo: string | null; connected: boolean }) {
  const pathname = usePathname();
  const [owner, name] = repo?.split("/") ?? [];

  return (
    <aside className="flex h-full w-[56px] shrink-0 flex-col border-r border-border bg-surface md:w-[226px]">
      <Link href="/" aria-label="RepoBoard home" className="flex h-[58px] items-center justify-center gap-2.5 border-b border-border px-2 md:justify-start md:px-4">
        <span className="grid size-7 place-items-center rounded-md bg-active text-[12px] font-semibold text-white">R</span>
        <span className="hidden text-[14px] font-semibold tracking-[-0.025em] text-ink md:inline">RepoBoard</span>
      </Link>

      <div className="p-1.5 md:p-3">
        <Link href="/settings" aria-label="Repository settings" title="Repository settings" className="flex items-center justify-center gap-2.5 rounded-lg border border-border px-1 py-2.5 transition-colors hover:bg-pill md:justify-start md:px-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-pill text-[12px] font-semibold text-muted">{name?.charAt(0).toUpperCase() ?? "?"}</span>
          <span className="hidden min-w-0 flex-1 md:block">
            <span className="block truncate text-[12px] font-semibold text-ink">{name ?? "Connect repository"}</span>
            <span className="block truncate text-[11px] text-muted">{owner ?? "No project selected"}</span>
          </span>
          <span className={`hidden size-1.5 shrink-0 rounded-full md:block ${connected ? "bg-success-fg" : "bg-warn-fg"}`} title={connected ? "Connected" : "Not connected"} />
        </Link>
      </div>

      <nav className="flex flex-col gap-0.5 px-1.5 md:px-3" aria-label="Main navigation">
        {NAV.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} aria-label={item.label} title={item.label} aria-current={isActive ? "page" : undefined} className={`flex items-center justify-center gap-2.5 rounded-md px-2.5 py-[8px] text-[12.5px] transition-colors md:justify-start ${isActive ? "bg-pill font-semibold text-ink" : "text-muted hover:bg-pill/70 hover:text-ink"}`}>
              <Icon name={item.icon} /><span className="hidden md:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />
      <div className="border-t border-border p-1.5 md:p-3">
        <Link href="/settings" aria-label="Settings" title="Settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined} className={`flex items-center justify-center gap-2.5 rounded-md px-2.5 py-[8px] text-[12.5px] transition-colors md:justify-start ${pathname.startsWith("/settings") ? "bg-pill font-semibold text-ink" : "text-muted hover:bg-pill/70 hover:text-ink"}`}>
          <Icon name="settings" /><span className="hidden md:inline">Settings</span>
        </Link>
      </div>
    </aside>
  );
}
