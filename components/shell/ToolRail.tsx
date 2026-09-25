"use client";

import { useRouter } from "next/navigation";
import { FilePlus2, Keyboard, Moon, Plus, Search, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Tooltip } from "@/components/ui";
import { modKey } from "@/lib/client/hotkeys";

function RailButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} shortcut={shortcut} side="left">
      <button
        onClick={onClick}
        aria-label={label}
        className="grid size-9 place-items-center rounded-full text-muted transition-colors duration-100 hover:bg-surface hover:text-ink hover:shadow-card"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The pill on the right edge of the main panel: the actions you want from
 * anywhere, one press away, without crowding each screen's own header.
 */
export function ToolRail() {
  const router = useRouter();
  const { openPalette, openShortcuts } = useShell();
  const { resolved, toggle } = useTheme();

  return (
    <aside
      aria-label="Tools"
      className="my-2 mr-2 hidden w-11 shrink-0 flex-col items-center gap-1 rounded-full bg-rail py-1.5 lg:flex"
    >
      <RailButton label="Search and commands" shortcut={`${modKey()}K`} onClick={() => openPalette()}>
        <Search className="size-4" />
      </RailButton>
      <RailButton label="New card" shortcut="C" onClick={() => router.push("/board?new=1")}>
        <Plus className="size-4" />
      </RailButton>
      <RailButton label="New document" onClick={() => router.push("/docs?new=1")}>
        <FilePlus2 className="size-4" />
      </RailButton>
      <div className="flex-1" />
      <RailButton label="Keyboard shortcuts" shortcut="?" onClick={openShortcuts}>
        <Keyboard className="size-4" />
      </RailButton>
      <RailButton label={resolved === "dark" ? "Light theme" : "Dark theme"} onClick={toggle}>
        {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </RailButton>
    </aside>
  );
}
