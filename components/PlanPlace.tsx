"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ExternalLink, FolderGit2, GitBranch, Globe, Lock, RefreshCw, Users } from "lucide-react";
import { api, useResource, type ApiError } from "@/lib/client/api";
import type { PlanLocation, PlanMode } from "@/lib/plan";
import type { PlanMovePreview, PlanStatus } from "@/lib/plan-move";
import { useShell } from "@/components/shell/ShellContext";
import { Modal, RowSkeleton, Spinner, useToast } from "@/components/ui";
import { DiffView } from "@/components/DiffView";

/**
 * Where a project keeps its plan — boards, checklists, notes, screenshots
 * (lib/plan.ts): the card in Settings, the dialog that moves it, the
 * one-time offer on the Overview, and the notice when the plan is in a
 * repository this computer cannot open.
 */

const CHOICE_KEY = "rb-plan-choice:";

/** What the connect screen asked for, kept until the project opens (components/connect). */
export function rememberPlanChoice(repo: string, mode: PlanMode) {
  try {
    sessionStorage.setItem(`${CHOICE_KEY}${repo.toLowerCase()}`, mode);
  } catch {
    /* only a convenience */
  }
}

function takePlanChoice(repo: string): PlanMode | null {
  try {
    const key = `${CHOICE_KEY}${repo.toLowerCase()}`;
    const value = sessionStorage.getItem(key) as PlanMode | null;
    sessionStorage.removeItem(key);
    return value === "main" || value === "branch" || value === "repo" ? value : null;
  } catch {
    return null;
  }
}

const OPTIONS: { mode: PlanMode; title: string; icon: ReactNode; what: string; good: string[]; mind: (s: PlanStatus) => string[] }[] = [
  {
    mode: "main",
    title: "In this repository, on main",
    icon: <FolderGit2 className="size-4" />,
    what: "A .repoboard/ folder next to the code, on the default branch — as RepoBoard always did.",
    good: ["Nothing extra to set up", "Anyone with the repository has the plan"],
    mind: (s) => [
      "Saving the boards and documents makes commits on main, among the code's",
      s.codeVisibility === "public" ? "The repository is public: everyone can read the plan, screenshots included" : "Everyone who can read the repository can read the plan",
    ],
  },
  {
    mode: "branch",
    title: "On RepoBoard's own branch",
    icon: <GitBranch className="size-4" />,
    what: "A branch called repoboard, just for the plan. Main and the code's history stay the code's.",
    good: ["No commits on main, no CI runs for the plan", "Boards sync by themselves", "Nobody needs access to anything new"],
    mind: (s) => [
      s.codeVisibility === "public"
        ? "The repository is public, so this branch is public too: a branch cannot be hidden"
        : "Everyone who can read the repository can read the plan",
    ],
  },
  {
    mode: "repo",
    title: "In a private repository of its own",
    icon: <Lock className="size-4" />,
    what: "A second repository just for the plan, next to the code. RepoBoard still reads branches, commits, pull requests and issues from the code.",
    good: ["Private even when the code is public", "No commits in the code at all", "Its own list of people"],
    mind: () => ["People who work with you need access to both repositories"],
  },
];

function Visibility({ value }: { value: "public" | "private" | null }) {
  if (!value) return null;
  return value === "public" ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-warn-bg px-1.5 py-0.5 text-2xs font-medium text-warn-fg">
      <Globe className="size-3" /> Public
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-pill px-1.5 py-0.5 text-2xs font-medium text-muted">
      <Lock className="size-3" /> Private
    </span>
  );
}

function placeVisibility(status: PlanStatus): "public" | "private" | null {
  return status.location.mode === "repo" ? null : status.codeVisibility;
}

