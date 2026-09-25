"use client";

import { createContext, useContext } from "react";
import type { ProjectInfo } from "@/lib/client/api";

export interface SidebarDoc {
  id: string;
  path: string;
  title: string;
  role: "board" | "checklist";
  kind: "checklist" | "note" | "decision" | "document";
  done: number;
  total: number;
  review: number;
}

export interface SidebarBoard {
  id: string;
  name: string;
  color: string | null;
  owner: string | null;
  primary: boolean;
  open: number;
}

export interface ShellState {
  repo: string | null;
  /** GitHub login of the token's owner: the default author of notes, "@me" in filters. */
  viewer: string | null;
  connected: boolean;
  projects: ProjectInfo[];
  docs: SidebarDoc[];
  boards: SidebarBoard[];
  managedByEnvironment: boolean;
  openPalette: (query?: string) => void;
  openShortcuts: () => void;
}

export const ShellContext = createContext<ShellState>({
  repo: null,
  viewer: null,
  connected: false,
  projects: [],
  docs: [],
  boards: [],
  managedByEnvironment: false,
  openPalette: () => {},
  openShortcuts: () => {},
});

export function useShell() {
  return useContext(ShellContext);
}
