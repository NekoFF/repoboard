"use client";

import { createContext, useContext } from "react";
import type { ProjectInfo } from "@/lib/client/api";

export interface SidebarDoc {
  id: string;
  path: string;
  title: string;
  role: "board" | "checklist";
  done: number;
  total: number;
}

export interface ShellState {
  repo: string | null;
  connected: boolean;
  projects: ProjectInfo[];
  docs: SidebarDoc[];
  managedByEnvironment: boolean;
  openPalette: (query?: string) => void;
  openShortcuts: () => void;
}

export const ShellContext = createContext<ShellState>({
  repo: null,
  connected: false,
  projects: [],
  docs: [],
  managedByEnvironment: false,
  openPalette: () => {},
  openShortcuts: () => {},
});

export function useShell() {
  return useContext(ShellContext);
}
