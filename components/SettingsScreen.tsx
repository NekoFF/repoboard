"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Check, Copy, ExternalLink, HardDrive, KeyRound, Monitor, Moon, Palette, Plus, Sun, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ProjectMark } from "@/components/shell/ProjectSwitcher";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Logo, RelativeTime, Segmented, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";

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

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

/** Ready-to-paste MCP configuration for the common AI clients. */
function AgentSetup({ server }: { server: string }) {
  const [client, setClient] = useState<"claude" | "codex" | "cursor" | "desktop" | "other">("claude");
  const json = (name: string) =>
    JSON.stringify({ mcpServers: { repoboard: { command: "node", args: [server], env: { REPOBOARD_AGENT: name } } } }, null, 2);
  const snippets = {
    claude: { where: "Run once in a terminal:", text: `claude mcp add repoboard -e REPOBOARD_AGENT="Claude Code" -- node "${server}"` },
    codex: {
      where: "Add to ~/.codex/config.toml:",
      text: `[mcp_servers.repoboard]\ncommand = "node"\nargs = ["${server}"]\nenv = { REPOBOARD_AGENT = "Codex" }`,
    },
    cursor: { where: "Add to ~/.cursor/mcp.json (or the project's .cursor/mcp.json):", text: json("Cursor") },
    desktop: { where: "Add to Claude Desktop's claude_desktop_config.json:", text: json("Claude Desktop") },
    other: { where: "Any MCP client that speaks stdio:", text: `REPOBOARD_AGENT="My agent" node "${server}"` },
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

export function SettingsScreen({
  authLabel,
  tokenSource,
  managedByEnvironment,
  paths,
}: {
  authLabel: string;
  tokenSource: string | null;
  managedByEnvironment: boolean;
  paths: { database: string; credentials: string; mcpServer: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { projects, connected, repo: activeRepo } = useShell();
  const { choice, setChoice } = useTheme();
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(projects.length === 0 || Boolean(params.get("add")));

  useEffect(() => {
    if (params.get("add")) setAdding(true);
  }, [params]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("connect");
    setError(null);
    try {
      const body = await api.connectRepository(token, repo);
      toast.push({
        kind: "success",
        message: `Connected ${body.repo.owner}/${body.repo.name}`,
        detail: `Default branch ${body.repo.defaultBranch}, ${body.repo.visibility}`,
      });
      setToken("");
      setRepo("");
      setAdding(false);
      router.refresh();
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

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
            description="Each project is one GitHub repository with its own board, checklists and token. Tokens stay on this computer."
          >
            {managedByEnvironment && (
              <p className="rounded-lg bg-pill p-3 text-sm text-muted">
                This instance is configured through environment variables (GITHUB_REPO / GITHUB_PAT), so projects are
                managed there.
              </p>
            )}

            {projects.length > 0 && (
              <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
                {projects.map((p) => (
                  <div key={p.repo} className="flex items-center gap-3 px-4 py-3">
                    <ProjectMark repo={p.repo} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-base font-medium text-ink">
                        {p.repo}
                        {p.active && <span className="rb-pill-ok">Active</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {p.open !== undefined ? `${p.open} open, ${p.done ?? 0} done` : "No board yet"}
                        {p.lastSyncAt ? (
                          <>
                            {", synced "}
                            <RelativeTime value={p.lastSyncAt} />
                          </>
                        ) : null}
                      </p>
                    </div>
                    {!p.active && !managedByEnvironment && (
                      <button
                        className="rb-btn rb-btn-sm"
                        disabled={busy !== null}
                        onClick={() => act(`switch-${p.repo}`, () => api.switchProject(p.repo), `Switched to ${p.repo}`)}
                      >
                        {busy === `switch-${p.repo}` && <Spinner />} Open
                      </button>
                    )}
                    {!managedByEnvironment && (
                      <button
                        className="rb-icon-btn"
                        aria-label={`Disconnect ${p.repo}`}
                        title="Disconnect — forgets the token; the board stays on this computer"
                        disabled={busy !== null}
                        onClick={() => act(`remove-${p.repo}`, () => api.removeProject(p.repo), `Disconnected ${p.repo}`)}
                      >
                        {busy === `remove-${p.repo}` ? <Spinner /> : <Trash2 className="size-3.5" />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!managedByEnvironment &&
              (adding ? (
                <form className="flex flex-col gap-4 rounded-xl border border-border bg-canvas p-5" onSubmit={connect}>
                  <p className="text-sm font-semibold text-ink">Connect a repository</p>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                    Repository
                    <input
                      className="rb-input h-9 font-mono"
                      placeholder="owner/name"
                      value={repo}
                      onChange={(event) => setRepo(event.target.value)}
                      required
                      autoFocus
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                    Fine-grained access token
                    <input
                      type="password"
                      className="rb-input h-9 font-mono"
                      placeholder="github_pat_…"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      required
                      autoComplete="off"
                    />
                  </label>
                  <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
                    <p>
                      <a className="inline-flex items-center gap-1 font-medium text-ink underline decoration-ink/30 underline-offset-2" href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
                        Create a token on GitHub <ExternalLink className="size-3" />
                      </a>{" "}
                      with <em>Only select repositories</em> → this repository, and these permissions:
                    </p>
                    <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <li><span className="text-ink">Contents</span> — read and write</li>
                      <li><span className="text-ink">Metadata</span> — read</li>
                      <li><span className="text-ink">Pull requests</span> — read</li>
                      <li><span className="text-ink">Issues</span> — read</li>
                    </ul>
                  </div>
                  {error && <p className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
                  <div className="flex items-center gap-2">
                    <button className="rb-btn-primary h-9 px-4" disabled={busy === "connect"}>
                      {busy === "connect" && <Spinner />} {busy === "connect" ? "Checking with GitHub" : "Connect"}
                    </button>
                    {projects.length > 0 && (
                      <button type="button" className="rb-btn-ghost" onClick={() => setAdding(false)}>
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <button className="rb-btn w-fit" onClick={() => setAdding(true)}>
                  <Plus className="size-3.5" /> Connect a repository
                </button>
              ))}
            <p className="text-xs text-faint">
              {authLabel}
              {tokenSource ? `, read from the ${tokenSource}` : ""}. The token is never sent to the browser.
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
            <AgentSetup server={paths.mcpServer} />
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
