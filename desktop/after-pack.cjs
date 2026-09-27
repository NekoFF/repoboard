/**
 * electron-builder leaves node_modules and dot-folders out of extraResources,
 * and the server needs both. So the server folder is copied in here, after
 * the app is laid out and before the .dmg / installer is made from it.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const from = path.join(__dirname, "app", "server");
  const to = path.join(resources, "server");
  if (!fs.existsSync(path.join(from, "server.js"))) {
    throw new Error("desktop/app/server is missing: run `node desktop/prepare.mjs` first");
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });
  console.log(`  • copied the server into ${path.relative(context.appOutDir, to)}`);

  // Without an Apple certificate the app is not signed, and laying it out broke
  // Electron's own signature: macOS then calls a downloaded copy "damaged", with
  // no way to open it. Signed ad hoc it is whole, and macOS only says the
  // developer is unknown — which the person can allow.
  if (context.electronPlatformName === "darwin") {
    const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
    console.log("  • signed the app ad hoc");
  }
};
