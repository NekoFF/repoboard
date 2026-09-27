/**
 * Tells the page it runs in the desktop app, before anything paints: the
 * `rb-desktop` classes on <html> make room for the window buttons and let the
 * system material show through the desk (app/globals.css). Also the one door
 * to the app's own work — updates (desktop/updates.cjs).
 */
const { contextBridge, ipcRenderer } = require("electron");

const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";

contextBridge.exposeInMainWorld("repoboardDesktop", {
  platform,
  updates: {
    state: () => ipcRenderer.invoke("repoboard:update-state"),
    download: () => ipcRenderer.invoke("repoboard:update-download"),
    install: () => ipcRenderer.invoke("repoboard:update-install"),
    /** Calls back with every change; returns a function that stops listening. */
    subscribe: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("repoboard:update", listener);
      return () => ipcRenderer.removeListener("repoboard:update", listener);
    },
  },
});

const mark = () => {
  document.documentElement.classList.add("rb-desktop", `rb-desktop-${platform}`);
};
if (document.documentElement) mark();
else document.addEventListener("DOMContentLoaded", mark, { once: true });
