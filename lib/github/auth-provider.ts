import fs from "node:fs";
import { credentialsPath, dataDir } from "@/lib/paths";

/**
 * Auth abstraction. The MVP ships a fine-grained PAT provider, but every
 * consumer depends on this interface only — swapping in GitHub OAuth or a
 * GitHub App later means adding a class here, not touching callers.
 */
export interface AuthProvider {
  kind: "pat" | "oauth" | "github-app";
  label: string;
  getToken(): Promise<string | null>;
}

/**
 * One connected repository. Fine-grained tokens are usually scoped to a single
 * repository, so every project keeps its own.
 */
export interface StoredProject {
  repo: string; // owner/name
  token: string;
  savedAt: string;
  /** How the token was made: pasted by hand, or from signing in with GitHub. */
  via?: "key" | "github";
}

/** The person signed in with GitHub (the RepoBoard GitHub App), when they did. */
interface StoredAccount {
  login: string;
  token: string;
  savedAt: string;
}

interface CredentialStore {
  version: 2;
  active: string | null;
  projects: StoredProject[];
  account?: StoredAccount | null;
}

/** The public shape of a project: never includes the token. */
export interface ProjectRef {
  repo: string;
  savedAt: string;
  active: boolean;
  via?: "key" | "github";
}

const CREDENTIALS_DIR = dataDir();
const CREDENTIALS_FILE = credentialsPath();

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Tokens live either in the environment (.env.local, gitignored) or in
 * ~/.repoboard/credentials.json written at 0600 by the connect screen.
 * They are never written to source files and never returned to the browser.
 *
 * The file used to hold a single `{ token, repo }`; that shape is read as a
 * store with one project, and rewritten in the new shape on the next save.
 */
function readStore(): CredentialStore {
  const empty: CredentialStore = { version: 2, active: null, projects: [] };
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return empty;
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
    if (raw?.version === 2 && Array.isArray(raw.projects)) {
      const account = raw.account;
      return {
        version: 2,
        active: typeof raw.active === "string" ? raw.active : null,
        projects: raw.projects.filter(
          (p: StoredProject) => typeof p?.repo === "string" && typeof p?.token === "string",
        ),
        account:
          account && typeof account.login === "string" && typeof account.token === "string" ? account : null,
      };
    }
    if (typeof raw?.token === "string" && typeof raw?.repo === "string") {
      return {
        version: 2,
        active: raw.repo,
        projects: [{ repo: raw.repo, token: raw.token, savedAt: raw.savedAt ?? new Date().toISOString() }],
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

function writeStore(store: CredentialStore): void {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  // Written aside and renamed into place: a crash mid-write must not leave a
  // broken file that reads as "no projects" and loses every other token.
  const temporary = `${CREDENTIALS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, CREDENTIALS_FILE);
}

function activeProject(store = readStore()): StoredProject | null {
  if (!store.active) return null;
  return store.projects.find((p) => same(p.repo, store.active!)) ?? null;
}

/** True when the environment pins the repository, so switching is not possible. */
export function isEnvironmentConfigured(): boolean {
  return Boolean(process.env.GITHUB_PAT || process.env.GITHUB_REPO);
}

/** Adds (or re-keys) a project and makes it the active one. */
export function saveProject(repo: string, token: string, via: "key" | "github" = "key"): void {
  const store = readStore();
  const others = store.projects.filter((p) => !same(p.repo, repo));
  writeStore({
    ...store,
    version: 2,
    active: repo,
    projects: [...others, { repo, token, savedAt: new Date().toISOString(), via }],
  });
}

/** Signing in with GitHub: the person and their token, kept like the keys (never sent to a page). */
export function saveAccount(login: string, token: string): void {
  const store = readStore();
  // Projects opened through the account use its token; a new sign-in renews them.
  const projects = store.projects.map((p) => (p.via === "github" ? { ...p, token } : p));
  writeStore({ ...store, projects, account: { login, token, savedAt: new Date().toISOString() } });
}

export function accountToken(): string | null {
  return readStore().account?.token ?? null;
}

export function accountLogin(): string | null {
  return readStore().account?.login ?? null;
}

/** Forgets the sign-in. Projects added with it keep working until removed. */
export function signOut(): void {
  const store = readStore();
  writeStore({ ...store, account: null });
}

export function setActiveProject(repo: string): boolean {
  const store = readStore();
  const found = store.projects.find((p) => same(p.repo, repo));
  if (!found) return false;
  writeStore({ ...store, active: found.repo });
  return true;
}

/** A project's own token, for checking it; never sent to a page. */
export function tokenFor(repo: string): string | null {
  return readStore().projects.find((p) => same(p.repo, repo))?.token ?? null;
}

/**
 * Forgets a project's token. The board itself stays in the database. When it
 * was the open project, `next` (a project known to work) is opened instead,
 * else the first one left.
 */
export function removeProject(repo: string, next?: string | null): void {
  const store = readStore();
  const projects = store.projects.filter((p) => !same(p.repo, repo));
  const fallback = projects.find((p) => next && same(p.repo, next))?.repo ?? projects[0]?.repo ?? null;
  const active = store.active && same(store.active, repo) ? fallback : store.active;
  if (projects.length === 0 && !store.account) {
    if (fs.existsSync(CREDENTIALS_FILE)) fs.rmSync(CREDENTIALS_FILE);
    return;
  }
  writeStore({ ...store, version: 2, active, projects });
}

export function listProjects(): ProjectRef[] {
  if (process.env.GITHUB_REPO) {
    return [{ repo: process.env.GITHUB_REPO, savedAt: "", active: true }];
  }
  const store = readStore();
  return store.projects.map((p) => ({
    repo: p.repo,
    savedAt: p.savedAt,
    active: Boolean(store.active && same(store.active, p.repo)),
    via: p.via ?? "key",
  }));
}

export class PatAuthProvider implements AuthProvider {
  kind = "pat" as const;
  label = "Fine-grained personal access token";

  async getToken(): Promise<string | null> {
    if (process.env.GITHUB_PAT) return process.env.GITHUB_PAT;
    return activeProject()?.token ?? null;
  }
}

export function getAuthProvider(): AuthProvider {
  return new PatAuthProvider();
}

export function getConfiguredRepo(): { owner: string; name: string } | null {
  // `||`, not `??`: an empty GITHUB_REPO= line in .env.local means "not set".
  const slug = process.env.GITHUB_REPO || activeProject()?.repo;
  if (!slug) return null;
  const [owner, name] = slug.split("/");
  if (!owner || !name) return null;
  return { owner, name };
}
