"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Check, Copy, HardDrive, KeyRound, Monitor, Moon, Palette, Plus, Sun, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ProjectMark } from "@/components/shell/ProjectSwitcher";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Logo, RelativeTime, Segmented, Spinner, useToast } from "@/components/ui";
import { api, type ProjectHealth, type ProjectInfo } from "@/lib/client/api";
import { openProject } from "@/lib/client/project";
import { ROLE_LABEL } from "@/lib/roles";

function Card({ title, icon, description, children }: { title: string; icon: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6">
      <div>
        <h2 className="flex items-center gap-2 text-md font-semibold text-ink">
          <span className="text-muted">{icon}</span>
          {title}
        </h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function AgentSetup({ server, node, env }: { server: string; node: string; env: Record<string, string> }) {
  const [client, setClient] = useState<"claude" | "codex" | "cursor" | "desktop" | "other">("claude");
  const withAgent = (name: string) => ({ ...env, REPOBOARD_AGENT: name });
  const json = (name: string) =>
    JSON.stringify({ mcpServers: { repoboard: { command: node, args: [server], env: withAgent(name) } } }, null, 2);
  // TOML literal strings ('…') keep Windows backslashes as they are.
  const toml = (value: string) => `'${value}'`;
  const flags = (name: string) =>
    Object.entries(withAgent(name))
      .map(([k, v]) => `-e ${k}="${v}"`)
      .join(" ");
  const snippets = {
    claude: {
      where: "Run once in a terminal. --scope user makes it available in every project, not only the folder you run it in:",
      text: `claude mcp add --scope user repoboard ${flags("Claude Code")} -- "${node}" "${server}"`,
    },
    codex: {
      where: "Add to ~/.codex/config.toml:",
      text: `[mcp_servers.repoboard]\ncommand = ${toml(node)}\nargs = [${toml(server)}]\nenv = { ${Object.entries(withAgent("Codex"))
        .map(([k, v]) => `${k} = ${toml(v)}`)
        .join(", ")} }`,
    },
    cursor: { where: "Add to ~/.cursor/mcp.json (or the project's .cursor/mcp.json):", text: json("Cursor") },
    desktop: { where: "Add to Claude Desktop's claude_desktop_config.json:", text: json("Claude Desktop") },
    other: {
      where: "Any MCP client that speaks stdio — the command, its argument and these environment variables:",
      text: `${Object.entries(withAgent("My agent"))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")}\n"${node}" "${server}"`,
    },
  } as const;
  const current = snippets[client];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Segmented
          size="sm"
          value={client}
          onChange={setClient}
          options={[
            { value: "claude", label: "Claude Code" },
            { value: "codex", label: "Codex" },
            { value: "cursor", label: "Cursor" },
            { value: "desktop", label: "Claude Desktop" },
            { value: "other", label: "Other" },
          ]}
        />
      </div>
      <p className="text-xs text-muted">{current.where}</p>
      <CopyBlock text={current.text} />
      <p className="text-xs text-muted">
        <code className="font-mono">REPOBOARD_AGENT</code> is the name the activity feed shows for that agent. Without it
        RepoBoard uses the name the client reports.
      </p>
    </div>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg border border-border bg-code-bg">
      <pre className="overflow-x-auto whitespace-pre p-3 pr-12 font-mono text-xs leading-relaxed text-ink">{text}</pre>
      <button
        className="rb-icon-btn absolute right-1.5 top-1.5"
        aria-label="Copy"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="size-3.5 text-state-done" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

const HEALTH_TEXT: Record<ProjectHealth, string> = {
  ok: "Open",
  expired: "Key ran out",
  no_access: "Key has no access",
  forbidden: "Refused by GitHub",
  offline: "GitHub unreachable",
  unknown: "Could not check",
};

export function SettingsScreen({
  authLabel,
  tokenSource,
  managedByEnvironment,
  paths,
  mcp,
}: {
  authLabel: string;
  tokenSource: string | null;
  managedByEnvironment: boolean;
  paths: { database: string; credentials: string; mcpServer: string };
  mcp: { node: string; env: Record<string, string> };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { projects, connected, repo: activeRepo, role } = useShell();
  const { choice, setChoice } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  // Whether each project's key still opens its repository.
  const [health, setHealth] = useState<Map<string, ProjectHealth> | null>(null);
  const [healthInfo, setHealthInfo] = useState<Map<string, ProjectInfo>>(new Map());
  const projectKey = projects.map((p) => p.repo).join(",");

  // Old links to the connect form go to the connect screen.
  useEffect(() => {
    if (params.get("add")) router.replace("/connect");
  }, [params, router]);

  useEffect(() => {
    if (managedByEnvironment) return;
    let cancelled = false;
    api
      .projectsHealth()
      .then((info) => {
        if (cancelled) return;
        setHealth(new Map(info.projects.map((p) => [p.repo.toLowerCase(), p.health ?? "unknown"])));
        setHealthInfo(new Map(info.projects.map((p) => [p.repo.toLowerCase(), p])));
      })
      .catch(() => !cancelled && setHealth(new Map()));
    return () => {
      cancelled = true;
    };
  }, [projectKey, managedByEnvironment]);

  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await fn();
      toast.push({ kind: "success", message });
      router.refresh();
    } catch (err) {
      toast.push({ kind: "error", message: "That did not work", detail: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };


  return (
    <>
      {connected ? (
        <PageHeader title="Settings" icon={<KeyRound className="size-4" />} />
      ) : (
        <header className="flex h-14 items-center gap-2.5 px-6">
          <Logo />
          <span className="text-md font-semibold tracking-[-0.01em] text-ink">RepoBoard</span>
        </header>
      )}

      <div className={`rb-scroll-thin min-h-0 flex-1 overflow-y-auto ${connected ? "rb-under-header" : ""}`}>
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pb-20 pt-8 sm:px-10">
          <Card
            title="Projects"
            icon={<KeyRound className="size-4" />}
            description="Each project is one GitHub repository with its own boards, checklists and key. Keys stay on this computer."
          >
            {managedByEnvironment && (
              <p className="rounded-lg bg-pill p-3 text-sm text-muted">
                This instance is configured through environment variables (GITHUB_REPO / GITHUB_PAT), so projects are
                managed there.
              </p>
            )}

            {projects.length > 0 && (
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
                {projects.map((listed) => {
                  const p = { ...listed, ...healthInfo.get(listed.repo.toLowerCase()), active: listed.active };
                  const state = managedByEnvironment ? (connected ? "ok" : undefined) : health?.get(p.repo.toLowerCase());
                  const broken = state !== undefined && state !== "ok";
                  return (
                  <div key={p.repo} className="flex items-center gap-3 px-4 py-3">
                    <ProjectMark repo={p.repo} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-base font-medium text-ink">
                        {p.repo}
                        {p.active && !broken && state === "ok" && <span className="rb-pill-ok">Open</span>}
                        {p.active && connected && (
                          <span className="rb-pill" title="Your role in this repository on GitHub decides what you can change here">
                            {ROLE_LABEL[role]}
                          </span>
                        )}
                        {p.active && state === undefined && <span className="rb-pill">Open</span>}
                        {broken && <span className="rb-pill-danger">{HEALTH_TEXT[state]}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {state === undefined && !managedByEnvironment
                          ? "Checking the key…"
                          : broken
                            ? "Its boards are safe on this computer. Give it a new key to open it again."
                            : p.open !== undefined
                              ? `${p.open} open, ${p.done ?? 0} done`
                              : "No board yet"}
                        {!broken && p.lastSyncAt ? (
                          <>
                            {", synced "}
                            <RelativeTime value={p.lastSyncAt} />
                          </>
                        ) : null}
                      </p>
                    </div>
                    {broken && !managedByEnvironment && (
                      <Link href={`/connect?repo=${encodeURIComponent(p.repo)}`} className="rb-btn-primary rb-btn-sm">
                        <KeyRound className="size-3.5" /> {p.via === "github" ? "Sign in again" : "New key"}
                      </Link>
                    )}
                    {!p.active && !broken && !managedByEnvironment && (
                      <button
                        className="rb-btn rb-btn-sm"
                        disabled={busy !== null}
                        onClick={() => {
                          setBusy(`switch-${p.repo}`);
                          api
                            .switchProject(p.repo)
                            .then(() => openProject())
                            .catch((err) => {
                              toast.push({ kind: "error", message: "Could not switch project", detail: (err as Error).message });
                              setBusy(null);
                            });
                        }}
                      >
                        {busy === `switch-${p.repo}` && <Spinner />} Open
                      </button>
                    )}
                    {!managedByEnvironment && (
                      <button
                        className="rb-icon-btn"
                        aria-label={`Remove ${p.repo}`}
                        title="Remove — forgets the key; the boards stay on this computer"
                        disabled={busy !== null}
                        onClick={() => {
                          if (!window.confirm(`Remove ${p.repo} from this computer? Its key is forgotten; the boards stay here and on GitHub.`)) return;
                          if (p.active) {
                            // The open project goes away: start again from what is left.
                            setBusy(`remove-${p.repo}`);
                            api
                              .removeProject(p.repo)
                              .then(() => openProject("/"))
                              .catch((err) => {
                                toast.push({ kind: "error", message: "That did not work", detail: (err as Error).message });
                                setBusy(null);
                              });
                            return;
                          }
                          void act(`remove-${p.repo}`, () => api.removeProject(p.repo), `Disconnected ${p.repo}`);
                        }}
                      >
                        {busy === `remove-${p.repo}` ? <Spinner /> : <Trash2 className="size-3.5" />}
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {!managedByEnvironment && (
              <Link href="/connect" className="rb-btn w-fit">
                <Plus className="size-3.5" /> Add a project
              </Link>
            )}
            <p className="text-xs text-faint">
              Keys are GitHub {authLabel.toLowerCase()}s
              {tokenSource ? `, read from the ${tokenSource === "env" ? "environment" : "file on this computer"}` : ""}. A key is never sent to the page.
            </p>
          </Card>

          <Card title="Appearance" icon={<Palette className="size-4" />}>
            <div>
            <Segmented
              value={choice}
              onChange={setChoice}
              options={[
                { value: "system", label: <><Monitor className="size-3.5" /> System</> },
                { value: "light", label: <><Sun className="size-3.5" /> Light</> },
                { value: "dark", label: <><Moon className="size-3.5" /> Dark</> },
              ]}
            />
            </div>
          </Card>

          <Card
            title="AI agents"
            icon={<Bot className="size-4" />}
            description={
              <>
                Any AI that supports MCP — Claude, Codex, Cursor and others — works with the same board and checklists you
                see: it reads the overview, creates, moves, changes and deletes cards, and comments, and every change shows
                in the activity feed under its name. Checklists it edits as files in{" "}
                <code className="font-mono text-xs">.repoboard/</code> in its own copy of the repository. It cannot commit
                through RepoBoard — writes to GitHub always go through your review.
              </>
            }
          >
            <AgentSetup server={paths.mcpServer} node={mcp.node} env={mcp.env} />
            <p className="text-sm text-muted">
              The rules agents follow — never tick an item themselves, mark it <code className="font-mono text-xs">[?]</code> and
              say how to verify it — are in <code className="font-mono text-xs">.repoboard/README.md</code>, which RepoBoard
              creates with the workspace.
            </p>
          </Card>

          <Card title="Your data" icon={<HardDrive className="size-4" />} description="Everything RepoBoard stores lives in two files on this computer. Back them up by copying the folder.">
            <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Board</dt>
              <dd className="min-w-0 truncate font-mono text-xs text-ink">{paths.database}</dd>
              <dt className="text-muted">Tokens</dt>
              <dd className="min-w-0 truncate font-mono text-xs text-ink">{paths.credentials}</dd>
            </dl>
            {activeRepo && (
              <p className="text-xs text-faint">
                Card order, checklists and links can also be kept in the repository itself (Board → Save to repo), so a
                teammate who connects the same repository sees them.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
