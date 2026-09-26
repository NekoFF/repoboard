"use client";

import { useRouter } from "next/navigation";
import { FilePlus2, Keyboard, Moon, Plus, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Tooltip } from "@/components/ui";
import { newCardHref } from "@/lib/client/current-board";
import { boardHref } from "@/components/labelColor";

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
        className="grid size-9 place-items-center rounded-full text-muted transition-[background-color,color,box-shadow] duration-150 hover:bg-surface/80 hover:text-ink hover:shadow-card"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The pill inside the main panel's right edge: the actions you want from
 * anywhere, one press away, without crowding each screen's own header.
 * Search lives once, at the top of the sidebar (it shows at every width).
 */
export function ToolRail() {
  const router = useRouter();
  const { openShortcuts, boards } = useShell();
  const { resolved, toggle } = useTheme();

  return (
    <aside
      aria-label="Tools"
      className="rb-rail absolute bottom-2.5 right-2.5 top-2.5 z-30 hidden w-11 flex-col items-center gap-1 rounded-full py-2 lg:flex"
    >
      <RailButton label="New card" shortcut="C" onClick={() => router.push(newCardHref(boards.map(boardHref)))}>
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
