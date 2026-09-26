/**
 * New versions, from the project's GitHub Releases. The app looks once after
 * starting and every few hours; when a newer release has a build for this
 * system, the page shows a quiet "update" pill (window.repoboardDesktop).
 *
 * Windows: the installer is downloaded and run silently, and the app starts
 * again on the new version. macOS: without an Apple signature the system does
 * not let an app replace itself, so the new .dmg is downloaded and opened —
 * drag RepoBoard to Applications as the first time.
 *
 * Only files from this repository's releases are ever fetched.
 */
const { app, dialog, net, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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

/** The release file for this system and processor. */
function assetFor(release) {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const suffix = process.platform === "darwin" ? `-mac-${arch}.dmg` : process.platform === "win32" ? "-win-x64.exe" : null;
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
  const dir = path.join(app.getPath("temp"), "RepoBoard update");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, asset.name);
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
    file = target;
    state = { ...state, state: "ready", progress: 1 };
    send(win);
  } catch (error) {
    state = { ...state, state: "failed", error: String(error?.message ?? error) };
    send(win);
  }
}

async function install() {
  if (state.state !== "ready" || !file) return;
  if (process.platform === "win32") {
    // The installer replaces the app in place and starts it again.
    spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    app.isQuitting = true;
    app.quit();
    return;
  }
  // macOS: open the disk image; the person drags RepoBoard to Applications.
  await shell.openPath(file);
}

function listen(ipcMain, getWin) {
  ipcMain.handle("repoboard:update-state", () => state);
  ipcMain.handle("repoboard:update-download", () => download(getWin()));
  ipcMain.handle("repoboard:update-install", () => install());
}

module.exports = { check, listen };
