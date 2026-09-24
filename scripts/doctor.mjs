#!/usr/bin/env node
/**
 * `npm run doctor` — answers "why will it not start?" without anyone having to
 * read a stack trace. It checks the two things that actually break on a fresh
 * machine: the Node version and whether the native database binary loaded.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const ok = (s) => `  OK    ${s}`;
const bad = (s) => `  FAIL  ${s}`;
const info = (s) => `        ${s}`;

console.log("\nRepoBoard doctor\n");

const problems = [];

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
console.log(`Node ${process.version} (ABI ${process.versions.modules}) on ${process.platform}`);
if (major < 20) {
  console.log(bad(`Node ${major} is too old — RepoBoard needs Node 20 or newer.`));
  problems.push("Install the LTS version of Node from https://nodejs.org");
} else {
  console.log(ok("Node version is supported"));
}

// 2. Dependencies installed at all
const nodeModules = path.join(process.cwd(), "node_modules");
if (!fs.existsSync(nodeModules)) {
  console.log(bad("node_modules is missing — dependencies were never installed."));
  problems.push("Run: npm install");
} else {
  console.log(ok("node_modules exists"));
}

// 3. The native database engine — the usual culprit
let installedVersion = null;
try {
  installedVersion = require("better-sqlite3/package.json").version;
  console.log(info(`better-sqlite3 ${installedVersion} installed`));
} catch {
  console.log(bad("better-sqlite3 is not installed"));
  problems.push("Run: npm install");
}

if (installedVersion) {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.exec("create table t (x)");
    db.close();
    console.log(ok("database engine loads and runs"));
  } catch (error) {
    console.log(bad("the database engine could not load"));
    console.log(info(String(error.message).split("\n")[0]));
    if (installedVersion.startsWith("11.")) {
      problems.push(
        "You have an old copy: better-sqlite3 11 has no ready-made binary for Node 24.\n" +
          "        Download the current version of RepoBoard, delete node_modules, then run: npm install",
      );
    } else {
      problems.push(
        "Run: npm run fix\n" +
          "        (Newer npm blocks packages from running their install scripts, so the\n" +
          "        database binary never got downloaded. This fetches it. No reinstall needed.)\n" +
          "        If that fails, install the LTS version of Node from https://nodejs.org,\n" +
          "        delete node_modules and run npm install.",
      );
    }
  }
}

// 4. Where data will live
const legacy = path.join(process.cwd(), "repoboard.db");
const home = path.join(os.homedir(), ".repoboard", "repoboard.db");
console.log(info(`data location: ${fs.existsSync(legacy) ? legacy : home}`));

console.log("");
if (problems.length === 0) {
  console.log("Everything checks out. Start the app with:  npm run dev\n");
} else {
  console.log("What to do:\n");
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log("");
  process.exitCode = 1;
}
