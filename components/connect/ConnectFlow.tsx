"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ExternalLink, Globe, Lock } from "lucide-react";
import { ProjectMark } from "@/components/shell/ProjectSwitcher";
import { GitHubMark, Spinner } from "@/components/ui";
import { ApiError, api, type AccessReason } from "@/lib/client/api";
import { repoSlug } from "@/lib/github/slug";
import { TOKENS_PAGE, tokenTemplateUrl } from "@/lib/github/token-link";

type Repo = Awaited<ReturnType<typeof api.repositoriesFor>>["repos"][number];
type Problem = { message: string; reason?: AccessReason };

const linkClass = "inline-flex items-center gap-1 font-medium text-ink underline decoration-ink/30 underline-offset-2";

const problemOf = (err: unknown): Problem => ({
  message: (err as Error).message,
  reason: err instanceof ApiError ? (err.body.reason as AccessReason | undefined) : undefined,
});

/** What to do next for each way GitHub can refuse. */
function NextStep({ reason }: { reason?: AccessReason }) {
  if (reason === "expired") {
    return (
      <a className={linkClass} href={tokenTemplateUrl()} target="_blank" rel="noreferrer noopener">
        Get a new key from GitHub <ExternalLink className="size-3" />
      </a>
    );
  }
  if (reason === "no_access" || reason === "forbidden") {
    return (
      <span>
        Open{" "}
        <a className={linkClass} href={TOKENS_PAGE} target="_blank" rel="noreferrer noopener">
          your keys on GitHub <ExternalLink className="size-3" />
        </a>
        , click this one → <em>Edit</em> → <em>Repository access</em>, tick the repository and save.
        {reason === "forbidden" && " If it belongs to an organisation, one of its owners may have to approve the key."}
      </span>
    );
  }
  return null;
}

function ProblemBox({ problem }: { problem: Problem }) {
  return (
    <div className="rb-enter rounded-xl bg-danger-bg p-3 text-sm text-danger">
      <p>{problem.message}</p>
      {problem.reason && problem.reason !== "offline" && problem.reason !== "unknown" && (
        <p className="mt-1.5 text-ink">
          <NextStep reason={problem.reason} />
        </p>
      )}
    </div>
  );
}

/**
 * With a key instead of signing in: get a key from GitHub
 * (the page opens already filled in), paste it, and pick from the
 * repositories that key opens — one or several at once. No names to spell,
 * no permissions to look up.
 *
 * `replacing` gives a project that is already connected a new key.
 */
