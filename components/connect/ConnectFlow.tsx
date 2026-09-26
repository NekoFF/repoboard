"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ExternalLink, Globe, Lock } from "lucide-react";
import { ProjectMark } from "@/components/shell/ProjectSwitcher";
import { Spinner } from "@/components/ui";
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

function Problem({ problem }: { problem: Problem }) {
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
 * Connecting repositories the way a person does it: get a key from GitHub
 * (the page opens already filled in), paste it, and pick from the
 * repositories that key opens — one or several at once. No names to spell,
 * no permissions to look up.
 *
 * `replacing` gives a project that is already connected a new key.
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
    if (busy) return targets.length > 1 ? `Adding ${busy.split("/")[1] ?? busy}…` : "Checking with GitHub…";
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
      {lookError && <Problem problem={lookError} />}
      {repos && repos.length === 0 && (
        <div className="rb-enter rounded-xl bg-pill p-3 text-sm text-muted">
          <p className="text-ink">GitHub accepted the key, but it opens no repositories yet.</p>
          <p className="mt-1">
            <NextStep reason="no_access" />
          </p>
        </div>
      )}

      {listed && !typing && (
        <fieldset className="rb-enter flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink">
            {repos!.length === 1 ? "This key opens one repository" : `This key opens ${repos!.length} repositories`}
          </legend>
          <div className="rb-scroll-thin -mx-1 flex max-h-[264px] flex-col gap-1.5 overflow-y-auto px-1 py-0.5">
            {repos!.map((r) => {
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
                        {already ? "Already added — it gets this key" : r.description}
                      </span>
                    )}
                  </span>
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
          {repos!.some((r) => !r.private) && (
            <p className="mt-1 text-xs leading-relaxed text-faint">
              Public repositories show up with any key, because anyone may read them. To save checklists and boards to
              one, the key must include it.
            </p>
          )}
        </fieldset>
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

      {error && <Problem problem={error} />}

      <button className="rb-btn-primary h-11 w-full justify-center rounded-xl text-md" disabled={Boolean(busy) || !haveToken || !targets.length}>
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
