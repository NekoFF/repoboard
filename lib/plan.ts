import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { repositories } from "@/db/schema";
import { GitHubClient, type RepoClient } from "@/lib/github/client";

/**
 * Where a project keeps its plan — everything under .repoboard/: board.json,
 * checklists, notes, decisions, screenshots. The code's own information
 * (branches, commits, pull requests, issues, files named in proofs) always
 * comes from the project's repository; only the plan can live elsewhere:
 *
 * - "main": in the repository, on its default branch — as RepoBoard always
 *   did (automatic sync may still keep board.json on the repoboard branch).
 *   Every project that never chose starts here, so nothing changes for it.
 * - "branch": in the repository, on RepoBoard's own branch (PLAN_BRANCH):
 *   the code's branches and history stay the code's. Still as visible as the
 *   repository — a public repository's branches are public.
 * - "repo": in a separate repository (owner/name on the same host, opened
 *   with the same key) — private even when the code is public, with its own
 *   list of people.
 *
 * Every read and write of a plan file goes through planAware(), which sends
 * paths under .repoboard/ to the plan's place and everything else to the
 * code, so the documents and boards code does not need to know.
 */

export type PlanMode = "main" | "branch" | "repo";

export const PLAN_DIR = ".repoboard";
/** RepoBoard's own branch — the same one automatic sync has always used. */
export const PLAN_BRANCH = "repoboard";
/** A small file in the plan's place that says whose plan it is (and, left behind after a move, where it went). */
export const LOCATION_FILE = `${PLAN_DIR}/location.json`;

export interface PlanLocation {
  mode: PlanMode;
  /** owner/name of the plan's repository ("repo" mode). */
  repo: string | null;
}

export const isPlanPath = (path: string) => {
  const clean = path.replace(/^\/+/, "");
  return clean === PLAN_DIR || clean.startsWith(`${PLAN_DIR}/`);
};

type PlanRow = { id: string; planMode?: string | null; planRepo?: string | null };

export function planLocationOf(row: PlanRow | null | undefined): PlanLocation {
  const mode = row?.planMode === "branch" || row?.planMode === "repo" ? row.planMode : "main";
  const repo = mode === "repo" ? row?.planRepo ?? null : null;
  // A "repo" mode without a repository (cannot happen through the app) reads as main, never as nowhere.
  return mode === "repo" && !repo ? { mode: "main", repo: null } : { mode, repo };
}

export function planLocationFor(repositoryId: string | null | undefined): PlanLocation {
  if (!repositoryId) return { mode: "main", repo: null };
  const row = db
    .select({ id: repositories.id, planMode: repositories.planMode, planRepo: repositories.planRepo })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get();
  return planLocationOf(row);
}

/** What a location.json says. Unknown or broken files say nothing. */
export interface LocationNote {
  /** The code repository this plan is for (owner/name). */
  for: string | null;
  mode: PlanMode | null;
  /** Left behind after a move: where the plan is now. */
  movedTo: { mode: PlanMode; repo: string | null } | null;
}

export function parseLocationNote(text: string | null | undefined): LocationNote | null {
  if (!text) return null;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;
    const mode = (v: unknown): PlanMode | null => (v === "main" || v === "branch" || v === "repo" ? v : null);
    const moved = data.movedTo as Record<string, unknown> | undefined;
    const movedMode = moved ? mode(moved.mode) : null;
    return {
      for: typeof data.for === "string" ? data.for : null,
      mode: mode(data.mode),
      movedTo: movedMode ? { mode: movedMode, repo: typeof moved?.repo === "string" ? (moved.repo as string) : null } : null,
    };
  } catch {
    return null;
  }
}

export function locationNote(args: { for: string; mode: PlanMode; movedTo?: { mode: PlanMode; repo: string | null } }): string {
  return `${JSON.stringify(
    {
      about: "Written by RepoBoard: where this project's plan (boards, checklists, notes) is kept.",
      for: args.for,
      ...(args.movedTo ? { movedTo: args.movedTo } : { mode: args.mode }),
    },
    null,
    2,
  )}\n`;
}

/* ------------------------------------------------------------------ routing -- */

type Client = RepoClient;
type Edit = { path: string; content: string; expectedSha: string };
type Add = { path: string; base64: string };

/**
 * The client, pointed at a branch: every read, list and commit goes there.
 * (For the documents' branch, and for the plan on RepoBoard's own branch.)
 */
