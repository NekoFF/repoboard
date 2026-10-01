import { GitHubClient, type RepoClient } from "@/lib/github/client";
import { BOARD_STATE_PATH } from "@/lib/board-state";
import { activeRepository, boardFileFor, logActivity, syncBoards } from "@/lib/board-service";
import { documentsBranch, watchDocs } from "@/lib/docs-service";
import { db } from "@/lib/db/client";
import { repositories } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  describePlace,
  isPlanPath,
  LOCATION_FILE,
  locationNote,
  onBranch,
  parseLocationNote,
  PLAN_BRANCH,
  planBlocked as planBlockedFor,
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

const BINARY = /\.(png|jpe?g|webp|gif|pdf)$/i;

export interface PlanMoveFile {
  path: string;
  /** new: not there yet; replace: there, different; same: already there as it is. */
  status: "new" | "replace" | "same";
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
}

async function code(): Promise<RepoClient> {
  return GitHubClient.create();
}

/** The plan's place as a client, and whether it exists yet. */
async function open(location: PlanLocation, gh: RepoClient): Promise<Opened> {
  if (location.mode === "repo" && location.repo) {
    const client = await GitHubClient.createFor(location.repo);
    const exists = await client.getRepo().then(
      () => true,
      () => false,
    );
    return { client, exists };
  }
  if (location.mode === "branch") {
    const exists = await gh.headCommit(PLAN_BRANCH).then(
      () => true,
      () => false,
    );
    return { client: onBranch(gh, PLAN_BRANCH), exists };
  }
  return { client: onBranch(gh, documentsBranch()), exists: true };
}

/** Plan files in a place, without RepoBoard's own two (board.json travels merged; the note is per place). */
async function planFiles(place: Opened): Promise<string[]> {
  if (!place.exists) return [];
  const all = await place.client.listFiles().catch(() => [] as string[]);
  return all.filter((p) => isPlanPath(p) && p !== BOARD_STATE_PATH && p !== LOCATION_FILE);
}

