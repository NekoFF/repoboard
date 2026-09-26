/**
 * RepoBoard for the desktop: the same app as in the browser, in its own
 * window. The Next.js server that `npm run start` would run lives inside the
 * app (resources/server, assembled by prepare.mjs) and is started here on a
 * free port on 127.0.0.1; the window loads it. Data and tokens stay where the
 * web version keeps them, in ~/.repoboard, so both see the same projects.
 *
 * The window is translucent: on macOS it takes the system's vibrancy, on
 * Windows 11 the acrylic material, and the page (html.rb-desktop, see
 * app/globals.css) lets it show through the desk behind the panels.
 */
const { app, BrowserWindow, Menu, nativeTheme, shell, utilityProcess, dialog, ipcMain } = require("electron");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const updates = require("./updates.cjs");

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
let server = null;
let origin = null;
let win = null;

function serverDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "app", "server");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitFor(url, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("The RepoBoard server did not start"));
        else setTimeout(attempt, 150);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

/** The server's output, kept so a failure can be looked into. */
function logFile() {
  const dir = app.getPath("logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "server.log");
}
let log = null;
function writeLog(text) {
  try {
    log ??= fs.createWriteStream(logFile(), { flags: "a" });
    log.write(text);
  } catch {
    // Logging must never stop the app.
  }
}

// A server that stops is started again, a few times, before asking.
let restarts = [];

async function startServer() {
  const port = await freePort();
  const dir = serverDir();
  server = utilityProcess.fork(path.join(dir, "server.js"), [], {
    cwd: dir,
    serviceName: "RepoBoard server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      REPOBOARD_DESKTOP: "1",
      // For Settings: agents run the bundled MCP server with this binary in Node mode.
      REPOBOARD_NODE: process.execPath,
    },
  });
  server.stdout?.on("data", (d) => {
    process.stdout.write(`[server] ${d}`);
    writeLog(String(d));
  });
  server.stderr?.on("data", (d) => {
    process.stderr.write(`[server] ${d}`);
    writeLog(String(d));
  });
  server.on("exit", (code) => {
    server = null;
    if (app.isQuitting) return;
    writeLog(`\n[${new Date().toISOString()}] server exited with code ${code}\n`);
    void recover();
  });
  origin = `http://127.0.0.1:${port}`;
  await waitFor(`${origin}/api/repo`);
  console.log(`RepoBoard server at ${origin}`);
}

/** Starts the server again and reopens the page on it; asks only when that keeps failing. */
async function recover() {
  const now = Date.now();
  restarts = restarts.filter((t) => now - t < 60_000);
  restarts.push(now);
  if (restarts.length <= 3) {
    try {
      await startServer();
      win?.loadURL(origin);
      return;
    } catch {
      // Falls through to asking.
    }
  }
  await askAfterFailure("RepoBoard stopped", "Its local server stopped and did not come back on its own.");
}

/** A failure the app could not fix itself: try again, look at the log, or quit — never a dead end. */
async function askAfterFailure(title, detail) {
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: title,
      detail: `${detail}\n\nYour boards and keys are safe in ~/.repoboard.`,
      buttons: ["Try again", "Open the log", "Quit"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 1) {
      shell.showItemInFolder(logFile());
      continue;
    }
    if (response === 2) {
      app.quit();
      return false;
    }
    try {
      restarts = [];
      await startServer();
      if (win) win.loadURL(origin);
      else createWindow();
      return true;
    } catch (error) {
      detail = String(error?.message ?? error);
    }
  }
}

function isInternal(url) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "RepoBoard",
    // Transparent, so the system material shows through the desk.
    backgroundColor: "#00000000",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          // Centred in the 34px strip at the top of the page (app/globals.css).
          trafficLightPosition: { x: 16, y: 10 },
          vibrancy: "under-window",
          visualEffectState: "followWindow",
        }
      : {}),
    ...(isWindows
      ? {
          backgroundMaterial: "acrylic",
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: nativeTheme.shouldUseDarkColors ? "#e8e9eb" : "#1f2329",
            height: 38,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // Links to GitHub and elsewhere open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: "allow" };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // Back and forward: the mouse's side buttons on Windows, a three-finger
  // swipe on macOS (two fingers are handled by the page).
  win.on("app-command", (_event, command) => {
    if (command === "browser-backward") goBack();
    if (command === "browser-forward") goForward();
  });
  win.on("swipe", (_event, direction) => {
    if (direction === "right") goBack();
    if (direction === "left") goForward();
  });

  // The window-control colours follow the theme on Windows.
  if (isWindows) {
    nativeTheme.on("updated", () => {
      win?.setTitleBarOverlay?.({ symbolColor: nativeTheme.shouldUseDarkColors ? "#e8e9eb" : "#1f2329" });
    });
  }

  win.once("ready-to-show", () => win.show());
  // For checking the layout from a script: REPOBOARD_CAPTURE=shot.png electron .
  if (process.env.REPOBOARD_CAPTURE) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        require("node:fs").writeFileSync(process.env.REPOBOARD_CAPTURE, image.toPNG());
        app.quit();
      }, 4000);
    });
  }
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(origin);
}

function goBack() {
  const history = win?.webContents.navigationHistory;
  if (history?.canGoBack()) history.goBack();
}
function goForward() {
  const history = win?.webContents.navigationHistory;
  if (history?.canGoForward()) history.goForward();
}

function buildMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: "RepoBoard",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Back", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: goBack },
        { label: "Forward", accelerator: isMac ? "Cmd+]" : "Alt+Right", click: goForward },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Check for updates", click: () => updates.check(win, { manual: true }) },
        { label: "RepoBoard on GitHub", click: () => shell.openExternal("https://github.com/NekoFF/repoboard") },
        { label: "Show the log", click: () => shell.showItemInFolder(logFile()) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    updates.listen(ipcMain, () => win);
    try {
      await startServer();
    } catch (error) {
      const ok = await askAfterFailure("RepoBoard could not start", String(error?.message ?? error));
      if (!ok) return;
    }
    if (!win) createWindow();
    // Is there a newer version? Once now, then every few hours.
    setTimeout(() => updates.check(win), 8_000);
    setInterval(() => updates.check(win), 4 * 60 * 60 * 1000);
    app.on("activate", () => {
      if (!win && origin) createWindow();
    });
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    server?.kill();
  });
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
}