function KeyFlow({
  replacing,
  connectedRepos = [],
  onConnected,
}: {
  replacing?: string | null;
  connectedRepos?: string[];
  onConnected: (opened: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<Problem | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState(replacing ?? "");
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const asked = useRef(0);

  // Ask GitHub once the key looks whole; a later keystroke wins.
  useEffect(() => {
    const value = token.trim();
    setRepos(null);
    setLookError(null);
    setError(null);
    if (value.length < 40) {
      setLooking(false);
      return;
    }
    const id = ++asked.current;
    setLooking(true);
    const timer = window.setTimeout(() => {
      api
        .repositoriesFor(value)
        .then(({ repos: found }) => {
          if (id !== asked.current) return;
          setRepos(found);
          const want = replacing?.toLowerCase();
          const match = want ? found.find((r) => r.fullName.toLowerCase() === want) : undefined;
          // Preselect what is obvious: the project being renewed, or the only
          // repository, or the ones not connected yet.
          const fresh = found.filter((r) => !connectedRepos.includes(r.fullName.toLowerCase()));
          setPicked(match ? [match.fullName] : found.length === 1 ? [found[0].fullName] : fresh.length === 1 ? [fresh[0].fullName] : []);
          setTyping(false);
        })
        .catch((err) => id === asked.current && setLookError(problemOf(err)))
        .finally(() => id === asked.current && setLooking(false));
    }, 350);
    return () => window.clearTimeout(timer);
    // connectedRepos and replacing are fixed for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const haveToken = token.trim().length >= 40;
  const listed = Boolean(repos && repos.length > 0);
  const showTyped = typing || lookError !== null || (repos !== null && repos.length === 0);
  const targets = showTyped ? (typed.trim() ? [repoSlug(typed)] : []) : picked;

  const toggle = (name: string) =>
    setPicked((list) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!targets.length || busy) return;
    setError(null);
    // The first one picked is the one that opens: connect it last, since
    // connecting makes a project the open one.
    const order = [...targets.slice(1), targets[0]];
    let last = "";
    for (const target of order) {
      setBusy(target);
      try {
        const body = await api.connectRepository(token, target);
        last = `${body.repo.owner}/${body.repo.name}`;
      } catch (err) {
        const problem = problemOf(err);
        setError(targets.length > 1 ? { ...problem, message: `${target}: ${problem.message}` } : problem);
        setBusy(null);
        return;
      }
    }
    onConnected(last);
  };

  const label = (() => {
    if (busy) {
      const order = [...targets.slice(1), targets[0]];
      const n = order.indexOf(busy) + 1;
      return targets.length > 1 ? `Adding ${busy.split("/")[1] ?? busy} · ${n} of ${targets.length}` : "Checking with GitHub…";
    }
    if (replacing) return "Save the new key";
    if (targets.length > 1) return `Add ${targets.length} projects`;
    if (targets.length === 1) return `Add ${targets[0].split("/")[1] ?? targets[0]}`;
    return listed ? "Pick a repository" : "Add";
  })();

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <a
          className="rb-btn h-10 w-full justify-center"
          href={tokenTemplateUrl({ owner: replacing?.split("/")[0] })}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => setOpened(true)}
        >
          {replacing ? "Get a new key from GitHub" : "Get a key from GitHub"} <ExternalLink className="size-3.5" />
        </a>
        {opened && !haveToken ? (
          <p className="rb-enter rounded-xl bg-accent/[0.08] p-3 text-sm leading-relaxed text-ink">
            GitHub opens with everything filled in. Under <em>Repository access</em> pick <em>Only select repositories</em>,
            tick {replacing ? <span className="font-mono">{replacing.split("/")[1]}</span> : "your repositories"}, press{" "}
            <em>Generate token</em> and copy it here.
            <span className="mt-1 block text-muted">
              For an organisation&rsquo;s repository, choose the organisation under <em>Resource owner</em> first.
            </span>
          </p>
        ) : (
          !haveToken && (
            <p className="text-xs leading-relaxed text-faint">
              A key lets RepoBoard open the repositories you choose, and nothing else.
            </p>
          )
        )}
      </div>

      <label className="flex flex-col gap-2 text-sm font-medium text-ink">
        {replacing ? "New key" : "Key"}
        <input
          type="password"
          className="rb-input h-11 w-full rounded-xl font-mono"
          placeholder="Paste it here — github_pat_…"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>

      {looking && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Looking for the repositories this key opens…
        </p>
      )}
      {lookError && <ProblemBox problem={lookError} />}
      {repos && repos.length === 0 && (
        <div className="rb-enter rounded-xl bg-pill p-3 text-sm text-muted">
          <p className="text-ink">GitHub accepted the key, but it opens no repositories yet.</p>
          <p className="mt-1">
            <NextStep reason="no_access" />
          </p>
        </div>
      )}

      {listed && !typing && (
        <>
          <RepoList repos={repos!} picked={picked} toggle={toggle} connectedRepos={connectedRepos} />
          {repos!.some((r) => !r.private) && (
            <p className="-mt-3 text-xs leading-relaxed text-faint">
              Public repositories show up with any key, because anyone may read them. To save checklists and boards to
              one, the key must include it.
            </p>
          )}
        </>
      )}

      {(repos !== null || lookError) &&
        (showTyped ? (
          <label className="rb-enter flex flex-col gap-2 text-sm font-medium text-ink">
            The repository&rsquo;s address
            <input
              className="rb-input h-10 rounded-xl font-mono"
              placeholder="https://github.com/owner/name"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoFocus={typing}
              spellCheck={false}
            />
            <span className="text-xs font-normal text-faint">Copy it from the browser&rsquo;s address bar on the repository&rsquo;s page.</span>
          </label>
        ) : (
          <button
            type="button"
            className="-mt-2 w-fit text-xs text-muted underline decoration-ink/20 underline-offset-2 hover:text-ink"
            onClick={() => setTyping(true)}
          >
            The repository is not in the list
          </button>
        ))}

      {error && <ProblemBox problem={error} />}

      <button
        className={`rb-btn-primary h-11 w-full justify-center rounded-xl text-md ${busy ? "pointer-events-none" : ""}`}
        disabled={!haveToken || !targets.length}
        aria-busy={Boolean(busy)}
      >
        {busy && <Spinner />}
        {label}
      </button>

      <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted">
        The key stays on this computer, readable only by your user account. RepoBoard uses it to talk to GitHub and
        nothing else — there is no RepoBoard server.
      </p>
    </form>
  );
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  maintain: "Maintainer",
  write: "Can edit",
  triage: "Can comment",
  read: "Can view",
};

