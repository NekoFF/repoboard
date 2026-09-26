"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Spinner, useToast } from "@/components/ui";
import { useShell } from "@/components/shell/ShellContext";
import { api } from "@/lib/client/api";
import { openProject } from "@/lib/client/project";

/** A square with the repository's first letter, tinted from its name. */
export function ProjectMark({ repo, size = 22 }: { repo: string | null; size?: number }) {
  const name = repo?.split("/")[1] ?? "?";
  let hash = 0;
  for (const ch of repo ?? "") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md text-2xs font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: repo ? `hsl(${hue} 32% 42%)` : "rgb(var(--faint))",
      }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function ProjectSwitcher() {
  const router = useRouter();
  const toast = useToast();
  const { repo, projects, connected, managedByEnvironment } = useShell();
  const [switching, setSwitching] = useState<string | null>(null);
  const [owner, name] = repo?.split("/") ?? [null, null];

  const switchTo = async (target: string) => {
    setSwitching(target);
    try {
      await api.switchProject(target);
      openProject();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not switch project", detail: (error as Error).message });
      setSwitching(null);
    }
  };

  return (
    <Menu
      width={236}
      trigger={
        <button className="flex h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left transition-colors hover:bg-ink/[0.05]">
          <ProjectMark repo={repo} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight text-ink">
              {name ?? "No project"}
            </span>
            <span className="flex items-center gap-1.5 truncate text-2xs leading-tight text-muted">
              <span
                className={`size-1.5 rounded-full ${connected ? "bg-state-done" : "bg-state-doing"}`}
                aria-hidden
              />
              {owner ?? (connected ? "Connected" : "Not connected")}
            </span>
          </span>
          {switching ? <Spinner className="text-muted" /> : <ChevronsUpDown className="size-3.5 text-faint" />}
        </button>
      }
    >
      <MenuLabel>Projects</MenuLabel>
      {projects.map((project) => (
        <MenuItem
          key={project.repo}
          icon={<ProjectMark repo={project.repo} size={16} />}
          onSelect={() => !project.active && switchTo(project.repo)}
          shortcut={project.open !== undefined ? `${project.open} open` : undefined}
        >
          <span className="flex items-center gap-1.5">
            {project.repo}
            {project.active && <Check className="size-3.5" />}
          </span>
        </MenuItem>
      ))}
      {projects.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted">No repositories connected yet.</p>
      )}
      <MenuSeparator />
      {!managedByEnvironment && (
        <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => router.push("/connect")}>
          Add a project
        </MenuItem>
      )}
      <MenuItem icon={<Settings2 className="size-3.5" />} onSelect={() => router.push("/settings")}>
        Manage projects
      </MenuItem>
    </Menu>
  );
}
