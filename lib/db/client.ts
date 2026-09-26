import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { databasePath } from "@/lib/paths";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";

const dbPath = databasePath();

function openDatabase(file: string): Database.Database {
  try {
    return new Database(file);
  } catch (error) {
    const message = (error as Error).message;
    // The native binary is missing or built for a different Node version. The
    // raw error is a wall of paths, so translate it into an instruction.
    if (
      /bindings file|NODE_MODULE_VERSION|was compiled against|MODULE_NOT_FOUND/i.test(
        message,
      )
    ) {
      throw new Error(
        [
          "RepoBoard could not load its database engine.",
          `You are running Node ${process.version}.`,
          "",
          "Fix it with:   npm run doctor",
          "which will tell you exactly what to do (usually: delete the",
          "node_modules folder, then run npm install).",
          "",
          `Original error: ${message.split("\n")[0]}`,
        ].join("\n"),
      );
    }
    throw error;
  }
}

const sqlite = openDatabase(dbPath);
// The app, the MCP server and a build's workers may open the file at once:
// wait for a lock instead of failing on it.
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/**
 * Migrations run on boot so a fresh clone works with `npm install && npm run
 * dev`. Drizzle records what it has applied, so this is a no-op on every
 * start after the first.
 */
const migrationsFolder = path.join(process.cwd(), "drizzle");
// `next build` loads this in several workers to collect page data; the
// database is migrated when the app starts, not while it is being built.
const building = process.env.NEXT_PHASE === "phase-production-build";
if (!building && fs.existsSync(migrationsFolder)) {
  try {
    migrate(db, { migrationsFolder });
  } catch (error) {
    // A half-migrated database breaks in confusing ways later; say so now.
    throw new Error(
      `RepoBoard could not update its database (${dbPath}): ${(error as Error).message}. Run npm run doctor.`,
    );
  }
}
