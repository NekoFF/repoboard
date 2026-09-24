import fs from "node:fs";
import path from "node:path";

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

export interface StoredCredentials {
  token: string;
  repo: string; // owner/name
  savedAt: string;
}

const CREDENTIALS_DIR = path.join(process.cwd(), ".repoboard");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "credentials.json");

/**
 * Token lives either in the environment (.env.local, gitignored) or in
 * .repoboard/credentials.json written at 0600 by the connect screen.
 * It is never written to source files and never returned to the browser.
 */
export function readStoredCredentials(): StoredCredentials | null {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const raw = fs.readFileSync(CREDENTIALS_FILE, "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export function writeStoredCredentials(creds: StoredCredentials): void {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
  fs.chmodSync(CREDENTIALS_FILE, 0o600);
}

export function clearStoredCredentials(): void {
  if (fs.existsSync(CREDENTIALS_FILE)) fs.rmSync(CREDENTIALS_FILE);
}

export class PatAuthProvider implements AuthProvider {
  kind = "pat" as const;
  label = "Fine-grained personal access token";

  async getToken(): Promise<string | null> {
    if (process.env.GITHUB_PAT) return process.env.GITHUB_PAT;
    return readStoredCredentials()?.token ?? null;
  }
}

export function getAuthProvider(): AuthProvider {
  return new PatAuthProvider();
}

export function getConfiguredRepo(): { owner: string; name: string } | null {
  const slug = process.env.GITHUB_REPO ?? readStoredCredentials()?.repo;
  if (!slug) return null;
  const [owner, name] = slug.split("/");
  if (!owner || !name) return null;
  return { owner, name };
}
