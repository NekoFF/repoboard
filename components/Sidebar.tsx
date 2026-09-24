"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One entry per destination. The repository screen owns its own tabs for
 * branches, commits, pull requests and issues, so listing those here as well
 * duplicated the same navigation in two places.
 */
const NAV = [
  { href: "/", icon: "◎", label: "Overview" },
  { href: "/board", icon: "▦", label: "Board" },
  { href: "/repository", icon: "⌘", label: "Repository" },
  { href: "/markdown-sync", icon: "≡", label: "Markdown" },
  { href: "/activity", icon: "↺", label: "Activity" },
];

export function Sidebar({
  repo,
  connected,
}: {
  repo: string | null;
  connected: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[212px] shrink-0 flex-col gap-1 border-r border-border bg-surface px-3 py-4">
      <div className="mb-1 flex items-center gap-2 px-2">
        <div className="grid size-[26px] place-items-center rounded-md bg-active text-[11px] font-semibold text-white">
          R
        </div>
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
          RepoBoard
        </span>
      </div>

      <Link
        href="/settings"
        className="group mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-pill"
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            connected ? "bg-success-fg" : "bg-warn-fg"
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-ink">
            {repo?.split("/")[1] ?? "No repository"}
          </span>
          <span className="block truncate text-[10.5px] text-muted">
            {repo?.split("/")[0] ?? "not connected"}
          </span>
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition-colors ${
                isActive
                  ? "bg-pill font-medium text-ink"
                  : "text-muted hover:bg-pill/60 hover:text-ink"
              }`}
            >
              <span className="w-3.5 text-center text-[12px]" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <Link
        href="/settings"
        className={`flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition-colors ${
          pathname.startsWith("/settings")
            ? "bg-pill font-medium text-ink"
            : "text-muted hover:bg-pill/60 hover:text-ink"
        }`}
      >
        <span className="w-3.5 text-center text-[12px]" aria-hidden>
          ⚙
        </span>
        Settings
      </Link>
    </aside>
  );
}
