"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useShell } from "@/components/shell/ShellContext";

/** Agents write their name the way their MCP client reports it; show it nicely. */
export function agentLabel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("claude")) return "Claude";
  if (n.includes("codex")) return "Codex";
  if (n.includes("cursor")) return "Cursor";
  if (n.includes("gemini")) return "Gemini";
  if (n.includes("copilot")) return "Copilot";
  if (n.includes("windsurf")) return "Windsurf";
  return name;
}

const KNOWN_AGENTS = ["claude", "codex", "cursor", "gemini", "copilot", "windsurf"];

/** Whether a name (an assignee, a board owner) is one of the project's AI agents. */
export function isAgentName(name: string, agents: string[] = []): boolean {
  const label = agentLabel(name).toLowerCase();
  return KNOWN_AGENTS.includes(label) || agents.some((a) => agentLabel(a).toLowerCase() === label);
}

/**
 * Each agent in its own colours, so the activity feed tells Claude from
 * Codex at a glance. Drawn marks, not the companies' logos; colours are the
 * .rb-agent-* rules in app/globals.css.
 */
function AgentMark({ name, size }: { name: string; size: number }) {
  const label = agentLabel(name).toLowerCase();
  const glyph = (() => {
    switch (label) {
      case "claude":
        // A starburst of rays.
        return (
          <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i / 8) * Math.PI * 2;
              const r = i % 2 ? 6.2 : 7.6;
              return <line key={i} x1={12 + Math.cos(a) * 2} y1={12 + Math.sin(a) * 2} x2={12 + Math.cos(a) * r} y2={12 + Math.sin(a) * r} />;
            })}
          </g>
        );
      case "codex":
        return (
          <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 9l3 3-3 3" />
            <path d="M12.5 15.5H17" />
          </g>
        );
      case "cursor":
        return <path d="M8 6.5l9 5-4 1.2-1.8 4.3z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />;
      case "gemini":
        return <path d="M12 4.5c.6 4 3.5 6.9 7.5 7.5-4 .6-6.9 3.5-7.5 7.5-.6-4-3.5-6.9-7.5-7.5 4-.6 6.9-3.5 7.5-7.5z" fill="currentColor" />;
      case "copilot":
        return (
          <g fill="currentColor">
            <circle cx="9" cy="12" r="2.4" />
            <circle cx="15" cy="12" r="2.4" />
          </g>
        );
      case "windsurf":
        return <path d="M5 14c2.5-3 4.5-3 7 0s4.5 3 7 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />;
      default:
        return null;
    }
  })();
  return (
    <span
      title={`${agentLabel(name)} (AI)`}
      className={`rb-agent rb-agent-${glyph ? label : "other"} grid shrink-0 place-items-center rounded-full`}
      style={{ width: size, height: size }}
    >
      {glyph ? (
        <svg viewBox="0 0 24 24" style={{ width: size * 0.78, height: size * 0.78 }} aria-hidden>
          {glyph}
        </svg>
      ) : (
        <Sparkles style={{ width: size * 0.55, height: size * 0.55 }} />
      )}
    </span>
  );
}

/**
 * A person's GitHub avatar, or a mark for an AI agent. The photo comes from
 * github.com/<login>.png, but only for people who work on the repository (see
 * `people` in the shell): any other name — typed for a board or a card — would
 * otherwise show a stranger's photo, since almost every short name is someone's
 * login. Everyone else, and a failed load, gets their initials.
 */
export function ActorAvatar({
  name,
  kind = "person",
  size = 20,
}: {
  name: string;
  kind?: "person" | "agent" | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const { people, agents, projects, avatars } = useShell();
  // Photos come from github.com by login; a GitLab project's people are someone else there.
  const onGitLab = projects.find((p) => p.active)?.host?.kind === "gitlab";
  // A card assigned to "Claude" is assigned to an agent: show it as one.
  if (kind === "agent" || (kind !== "person" && isAgentName(name, agents))) {
    return <AgentMark name={name} size={size} />;
  }
  const login = name.replace(/^@/, "");
  // The project's own list of people carries their photos (GitHub or GitLab);
  // github.com/<login>.png only for GitHub projects, and only for its people.
  const listed = avatars[login.toLowerCase()];
  const src = listed || (!onGitLab ? `https://github.com/${login}.png?size=${size * 2}` : null);
  if (failed || !src || !/^[A-Za-z0-9._-]+$/.test(login) || !people.includes(login.toLowerCase())) {
    return (
      <span
        title={login}
        className="grid shrink-0 place-items-center rounded-full bg-pill font-semibold uppercase text-muted ring-1 ring-border"
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
      >
        {login.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={login}
      title={login}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-pill ring-1 ring-border"
      style={{ width: size, height: size }}
    />
  );
}

export function ActorName({ name, kind }: { name: string; kind?: "person" | "agent" | null }) {
  const { agents } = useShell();
  const agent = kind === "agent" || (kind !== "person" && isAgentName(name, agents));
  return (
    <span className="font-medium text-ink">
      {agent ? agentLabel(name) : name}
      {agent && <span className="ml-1 text-2xs font-normal text-state-review">AI</span>}
    </span>
  );
}

/**
 * Events are written as actions ("moved X from Todo to Done") so they read
 * after a name. Without one (older events, background syncs) they start with
 * a capital instead.
 */
export function eventText(message: string, actor: string | null | undefined): string {
  return actor ? message : message.charAt(0).toUpperCase() + message.slice(1);
}
