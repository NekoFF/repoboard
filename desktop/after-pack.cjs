/**
 * electron-builder leaves node_modules and dot-folders out of extraResources,
 * and the server needs both. So the server folder is copied in here, after
 * the app is laid out and before the .dmg / installer is made from it.
 */
const fs = require("node:fs");
const path = require("node:path");

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
};