export function onBranch<T extends object>(gh: T, branch: string | null): T {
  if (!branch) return gh;
  const client = gh as T & Record<string, unknown>;
  return new Proxy(client, {
    get(target, prop) {
      const fn = (name: string) => Reflect.get(target, name) as ((...args: unknown[]) => Promise<unknown>) | undefined;
      if (prop === "getFile") return (path: string, ref?: string) => fn("getFile")!.call(target, path, ref ?? branch);
      if (prop === "getFileBytes" && fn("getFileBytes")) return (path: string, ref?: string) => fn("getFileBytes")!.call(target, path, ref ?? branch);
      if (prop === "listMarkdownFiles" && fn("listMarkdownFiles")) return () => fn("listMarkdownFiles")!.call(target, branch);
      if (prop === "listFiles" && fn("listFiles")) return () => fn("listFiles")!.call(target, branch);
      if (prop === "fileShas" && fn("fileShas")) return () => fn("fileShas")!.call(target, branch);
      if (prop === "headCommit" && fn("headCommit")) return () => fn("headCommit")!.call(target, branch);
      if (prop === "putFile") return (args: { branch?: string }) => fn("putFile")!.call(target, { ...args, branch: args.branch ?? branch });
      if (prop === "commitChanges" && fn("commitChanges")) return (args: object) => fn("commitChanges")!.call(target, { branch, ...args });
      if (prop === "createFiles" && fn("createFiles")) return (args: object) => fn("createFiles")!.call(target, { branch, ...args });
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

/**
 * One client over two places: paths under .repoboard/ go to `plan`, every
 * other path to `code`. A commit that touches both becomes two commits, the
 * plan's first. File lists are the plan's .repoboard/ and the code's other
 * files — a .repoboard/ folder left in the code after a move is not read.
 * `watchKey` is both heads, so a change in either is noticed.
 */
export function splitClient(code: Client, plan: Client, describe: string): Client & { watchKey(): Promise<string>; planPlace: string } {
  const pick = (path: string) => (isPlanPath(path) ? plan : code);
  const handler: ProxyHandler<Client> = {
    get(target, prop) {
      switch (prop) {
        case "planPlace":
          return describe;
        case "getFile":
          return (path: string, ref?: string) => pick(path).getFile(path, ref);
        case "getFileBytes":
          return (path: string, ref?: string) => pick(path).getFileBytes(path, ref);
        case "putFile":
          return (args: Parameters<Client["putFile"]>[0]) => pick(args.path).putFile(args);
        case "listMarkdownFiles":
          return async () => {
            // A plan that cannot be listed is an error, never "no documents" (that would drop them all).
            const [inPlan, inCode] = await Promise.all([plan.listMarkdownFiles(), code.listMarkdownFiles()]);
            return [...inPlan.filter(isPlanPath), ...inCode.filter((p) => !isPlanPath(p))].sort();
          };
        case "listFiles":
          return async () => {
            const [inPlan, inCode] = await Promise.all([plan.listFiles(), code.listFiles()]);
            return [...inPlan.filter(isPlanPath), ...inCode.filter((p) => !isPlanPath(p))].sort();
          };
        case "headCommit":
          // What a permalink names: the code's commit (proofs point at code).
          return () => code.headCommit();
        case "watchKey":
          return async () => {
            // The plan's documents by their blob SHAs, so a board sync (board.json) is not a change
            // that reads every document again; the code by its head.
            const head = code.headCommit().catch((error: { status?: number }) => {
              if (error?.status === 409) return "empty";
              throw error;
            });
            const shas = await plan.fileShas();
            const docs = [...shas]
              .filter(([p]) => isPlanPath(p) && p.endsWith(".md"))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([p, sha]) => `${p}:${sha}`)
              .join("\n");
            const digest = createHash("sha1").update(docs).digest("hex");
            return `${digest}+${await head}`;
          };
        case "commitChanges":
          return async (args: { message: string; edits: Edit[]; adds: Add[]; branch?: string }) => {
            const part = (inPlan: boolean) => ({
              message: args.message,
              edits: args.edits.filter((e) => isPlanPath(e.path) === inPlan),
              adds: args.adds.filter((a) => isPlanPath(a.path) === inPlan),
            });
            const forPlan = part(true);
            const forCode = part(false);
            let commitSha = "";
            if (forPlan.edits.length + forPlan.adds.length) commitSha = (await plan.commitChanges(forPlan)).commitSha;
            if (forCode.edits.length + forCode.adds.length) commitSha = (await code.commitChanges(forCode)).commitSha;
            return { commitSha };
          };
        case "createFiles":
          return async (args: { files: { path: string; content: string }[]; message: string }) => {
            const forPlan = args.files.filter((f) => isPlanPath(f.path));
            const forCode = args.files.filter((f) => !isPlanPath(f.path));
            let commitSha = "";
            if (forPlan.length) commitSha = (await plan.createFiles({ files: forPlan, message: args.message })).commitSha;
            if (forCode.length) commitSha = (await code.createFiles({ files: forCode, message: args.message })).commitSha;
            return { commitSha };
          };
        default: {
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  };
  return new Proxy(code, handler) as Client & { watchKey(): Promise<string>; planPlace: string };
}

/** The plan's own place as a client: RepoBoard's branch here, or the plan's repository. */
export async function planClient(code: Client, location: PlanLocation): Promise<Client | null> {
  if (location.mode === "branch") return onBranch(code, PLAN_BRANCH);
  if (location.mode === "repo" && location.repo) return GitHubClient.createFor(location.repo);
  return null;
}

/**
 * The client every plan read and write goes through: in "main" mode the code
 * itself (on the documents' branch, when one was chosen); otherwise the split
 * client over the code and the plan's place.
 */
export async function planAware(code: Client, location: PlanLocation, docsBranch: string | null): Promise<Client> {
  const plan = await planClient(code, location);
  if (!plan) return onBranch(code, docsBranch);
  return splitClient(code, plan, describePlace(location));
}

export function describePlace(location: PlanLocation): string {
  if (location.mode === "repo") return location.repo ?? "another repository";
  if (location.mode === "branch") return `the ${PLAN_BRANCH} branch`;
  return "main";
}

/** Where board.json is read and written when the boards sync on their own. */
export async function boardsTarget(code: Client, location: PlanLocation): Promise<{ gh: Client; branch: string | undefined; ensure: boolean }> {
  if (location.mode === "repo" && location.repo) return { gh: await GitHubClient.createFor(location.repo), branch: undefined, ensure: false };
  return { gh: code, branch: PLAN_BRANCH, ensure: true };
}

/** RepoBoard's automatic commits say so, so CI does not run for a board moving. */
export const SKIP_CI = "[skip ci]";

/* ---------------------------------------------------------------- choosing -- */

/** Keeps the plan here from now on. Documents are read again from the new place on the next look. */
export function setPlanLocation(repositoryId: string, location: PlanLocation): void {
  db.update(repositories)
    .set({
      planMode: location.mode === "main" ? null : location.mode,
      planRepo: location.mode === "repo" ? location.repo : null,
      // Kept apart from main, the boards sync on their own; back in main they stay as they were.
      ...(location.mode !== "main" ? { autoSync: true } : {}),
      docsCommit: null,
      ...(location.mode !== "main" ? { docsBranch: null } : {}),
    })
    .where(eq(repositories.id, repositoryId))
    .run();
}

type Reader = { getFile(path: string, ref?: string): Promise<{ content: string; sha: string }> };

const readNote = (gh: Reader, ref?: string) =>
  gh
    .getFile(LOCATION_FILE, ref)
    .then((f) => parseLocationNote(f.content))
    .catch(() => null);

/** The name a plan's repository gets by default: the code's name with -plan. */
export const defaultPlanRepo = (owner: string, name: string) => `${owner}/${name}-plan`;

export type Found =
  | { kind: "found"; location: PlanLocation; how: string }
  /** The plan is in a repository this key cannot open (yet). */
  | { kind: "blocked"; repo: string }
  /** A note points somewhere RepoBoard does not follow on its own (another owner, or public from private): ask first. */
  | { kind: "ask"; location: PlanLocation; how: string }
  | null;

const SLUG = /^[\w.-]+\/[\w.-]+$/;
const sameRepo = (a: string | null, b: string | null) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
const key = (l: PlanLocation) => (l.mode === "repo" ? `repo:${(l.repo ?? "").toLowerCase()}` : l.mode);

/**
 * Where another computer keeps this project's plan, when it is not where
 * this one looks — so a teammate's RepoBoard, or a second computer, follows
 * on its own. From the place this computer uses, notes are followed hop by
 * hop (a plan can move more than once) to the first place whose note does
 * not send it on. In main with no note of its own, RepoBoard's branch is
 * looked at, and — only when nothing of the plan is on this computer yet —
 * a repository named <name>-plan whose note names this project.
 *
 * A note is only followed on its own to a repository of the same owner, and
 * never from a private project to a public place: anything else is asked
 * ("ask"), since anyone who can write a note could otherwise send the boards
 * anywhere.
 */
export async function findPlan(args: {
  code: Reader;
  slug: string;
  current: PlanLocation;
  open: (slug: string) => Promise<Reader>;
  /** Nothing of the plan on this computer yet: a repository named <name>-plan may be taken as it. */
  fresh: boolean;
  /** The code repository's visibility. */
  codePrivate?: boolean;
}): Promise<Found> {
  const { code, slug, current, open, fresh, codePrivate = false } = args;
  const [owner, name] = slug.split("/");

  /** A place's note, or why it cannot be read. */
  const noteAt = async (place: PlanLocation): Promise<{ note: LocationNote | null; blocked?: string; visibility?: "public" | "private" }> => {
    if (place.mode === "repo") {
      if (!place.repo || !SLUG.test(place.repo)) return { note: null, blocked: place.repo ?? "?" };
      const gh = await open(place.repo).catch(() => null);
      const summary = gh ? await repoSummary(gh) : null;
      if (!gh || !summary) return { note: null, blocked: place.repo };
      return { note: await readNote(gh), visibility: summary.visibility };
    }
    return { note: await readNote(code, place.mode === "branch" ? PLAN_BRANCH : undefined) };
  };

  /** Follows notes from `start`; the place reached, or why not. */
  const resolve = async (start: PlanLocation, startNote: LocationNote | null, how: string): Promise<Found> => {
    const seen = new Set([key(start)]);
    let place = start;
    let note = startNote;
    let ask = false;
    for (let hop = 0; hop < 5 && note?.movedTo; hop += 1) {
      const next: PlanLocation = { mode: note.movedTo.mode, repo: note.movedTo.mode === "repo" ? note.movedTo.repo : null };
      if (seen.has(key(next))) break;
      seen.add(key(next));
      const at = await noteAt(next);
      if (at.blocked) return { kind: "blocked", repo: at.blocked };
      // A note that says it is another project's plan is not this one's.
      if (at.note?.for && !sameRepo(at.note.for, slug)) return null;
      if (next.mode === "repo" && (!sameRepo(next.repo!.split("/")[0], owner) || (codePrivate && at.visibility === "public"))) ask = true;
      place = next;
      note = at.note;
    }
    if (key(place) === key(current)) return null;
    return ask ? { kind: "ask", location: place, how } : { kind: "found", location: place, how };
  };

  if (current.mode !== "main") {
    const at = await noteAt(current);
    if (at.blocked) return { kind: "blocked", repo: at.blocked };
    return at.note?.movedTo ? resolve(current, at.note, `the note in ${describePlace(current)}`) : null;
  }

  // In main: main's own note decides when there is one.
  const inMain = await readNote(code);
  if (inMain?.movedTo) return resolve(current, inMain, "the note in main");
  if (inMain) return null;
  // No note in main: RepoBoard's branch may hold the plan (or say where it went).
  const onBranchNote = await readNote(code, PLAN_BRANCH);
  if (onBranchNote?.movedTo || onBranchNote?.mode === "branch") {
    if (onBranchNote.for && !sameRepo(onBranchNote.for, slug)) return null;
    return resolve({ mode: "branch", repo: null }, onBranchNote, `the ${PLAN_BRANCH} branch`);
  }
  // Something of the plan is here already: a <name>-plan repository is not taken over it unasked.
  if (!fresh) return null;
  const guess = defaultPlanRepo(owner, name);
  const gh = await open(guess).catch(() => null);
  const summary = gh ? await repoSummary(gh) : null;
  if (!gh || !summary) return null;
  const note = await readNote(gh);
  // Only a plan that says it is this project's, and is still there (not moved away).
  if (!note || !sameRepo(note.for, slug) || note.mode !== "repo") {
    return note?.movedTo && sameRepo(note.for, slug) ? resolve({ mode: "repo", repo: guess }, note, guess) : null;
  }
  if (codePrivate && summary.visibility === "public") return { kind: "ask", location: { mode: "repo", repo: guess }, how: guess };
  return { kind: "found", location: { mode: "repo", repo: guess }, how: guess };
}

async function repoSummary(gh: Reader): Promise<{ visibility: "public" | "private" } | null> {
  const repo = gh as Reader & { getRepo?: () => Promise<{ visibility: "public" | "private" }> };
  if (!repo.getRepo) return null;
  return repo.getRepo().catch(() => null);
}


/** The plan's repository this key could not open, per project — for the screens that say so. */
const blocked = new Map<string, string>();
export const planBlocked = (repositoryId: string) => blocked.get(repositoryId) ?? null;
export function setPlanBlocked(repositoryId: string, repo: string | null): void {
  if (repo) blocked.set(repositoryId, repo);
  else blocked.delete(repositoryId);
}

/** A move another computer made that RepoBoard asks about before following (findPlan "ask"). */
const asking = new Map<string, PlanLocation>();
export const planAsk = (repositoryId: string) => asking.get(repositoryId) ?? null;
export function setPlanAsk(repositoryId: string, location: PlanLocation | null): void {
  if (location) asking.set(repositoryId, location);
  else asking.delete(repositoryId);
}
