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
import { copyText } from "@/lib/client/clipboard";

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
  const snippets: Record<typeof client, { where: string; text: string; alt?: { where: string; text: string } }> = {
    claude: {
      where: "Run once in a terminal. --scope user makes it available in every project, not only the folder you run it in:",
      text: `claude mcp add --scope user repoboard ${flags("Claude Code")} -- "${node}" "${server}"`,
      // Claude Code in the Claude app has no claude command: the same entry, written into its settings file.
      alt: {
        where:
          "No claude command (Claude Code in the Claude app)? Add this under \"mcpServers\" in ~/.claude.json (on Windows %USERPROFILE%\\.claude.json), or paste it into a Claude Code chat and ask it to add the server for you. Then start a new session.",
        text: JSON.stringify({ repoboard: { type: "stdio", command: node, args: [server], env: withAgent("Claude Code") } }, null, 2),
      },
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
  };
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
      {current.alt && (
        <>
          <p className="text-xs text-muted">{current.alt.where}</p>
          <CopyBlock text={current.alt.text} />
        </>
      )}
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
    // The button has a column of its own: a long line scrolls beside it, never under it.
    <div className="flex items-start rounded-lg border border-border bg-code-bg">
      <pre className="rb-scroll-thin min-w-0 flex-1 overflow-x-auto whitespace-pre py-3 pl-3 font-mono text-xs leading-relaxed text-ink">{text}</pre>
      <button
        className="rb-icon-btn m-1.5 shrink-0"
        aria-label="Copy"
        onClick={() =>
          void copyText(text).then(() => {
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

/** The desktop app asks GitHub Releases now, and says so either way. */
function CheckForUpdates() {
  const [busy, setBusy] = useState(false);
  type Bridge = { updates?: { check?: () => Promise<void> } };
  // Read after mount: the page is rendered on the server first, where there is no app bridge.
  const [bridge, setBridge] = useState<Bridge | null>(null);
  useEffect(() => setBridge((window as unknown as { repoboardDesktop?: Bridge }).repoboardDesktop ?? null), []);
  if (!bridge?.updates?.check) return null;
  return (
    <button
      className="rb-btn rb-btn-sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void bridge.updates!.check!().finally(() => setBusy(false));
      }}
    >
      {busy && <Spinner />} Check for updates
    </button>
  );
}

/** Stable follows releases; beta takes pre-releases too. Desktop only. */
function UpdateChannel() {
  type Channel = "stable" | "beta";
  type Bridge = { updates?: { channel?: () => Promise<Channel>; setChannel?: (c: Channel) => Promise<Channel> } };
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  useEffect(() => {
    const found = (window as unknown as { repoboardDesktop?: Bridge }).repoboardDesktop ?? null;
    setBridge(found);
    void found?.updates?.channel?.().then(setChannel);
  }, []);
  if (!bridge?.updates?.setChannel || !channel) return null;
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        size="sm"
        value={channel}
        onChange={(next) => {
          setChannel(next);
          void bridge.updates!.setChannel!(next).then(setChannel);
        }}
        options={[
          { value: "stable", label: "Stable" },
          { value: "beta", label: "Beta" },
        ]}
      />
      <p className="text-xs text-muted">
        {channel === "beta"
          ? "You get new versions first, before they are finished. Back on Stable, the next stable version that is newer comes as usual."
          : "Finished versions only. Beta brings new versions first, before they are finished."}
      </p>
    </div>
  );
}

/** Whether agents' documents wait for the person, or the app commits them itself. */
function AgentDocs({ initial, canChange }: { initial: "review" | "direct"; canChange: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState(initial);
  const change = async (next: "review" | "direct") => {
    const before = mode;
    setMode(next);
    try {
      await api.setAgentDocs(next);
    } catch (error) {
      setMode(before);
      toast.push({ kind: "error", message: "Could not change it", detail: (error as Error).message });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink">When an agent writes a document</p>
      <Segmented
        size="sm"
        value={mode}
        onChange={(v) => canChange && void change(v)}
        options={[
          { value: "review", label: "Wait for my review" },
          { value: "direct", label: "Write it directly" },
        ]}
      />
      <p className="text-sm text-muted">
        {mode === "direct"
          ? "RepoBoard commits agents' documents and checks to .repoboard/ on the documents' branch by itself, a few seconds after they propose them, while RepoBoard is open. Agents tick a check done only with a reason and evidence, and only when the project lets agents close work. Anything outside .repoboard/, or a change that no longer fits the file, waits for you."
          : "Agents' new documents and checks wait in Documents until you review and commit them."}
        {!canChange && " Only a project admin can change this."}
      </p>
    </div>
  );
}

/** Whether agents may close cards and items themselves, when they say why. */
function AgentPolicy({ initial, canChange }: { initial: "propose" | "reason"; canChange: boolean }) {
  const toast = useToast();
  const [policy, setPolicy] = useState(initial);
  const change = async (next: "propose" | "reason") => {
    const before = policy;
    setPolicy(next);
    try {
      await api.setAgentPolicy(next);
    } catch (error) {
      setPolicy(before);
      toast.push({ kind: "error", message: "Could not change it", detail: (error as Error).message });
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink">When an agent finishes work</p>
      <Segmented
        size="sm"
        value={policy}
        onChange={(v) => canChange && void change(v)}
        options={[
          { value: "reason", label: "Close with proof" },
          { value: "propose", label: "Only send to check" },
        ]}
      />
      <p className="text-sm text-muted">
        {policy === "reason"
          ? "Agents close work when they can show it is done: they checked it themselves, you told them you did, or it was done before. The proof shows on the card and you can reopen it. Without proof, work waits in Review for you."
          : "Agents never close anything: finished work always waits in Review for you."}
        {!canChange && " Only a project admin can change this."}
      </p>
    </div>
  );
}

export function SettingsScreen({
  agentPolicy,
  agentDocs,
  version,
  authLabel,
  tokenSource,
  managedByEnvironment,
  paths,
  mcp,
}: {
  agentPolicy: "propose" | "reason";
  agentDocs: "review" | "direct";
  version: { number: string; desktop: boolean };
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
                        {p.host?.kind === "gitlab" && (
                          <span className="rb-pill" title={p.host.url}>
                            GitLab
                          </span>
                        )}
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
            {connected && <AgentPolicy initial={agentPolicy} canChange={role === "manager"} />}
            {connected && <AgentDocs initial={agentDocs} canChange={role === "manager"} />}
            <p className="text-sm text-muted">
              In documents agents never tick an item themselves: they mark it <code className="font-mono text-xs">[?]</code> and
              say how to verify it. The rules are in <code className="font-mono text-xs">.repoboard/README.md</code>, which
              RepoBoard creates with the workspace.
            </p>
          </Card>

          <Card title="About" icon={<Logo size={16} />}>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink">
                RepoBoard <span className="font-mono tabular-nums">{version.number}</span>
                <span className="text-muted"> · {version.desktop ? "desktop app" : "in the browser"}</span>
              </p>
              {version.desktop && <CheckForUpdates />}
              <a
                className="ml-auto text-sm text-muted underline decoration-ink/20 underline-offset-2 hover:text-ink"
                href="https://github.com/NekoFF/repoboard/releases"
                target="_blank"
                rel="noreferrer noopener"
              >
                What&rsquo;s new
              </a>
            </div>
            {version.desktop && <UpdateChannel />}
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
