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
  const { people } = useShell();
  if (kind === "agent") {
    return (
      <span
        title={agentLabel(name)}
        className="grid shrink-0 place-items-center rounded-full bg-state-review/15 text-state-review ring-1 ring-state-review/25"
        style={{ width: size, height: size }}
      >
        <Sparkles style={{ width: size * 0.55, height: size * 0.55 }} />
      </span>
    );
  }
  const login = name.replace(/^@/, "");
  if (failed || !/^[A-Za-z0-9-]+$/.test(login) || !people.includes(login.toLowerCase())) {
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
      src={`https://github.com/${login}.png?size=${size * 2}`}
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
  return (
    <span className="font-medium text-ink">
      {kind === "agent" ? agentLabel(name) : name}
      {kind === "agent" && <span className="ml-1 text-2xs font-normal text-state-review">AI</span>}
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
