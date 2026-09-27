/**
 * Windows: the agents' MCP server runs from a copy outside the install folder.
 *
 * The installer closes every process started from the install folder before
 * it writes the new version, and an agent's MCP server is such a process
 * (RepoBoard.exe in Node mode). Stdio servers are not reconnected by their
 * clients, so every update would cut agents off. From a copy in
 * %LOCALAPPDATA%\NekoFF\RepoBoard\mcp the server keeps running through an update,
 * and loads the new tools itself when the app, started again, refreshes the
 * copy (scripts/mcp-server.mjs looks at mcp-core.mjs before every request).
 *
 * The copy: the app's runtime (its executable and what it loads — the
 * top-level files of the install folder), the two MCP files, and
 * better-sqlite3 with what it needs. A file that is the same (size and time)
 * is left alone. A file in use by a running server cannot be overwritten on
 * Windows but can be renamed: it is moved aside, the new one written, and
 * the old one removed on a later start once nothing uses it.
 *
 * No Electron in here, so it can be run and tested on its own.
 */
const fs = require("node:fs");
const path = require("node:path");

const IN_USE = new Set(["EBUSY", "EPERM", "EACCES"]);
const ASIDE = /\.old-\d+$/;

/** The modules the MCP core loads, from the bundled server's node_modules. */
const MODULES = {
  "better-sqlite3": ["package.json", "lib", path.join("build", "Release", "better_sqlite3.node")],
  bindings: ["package.json", "bindings.js"],
  "file-uri-to-path": ["package.json", "index.js"],
};

async function same(a, b) {
  try {
    const [x, y] = await Promise.all([fs.promises.stat(a), fs.promises.stat(b)]);
    // Times set on a copy come back a hair off (…708 as …707.999): within 2 ms is the same.
    return x.size === y.size && Math.abs(x.mtimeMs - y.mtimeMs) < 2;
  } catch {
    return false;
  }
}

async function place(from, to) {
  if (await same(from, to)) return false;
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  // Written next to it first, so a server that reads it never sees half a file.
  const temp = `${to}.new-${process.pid}`;
  await fs.promises.copyFile(from, temp);
  const { atime, mtime } = await fs.promises.stat(from);
  await fs.promises.utimes(temp, atime, mtime);
  try {
    await fs.promises.rename(temp, to);
  } catch (error) {
    if (!IN_USE.has(error.code)) throw error;
    // In use by a running server: move it aside, then put the new one in its place.
    await fs.promises.rename(to, `${to}.old-${Date.now()}`);
    await fs.promises.rename(temp, to);
  }
  return true;
}

async function placeTree(from, to) {
  const stat = await fs.promises.stat(from);
  if (!stat.isDirectory()) return (await place(from, to)) ? 1 : 0;
  let changed = 0;
  for (const entry of await fs.promises.readdir(from)) changed += await placeTree(path.join(from, entry), path.join(to, entry));
  return changed;
}

/** Files moved aside by an earlier refresh: gone once no server uses them. */
async function sweep(dir) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sweep(full);
    else if (ASIDE.test(entry.name) || /\.new-\d+$/.test(entry.name)) await fs.promises.rm(full, { force: true }).catch(() => {});
  }
}

/**
 * Brings the copy up to date. `installDir` holds the running executable,
 * `serverDir` the bundled server (with mcp/ and node_modules/), `home` is
 * where the copy lives. Returns the command agents should run.
 */
async function prepareMcpHome({ installDir, exeName, serverDir, home }) {
  await sweep(home);
  let changed = 0;
  for (const entry of await fs.promises.readdir(installDir, { withFileTypes: true })) {
    // The runtime: the executable and the files it loads beside it. Not the uninstaller.
    if (!entry.isFile() || /^uninstall/i.test(entry.name)) continue;
    if (await place(path.join(installDir, entry.name), path.join(home, entry.name))) changed += 1;
  }
  for (const [name, parts] of Object.entries(MODULES)) {
    for (const part of parts) {
      const from = path.join(serverDir, "node_modules", name, part);
      if (fs.existsSync(from)) changed += await placeTree(from, path.join(home, "server", "node_modules", name, part));
    }
  }
  // The tools last: a running server that sees them change finds the rest in place.
  for (const file of ["mcp-core.mjs", "mcp-server.mjs"]) {
    if (await place(path.join(serverDir, "mcp", file), path.join(home, "server", "mcp", file))) changed += 1;
  }
  const command = { node: path.join(home, exeName), server: path.join(home, "server", "mcp", "mcp-server.mjs") };
  await fs.promises.writeFile(path.join(home, "ready.json"), JSON.stringify({ ...command, at: Date.now() }));
  return { ...command, changed };
}

module.exports = { prepareMcpHome };
