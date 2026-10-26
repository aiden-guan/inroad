/**
 * electron-builder leaves node_modules out of extraResources whatever the filter says, so the server's own
 * dependencies (Next.js, React, the keychain module) are copied in here, after packaging and before signing,
 * so they're signed with the rest of the app.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads its hooks as CommonJS */
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, "dist-server", "node_modules");
  const app = `${context.packager.appInfo.productFilename}.app`;
  const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, app, "Contents", "Resources") : path.join(context.appOutDir, "resources");
  const to = path.join(resources, "server", "node_modules");
  if (!fs.existsSync(from)) throw new Error("desktop/dist-server/node_modules is missing. Run npm run desktop:server first.");
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  if (!fs.existsSync(path.join(to, "next", "package.json"))) throw new Error("The server's node_modules didn't copy.");
};
