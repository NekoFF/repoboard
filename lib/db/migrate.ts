import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbPath = (process.env.DATABASE_URL ?? "file:./repoboard.db").replace(
  "file:",
  "",
);

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle" });
sqlite.close();

console.log(`Migrations applied to ${dbPath}`);
