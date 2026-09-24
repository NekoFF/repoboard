import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { databasePath } from "@/lib/paths";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";

const dbPath = databasePath();

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

/**
 * Migrations run on boot so a fresh clone works with `npm install && npm run
 * dev`. Drizzle records what it has applied, so this is a no-op on every
 * start after the first.
 */
const migrationsFolder = path.join(process.cwd(), "drizzle");
if (fs.existsSync(migrationsFolder)) {
  try {
    migrate(db, { migrationsFolder });
  } catch (error) {
    console.error(
      `[repoboard] Could not apply database migrations to ${dbPath}:`,
      (error as Error).message,
    );
  }
}
