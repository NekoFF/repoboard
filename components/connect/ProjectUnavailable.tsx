"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Settings2 } from "lucide-react";
import { StartFrame } from "@/components/connect/Frame";
import { ProjectMark } from "@/components/shell/ProjectSwitcher";
import { Spinner, useToast } from "@/components/ui";
import { api, type AccessProblem, type ProjectHealth, type ProjectInfo } from "@/lib/client/api";
import { openProject } from "@/lib/client/project";

const HEALTH_LABEL: Record<ProjectHealth, string> = {
  ok: "Opens",
  expired: "Key ran out",
  no_access: "Key has no access",
  forbidden: "Refused by GitHub",
  offline: "GitHub unreachable",
  unknown: "Could not check",
};

function headline(problem: AccessProblem | null, name: string): string {
  if (!problem) return "Choose a project";
  switch (problem.reason) {
    case "expired":
      return `The key for ${name} has run out`;
    case "no_access":
      return `This key cannot open ${name}`;
    case "forbidden":
      return `GitHub refused ${name}`;
    case "offline":
      return "GitHub cannot be reached";
    default:
      return `${name} did not open`;
  }
}

/**
 * The open project no longer opens — its key ran out, lost access, or GitHub
 * is out of reach. Says which and why, and always offers a way on: a new
 * key, another project, trying again. Nobody is left on a screen without a
 * button that helps.
 */
export function ProjectUnavailable({ problem, projects }: { problem: AccessProblem | null; projects: ProjectInfo[] }) {
  const toast = useToast();
  const [health, setHealth] = useState<Map<string, ProjectHealth> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const slug = problem?.slug ?? projects.find((p) => p.active)?.repo ?? null;
  const name = slug?.split("/")[1] ?? "The project";
  const others = projects.filter((p) => !slug || p.repo.toLowerCase() !== slug.toLowerCase());

  useEffect(() => {
    let cancelled = false;
    api
      .projectsHealth()
      .then((info) => {
        if (cancelled) return;
        setHealth(new Map(info.projects.map((p) => [p.repo.toLowerCase(), p.health ?? "unknown"])));
      })
      .catch(() => !cancelled && setHealth(new Map()));
    return () => {
      cancelled = true;
    };
  }, []);

  const open = (repo: string) => {
    setBusy(repo);
    api
      .switchProject(repo)
      .then(() => openProject("/"))
      .catch((err) => {
        toast.push({ kind: "error", message: "Could not open it", detail: (err as Error).message });
        setBusy(null);
      });
  };

  const remove = () => {
    if (!slug) return;
    if (!window.confirm(`Remove ${slug} from this computer? Its key is forgotten; the boards stay here and on GitHub.`)) return;
    setBusy("remove");
    api
      .removeProject(slug)
      .then(() => openProject("/"))
      .catch((err) => {
        toast.push({ kind: "error", message: "Could not remove it", detail: (err as Error).message });
        setBusy(null);
      });
  };

  const offline = problem?.reason === "offline" || problem?.reason === "unknown";

  return (
    <StartFrame>
      <div className="flex items-start gap-4">
        {slug && <ProjectMark repo={slug} size={44} />}
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{headline(problem, name)}</h1>
          {slug && <p className="mt-1 font-mono text-xs text-faint">{slug}</p>}
        </div>
      </div>
      <p className="mt-4 text-md leading-relaxed text-muted">
        {problem
          ? problem.message
          : "None of your projects is open. Pick one below, or add a new one."}{" "}
        {problem && !offline && "Its boards and checklists are safe on this computer."}
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {problem && !offline && slug && (
          <Link href={`/connect?repo=${encodeURIComponent(slug)}`} className="rb-btn-primary h-10 rounded-xl px-4">
            <KeyRound className="size-4" /> Give it a new key
          </Link>
        )}
        <button
          type="button"
          className={`${offline ? "rb-btn-primary" : "rb-btn"} h-10 rounded-xl px-4`}
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="size-3.5" /> Try again
        </button>
      </div>

      {others.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-sm font-medium text-ink">Open another project</p>
          <div className="flex flex-col gap-1.5">
            {others.map((p) => {
              const state = health?.get(p.repo.toLowerCase());
              const works = state === "ok";
              return (
                <button
                  key={p.repo}
                  type="button"
                  className="rb-pick w-full text-left disabled:cursor-default disabled:opacity-60"
                  disabled={busy !== null || (health !== null && !works)}
                  onClick={() => open(p.repo)}
                >
                  <ProjectMark repo={p.repo} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="text-muted">{p.repo.split("/")[0]}/</span>
                    <span className="font-medium text-ink">{p.repo.split("/")[1]}</span>
                  </span>
                  {busy === p.repo ? (
                    <Spinner />
                  ) : (
                    <span className={`flex items-center gap-1.5 text-xs ${works ? "text-state-done" : "text-faint"}`}>
                      {state ? (
                        <>
                          <span className={`size-1.5 rounded-full ${works ? "bg-state-done" : "bg-ink/25"}`} />
                          {HEALTH_LABEL[state]}
                        </>
                      ) : (
                        <Spinner />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
        <Link href="/connect" className="inline-flex items-center gap-1.5 text-muted hover:text-ink">
          <Plus className="size-3.5" /> Add a project
        </Link>
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-muted hover:text-ink">
          <Settings2 className="size-3.5" /> Settings
        </Link>
        {slug && (
          <button type="button" className="ml-auto text-muted hover:text-danger" onClick={remove} disabled={busy !== null}>
            {busy === "remove" ? <Spinner /> : `Remove ${name}`}
          </button>
        )}
      </div>
    </StartFrame>
  );
}