export function PlanPlaceCard() {
  const { role } = useShell();
  const status = useResource(api.planStatus, []);
  const [open, setOpen] = useState(false);
  const s = status.data?.status;
  if (status.loading && !s) return <RowSkeleton rows={2} />;
  if (!s) return null;
  const manager = role === "manager";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
        <span className="text-muted">Kept</span>
        <span className="font-medium">
          {s.location.mode === "repo" ? (
            <>
              in its own repository, <span className="font-mono text-xs">{s.location.repo}</span>
            </>
          ) : s.location.mode === "branch" ? (
            <>
              in this repository, on the <span className="font-mono text-xs">repoboard</span> branch
            </>
          ) : (
            <>
              in this repository, on <span className="font-mono text-xs">{s.defaultBranch}</span>
            </>
          )}
        </span>
        <Visibility value={placeVisibility(s)} />
      </div>
      {s.location.mode !== "repo" && s.codeVisibility === "public" && (
        <p className="rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-sm text-ink">
          This repository is public: everyone can read the boards, checklists, notes and screenshots RepoBoard saves in it.
          A private repository of its own keeps them to the people you choose.
        </p>
      )}
      {s.blocked && (
        <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-ink">
          The plan is kept in <span className="font-mono text-xs">{s.blocked}</span>, which this computer cannot open yet.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {manager ? (
          <button className="rb-btn w-fit" onClick={() => setOpen(true)}>
            Change where it is kept
          </button>
        ) : (
          <p className="text-xs text-faint">Only a project admin can change where the plan is kept.</p>
        )}
      </div>
      {open && s && (
        <PlanDialog
          status={s}
          onClose={() => setOpen(false)}
          onMoved={() => {
            setOpen(false);
            status.reload();
          }}
        />
      )}
    </div>
  );
}

type Step = "choose" | "repo" | "review" | "done";

export function PlanDialog({
  status,
  initial,
  onClose,
  onMoved,
}: {
  status: PlanStatus;
  initial?: PlanMode;
  onClose: () => void;
  onMoved: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<PlanMode>(initial ?? (status.location.mode === "main" ? (status.codeVisibility === "public" ? "repo" : "branch") : status.location.mode));
  const [step, setStep] = useState<Step>("choose");
  const [repo, setRepo] = useState(status.location.repo ?? status.suggestedRepo);
  const [preview, setPreview] = useState<PlanMovePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [leaveNote, setLeaveNote] = useState(true);
  const [removeOld, setRemoveOld] = useState(false);
  const [moving, setMoving] = useState(false);
  const [result, setResult] = useState<{ copied: number; place: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [mergeInstead, setMergeInstead] = useState(false);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const target: PlanLocation = { mode, repo: mode === "repo" ? repo.trim() : null };
  const current = status.location;
  const isCurrent = (m: PlanMode) => m === current.mode && (m !== "repo" || (current.repo ?? "").toLowerCase() === repo.trim().toLowerCase());

  const check = async () => {
    setChecking(true);
    setProblem(null);
    try {
      const { preview } = await api.previewPlanMove(target);
      if (preview.problem) {
        setProblem(preview.problem.message);
        setPreview(null);
      } else {
        setPreview(preview);
        setStep("review");
      }
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const next = () => {
    if (isCurrent(mode)) return onClose();
    if (mode === "repo") setStep("repo");
    else void check();
  };

  const move = async () => {
    setMoving(true);
    try {
      const seen = Object.fromEntries((preview?.files ?? []).map((f) => [f.path, { source: f.sourceSha, target: f.targetSha }]));
      const done = await api.movePlan(target, { leaveNote: leaveNote || removeOld || Boolean(preview?.noteRequired), removeOld }, seen);
      setResult({ copied: done.copied, place: done.place });
      setStep("done");
      window.dispatchEvent(new Event("rb-live"));
      window.dispatchEvent(new Event("rb-doc-saved"));
      router.refresh();
    } catch (error) {
      toast.push({ kind: "error", message: "The plan was not moved", detail: (error as Error).message });
      // Something changed on GitHub meanwhile: show the move as it is now.
      if ((error as ApiError).body?.code === "CONFLICT") void check();
    } finally {
      setMoving(false);
    }
  };

  const openThere = async () => {
    setMoving(true);
    try {
      const done = await api.openPlan(target);
      setResult({ copied: 0, place: done.place });
      setStep("done");
      window.dispatchEvent(new Event("rb-live"));
      window.dispatchEvent(new Event("rb-doc-saved"));
      router.refresh();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not open the plan there", detail: (error as Error).message });
    } finally {
      setMoving(false);
    }
  };

  const createOnGitLab = async () => {
    setCreating(true);
    setProblem(null);
    try {
      const made = await api.createPlanRepo(repo.split("/").pop() ?? repo);
      setRepo(made.repo);
      toast.push({ kind: "success", message: `Created ${made.repo}`, detail: "Private, on GitLab." });
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const changed = preview?.files.filter((f) => f.status !== "same") ?? [];
  const footer =
    step === "choose" ? (
      <>
        <button className="rb-btn" onClick={onClose}>
          Cancel
        </button>
        <div className="flex-1" />
        <button className="rb-btn-primary" onClick={next} disabled={checking}>
          {checking ? <Spinner /> : null} {isCurrent(mode) ? "Keep it there" : "Next"}
        </button>
      </>
    ) : step === "repo" ? (
      <>
        <button className="rb-btn" onClick={() => setStep("choose")}>
          Back
        </button>
        <div className="flex-1" />
        <button className="rb-btn-primary" onClick={() => void check()} disabled={checking || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())}>
          {checking ? <Spinner /> : <RefreshCw className="size-4" />} Check it and continue
        </button>
      </>
    ) : step === "review" ? (
      <>
        <button className="rb-btn" onClick={() => setStep(mode === "repo" ? "repo" : "choose")} disabled={moving}>
          Back
        </button>
        <div className="flex-1" />
        {preview?.existing && !mergeInstead ? (
          <button className="rb-btn-primary" onClick={() => void openThere()} disabled={moving}>
            {moving ? <Spinner /> : <ArrowRight className="size-4" />} Open the plan there
          </button>
        ) : (
          <button className="rb-btn-primary" onClick={() => void move()} disabled={moving}>
            {moving ? <Spinner /> : <ArrowRight className="size-4" />} Move the plan
          </button>
        )}
      </>
    ) : (
      <>
        <div className="flex-1" />
        <button className="rb-btn-primary" onClick={onMoved}>
          Done
        </button>
      </>
    );

  return (
    <Modal
      wide
      title={step === "done" ? "The plan has moved" : "Where should the plan be kept?"}
      description={step === "choose" ? "Boards, checklists, notes and screenshots. The code and its history stay where they are." : undefined}
      onClose={step === "done" ? onMoved : onClose}
      footer={footer}
    >
      {step === "choose" && (
        <div className="flex flex-col gap-2" role="radiogroup">
          {OPTIONS.map((o) => {
            const chosen = mode === o.mode;
            return (
              <button
                key={o.mode}
                role="radio"
                aria-checked={chosen}
                onClick={() => setMode(o.mode)}
                className={`flex w-full flex-col gap-2 rounded-xl border px-4 py-3 text-left transition-colors ${
                  chosen ? "border-accent bg-accent/5" : "border-border hover:bg-hover"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span className="text-muted">{o.icon}</span>
                  {o.title}
                  {isCurrent(o.mode) && o.mode !== "repo" && <span className="rounded-md bg-pill px-1.5 py-0.5 text-2xs font-medium text-muted">Now</span>}
                  {o.mode === "repo" && current.mode === "repo" && <span className="rounded-md bg-pill px-1.5 py-0.5 text-2xs font-medium text-muted">Now: {current.repo}</span>}
                </span>
                <span className="text-sm text-muted">{o.what}</span>
                <span className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <span className="flex flex-col gap-1">
                    {o.good.map((g) => (
                      <span key={g} className="flex gap-1.5 text-ink">
                        <Check className="mt-px size-3.5 shrink-0 text-success" /> {g}
                      </span>
                    ))}
                  </span>
                  <span className="flex flex-col gap-1">
                    {o.mind(status).map((m) => (
                      <span key={m} className="flex gap-1.5 text-muted">
                        <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-warn" /> {m}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
          {problem && <p className="text-sm text-danger">{problem}</p>}
        </div>
      )}

      {step === "repo" && (
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm font-medium text-ink">
            The plan&rsquo;s repository
            <input className="rb-input h-10 rounded-xl font-mono" value={repo} onChange={(e) => setRepo(e.target.value)} spellCheck={false} />
            <span className="text-xs font-normal text-faint">
              An empty private repository is right. One that already holds this project&rsquo;s plan works too.
            </span>
          </label>
          {status.host === "github" ? (
            <ol className="flex flex-col gap-3 text-sm text-ink">
              <li className="flex flex-col gap-1.5">
                <span>
                  <span className="text-muted">1.</span> Create it on GitHub. The page opens with the name filled in and <b>Private</b> chosen — press{" "}
                  <b>Create repository</b>.
                </span>
                {status.links.create && (
                  <a
                    className="rb-btn w-fit"
                    href={status.links.create.replace(/name=[^&]*/, `name=${encodeURIComponent(repo.split("/").pop() ?? "")}`).replace(/owner=[^&]*/, `owner=${encodeURIComponent(repo.split("/")[0] ?? "")}`)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <ExternalLink className="size-3.5" /> Create {repo.split("/").pop()} on GitHub
                  </a>
                )}
              </li>
              <li className="flex flex-col gap-1.5">
                <span>
                  <span className="text-muted">2.</span>{" "}
                  {status.via === "github" ? (
                    <>
                      Let RepoBoard open it. If you gave RepoBoard <b>All repositories</b>, there is nothing to do. Otherwise add it: <b>Only select repositories</b> → add it → <b>Save</b>.
                    </>
                  ) : (
                    <>
                      Add it to the key RepoBoard uses: open your fine-grained keys, this one → <b>Repository access</b> → add it → <b>Update</b>.
                    </>
                  )}
                </span>
                {status.links.access && (
                  <a className="rb-btn w-fit" href={status.links.access} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="size-3.5" /> {status.via === "github" ? "RepoBoard's access on GitHub" : "Your keys on GitHub"}
                  </a>
                )}
              </li>
              <li>
                <span className="text-muted">3.</span> Come back and press <b>Check it and continue</b>.
              </li>
            </ol>
          ) : (
            <div className="flex flex-col gap-2 text-sm text-ink">
              <p>RepoBoard can create it on GitLab with your key — private, next to the code.</p>
              <button className="rb-btn w-fit" onClick={() => void createOnGitLab()} disabled={creating}>
                {creating ? <Spinner /> : null} Create {repo.split("/").pop()} on GitLab
              </button>
            </div>
          )}
          {problem && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-ink">{problem}</p>}
        </div>
      )}

      {step === "review" && preview && preview.existing && !mergeInstead && (
        <div className="flex flex-col gap-3 text-sm text-ink">
          <p>
            <b>{preview.toPlace}</b> already holds this project&rsquo;s plan — someone moved it there. This computer can simply read and save
            there from now on; nothing is copied.
          </p>
          <button type="button" className="w-fit text-xs text-muted underline decoration-ink/20 underline-offset-2 hover:text-ink" onClick={() => setMergeInstead(true)}>
            Bring this computer&rsquo;s copy along instead ({preview.files.filter((f) => f.status !== "same").length} file
            {preview.files.filter((f) => f.status !== "same").length === 1 ? "" : "s"} differ)
          </button>
        </div>
      )}

      {step === "review" && preview && (!preview.existing || mergeInstead) && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <span className="text-muted">From</span> {preview.fromPlace}
            <ArrowRight className="size-3.5 text-faint" />
            <span className="font-medium">{preview.toPlace}</span>
            <Visibility value={preview.toVisibility} />
          </div>
          {preview.toVisibility === "public" && (
            <p className="rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-sm text-ink">
              {preview.toPlace} is public: everyone will be able to read the plan there, screenshots included.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink">
              {changed.length
                ? `${changed.length} file${changed.length === 1 ? "" : "s"} go there in one commit, and the boards follow them.`
                : "Nothing to copy: the boards go there, and from now on everything is saved there."}
            </p>
            {preview.files.length > 0 && (
              <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {preview.files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-3 px-3 py-1.5 text-left ${f.diff ? "hover:bg-hover" : "cursor-default"}`}
                      onClick={() => f.diff && setOpenDiff(openDiff === f.path ? null : f.path)}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.path}</span>
                      <span className={`text-2xs ${f.status === "replace" ? "text-warn-fg" : "text-muted"}`}>
                        {f.status === "new" ? "copied" : f.status === "replace" ? (f.diff ? "replaces the one there — see what changes" : "replaces the one there") : "already there"}
                      </span>
                    </button>
                    {openDiff === f.path && f.diff && (
                      <div className="max-h-60 overflow-auto border-t border-border">
                        <DiffView diff={f.diff} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-pill px-3 py-3 text-sm">
            <label className="flex items-start gap-2 text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={leaveNote || removeOld || preview.noteRequired}
                disabled={removeOld || preview.noteRequired}
                onChange={(e) => setLeaveNote(e.target.checked)}
              />
              <span>
                Leave a note in {preview.fromPlace} saying where the plan went
                <span className="block text-xs text-muted">Other computers and teammates follow it by themselves. One small file, location.json.</span>
              </span>
            </label>
            {preview.oldFiles.length > 0 && (
              <label className="flex items-start gap-2 text-ink">
                <input type="checkbox" className="mt-0.5" checked={removeOld} onChange={(e) => setRemoveOld(e.target.checked)} />
                <span>
                  Remove the old copy from {preview.fromPlace}
                  <span className="block text-xs text-muted">
                    {preview.from.mode !== "repo" && preview.codeVisibility === "public"
                      ? "The repository's history keeps it: in a public repository, what was there stays readable in old commits."
                      : "Its history still has it, as with every file removed in git."}
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="flex flex-col gap-3 text-sm text-ink">
          <p>
            The plan is kept in <b>{result.place}</b> now{result.copied ? `, with its ${result.copied} file${result.copied === 1 ? "" : "s"}` : ""}. The boards sync there by
            themselves.
          </p>
          <p className="text-muted">Other computers follow the next time RepoBoard opens or comes to the front.</p>
          {mode === "repo" && (
            <p className="flex items-start gap-2 rounded-lg bg-pill px-3 py-2 text-muted">
              <Users className="mt-0.5 size-4 shrink-0" />
              People who work with you need access to {repo} too. Settings → People shows who is missing.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * On the Overview: the one-time offer (a public repository says plainly what
 * it means), and the dialog the connect screen asked for.
 */
export function PlanOffer() {
  const { role, repo } = useShell();
  const status = useResource(api.planStatus, [repo]);
  const [dialog, setDialog] = useState<PlanMode | null>(null);
  const [hidden, setHidden] = useState(false);
  const s = status.data?.status;

  useEffect(() => {
    if (!s || !repo || role !== "manager") return;
    // Found elsewhere already (a teammate's plan): nothing to ask.
    if (s.location.mode !== "main") return;
    const asked = takePlanChoice(repo);
    if (!asked) return;
    if (asked === "main") {
      void api.closePlanOffer().then(() => status.reload());
      return;
    }
    // A teammate may keep this project's plan elsewhere already: look first, and follow it if so.
    void api
      .boardAdopt()
      .catch(() => null)
      .then(() => api.planStatus())
      .then(({ status: now }) => {
        if (now?.location.mode === "main") setDialog(asked);
        else status.reload();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.codeRepo, role]);

  if (!s) return null;
  const close = () => {
    setHidden(true);
    void api.closePlanOffer().then(() => status.reload());
  };
  const show = s.offer && !hidden && role === "manager";
  return (
    <>
      {show && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
          <span className="text-muted">{s.codeVisibility === "public" ? <Globe className="size-5" /> : <FolderGit2 className="size-5" />}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {s.codeVisibility === "public" ? "This repository is public — and so is the plan saved in it" : "The plan is saved on main, among the code's commits"}
            </p>
            <p className="text-sm text-muted">
              {s.codeVisibility === "public"
                ? "Boards, checklists, notes and screenshots can be kept in a private repository of their own instead."
                : "It can live on RepoBoard's own branch or in a repository of its own instead. Nothing changes unless you choose."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="rb-btn" onClick={close}>
              Keep it as it is
            </button>
            <button className="rb-btn-primary" onClick={() => setDialog(s.codeVisibility === "public" ? "repo" : "branch")}>
              Choose where
            </button>
          </div>
        </section>
      )}
      {dialog && (
        <PlanDialog
          status={s}
          initial={dialog}
          onClose={() => setDialog(null)}
          onMoved={() => {
            setDialog(null);
            setHidden(true);
            status.reload();
          }}
        />
      )}
    </>
  );
}

/** Across the app: the plan is in a repository this computer cannot open, or moved somewhere RepoBoard asks about. */
export function PlanBlocked() {
  const { repo, connected } = useShell();
  const toast = useToast();
  const router = useRouter();
  const status = useResource(api.planStatus, [repo], { enabled: connected, live: true });
  const [busy, setBusy] = useState(false);
  const s = status.data?.status;
  if (s?.asked && !s.blocked) {
    const where = s.asked.mode === "repo" ? s.asked.repo : s.asked.mode === "branch" ? "the repoboard branch" : "main";
    const open = async () => {
      setBusy(true);
      try {
        await api.openPlan(s.asked!);
        status.reload();
        window.dispatchEvent(new Event("rb-live"));
        router.refresh();
      } catch (error) {
        toast.push({ kind: "error", message: "Could not open the plan there", detail: (error as Error).message });
      } finally {
        setBusy(false);
      }
    };
    return (
      <div
        role="status"
        className="rb-glass-strong absolute bottom-4 left-1/2 z-30 flex w-[min(100%-96px,820px)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm text-ink"
      >
        <FolderGit2 className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          This project&rsquo;s plan was moved to <span className="font-mono text-xs">{where}</span>. RepoBoard asks before following it there
          {s.asked.mode === "repo" ? ", because it belongs to someone else or is public" : ""}.
        </span>
        <button className="rb-btn-primary" onClick={() => void open()} disabled={busy}>
          {busy ? <Spinner /> : null} Open it there
        </button>
      </div>
    );
  }
  if (!s?.blocked) return null;
  return (
    <div
      role="status"
      className="rb-glass-strong absolute bottom-4 left-1/2 z-30 flex w-[min(100%-96px,820px)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-danger/30 px-4 py-3 text-sm text-ink"
    >
      <Lock className="size-4 shrink-0 text-danger" />
      <span className="min-w-0 flex-1">
        This project&rsquo;s plan is kept in <span className="font-mono text-xs">{s.blocked}</span>, which{" "}
        {s.via === "github" ? "your GitHub sign-in" : "this key"} cannot open. Ask its owner to add you there
        {s.via === "github" ? ", then let RepoBoard open it on GitHub" : ", then add it to your key"}.
      </span>
      {s.links.access && (
        <a className="rb-btn" href={s.links.access} target="_blank" rel="noreferrer noopener">
          <ExternalLink className="size-3.5" /> Open GitHub
        </a>
      )}
      <button className="rb-btn" onClick={() => void api.boardAdopt().then(() => status.reload())}>
        <RefreshCw className="size-3.5" /> Check again
      </button>
    </div>
  );
}

/** Settings → People: who works on the code, and who can open the plan. */
export function PlanPeopleCard() {
  const { repo } = useShell();
  const status = useResource(api.planStatus, [repo]);
  const people = useResource(api.planPeople, [repo]);
  const s = status.data?.status;
  const p = people.data;
  if (!s) return null;
  return (
    <div className="flex flex-col gap-4">
      {people.loading && !p ? (
        <RowSkeleton rows={2} />
      ) : p ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {p.code.length === 0 && <li className="px-3 py-2 text-sm text-muted">GitHub did not list anyone with Write here (a key without that permission lists nobody).</li>}
          {p.code.map((person) => {
            const missing = p.missing.includes(person.login);
            return (
              <li key={person.login} className="flex items-center gap-3 px-3 py-2 text-sm">
                {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="size-6 rounded-full" /> : <span className="size-6 rounded-full bg-pill" />}
                <span className="min-w-0 flex-1 truncate text-ink">{person.login}</span>
                {p.plan ? (
                  missing ? (
                    <span className="text-xs text-danger">No access to the plan</span>
                  ) : (
                    <span className="text-xs text-muted">Code and plan</span>
                  )
                ) : (
                  <span className="text-xs text-muted">Can work on cards</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p className="text-ink">To work together:</p>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>
            Add them on {s.host === "gitlab" ? "GitLab" : "GitHub"} to <span className="font-mono text-xs">{s.codeRepo}</span>
            {s.location.mode === "repo" ? (
              <>
                {" "}
                and to <span className="font-mono text-xs">{s.location.repo}</span>
              </>
            ) : null}
            . Write lets them work on cards; Admin also changes the project&rsquo;s settings; Read only looks.
          </li>
          <li>They install RepoBoard, sign in and pick the repository. Their boards, checklists and notes appear by themselves.</li>
        </ol>
        {s.links.people && (
          <a className="rb-btn w-fit" href={s.links.people} target="_blank" rel="noreferrer noopener">
            <ExternalLink className="size-3.5" /> {s.location.mode === "repo" ? "People of the plan's repository" : "People of the repository"}
          </a>
        )}
        <p className="text-xs text-faint">
          {s.host === "gitlab"
            ? "On gitlab.com a free private group holds up to five people; your own namespace and a company's GitLab server have no such limit."
            : "On GitHub's free plan a private repository can have as many people as you like."}{" "}
          Everyone sees the same boards a few seconds after a change.
        </p>
      </div>
    </div>
  );
}
