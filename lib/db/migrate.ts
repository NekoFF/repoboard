import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { databasePath } from "@/lib/paths";

// The same file the app opens — creating ./repoboard.db here would make the
// app prefer an empty "legacy" database over the real one in ~/.repoboard.
const dbPath = databasePath();

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle" });
sqlite.close();

console.log(`Migrations applied to ${dbPath}`);
