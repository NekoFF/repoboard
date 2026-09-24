import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where RepoBoard keeps the things you would hate to lose: the board database
 * and the GitHub token.
 *
 * By default these live in ~/.repoboard, deliberately *outside* the project
 * folder. People update this app by downloading a new ZIP and replacing the
 * folder, and anything stored next to the source would be deleted by that.
 *
 * Installs made before this change kept both inside the project directory, so
 * an existing ./repoboard.db or ./.repoboard still wins — upgrading must never
 * silently orphan someone's board.
 */

const HOME_DATA_DIR = path.join(os.homedir(), ".repoboard");
const LEGACY_DATA_DIR = path.join(process.cwd(), ".repoboard");
const LEGACY_DB = path.join(process.cwd(), "repoboard.db");

export function dataDir(): string {
  if (fs.existsSync(LEGACY_DATA_DIR)) return LEGACY_DATA_DIR;
  return HOME_DATA_DIR;
}

export function databasePath(): string {
  // An explicit DATABASE_URL always wins, so tests and power users can point
  // anywhere they like.
  const configured = process.env.DATABASE_URL;
  if (configured) return configured.replace(/^file:/, "");

  if (fs.existsSync(LEGACY_DB)) return LEGACY_DB;

  fs.mkdirSync(HOME_DATA_DIR, { recursive: true, mode: 0o700 });
  return path.join(HOME_DATA_DIR, "repoboard.db");
}

export function credentialsPath(): string {
  return path.join(dataDir(), "credentials.json");
}
