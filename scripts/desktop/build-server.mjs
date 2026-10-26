#!/usr/bin/env node
/**
 * Builds the server the Mac app runs: `next build` in standalone mode (INROAD_DESKTOP=1, see next.config.ts),
 * then assembles desktop/dist-server (prepare-server.mjs). Arguments pass through, e.g. `--arch x64`.
 *
 *   npm run desktop:server                      # for this machine
 *   npm run desktop:server -- --platform darwin --arch x64
 */
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// A throwaway data folder: the build must never read or write a real workspace.
const build = spawnSync(npx, ["next", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, INROAD_DESKTOP: "1", NEXT_TELEMETRY_DISABLED: "1", GTM_DATA_DIR: path.join(os.tmpdir(), "inroad-desktop-build") },
  shell: process.platform === "win32",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const prepare = spawnSync(process.execPath, [path.join(root, "scripts", "desktop", "prepare-server.mjs"), ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
process.exit(prepare.status ?? 1);
