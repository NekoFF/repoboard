"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  FileText,
  GitBranch,
  Home,
  Keyboard,
  Moon,
  Plus,
  Search,
  Settings,
  SquareKanban,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { ProjectSwitcher } from "@/components/shell/ProjectSwitcher";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Kbd, ProgressRing, Tooltip, percent } from "@/components/ui";
import { modKey } from "@/lib/client/hotkeys";

const NAV: { href: string; label: string; icon: ReactNode; keys: string }[] = [
  { href: "/", label: "Overview", icon: <Home className="size-4" />, keys: "G then O" },
  { href: "/board", label: "Board", icon: <SquareKanban className="size-4" />, keys: "G then B" },
  { href: "/docs", label: "Documents", icon: <FileText className="size-4" />, keys: "G then D" },
  { href: "/repository", label: "Code", icon: <GitBranch className="size-4" />, keys: "G then C" },
  { href: "/activity", label: "Activity", icon: <Activity className="size-4" />, keys: "G then A" },
];

function NavLink({
  href,
  active,
  icon,
  children,
  trailing,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-100 ${
        active ? "bg-ink/[0.07] font-medium text-ink" : "text-muted hover:bg-ink/[0.04] hover:text-ink"
      }`}
    >
      <span className={active ? "text-ink" : "text-faint group-hover:text-muted"}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { docs, openPalette, openShortcuts } = useShell();
  const { resolved, toggle } = useTheme();
  const currentDoc = pathname.startsWith("/docs") ? params.get("path") : null;

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col">
      <div className="px-2.5 pt-2.5">
        <ProjectSwitcher />
      </div>

      <div className="px-2.5 pt-2">
        <button
          onClick={() => openPalette()}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-surface/70 px-2 text-sm text-faint shadow-card transition-colors hover:bg-surface hover:text-muted"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or run a command</span>
          <Kbd>{modKey()}K</Kbd>
        </button>
      </div>

      <nav className="flex flex-col gap-px px-2.5 pt-3" aria-label="Main">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <NavLink key={item.href} href={item.href} active={active && !currentDoc} icon={item.icon}>
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center px-4 pb-1">
          <span className="flex-1 text-xs font-medium text-faint">Tracked documents</span>
          <Tooltip content="Track a document">
            <button
              className="rb-icon-btn size-6"
              aria-label="Track a document"
              onClick={() => router.push("/docs?add=1")}
            >
              <Plus className="size-3.5" />
            </button>
          </Tooltip>
        </div>
        <div className="rb-scroll-thin flex min-h-0 flex-col gap-px overflow-y-auto px-2.5 pb-2">
          {docs.length === 0 && (
            <Link
              href="/docs?add=1"
              className="rounded-md px-2 py-1.5 text-xs leading-relaxed text-faint hover:bg-ink/[0.04] hover:text-muted"
            >
              Keep a roadmap, a policy or a release checklist in view. Track any markdown file.
            </Link>
          )}
          {docs.map((doc) => (
            <NavLink
              key={doc.id}
              href={`/docs?path=${encodeURIComponent(doc.path)}`}
              active={currentDoc === doc.path}
              icon={<ProgressRing done={doc.done} total={doc.total} />}
              trailing={
                doc.total > 0 ? (
                  <span className="text-2xs tabular-nums text-faint">{percent(doc.done, doc.total)}%</span>
                ) : null
              }
            >
              <span title={doc.path}>{doc.title}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 px-2.5 py-2.5">
        <NavLink href="/settings" active={pathname.startsWith("/settings")} icon={<Settings className="size-4" />}>
          Settings
        </NavLink>
        <div className="flex-1" />
        <Tooltip content="Keyboard shortcuts" shortcut="?">
          <button className="rb-icon-btn lg:hidden" onClick={openShortcuts} aria-label="Keyboard shortcuts">
            <Keyboard className="size-4" />
          </button>
        </Tooltip>
        <Tooltip content={resolved === "dark" ? "Light theme" : "Dark theme"}>
          <button className="rb-icon-btn lg:hidden" onClick={toggle} aria-label="Toggle theme">
            {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
