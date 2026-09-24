"use client";

import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { ToastHost } from "@/components/ui";

export function AppShell({
  repo,
  connected,
  children,
}: {
  repo: string | null;
  connected: boolean;
  children: ReactNode;
}) {
  return (
    <ToastHost>
      <div className="flex h-screen w-full overflow-hidden bg-canvas">
        <Sidebar repo={repo} connected={connected} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
          {children}
        </main>
      </div>
      <CommandPalette connected={connected} />
    </ToastHost>
  );
}
