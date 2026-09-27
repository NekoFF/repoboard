/**
 * New versions, from the project's GitHub Releases. The app looks once after
 * starting and every few hours; when a newer release has a build for this
 * system, the page shows a quiet "update" pill (window.repoboardDesktop).
 *
 * Windows: the installer is downloaded and run silently; it replaces the app
 * where it is installed and starts it again.
 *
 * macOS, when RepoBoard sits in a folder it may write to (Applications, as
 * dragged there): the new version's .zip is downloaded and unpacked, and
 * once RepoBoard has quit a small script puts the new app where the old one
 * was — the old one goes, nothing is left beside it — and opens it. Anywhere
 * else (run straight from the disk image, or moved by macOS to a read-only
 * place because it was never dragged) the new .dmg opens instead.
 *
 * There is only ever one RepoBoard: every version replaces the one before.
 * Downloads live in one temporary folder, emptied when the app starts.
 * Boards and keys are in ~/.repoboard and never touched.
 *
 * Only files from this repository's releases are ever fetched.
 */
const { app, dialog, net, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const DIR = () => path.join(app.getPath("temp"), "RepoBoard update");

/** The .app bundle this process runs from (…/RepoBoard.app/Contents/MacOS/RepoBoard). */
function bundlePath() {
  return path.resolve(path.dirname(app.getPath("exe")), "..", "..");
}

/**
 * Whether this Mac copy can replace itself: a real .app, not on a disk
 * image (/Volumes) nor moved by macOS to a random read-only place
 * (AppTranslocation), in a folder this user may write to.
 */
function canReplaceItself() {
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  const bundle = bundlePath();
  if (!bundle.endsWith(".app") || bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) return false;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Leftovers of an earlier update: gone once the app runs again. */
function cleanUp() {
  try {
    fs.rmSync(DIR(), { recursive: true, force: true });
  } catch {
    // An installer still finishing may hold its file; next start tries again.
  }
}

const REPO = "NekoFF/repoboard";
const DOWNLOADS = `https://github.com/${REPO}/releases/download/`;

let state = { state: "idle" };
let file = null;

function send(win) {
  win?.webContents.send("repoboard:update", state);
}

function newer(a, b) {
  const parse = (v) => String(v).replace(/^v/, "").split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** The release file for this system and processor: the .zip when a Mac copy can replace itself. */
function assetFor(release) {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const suffix =
    process.platform === "darwin"
      ? `-mac-${arch}.${canReplaceItself() ? "zip" : "dmg"}`
      : process.platform === "win32"
        ? "-win-x64.exe"
        : null;
  if (!suffix) return null;
  const asset = (release.assets ?? []).find((a) => typeof a.name === "string" && a.name.endsWith(suffix));
  if (!asset || !String(asset.browser_download_url).startsWith(DOWNLOADS)) return null;
  return { name: asset.name, url: asset.browser_download_url, size: asset.size ?? 0 };
}

async function check(win, { manual = false } = {}) {
  if (!app.isPackaged && !process.env.REPOBOARD_UPDATES) return;
  if (state.state === "downloading" || state.state === "ready") return;
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "RepoBoard" },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = await res.json();
    const asset = assetFor(release);
    if (asset && newer(release.tag_name, app.getVersion())) {
      state = {
        state: "available",
        version: String(release.tag_name).replace(/^v/, ""),
        notes: release.html_url,
        asset,
        // The pill says "Restart to update" when the app replaces itself.
        inPlace: process.platform === "win32" || asset.name.endsWith(".zip"),
      };
      send(win);
      return;
    }
    if (manual) {
      await dialog.showMessageBox({ type: "info", message: "RepoBoard is up to date", detail: `You have version ${app.getVersion()}.` });
    }
  } catch (error) {
    if (manual) {
      await dialog.showMessageBox({ type: "warning", message: "Could not check for updates", detail: String(error?.message ?? error) });
    }
  }
}

async function download(win) {
  if (state.state !== "available" && state.state !== "failed") return;
  const { asset } = state;
  const dir = DIR();
  // One download at a time, in a folder of its own.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(asset.name));
  state = { ...state, state: "downloading", progress: 0 };
  send(win);
  try {
    const res = await net.fetch(asset.url);
    if (!res.ok || !res.body) throw new Error(`The download failed (${res.status})`);
    const total = Number(res.headers.get("content-length")) || asset.size || 0;
    const out = fs.createWriteStream(target);
    const reader = res.body.getReader();
    let got = 0;
    let lastSent = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.write(Buffer.from(value));
      got += value.length;
      if (total && Date.now() - lastSent > 250) {
        state = { ...state, progress: got / total };
        send(win);
        lastSent = Date.now();
      }
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    // Not a signature (the builds are not signed yet), but a download cut
    // short or swapped for something else of another size is refused.
    if (asset.size && fs.statSync(target).size !== asset.size) {
      fs.rmSync(target, { force: true });
      throw new Error("The download did not match the release. Try again.");
    }
    if (target.endsWith(".zip")) {
      // Unpack now, so installing is only a move; check it is RepoBoard, at that version.
      const unpacked = path.join(dir, "unpacked");
      execFileSync("/usr/bin/ditto", ["-x", "-k", target, unpacked]);
      const bundle = path.join(unpacked, "RepoBoard.app");
      const plist = path.join(bundle, "Contents", "Info.plist");
      const read = (key) => execFileSync("/usr/bin/plutil", ["-extract", key, "raw", plist]).toString().trim();
      if (!fs.existsSync(plist) || read("CFBundleIdentifier") !== "com.nekoff.repoboard" || read("CFBundleShortVersionString") !== state.version) {
        throw new Error("The download is not the RepoBoard release it should be. Try again.");
      }
      fs.rmSync(target, { force: true });
      file = bundle;
    } else {
      file = target;
    }
    state = { ...state, state: "ready", progress: 1 };
    send(win);
  } catch (error) {
    state = { ...state, state: "failed", error: String(error?.message ?? error) };
    send(win);
  }
}

async function install() {
  if (state.state !== "ready" || !file) return;
  const replace = state.inPlace;
  // A person decides, in the app's own dialog — not a script in the page.
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: `Install RepoBoard ${state.version}?`,
    detail: replace
      ? "RepoBoard closes, puts the new version in place of this one and opens again. Your boards and keys stay where they are."
      : "The new version opens in a window: drag RepoBoard to Applications, replacing the old one. Your boards and keys stay where they are.",
    buttons: [replace ? "Install and restart" : "Open", "Not now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  if (process.platform === "darwin" && file.endsWith(".app")) {
    // After this process has quit: the new app takes the old one's place, then opens.
    const bundle = bundlePath();
    const script = path.join(DIR(), "install.sh");
    fs.writeFileSync(
      script,
      [
        "#!/bin/sh",
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
        'OLD="$1"; NEW="$2"',
        'rm -rf "$OLD.previous"',
        'if mv "$OLD" "$OLD.previous" && mv "$NEW" "$OLD"; then rm -rf "$OLD.previous"; else rm -rf "$OLD"; mv "$OLD.previous" "$OLD"; fi',
        'open "$OLD"',
      ].join("\n"),
      { mode: 0o700 },
    );
    spawn("/bin/sh", [script, bundle, file], { detached: true, stdio: "ignore" }).unref();
    app.isQuitting = true;
    app.quit();
    return;
  }
  if (process.platform === "win32") {
    // The installer replaces the app in place and starts it again.
    spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    app.isQuitting = true;
    app.quit();
    return;
  }
  // macOS: open the disk image, then quit — a running RepoBoard cannot be
  // replaced, so the old one would keep running and keep offering the update.
  await shell.openPath(file);
  await dialog.showMessageBox({
    type: "info",
    message: "Drag RepoBoard to Applications",
    detail: "In the window that opened, drag RepoBoard onto Applications and choose Replace. RepoBoard closes now so it can be replaced; open it again from Applications afterwards.",
    buttons: ["OK"],
  });
  app.isQuitting = true;
  app.quit();
}

function listen(ipcMain, getWin) {
  cleanUp();
  ipcMain.handle("repoboard:update-check", () => check(getWin(), { manual: true }));
  ipcMain.handle("repoboard:update-state", () => state);
  ipcMain.handle("repoboard:update-download", () => download(getWin()));
  ipcMain.handle("repoboard:update-install", () => install());
}

module.exports = { check, listen };
