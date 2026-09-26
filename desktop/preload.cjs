/**
 * Tells the page it runs in the desktop app, before anything paints: the
 * `rb-desktop` classes on <html> make room for the window buttons and let the
 * system material show through the desk (app/globals.css).
 */
const { contextBridge } = require("electron");

const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";

contextBridge.exposeInMainWorld("repoboardDesktop", { platform });

const mark = () => {
  document.documentElement.classList.add("rb-desktop", `rb-desktop-${platform}`);
};
if (document.documentElement) mark();
else document.addEventListener("DOMContentLoaded", mark, { once: true });
