import { GitHubClient, type RepoClient } from "@/lib/github/client";
import { BOARD_STATE_PATH } from "@/lib/board-state";
import { activeRepository, boardFileFor, logActivity, syncBoards } from "@/lib/board-service";
import { documentsBranch, watchDocs } from "@/lib/docs-service";
import { db } from "@/lib/db/client";
import { repositories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { activeHost } from "@/lib/github/auth-provider";
import { buildDiff, type DiffLine } from "@/lib/markdown/sync";
import {
  describePlace,
  isPlanPath,
  LOCATION_FILE,
  locationNote,
  onBranch,
  parseLocationNote,
  PLAN_BRANCH,
  planAsk,
  planBlocked as planBlockedFor,
  setPlanAsk,
  planLocationFor,
  setPlanBlocked,
  setPlanLocation,
  SKIP_CI,
  type PlanLocation,
} from "@/lib/plan";

/**
 * Moving a project's plan from one place to another (lib/plan.ts): every file
 * under .repoboard/ is copied to the new place in one commit, the boards are
 * merged into the board.json there, and — if the person wants — a note is
 * left in the old place so every other computer follows on its own, and the
 * old copy is removed. Nothing is written before the person has seen the
 * list (previewPlanMove); the old place's history keeps what it had.
 */

type Opened = { client: RepoClient; exists: boolean };

const BINARY = /\.(png|jpe?g|webp|gif|pdf|avif|heic|mp4|mov|zip)$/i;

export interface PlanMoveFile {
  path: string;
  /** new: not there yet; replace: there, different; same: already there as it is. */
  status: "new" | "replace" | "same";
  /** The file's SHA in the old place, and in the new one (null: not there) — the move refuses if either moved since. */
  sourceSha: string;
  targetSha: string | null;
  /** For a text file that replaces another: what changes there. */
  diff?: DiffLine[];
}

export interface PlanMovePreview {
  from: PlanLocation;
  to: PlanLocation;
  fromPlace: string;
  toPlace: string;
  files: PlanMoveFile[];
  /** Plan files that stay in the old place unless the person removes them. */
  oldFiles: string[];
  /** The new place can be written: otherwise what is wrong, in words, and what to do. */
  problem: { code: "missing" | "no_access" | "other_project" | "read_only" | "same"; message: string } | null;
  /** The new place as GitHub sees it. */
  toVisibility: "public" | "private" | null;
  /** The new place already holds this project's plan (a teammate put it there): it can simply be used. */
  existing: boolean;
  codeVisibility: "public" | "private";
  /** Back to main: the old place must say so, or other computers would stay there. */
  noteRequired: boolean;
  host: "github" | "gitlab";
}

async function code(): Promise<RepoClient> {
  return GitHubClient.create();
}

const missing = (error: unknown) => {
  const status = (error as { status?: number }).status;
  return status === 404 || /not found/i.test((error as Error).message ?? "");
};

/** The plan's place as a client, and whether it exists yet. Only a "not found" counts as missing. */
async function open(location: PlanLocation, gh: RepoClient): Promise<Opened> {
  if (location.mode === "repo" && location.repo) {
    const client = await GitHubClient.createFor(location.repo);
    const exists = await client.getRepo().then(
      () => true,
      (error) => {
        if (missing(error)) return false;
        throw error;
      },
    );
    return { client, exists };
  }
  if (location.mode === "branch") {
    const exists = await gh.headCommit(PLAN_BRANCH).then(
      () => true,
      (error) => {
        if (missing(error)) return false;
        throw error;
      },
    );
    return { client: onBranch(gh, PLAN_BRANCH), exists };
  }
  return { client: onBranch(gh, documentsBranch()), exists: true };
}

/** Where this place's board.json is read from (main with automatic sync keeps it on RepoBoard's branch). */
async function boardsAt(location: PlanLocation, gh: RepoClient, place: Opened): Promise<{ client: RepoClient; ref?: string }> {
  if (location.mode === "main") {
    const auto = db.select({ a: repositories.autoSync }).from(repositories).where(eq(repositories.id, activeRepository()!.id)).get()?.a;
    return auto ? { client: gh, ref: PLAN_BRANCH } : { client: gh };
  }
  return { client: place.client };
}

/** Plan files in a place, without RepoBoard's own two (board.json travels merged; the note is per place). */
async function planFiles(place: Opened): Promise<string[]> {
  if (!place.exists) return [];
  const all = await place.client.listFiles();
  return all.filter((p) => isPlanPath(p) && p !== BOARD_STATE_PATH && p !== LOCATION_FILE);
}

const bytesOf = (place: Opened, path: string) =>
  place.exists
    ? place.client.getFileBytes(path).then(
        (f) => f,
        () => null,
      )
    : Promise.resolve(null);

const sameLocation = (a: PlanLocation, b: PlanLocation) =>
  a.mode === b.mode && (a.mode !== "repo" || (a.repo ?? "").toLowerCase() === (b.repo ?? "").toLowerCase());

export async function previewPlanMove(to: PlanLocation): Promise<PlanMovePreview> {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const from = planLocationFor(repository.id);
  const gh = await code();
  const source = await open(from, gh);
  const target = await open(to, gh);
  const slug = `${repository.owner}/${repository.name}`;

  let problem: PlanMovePreview["problem"] = null;
  let toVisibility: PlanMovePreview["toVisibility"] = null;
  let existing = false;
  if (sameLocation(from, to)) problem = { code: "same", message: "The plan is kept there already." };
  if (!problem && to.mode === "repo") {
    if (!to.repo || !/^[\w.-]+\/[\w.-]+$/.test(to.repo)) {
      problem = { code: "missing", message: "Name the repository as owner/name." };
    } else if (to.repo.toLowerCase() === slug.toLowerCase()) {
      problem = { code: "same", message: "That is the project's own repository — choose “On RepoBoard's own branch” instead." };
    } else if (!target.exists) {
      problem = {
        code: "missing",
        message: `RepoBoard cannot open ${to.repo}: it does not exist yet, or the sign-in or key does not include it.`,
      };
    } else {
      const summary = await target.client.getRepo();
      toVisibility = summary.visibility;
      if (summary.role === "viewer") {
        problem = { code: "read_only", message: `You can only read ${to.repo}; the plan needs a repository you can write to.` };
      }
      const note = await target.client
        .getFile(LOCATION_FILE)
        .then((f) => parseLocationNote(f.content))
        .catch(() => null);
      if (!problem && note?.for && note.for.toLowerCase() !== slug.toLowerCase()) {
        problem = { code: "other_project", message: `${to.repo} keeps the plan of ${note.for}. Use a repository of its own for this project.` };
      }
      existing = Boolean(note?.for && note.for.toLowerCase() === slug.toLowerCase() && !note.movedTo);
    }
  } else if (to.mode !== "repo") {
    toVisibility = repository.visibility;
    if (to.mode === "branch" && target.exists) {
      const note = await target.client
        .getFile(LOCATION_FILE)
        .then((f) => parseLocationNote(f.content))
        .catch(() => null);
      existing = note?.mode === "branch" && !note.movedTo;
    }
  }

  const sourceFiles = await planFiles(source);
  const files: PlanMoveFile[] = [];
  for (const path of sourceFiles) {
    const [a, b] = await Promise.all([bytesOf(source, path), bytesOf(target, path)]);
    if (!a) continue;
    const status = !b ? "new" : a.sha === b.sha ? "same" : "replace";
    const diff =
      status === "replace" && !BINARY.test(path) ? buildDiff(b!.bytes.toString("utf8"), a.bytes.toString("utf8")) : undefined;
    files.push({ path, status, sourceSha: a.sha, targetSha: b?.sha ?? null, ...(diff ? { diff } : {}) });
  }
  return {
    from,
    to,
    fromPlace: from.mode === "main" ? (documentsBranch() ?? repository.defaultBranch) : describePlace(from),
    toPlace: to.mode === "main" ? repository.defaultBranch : describePlace(to),
    files,
    oldFiles: sourceFiles,
    problem,
    toVisibility,
    existing,
    codeVisibility: repository.visibility,
    noteRequired: to.mode === "main",
    host: activeHost().kind,
  };
}

/**
 * Uses a plan that is already in a place (a teammate moved it there) without
 * copying anything: this computer reads and syncs there from now on.
 */
export async function openPlanAt(to: PlanLocation): Promise<{ place: string }> {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const preview = await previewPlanMove(to);
  if (preview.problem && preview.problem.code !== "same") throw new Error(preview.problem.message);
  setPlanLocation(repository.id, to);
  setPlanBlocked(repository.id, null);
  setPlanAsk(repository.id, null);
  if (to.mode === "main") db.update(repositories).set({ autoSync: false }).where(eq(repositories.id, repository.id)).run();
  else await syncBoards(undefined, undefined, false);
  await watchDocs({ force: true }).catch(() => null);
  logActivity({ repositoryId: repository.id, type: "sync_settings", message: `opened the plan kept in ${preview.toPlace}` });
  return { place: preview.toPlace };
}

function conflict(message: string): Error {
  const error = new Error(message);
  (error as Error & { code?: string }).code = "CONFLICT";
  return error;
}

/**
 * Moves the plan. `seen`: each file's SHAs in the preview the person looked
 * at — anything that moved since means a new look. `leaveNote`: a
 * location.json in the old place saying where it went (other computers follow
 * it; always, when the plan goes back to main); `removeOld`: the old
 * .repoboard/ files are removed there, each still as it was seen.
 *
 * Order: the new place first, then the old place's note, and only then this
 * computer switches — a failure on the way leaves it where it was, and moving
 * again picks up from what is there already.
 */
export async function movePlan(
  to: PlanLocation,
  options: { leaveNote: boolean; removeOld: boolean },
  seen?: Record<string, { source: string; target: string | null }>,
): Promise<{ copied: number; commits: string[]; place: string }> {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const preview = await previewPlanMove(to);
  if (preview.problem) throw new Error(preview.problem.message);
  if (seen) {
    for (const f of preview.files) {
      const was = seen[f.path];
      if (!was || was.source !== f.sourceSha || (was.target ?? null) !== (f.targetSha ?? null)) {
        throw conflict(`${f.path} changed since you looked. Look at the move again.`);
      }
    }
    if (Object.keys(seen).some((p) => !preview.files.some((f) => f.path === p))) throw conflict("The plan's files changed since you looked. Look at the move again.");
  }
  const leaveNote = options.leaveNote || options.removeOld || preview.noteRequired;
  const from = preview.from;
  const gh = await code();
  const source = await open(from, gh);
  let target = await open(to, gh);
  const slug = `${repository.owner}/${repository.name}`;
  const commits: string[] = [];

  // What other computers synced to the old place comes along too.
  const sourceBoards = await boardsAt(from, gh, source);
  await boardFileFor(sourceBoards.client, sourceBoards.ref);

  const moving = preview.files.filter((f) => f.status !== "same");
  const bytes = new Map<string, string>();
  for (const f of moving) bytes.set(f.path, (await source.client.getFileBytes(f.path)).bytes.toString("base64"));
  const note = Buffer.from(locationNote({ for: slug, mode: to.mode }), "utf8").toString("base64");
  const message = `RepoBoard: move the plan here from ${preview.fromPlace} (${moving.length} file${moving.length === 1 ? "" : "s"}) ${SKIP_CI}`;

  let written = false;
  if (to.mode === "branch" && !target.exists) {
    // A branch of its own, with nothing of the code in it.
    const files = [...moving.map((f) => ({ path: f.path, base64: bytes.get(f.path)! })), { path: LOCATION_FILE, base64: note }];
    written = await gh.createOrphanBranch(PLAN_BRANCH, files, message);
    // Made by another computer a moment ago: write into it as into any existing place.
    if (!written) target = await open(to, gh);
  }
  if (!written) {
    const edits: { path: string; content: string; expectedSha: string; base64?: string }[] = [];
    const adds: { path: string; base64: string }[] = [];
    for (const f of moving) {
      if (f.status === "replace") edits.push({ path: f.path, content: "", base64: bytes.get(f.path)!, expectedSha: f.targetSha! });
      else adds.push({ path: f.path, base64: bytes.get(f.path)! });
    }
    // The note in the new place: whose plan it is (in main too, so a note elsewhere cannot send computers off again).
    const existingNote = await target.client.getFile(LOCATION_FILE).catch(() => null);
    if (existingNote) edits.push({ path: LOCATION_FILE, content: Buffer.from(note, "base64").toString("utf8"), expectedSha: existingNote.sha });
    else adds.push({ path: LOCATION_FILE, base64: note });
    if (to.mode === "main") {
      // The boards go with them, into main's board.json.
      const board = await boardFileFor(target.client);
      if (board.sha) edits.push({ path: BOARD_STATE_PATH, content: board.content, expectedSha: board.sha });
      else adds.push({ path: BOARD_STATE_PATH, base64: Buffer.from(board.content, "utf8").toString("base64") });
    }
    if (edits.length + adds.length) commits.push((await target.client.commitChanges({ message, edits, adds })).commitSha);
  }

  // The old place: a note saying where the plan went (main's on its default branch, where other computers look), and its old copy removed if wanted.
  if (leaveNote) {
    const movedNote = locationNote({ for: slug, mode: from.mode, movedTo: { mode: to.mode, repo: to.repo } });
    const noteClient = from.mode === "main" ? gh : source.client;
    const current = await noteClient.getFile(LOCATION_FILE).catch(() => null);
    const noteEdit = current ? [{ path: LOCATION_FILE, content: movedNote, expectedSha: current.sha }] : [];
    const noteAdd = current ? [] : [{ path: LOCATION_FILE, base64: Buffer.from(movedNote, "utf8").toString("base64") }];
    const deletes: { path: string; expectedSha: string }[] = [];
    if (options.removeOld) {
      for (const f of preview.files) deletes.push({ path: f.path, expectedSha: f.sourceSha });
      const board = await source.client.getFile(BOARD_STATE_PATH).catch(() => null);
      if (board) deletes.push({ path: BOARD_STATE_PATH, expectedSha: board.sha });
    }
    const sameBranch = from.mode !== "main" || !documentsBranch() || documentsBranch() === repository.defaultBranch;
    const word = `RepoBoard: the plan moved to ${preview.toPlace}`;
    try {
      if (sameBranch) {
        commits.push((await source.client.commitChanges({ message: `${word}${options.removeOld ? "; removed the old copy" : ""} ${SKIP_CI}`, edits: noteEdit, adds: noteAdd, deletes })).commitSha);
      } else {
        // main's own board.json is on the default branch, next to the note.
        const mainBoard = options.removeOld ? await gh.getFile(BOARD_STATE_PATH).catch(() => null) : null;
        commits.push(
          (await gh.commitChanges({ message: `${word} ${SKIP_CI}`, edits: noteEdit, adds: noteAdd, deletes: mainBoard ? [{ path: BOARD_STATE_PATH, expectedSha: mainBoard.sha }] : [] })).commitSha,
        );
        if (deletes.length) commits.push((await source.client.commitChanges({ message: `${word}; removed the old copy`, edits: [], adds: [], deletes })).commitSha);
      }
    } catch (error) {
      throw new Error(
        `The plan was copied to ${preview.toPlace}, but RepoBoard could not leave the note in ${preview.fromPlace} (${(error as Error).message}). ` +
          "Nothing was switched: move again to finish — what is copied already stays.",
      );
    }
  }

  setPlanLocation(repository.id, to);
  setPlanBlocked(repository.id, null);
  setPlanAsk(repository.id, null);
  if (to.mode === "main") db.update(repositories).set({ autoSync: false }).where(eq(repositories.id, repository.id)).run();

  if (to.mode !== "main") await syncBoards(undefined, undefined, false);
  await watchDocs({ force: true }).catch(() => null);
  logActivity({
    repositoryId: repository.id,
    type: "sync_settings",
    message: `moved the plan from ${preview.fromPlace} to ${preview.toPlace} (${moving.length} file${moving.length === 1 ? "" : "s"})`,
  });
  return { copied: moving.length, commits, place: preview.toPlace };
}

/* ------------------------------------------------------------------ status -- */

export interface PlanStatus {
  location: PlanLocation;
  place: string;
  codeRepo: string;
  codeVisibility: "public" | "private";
  defaultBranch: string;
  /** The plan's repository this key cannot open (yet). */
  blocked: string | null;
  /** Another computer moved the plan somewhere RepoBoard asks about before following. */
  asked: PlanLocation | null;
  /** What a repository of its own would be called. */
  suggestedRepo: string;
  /** Show the one-time "keep the plan elsewhere?" offer. */
  offer: boolean;
  host: "github" | "gitlab";
  /** How the project is opened: signed in with GitHub, or a key. */
  via: "github" | "key";
  links: {
    /** github.com's new-repository page, filled in; null on GitLab (RepoBoard makes it there). */
    create: string | null;
    /** Where the sign-in or key gets the new repository added. */
    access: string | null;
    /** Where people are given access to the plan's repository. */
    people: string | null;
  };
}

export function planStatus(args: { via: "github" | "key"; host: { kind: "github" } | { kind: "gitlab"; url: string }; installUrl: string | null }): PlanStatus | null {
  const repository = activeRepository();
  if (!repository) return null;
  const location = planLocationFor(repository.id);
  const row = db.select({ seen: repositories.planOfferSeen }).from(repositories).where(eq(repositories.id, repository.id)).get();
  const suggested = `${repository.owner}/${repository.name}-plan`;
  const plan = location.mode === "repo" ? location.repo : null;
  const gitlab = args.host.kind === "gitlab" ? args.host.url.replace(/\/+$/, "") : null;
  const create = gitlab
    ? null
    : `https://github.com/new?${new URLSearchParams({
        owner: repository.owner,
        name: `${repository.name}-plan`,
        visibility: "private",
        description: `RepoBoard plan for ${repository.owner}/${repository.name}: boards, checklists, notes`,
      })}`;
  const access = gitlab ? null : args.via === "github" ? args.installUrl : "https://github.com/settings/personal-access-tokens";
  const people = plan
    ? gitlab
      ? `${gitlab}/${plan}/-/project_members`
      : `https://github.com/${plan}/settings/access`
    : gitlab
      ? `${gitlab}/${repository.owner}/${repository.name}/-/project_members`
      : `https://github.com/${repository.owner}/${repository.name}/settings/access`;
  return {
    location,
    place: describePlace(location),
    codeRepo: `${repository.owner}/${repository.name}`,
    codeVisibility: repository.visibility,
    defaultBranch: repository.defaultBranch,
    blocked: planBlockedFor(repository.id),
    asked: planAsk(repository.id),
    suggestedRepo: suggested,
    offer: location.mode === "main" && !row?.seen,
    host: gitlab ? "gitlab" : "github",
    via: args.via,
    links: { create, access, people },
  };
}

export function closePlanOffer(): void {
  const repository = activeRepository();
  if (!repository) return;
  db.update(repositories).set({ planOfferSeen: new Date() }).where(eq(repositories.id, repository.id)).run();
}

/* ------------------------------------------------------------------ people -- */

export interface PlanPeople {
  /** Who can work on the code (GitHub's assignees: owner and collaborators; GitLab's members). */
  code: { login: string; avatarUrl: string }[];
  /** Who can open the plan's own repository; null when the plan is kept with the code. */
  plan: { login: string; avatarUrl: string }[] | null;
  /** In the code but not in the plan: they would see the code and an empty board. */
  missing: string[];
}

export async function planPeople(): Promise<PlanPeople> {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const location = planLocationFor(repository.id);
  const codePeople = await (await code()).listPeople();
  const planList =
    location.mode === "repo" && location.repo ? await (await GitHubClient.createFor(location.repo)).listPeople().catch(() => []) : null;
  const inPlan = new Set((planList ?? []).map((p) => p.login.toLowerCase()));
  return {
    code: codePeople,
    plan: planList,
    missing: planList ? codePeople.filter((p) => !inPlan.has(p.login.toLowerCase())).map((p) => p.login) : [],
  };
}
