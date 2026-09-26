#!/usr/bin/env node
/**
 * Assembles the server the desktop app runs, in desktop/app/server:
 *
 *   1. `next build` with output: "standalone" into .next-desktop
 *   2. the standalone server, its static files, public/, drizzle/ migrations
 *   3. better-sqlite3 built for Electron's Node (not the system's), for the
 *      target platform and architecture — a prebuilt binary when there is one,
 *      otherwise compiled from source
 *
 *   node desktop/prepare.mjs [--arch arm64|x64] [--platform darwin|win32|linux]
 *
 * The project's own node_modules are never touched, so `npm run dev` keeps
 * working with the system's Node afterwards.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const arch = arg("arch", process.arch);
const platform = arg("platform", process.platform);
const distDir = ".next-desktop";
const out = path.join(here, "app", "server");
const require = createRequire(path.join(here, "package.json"));
const electronVersion = require("electron/package.json").version;

const run = (cmd, args, opts = {}) => {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
};

console.log(`RepoBoard desktop: server for Electron ${electronVersion}, ${platform}-${arch}`);

// 1. The build.
run("npx", ["next", "build"], {
  cwd: root,
  env: { ...process.env, NEXT_OUTPUT: "standalone", NEXT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: "1" },
});

// 2. The server folder.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const standalone = path.join(root, distDir, "standalone");
fs.cpSync(standalone, out, { recursive: true, verbatimSymlinks: false, dereference: true });
fs.cpSync(path.join(root, distDir, "static"), path.join(out, distDir, "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
fs.cpSync(path.join(root, "drizzle"), path.join(out, "drizzle"), { recursive: true });
// Nothing from the developer's machine rides along.
for (const leftover of [".env", ".env.local", "repoboard.db", ".repoboard"]) {
  fs.rmSync(path.join(out, leftover), { recursive: true, force: true });
}

// 3. The database engine, for Electron. The standalone copy has only the
// files the server loads; the full package is needed to fetch or build.
const sqliteSrc = path.join(root, "node_modules", "better-sqlite3");
const sqliteDst = path.join(out, "node_modules", "better-sqlite3");
fs.rmSync(sqliteDst, { recursive: true, force: true });
fs.cpSync(sqliteSrc, sqliteDst, { recursive: true });
// The binary in the project is for the system's Node; it must not ship.
fs.rmSync(path.join(sqliteDst, "build"), { recursive: true, force: true });
for (const dep of ["bindings", "file-uri-to-path"]) {
  const src = path.join(root, "node_modules", dep);
  const dst = path.join(out, "node_modules", dep);
  if (fs.existsSync(src) && !fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true });
}

const prebuild = path.join(root, "node_modules", "prebuild-install", "bin.js");
let fetched = false;
if (fs.existsSync(prebuild)) {
  try {
    run(process.execPath, [prebuild, "--runtime", "electron", "--target", electronVersion, "--arch", arch, "--platform", platform], {
      cwd: sqliteDst,
    });
    fetched = fs.existsSync(path.join(sqliteDst, "build", "Release", "better_sqlite3.node"));
  } catch {
    fetched = false;
  }
}
if (!fetched) {
  if (platform !== process.platform) {
    throw new Error(`No prebuilt better-sqlite3 for Electron ${electronVersion} ${platform}-${arch}, and it cannot be compiled for another platform here.`);
  }
  console.log("No prebuilt binary; compiling better-sqlite3 for Electron from source.");
  run("npx", ["--yes", "@electron/rebuild", "--version", electronVersion, "--arch", arch, "--module-dir", out, "--which-module", "better-sqlite3", "--force"], {
    cwd: here,
  });
}

const binary = path.join(sqliteDst, "build", "Release", "better_sqlite3.node");
if (!fs.existsSync(binary)) throw new Error("better-sqlite3 was not built for Electron");
// Sources are only needed to build; the app ships the binary.
for (const dir of ["deps", "src"]) fs.rmSync(path.join(sqliteDst, dir), { recursive: true, force: true });
console.log(`Server ready in ${path.relative(root, out)} (${platform}-${arch}).`);