const shaOf = (place: Opened, path: string) =>
  place.exists
    ? place.client.getFileBytes(path).then(
        (f) => f.sha,
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
  const files: PlanMoveFile[] = await Promise.all(
    sourceFiles.map(async (path) => {
      if (!target.exists || to.mode === from.mode) return { path, status: "new" as const };
      const [a, b] = await Promise.all([shaOf(source, path), shaOf(target, path)]);
      return { path, status: b === null ? ("new" as const) : a === b ? ("same" as const) : ("replace" as const) };
    }),
  );
  return {
    from,
    to,
    fromPlace: describePlace(from),
    toPlace: describePlace(to),
    files,
    oldFiles: sourceFiles,
    problem,
    toVisibility,
    existing,
    codeVisibility: repository.visibility,
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
  if (to.mode !== "main") await syncBoards();
  await watchDocs({ force: true }).catch(() => null);
  logActivity({ repositoryId: repository.id, type: "sync_settings", message: `opened the plan kept in ${preview.toPlace}` });
  return { place: preview.toPlace };
}

/**
 * Moves the plan. `leaveNote`: a location.json in the old place saying where
 * it went (other computers follow it); `removeOld`: the old .repoboard/ files
 * are removed there in the same commit as the note.
 */
export async function movePlan(
  to: PlanLocation,
  options: { leaveNote: boolean; removeOld: boolean },
): Promise<{ copied: number; commits: string[]; place: string }> {
  const repository = activeRepository();
  if (!repository) throw new Error("Connect a repository first");
  const preview = await previewPlanMove(to);
  if (preview.problem) throw new Error(preview.problem.message);
  const from = preview.from;
  const gh = await code();
  const source = await open(from, gh);
  const target = await open(to, gh);
  const slug = `${repository.owner}/${repository.name}`;
  const commits: string[] = [];

  // What goes: each file's bytes from the old place.
  const moving = preview.files.filter((f) => f.status !== "same");
  const bytes = new Map<string, string>();
  for (const f of moving) bytes.set(f.path, (await source.client.getFileBytes(f.path)).bytes.toString("base64"));
  const note = Buffer.from(locationNote({ for: slug, mode: to.mode }), "utf8").toString("base64");
  const message = `RepoBoard: move the plan here from ${preview.fromPlace} (${moving.length} file${moving.length === 1 ? "" : "s"}) ${SKIP_CI}`;

  if (to.mode === "branch" && !target.exists) {
    // A branch of its own, with nothing of the code in it.
    const files = [...moving.map((f) => ({ path: f.path, base64: bytes.get(f.path)! })), { path: LOCATION_FILE, base64: note }];
    await gh.createOrphanBranch(PLAN_BRANCH, files, message);
  } else {
    const edits: { path: string; content: string; expectedSha: string }[] = [];
    const adds: { path: string; base64: string }[] = [];
    for (const f of moving) {
      if (f.status === "replace") {
        const current = await target.client.getFile(f.path);
        edits.push({ path: f.path, content: Buffer.from(bytes.get(f.path)!, "base64").toString("utf8"), expectedSha: current.sha });
      } else {
        adds.push({ path: f.path, base64: bytes.get(f.path)! });
      }
    }
    // The note in the new place: whose plan it is.
    const existingNote = await target.client.getFile(LOCATION_FILE).catch(() => null);
    if (to.mode !== "main") {
      if (existingNote) edits.push({ path: LOCATION_FILE, content: Buffer.from(note, "base64").toString("utf8"), expectedSha: existingNote.sha });
      else adds.push({ path: LOCATION_FILE, base64: note });
    } else if (existingNote) {
      // Back in main: a "moved away" note left there earlier would send other computers off again.
      edits.push({ path: LOCATION_FILE, content: Buffer.from(note, "base64").toString("utf8"), expectedSha: existingNote.sha });
    }
    if (to.mode === "main") {
      // The boards go with them, into main's board.json.
      const board = await boardFileFor(target.client);
      if (board.sha) edits.push({ path: BOARD_STATE_PATH, content: board.content, expectedSha: board.sha });
      else adds.push({ path: BOARD_STATE_PATH, base64: Buffer.from(board.content, "utf8").toString("base64") });
    }
    // A screenshot already there under the same name keeps its bytes (a document that names it still finds one).
    const textEdits = edits.filter((e) => !BINARY.test(e.path));
    if (textEdits.length + adds.length) {
      commits.push((await target.client.commitChanges({ message, edits: textEdits, adds })).commitSha);
    }
  }

  setPlanLocation(repository.id, to);
  setPlanBlocked(repository.id, null);
  if (to.mode === "main") db.update(repositories).set({ autoSync: false }).where(eq(repositories.id, repository.id)).run();

  // The old place: a note saying where the plan went, and its old copy removed if wanted.
  // Removing it without a note would leave other computers with an empty plan and no way on.
  if (options.removeOld) options = { ...options, leaveNote: true };
  if (options.leaveNote) {
    const movedNote = locationNote({ for: slug, mode: from.mode, movedTo: { mode: to.mode, repo: to.repo } });
    const current = await source.client.getFile(LOCATION_FILE).catch(() => null);
    const edits = options.leaveNote && current ? [{ path: LOCATION_FILE, content: movedNote, expectedSha: current.sha }] : [];
    const adds = options.leaveNote && !current ? [{ path: LOCATION_FILE, base64: Buffer.from(movedNote, "utf8").toString("base64") }] : [];
    const deletes = options.removeOld ? [...preview.oldFiles] : [];
    if (options.removeOld && (await source.client.getFile(BOARD_STATE_PATH).catch(() => null))) deletes.push(BOARD_STATE_PATH);
    if (edits.length + adds.length + deletes.length) {
      commits.push(
        (
          await source.client.commitChanges({
            message: `RepoBoard: the plan moved to ${preview.toPlace}${options.removeOld ? "; removed the old copy" : ""} ${SKIP_CI}`,
            edits,
            adds,
            deletes,
          })
        ).commitSha,
      );
    }
  }

  if (to.mode !== "main") await syncBoards();
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