/** The repositories to pick from: glass rows, one or several at once. */
function RepoList({
  repos,
  picked,
  toggle,
  connectedRepos,
}: {
  repos: (Repo & { role?: string })[];
  picked: string[];
  toggle: (name: string) => void;
  connectedRepos: string[];
}) {
  return (
    <fieldset className="rb-enter flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">
        {repos.length === 1 ? "You can open one repository" : `You can open ${repos.length} repositories`}
      </legend>
      <div className="rb-scroll-thin -mx-1 flex max-h-[264px] flex-col gap-1.5 overflow-y-auto px-1 py-0.5">
        {repos.map((r) => {
          const on = picked.includes(r.fullName);
          const already = connectedRepos.includes(r.fullName.toLowerCase());
          const [who, name] = r.fullName.split("/");
          return (
            <label key={r.fullName} className="rb-pick" data-picked={on}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(r.fullName)} />
              <ProjectMark repo={r.fullName} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm text-ink">
                  <span className="truncate">
                    <span className="text-muted">{who}/</span>
                    <span className="font-medium">{name}</span>
                  </span>
                  {r.private ? (
                    <Lock className="size-3 shrink-0 text-faint" aria-label="Private" />
                  ) : (
                    <Globe className="size-3 shrink-0 text-faint" aria-label="Public" />
                  )}
                </span>
                {(r.description || already) && (
                  <span className="block truncate text-xs text-faint">
                    {already ? "Already added — it opens with this sign-in" : r.description}
                  </span>
                )}
              </span>
              {r.role && <span className="rb-pill shrink-0">{ROLE_LABEL[r.role] ?? r.role}</span>}
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${
                  on ? "border-accent bg-accent text-white" : "border-border-strong"
                }`}
                aria-hidden
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type SignIn = Awaited<ReturnType<typeof api.githubSignIn.start>>;
type AppRepo = Repo & { role: string };

/**
 * Signing in with GitHub: one button, a short code to enter on github.com,
 * and every repository the person can open appears — theirs, their
 * organisation's, and the ones they were invited to.
 */
function SignInFlow({
  status,
  replacing,
  connectedRepos,
  onConnected,
  onEngaged,
}: {
  status: { login: string | null; installUrl: string | null };
  replacing?: string | null;
  connectedRepos: string[];
  onConnected: (opened: string) => void;
  /** Whether a sign-in is under way or done, so the other way can step aside. */
  onEngaged: (engaged: boolean) => void;
}) {
  const [login, setLogin] = useState(status.login);
  const [flow, setFlow] = useState<SignIn | null>(null);
  useEffect(() => onEngaged(Boolean(login || flow)), [login, flow, onEngaged]);
  const [copied, setCopied] = useState(false);
  const [repos, setRepos] = useState<AppRepo[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const receive = (list: AppRepo[]) => {
    setRepos(list);
    const want = replacing?.toLowerCase();
    const match = want ? list.find((r) => r.fullName.toLowerCase() === want) : undefined;
    const fresh = list.filter((r) => !connectedRepos.includes(r.fullName.toLowerCase()));
    setPicked(match ? [match.fullName] : list.length === 1 ? [list[0].fullName] : fresh.length === 1 ? [fresh[0].fullName] : []);
  };

  const loadRepos = () => {
    setBusy("repos");
    setProblem(null);
    api.githubSignIn
      .repos()
      .then((r) => receive(r.repos))
      .catch((err) => {
        const p = problemOf(err);
        // The sign-in was withdrawn on GitHub: start over.
        if (p.reason === "expired") setLogin(null);
        setProblem(p);
      })
      .finally(() => setBusy(null));
  };

  // Back from GitHub after choosing repositories: look again without being asked.
  const empty = repos !== null && repos.length === 0;
  useEffect(() => {
    if (!login || !empty) return;
    const look = () => document.visibilityState === "visible" && loadRepos();
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
    };
    // loadRepos reads only state setters and fixed props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login, empty]);

  // Already signed in: go straight to the repositories.
  useEffect(() => {
    if (status.login) loadRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While GitHub waits for the person to approve, ask now and then whether they did.
  useEffect(() => {
    if (!flow) return;
    let stopped = false;
    let timer: number | undefined;
    const ask = () => {
      api.githubSignIn
        .poll(flow.flowId)
        .then((result) => {
          if (stopped) return;
          if (result.state === "done") {
            setFlow(null);
            setLogin(result.login);
            receive(result.repos);
            return;
          }
          if (result.state === "pending") {
            timer = window.setTimeout(ask, Math.max(1, flow.interval) * 1000);
            return;
          }
          setFlow(null);
          setProblem({
            message: result.state === "denied" ? "The sign-in was cancelled on GitHub." : "The code ran out. Start again for a new one.",
          });
        })
        .catch((err) => {
          if (stopped) return;
          setFlow(null);
          setProblem(problemOf(err));
        });
    };
    timer = window.setTimeout(ask, Math.max(1, flow.interval) * 1000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // receive only reads fixed props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const start = () => {
    setBusy("start");
    setProblem(null);
    api.githubSignIn
      .start()
      // GitHub asks for the code first thing, so show it before sending the person there.
      .then((f) => setFlow(f))
      .catch((err) => setProblem(problemOf(err)))
      .finally(() => setBusy(null));
  };

  const [progress, setProgress] = useState<{ name: string; n: number; of: number } | null>(null);
  const connect = async () => {
    if (!picked.length || busy) return;
    setBusy("connect");
    setProblem(null);
    // One at a time, so the button can say how far along it is. The first
    // picked opens: connect it last, as connecting opens a project.
    const order = [...picked.slice(1), picked[0]];
    let opened = "";
    try {
      for (const [index, repo] of order.entries()) {
        setProgress({ name: repo.split("/")[1] ?? repo, n: index + 1, of: order.length });
        opened = (await api.githubSignIn.connect([repo])).opened;
      }
      onConnected(opened);
    } catch (err) {
      setProblem(problemOf(err));
      setBusy(null);
      setProgress(null);
    }
  };

  const toggle = (name: string) => setPicked((list) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]));

  if (flow) {
    return (
      <div className="rb-enter flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-muted">Your code for GitHub:</p>
        <button
          type="button"
          className="rounded-2xl bg-ink/[0.05] px-6 py-4 font-mono text-[34px] font-semibold tracking-[0.18em] text-ink shadow-[inset_0_0_0_1px_rgb(var(--ink)/0.08)] hover:bg-ink/[0.08]"
          onClick={() => {
            void navigator.clipboard?.writeText(flow.userCode).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
          title="Copy the code"
        >
          {flow.userCode}
        </button>
        <p className="h-4 text-xs text-faint">{copied ? "Copied" : "Click the code to copy it"}</p>
        <a
          className="rb-btn-primary h-11 w-full justify-center rounded-xl text-md"
          href={flow.verificationUri}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => {
            void navigator.clipboard?.writeText(flow.userCode).then(() => setCopied(true));
          }}
        >
          Copy the code and open GitHub <ExternalLink className="size-3.5" />
        </a>
        <p className="text-xs leading-relaxed text-faint">
          Paste the code there, press <em>Continue</em> and then <em>Authorize</em>. Come back here — it goes on by itself.
        </p>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Waiting for GitHub…
        </p>
        <button type="button" className="text-xs text-muted underline decoration-ink/20 underline-offset-2 hover:text-ink" onClick={() => setFlow(null)}>
          Cancel
        </button>
      </div>
    );
  }

  if (!login) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="rb-btn-primary h-11 w-full justify-center rounded-xl text-md" onClick={start} disabled={busy === "start"}>
          {busy === "start" ? <Spinner /> : <GitHubMark size={18} />} Sign in with GitHub
        </button>
        <p className="text-xs leading-relaxed text-faint">
          GitHub shows a short code to confirm it is you. RepoBoard then sees the repositories you allow it — your own, your
          organisation&rsquo;s, and the ones you were invited to.
        </p>
        {problem && <ProblemBox problem={problem} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <GitHubMark size={16} className="text-ink" />
        Signed in as <span className="font-medium text-ink">{login}</span>
        <button
          type="button"
          className="ml-auto text-xs text-muted underline decoration-ink/20 underline-offset-2 hover:text-ink"
          onClick={() => {
            void api.githubSignIn.signOut().then(() => {
              setLogin(null);
              setRepos(null);
            });
          }}
        >
          Sign out
        </button>
      </div>

      {busy === "repos" && !repos && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Looking for your repositories…
        </p>
      )}
      {repos && repos.length > 0 && <RepoList repos={repos} picked={picked} toggle={toggle} connectedRepos={connectedRepos} />}
      {repos && repos.length === 0 && (
        <div className="rb-enter flex flex-col gap-3 rounded-2xl bg-accent/[0.07] p-4 shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.18)]">
          <div>
            <p className="text-md font-semibold text-ink">One more step on GitHub</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Choose which repositories RepoBoard may open — GitHub asks this once. Pick{" "}
              <em>Only select repositories</em>, tick yours and press <em>Install</em>. Then come back here: the list fills
              in by itself.
            </p>
          </div>
          {status.installUrl && (
            <a
              className="rb-btn-primary h-11 w-full justify-center rounded-xl text-md"
              href={status.installUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Choose repositories on GitHub <ExternalLink className="size-3.5" />
            </a>
          )}
          <button
            type="button"
            className="flex items-center justify-center gap-2 text-xs text-muted hover:text-ink"
            onClick={loadRepos}
            disabled={busy === "repos"}
          >
            {busy === "repos" && <Spinner />} I did it — look again
          </button>
        </div>
      )}
      {repos && repos.length > 0 && status.installUrl && (
        <p className="-mt-2 text-xs text-faint">
          Missing one?{" "}
          <a className="underline decoration-ink/20 underline-offset-2 hover:text-ink" href={status.installUrl} target="_blank" rel="noreferrer noopener">
            Add RepoBoard to more repositories
          </a>{" "}
          ·{" "}
          <button type="button" className="underline decoration-ink/20 underline-offset-2 hover:text-ink" onClick={loadRepos}>
            look again
          </button>
        </p>
      )}
      {problem && <ProblemBox problem={problem} />}
      {repos && repos.length > 0 && (
      <button
        type="button"
        // Stays bright while it works: a faded button over glass reads as something laid on top.
        className={`rb-btn-primary h-11 w-full justify-center rounded-xl text-md ${busy === "connect" ? "pointer-events-none" : ""}`}
        disabled={!picked.length}
        aria-busy={busy === "connect"}
        onClick={connect}
      >
        {busy === "connect" && <Spinner />}
        {busy === "connect"
          ? progress && progress.of > 1
            ? `Adding ${progress.name} · ${progress.n} of ${progress.of}`
            : `Opening ${progress?.name ?? ""}…`
          : picked.length > 1
            ? `Add ${picked.length} projects`
            : picked.length === 1
              ? `${connectedRepos.includes(picked[0].toLowerCase()) ? "Open" : "Add"} ${picked[0].split("/")[1]}`
              : "Pick a repository"}
      </button>
      )}
    </div>
  );
}

/**
 * Connecting repositories: sign in with GitHub when this copy of RepoBoard
 * has the GitHub App, with a key as the other way; a key only, otherwise.
 */
export function ConnectFlow({
  replacing,
  connectedRepos = [],
  onConnected,
}: {
  replacing?: string | null;
  connectedRepos?: string[];
  onConnected: (opened: string) => void;
}) {
  const [status, setStatus] = useState<{ available: boolean; login: string | null; installUrl: string | null } | null>(null);
  const [withKey, setWithKey] = useState(false);
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    api.githubSignIn
      .status()
      .then(setStatus)
      .catch(() => setStatus({ available: false, login: null, installUrl: null }));
  }, []);

  if (!status) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> One moment…
      </p>
    );
  }
  if (!status.available || withKey) {
    return (
      <div className="flex flex-col gap-4">
        <KeyFlow replacing={replacing} connectedRepos={connectedRepos} onConnected={onConnected} />
        {status.available && (
          <button type="button" className="w-fit text-xs text-muted underline decoration-ink/20 underline-offset-2 hover:text-ink" onClick={() => setWithKey(false)}>
            Sign in with GitHub instead
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <SignInFlow
        status={status}
        replacing={replacing}
        connectedRepos={connectedRepos}
        onConnected={onConnected}
        onEngaged={setEngaged}
      />
      {!engaged && (
        <>
          <div className="flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <button type="button" className="rb-btn h-10 w-full justify-center rounded-xl" onClick={() => setWithKey(true)}>
            Use a key instead
          </button>
        </>
      )}
      <p className="text-xs leading-relaxed text-muted">
        Whatever you choose, it stays on this computer, readable only by your user account. RepoBoard talks to GitHub and
        nothing else — there is no RepoBoard server.
      </p>
    </div>
  );
}
