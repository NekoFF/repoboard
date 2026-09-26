"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Palette } from "lucide-react";
import { PROJECT_ART, PROJECT_HUES, ProjectArt, projectLook } from "@/components/ProjectArt";
import { useShell } from "@/components/shell/ShellContext";
import { Modal, RelativeTime, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";

type Look = { art: string | null; hue: number | null };

/** Choosing a project's cover: one of the pixel scenes, in one of the colours. */
function CoverDialog({ repo, initial, onClose }: { repo: string; initial: Look; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const auto = projectLook(repo);
  const [look, setLook] = useState<Look>(initial);
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = { art: look.art ?? auto.art, hue: look.hue ?? auto.hue };

  const save = async () => {
    setBusy(true);
    try {
      await api.setProjectLook(repo, look);
      router.refresh();
      onClose();
    } catch (err) {
      toast.push({ kind: "error", message: "Could not change the cover", detail: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Project cover"
      description="A small scene for this project, shown on Overview and next to its name."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="rb-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="rb-btn-primary" onClick={save} disabled={busy}>
            {busy && <Spinner />} Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rb-project-banner relative h-[120px] overflow-hidden rounded-2xl" style={{ ["--ph" as string]: shown.hue }}>
          <ProjectArt repo={repo} look={shown} />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted">Colour</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            <button
              type="button"
              role="radio"
              aria-checked={look.hue === null}
              className={`h-7 rounded-full px-3 text-xs ${look.hue === null ? "bg-ink text-canvas" : "bg-pill text-muted hover:text-ink"}`}
              onClick={() => setLook((l) => ({ ...l, hue: null }))}
            >
              From the name
            </button>
            {PROJECT_HUES.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={look.hue === h}
                aria-label={`Hue ${h}`}
                className="grid size-7 place-items-center rounded-full"
                style={{ background: `hsl(${h} 65% 55%)`, boxShadow: look.hue === h ? "0 0 0 2px rgb(var(--canvas)), 0 0 0 4px rgb(var(--ink))" : undefined }}
                onClick={() => setLook((l) => ({ ...l, hue: h }))}
              >
                {look.hue === h && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted">Scene</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Scene">
            {PROJECT_ART.map((a) => {
              const on = shown.art === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`group flex flex-col gap-1.5 rounded-xl p-1.5 text-left ${on ? "bg-accent/10 ring-2 ring-accent" : "hover:bg-pill"}`}
                  onClick={() => setLook((l) => ({ ...l, art: a.key }))}
                  onPointerEnter={() => setHover(a.key)}
                  onPointerLeave={() => setHover((k) => (k === a.key ? null : k))}
                >
                  <span className="block h-14 overflow-hidden rounded-lg">
                    <ProjectArt repo={repo} look={{ art: a.key, hue: shown.hue }} still={hover !== a.key} cellSize={4} />
                  </span>
                  <span className="px-1 text-xs text-ink">{a.name}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-muted underline decoration-ink/20 underline-offset-2 hover:text-ink"
            onClick={() => setLook((l) => ({ ...l, art: null }))}
          >
            Pick the scene from the name
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The top of Overview: the project's cover, a scene in pixels that moves
 * slowly, with its name on a glass plate — like a channel's banner.
 */
export function ProjectBanner({
  repo,
  owner,
  name,
  branch,
  syncedAt,
}: {
  repo: string | null;
  owner: string;
  name: string;
  branch: string | null;
  syncedAt: number | null;
}) {
  const { projects } = useShell();
  const [editing, setEditing] = useState(false);
  const stored = repo ? projects.find((p) => p.repo.toLowerCase() === repo.toLowerCase()) : undefined;
  const look: Look = { art: stored?.art ?? null, hue: stored?.hue ?? null };
  const { hue } = projectLook(repo, look);

  return (
    <header className="rb-project-banner relative h-[176px] overflow-hidden rounded-[22px]" style={{ ["--ph" as string]: hue }}>
      <ProjectArt repo={repo} look={look} />
      <div className="absolute right-3 top-3 flex gap-2">
        {repo && (
          <button type="button" className="rb-btn rb-glass" onClick={() => setEditing(true)}>
            <Palette className="size-3.5" /> Cover
          </button>
        )}
        {repo && (
          <a className="rb-btn rb-glass" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer noopener">
            GitHub <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      <div className="rb-glass absolute bottom-3 left-3 max-w-[calc(100%-24px)] rounded-2xl px-4 py-3">
        <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] text-ink">{name || "Your project"}</h1>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
          <span>{owner}</span>
          {branch && <span className="font-mono text-xs">{branch}</span>}
          {syncedAt && (
            <span>
              Synced <RelativeTime value={syncedAt} />
            </span>
          )}
        </p>
      </div>
      {editing && repo && <CoverDialog repo={repo} initial={look} onClose={() => setEditing(false)} />}
    </header>
  );
}
