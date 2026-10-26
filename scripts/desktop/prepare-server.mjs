#!/usr/bin/env node
/**
 * Assembles the server the Mac app runs (desktop/dist-server, packaged as Contents/Resources/server):
 * Next's standalone output (`INROAD_DESKTOP=1 next build`), its static files and public/, the peer guard that
 * stamps each request with its real socket address, and an entry that loads the guard before server.js.
 *
 * The keychain module and Studio's SVG renderer are native, so the folder gets exactly one platform binary of
 * each: the one for the Mac it's built for (`--arch arm64|x64`, default this machine's). A binary npm didn't
 * install here (an x64 build on an Apple Silicon runner) is fetched with `npm pack`, at the module's version.
 *
 * Next links some external packages from .next/node_modules into the standalone node_modules with absolute
 * symlinks. Those would point outside the app (codesign refuses: "invalid destination for symbolic link"),
 * so each becomes a relative link to the same package inside the folder.
 *
 *   node scripts/desktop/prepare-server.mjs [--arch arm64|x64] [--platform darwin|linux|win32]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const standalone = path.join(root, ".next", "standalone");
const out = path.join(root, "desktop", "dist-server");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const arch = arg("arch", process.arch);
const platform = arg("platform", process.platform);

function fail(message) {
  console.error(`[desktop] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(standalone, "server.js"))) fail("No standalone build. Run `npm run desktop:build` (it builds with INROAD_DESKTOP=1 first).");

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(standalone, out, { recursive: true, verbatimSymlinks: false });
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts", "peer-guard.cjs"), path.join(out, "peer-guard.cjs"));
fs.writeFileSync(
  path.join(out, "entry.cjs"),
  `// The Mac app's server: the peer guard first (it stamps each request with its socket address), then Next.\nrequire("./peer-guard.cjs");\nrequire("./server.js");\n`,
);
// Nothing at run time reads these.
for (const extra of ["package-lock.json", "next.config.ts"]) fs.rmSync(path.join(out, extra), { force: true });

// A build folder from a developer's machine must never ship their data.
for (const name of fs.readdirSync(out)) if (name.startsWith(".data")) fail(`${name} ended up in the server folder; it must not ship.`);

/* ───────────── Links that point outside the folder ───────────── */

const insideOut = (p) => p === out || p.startsWith(out + path.sep);
function fixLinks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      const target = path.resolve(dir, fs.readlinkSync(p));
      if (insideOut(target)) continue;
      // A link into the standalone build points at the same package here; anything else can't ship.
      const rel = path.relative(standalone, target);
      const here = path.join(out, rel);
      if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(here)) fail(`${path.relative(out, p)} links outside the app (${target}).`);
      fs.rmSync(p);
      fs.symlinkSync(path.relative(dir, here), p);
    } else if (e.isDirectory()) fixLinks(p);
  }
}
fixLinks(out);

/* ───────────── Native binaries for the target ───────────── */

/** Keeps only the target's binary package of `scope/name` (e.g. @napi-rs/keyring-darwin-arm64), fetching it when needed. */
function nativeFor(scopeName, name, required) {
  const scope = path.join(out, "node_modules", scopeName);
  const modulePkg = path.join(scope, name, "package.json");
  if (!fs.existsSync(modulePkg)) {
    if (required) fail(`${scopeName}/${name} wasn't traced into the build (see outputFileTracingIncludes in next.config.ts).`);
    return null;
  }
  const version = JSON.parse(fs.readFileSync(modulePkg, "utf8")).version;
  const want = platform === "darwin" ? `${name}-darwin-${arch}` : platform === "win32" ? `${name}-win32-${arch}-msvc` : `${name}-${platform}-${arch}-gnu`;
  for (const entry of fs.readdirSync(scope)) {
    if (entry.startsWith(`${name}-`) && entry !== want) fs.rmSync(path.join(scope, entry), { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(scope, want))) {
    const local = path.join(root, "node_modules", scopeName, want);
    if (fs.existsSync(local)) fs.cpSync(local, path.join(scope, want), { recursive: true });
    else {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `inroad-${name}-`));
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const file = execFileSync(npm, ["pack", `${scopeName}/${want}@${version}`, "--pack-destination", tmp, "--silent"], { encoding: "utf8", shell: process.platform === "win32" })
        .trim()
        .split("\n")
        .pop();
      execFileSync("tar", ["-xzf", path.join(tmp, file), "-C", tmp]);
      fs.cpSync(path.join(tmp, "package"), path.join(scope, want), { recursive: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (!fs.readdirSync(path.join(scope, want)).some((f) => f.endsWith(".node"))) fail(`${want} has no native binary.`);
  return `${want}@${version}`;
}

const keychain = nativeFor("@napi-rs", "keyring", true);
// Studio graphics render SVG to PNG with it; traced only when a route imports it.
const renderer = nativeFor("@resvg", "resvg-js", false);

const size = execFileSync("du", ["-sh", out], { encoding: "utf8" }).split("\t")[0];
console.log(`[desktop] Server ready in desktop/dist-server (${size}) for ${platform}-${arch}, keychain ${keychain}${renderer ? `, renderer ${renderer}` : ""}.`);
