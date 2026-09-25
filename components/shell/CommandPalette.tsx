"use client";

import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  FilePlus2,
  FileSearch,
  FileText,
  GitBranch,
  GitPullRequest,
  Home,
  Keyboard,
  Moon,
  Plus,
  Settings,
  SquareKanban,
  Sun,
  CircleDot,
  GitCommitHorizontal,
} from "lucide-react";
import { api, useResource } from "@/lib/client/api";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/shell/ThemeProvider";
import { ProjectMark } from "@/components/shell/ProjectSwitcher";
import { Spinner, StatusIcon } from "@/components/ui";
import { statusOfColumn } from "@/lib/status";
import { boardHref } from "@/components/labelColor";

function Item({
  value,
  keywords,
  icon,
  children,
  hint,
  onSelect,
}: {
  value: string;
  keywords?: string[];
  icon: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-sm text-ink data-[selected=true]:bg-hover"
    >
      <span className="grid w-4 shrink-0 place-items-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-xs text-faint">{hint}</span>}
    </Command.Item>
  );
}

const groupClass =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint";

/**
 * ⌘K over everything: go anywhere, run any action, find any card, document,
 * branch, pull request or issue. The fastest path to anything in the app.
 */
export function CommandPalette({
  open,
  onOpenChange,
  initialQuery = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
}) {
  const router = useRouter();
  const { connected, projects, docs, boards, openShortcuts } = useShell();
  const { resolved, toggle } = useTheme();
  const [search, setSearch] = useState(initialQuery);
  useEffect(() => {
    if (open) setSearch(initialQuery);
  }, [open, initialQuery]);

  const board = useResource(api.board, [open], { enabled: open && connected });
  const branches = useResource(api.branches, [], { enabled: open && connected });
  const pulls = useResource(api.pulls, [], { enabled: open && connected });
  const issues = useResource(api.issues, [], { enabled: open && connected });
  // Checklist items from the last read of each document: every important
  // point is two keystrokes away, not buried in a file.
  const docItems = useResource(api.docs, [open], { enabled: open && connected });
  const loading = board.loading || branches.loading || pulls.loading || issues.loading;

  const columnName = useMemo(
    () => new Map((board.data?.columns ?? []).map((c) => [c.id, c.name])),
    [board.data],
  );

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  const go = (href: string) => run(() => router.push(href));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="rb-fade-in rb-scrim fixed inset-0 z-[85]" />
        <Dialog.Content
          className="rb-pop rb-glass-strong fixed left-1/2 top-[12vh] z-[86] w-[calc(100vw-24px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          <Command label="Command menu" loop>
            <div className="flex items-center gap-2 border-b border-ink/[0.06] px-4">
              <Command.Input
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder="Type a command or search…"
                className="h-12 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-faint focus-visible:ring-0"
              />
              {loading && <Spinner className="text-faint" />}
            </div>
            <Command.List className="rb-scroll-thin max-h-[min(460px,60vh)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
                Nothing matches. Try a card title, a file name or a branch.
              </Command.Empty>

              <Command.Group heading="Actions" className={groupClass}>
                <Item value="New card" keywords={["create", "add", "task"]} icon={<Plus className="size-4" />} hint="C" onSelect={go("/board?new=1")}>
                  New card
                </Item>
                <Item value="New document" keywords={["create", "markdown", "file", "policy", "checklist"]} icon={<FilePlus2 className="size-4" />} onSelect={go("/docs?new=1")}>
                  New document
                </Item>
                <Item value="Track a document" keywords={["markdown", "add", "roadmap", "file"]} icon={<FileSearch className="size-4" />} onSelect={go("/docs?add=1")}>
                  Track an existing document
                </Item>
                <Item value="Toggle theme" keywords={["dark", "light", "appearance"]} icon={resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} onSelect={run(toggle)}>
                  Switch to {resolved === "dark" ? "light" : "dark"} theme
                </Item>
                <Item value="Keyboard shortcuts" keywords={["help", "keys", "hotkeys"]} icon={<Keyboard className="size-4" />} hint="?" onSelect={run(openShortcuts)}>
                  Keyboard shortcuts
                </Item>
              </Command.Group>

              <Command.Group heading="Go to" className={groupClass}>
                <Item value="Overview" icon={<Home className="size-4" />} hint="G O" onSelect={go("/")}>Overview</Item>
                <Item value="Boards" icon={<SquareKanban className="size-4" />} hint="G B" onSelect={go("/boards")}>Boards</Item>
                <Item value="Documents" icon={<FileText className="size-4" />} hint="G D" onSelect={go("/docs")}>Documents</Item>
                <Item value="Branches" keywords={["code"]} icon={<GitBranch className="size-4" />} hint="G C" onSelect={go("/repository?tab=branches")}>Branches</Item>
                <Item value="Commits" keywords={["code", "history"]} icon={<GitCommitHorizontal className="size-4" />} onSelect={go("/repository?tab=commits")}>Commits</Item>
                <Item value="Pull requests" keywords={["code", "pr"]} icon={<GitPullRequest className="size-4" />} onSelect={go("/repository?tab=pulls")}>Pull requests</Item>
                <Item value="Issues" keywords={["code", "bugs"]} icon={<CircleDot className="size-4" />} onSelect={go("/repository?tab=issues")}>Issues</Item>
                <Item value="Activity" icon={<Activity className="size-4" />} hint="G A" onSelect={go("/activity")}>Activity</Item>
                <Item value="Settings" icon={<Settings className="size-4" />} onSelect={go("/settings")}>Settings</Item>
              </Command.Group>

              {boards.length > 0 && (
                <Command.Group heading="Boards" className={groupClass}>
                  {boards.map((b) => (
                    <Item
                      key={b.id}
                      value={`board ${b.name} ${b.owner ?? ""}`}
                      icon={<SquareKanban className="size-4" />}
                      hint={b.open ? `${b.open} open` : undefined}
                      onSelect={go(boardHref(b))}
                    >
                      {b.name}
                    </Item>
                  ))}
                  <Item value="New board" keywords={["create", "person", "area"]} icon={<Plus className="size-4" />} onSelect={go("/boards?new=1")}>
                    New board
                  </Item>
                </Command.Group>
              )}

              {projects.length > 1 && (
                <Command.Group heading="Switch project" className={groupClass}>
                  {projects
                    .filter((p) => !p.active)
                    .map((p) => (
                      <Item
                        key={p.repo}
                        value={`project ${p.repo}`}
                        keywords={["switch", "project", "repository"]}
                        icon={<ProjectMark repo={p.repo} size={16} />}
                        onSelect={run(async () => {
                          await api.switchProject(p.repo).catch(() => null);
                          router.refresh();
                          router.push("/");
                        })}
                      >
                        {p.repo}
                      </Item>
                    ))}
                </Command.Group>
              )}

              {docs.length > 0 && (
                <Command.Group heading="Documents" className={groupClass}>
                  {docs.map((doc) => (
                    <Item
                      key={doc.id}
                      value={`doc ${doc.title} ${doc.path}`}
                      icon={<FileText className="size-4" />}
                      hint={<span className="font-mono">{doc.path}</span>}
                      onSelect={go(`/docs?path=${encodeURIComponent(doc.path)}`)}
                    >
                      {doc.title}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {(docItems.data?.docs ?? []).some((d) => d.items.length > 0 && d.role !== "board") && (
                <Command.Group heading="Checklist items" className={groupClass}>
                  {docItems.data!.docs
                    .filter((d) => d.role !== "board")
                    .flatMap((d) =>
                      d.items.map((item) => (
                        <Item
                          key={`${d.id}-${item.line}`}
                          value={`item ${item.title} ${d.title}`}
                          icon={<StatusIcon status={item.state ?? (item.done ? "done" : "todo")} />}
                          hint={d.title}
                          onSelect={go(`/docs?path=${encodeURIComponent(d.path)}#line-${item.line}`)}
                        >
                          {item.title}
                        </Item>
                      )),
                    )}
                </Command.Group>
              )}

              {(board.data?.tasks.length ?? 0) > 0 && (
                <Command.Group heading="Cards" className={groupClass}>
                  {board.data!.tasks.map((task) => (
                    <Item
                      key={task.id}
                      value={`card ${task.number ? `RB-${task.number}` : ""} ${task.title}`}
                      keywords={task.labels}
                      icon={<StatusIcon status={statusOfColumn(columnName.get(task.columnId))} />}
                      hint={task.number ? <span className="font-mono">RB-{task.number}</span> : undefined}
                      onSelect={go(`/board/card/${task.id}`)}
                    >
                      {task.title}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {(branches.data?.branches.length ?? 0) > 0 && (
                <Command.Group heading="Branches" className={groupClass}>
                  {branches.data!.branches.map((branch) => (
                    <Item
                      key={branch.name}
                      value={`branch ${branch.name}`}
                      icon={<GitBranch className="size-4" />}
                      hint={branch.ahead || branch.behind ? `+${branch.ahead} −${branch.behind}` : undefined}
                      onSelect={go(`/repository?tab=commits&branch=${encodeURIComponent(branch.name)}`)}
                    >
                      <span className="font-mono text-xs">{branch.name}</span>
                    </Item>
                  ))}
                </Command.Group>
              )}

              {(pulls.data?.pulls.length ?? 0) > 0 && (
                <Command.Group heading="Pull requests" className={groupClass}>
                  {pulls.data!.pulls.map((pr) => (
                    <Item
                      key={pr.number}
                      value={`pr #${pr.number} ${pr.title}`}
                      icon={<GitPullRequest className="size-4" />}
                      hint={pr.mergeableState ?? pr.state}
                      onSelect={go(`/repository?tab=pulls&pr=${pr.number}`)}
                    >
                      #{pr.number} {pr.title}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {(issues.data?.issues.length ?? 0) > 0 && (
                <Command.Group heading="Issues" className={groupClass}>
                  {issues.data!.issues.map((issue) => (
                    <Item
                      key={issue.number}
                      value={`issue #${issue.number} ${issue.title}`}
                      icon={<CircleDot className="size-4" />}
                      hint={issue.state}
                      onSelect={go(`/repository?tab=issues&issue=${issue.number}`)}
                    >
                      #{issue.number} {issue.title}
                    </Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-ink/[0.06] px-4 py-2 text-2xs text-faint">
              <span><span className="rb-kbd">↑</span> <span className="rb-kbd">↓</span> to move</span>
              <span><span className="rb-kbd">↵</span> to open</span>
              <span><span className="rb-kbd">esc</span> to close</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
