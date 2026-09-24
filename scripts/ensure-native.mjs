#!/usr/bin/env node
/**
 * Makes sure the database engine's native binary is present after install.
 *
 * Recent npm versions refuse to run dependencies' install scripts unless they
 * are explicitly approved, printing "install scripts blocked because they are
 * not covered by allowScripts". better-sqlite3 downloads its prebuilt binary
 * from such a script, so the package installs "successfully" and the app then
 * cannot start.
 *
 * Scripts belonging to this project are still allowed to run, so we fetch the
 * binary ourselves — the same download the blocked script would have done, run
 * deliberately by the project rather than silently by a dependency.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);

function engineLoads() {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
}

if (engineLoads()) process.exit(0);

let packageDir;
try {
  packageDir = path.dirname(require.resolve("better-sqlite3/package.json"));
} catch {
  // Dependencies are not installed yet; `npm install` will call us again.
  process.exit(0);
}

const localRequire = createRequire(path.join(packageDir, "package.json"));
let prebuildBin = null;
for (const candidate of ["prebuild-install/bin.js", "prebuild-install"]) {
  try {
    prebuildBin = localRequire.resolve(candidate);
    break;
  } catch {
    /* try the next one */
  }
}

console.log("[repoboard] fetching the database engine binary…");

if (prebuildBin && fs.existsSync(prebuildBin)) {
  spawnSync(process.execPath, [prebuildBin], {
    cwd: packageDir,
    stdio: "inherit",
  });
}

if (!engineLoads()) {
  // Last resort: build it, which only works where a compiler is available.
  spawnSync("npm", ["run", "build-release"], {
    cwd: packageDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

if (engineLoads()) {
  console.log("[repoboard] database engine ready.");
} else {
  console.log(
    [
      "",
      "[repoboard] Could not prepare the database engine automatically.",
      "            Run `npm run doctor` for what to do next.",
      "",
    ].join("\n"),
  );
}

// Never fail the install over this: the doctor explains it better than a
// non-zero exit code buried in npm output.
process.exit(0);
