"use client";

import type { Role } from "@/lib/roles";
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
  /**
   * Lower-case logins of the people who can work on the repository (its
   * collaborators) plus the viewer. Only these get a GitHub photo: a name
   * typed for a board or a card may be anyone's login on GitHub.
   */
  people: string[];
  connected: boolean;
  projects: ProjectInfo[];
  docs: SidebarDoc[];
  boards: SidebarBoard[];
  managedByEnvironment: boolean;
  /** The viewer's role in the open project, from GitHub (lib/roles.ts). */
  role: Role;
  openPalette: (query?: string) => void;
  openShortcuts: () => void;
}

export const ShellContext = createContext<ShellState>({
  repo: null,
  viewer: null,
  people: [],
  connected: false,
  projects: [],
  docs: [],
  boards: [],
  managedByEnvironment: false,
  role: "manager",
  openPalette: () => {},
  openShortcuts: () => {},
});

export function useShell() {
  return useContext(ShellContext);
}
