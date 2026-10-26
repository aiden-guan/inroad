#!/usr/bin/env node
/**
 * Cuts a release: `npm run release -- 0.2.0`.
 *
 * Sets the version everywhere it's read (package.json, package-lock.json and the Mac app's
 * desktop/app/package.json, which installed apps compare against the release tag), moves the changelog's
 * Unreleased notes under the new version with today's date, commits that and tags it v0.2.0. Pushing the tag
 * (it says the command) runs the Mac app workflow, which publishes the release that installed copies update from.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Writes the new version into the repository at `root`. Returns the files it changed. */
export function bumpVersions(root, version, today) {
  if (!VERSION.test(version)) throw new Error(`"${version}" isn't a version like 0.2.0.`);
  const changed = [];
  const editJSON = (rel, fn) => {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) return;
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    fn(json);
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    changed.push(rel);
  };
  editJSON("package.json", (j) => (j.version = version));
  editJSON("desktop/app/package.json", (j) => (j.version = version));
  editJSON("package-lock.json", (j) => {
    j.version = version;
    if (j.packages?.[""]) j.packages[""].version = version;
  });
  const changelog = path.join(root, "CHANGELOG.md");
  if (fs.existsSync(changelog)) {
    const text = fs.readFileSync(changelog, "utf8");
    if (text.includes(`## [v${version}]`)) throw new Error(`CHANGELOG.md already has v${version}.`);
    if (text.includes("## [Unreleased]")) {
      fs.writeFileSync(changelog, text.replace("## [Unreleased]", `## [Unreleased]\n\n---\n\n## [v${version}] — ${today}`));
      changed.push("CHANGELOG.md");
    }
  }
  return changed;
}

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  try {
    if (!version) throw new Error("Usage: npm run release -- 0.2.0");
    if (git(root, "status", "--porcelain", "--untracked-files=no")) throw new Error("Commit or stash your changes first, so the release commit holds only the version.");
    if (git(root, "tag", "--list", `v${version}`)) throw new Error(`The tag v${version} already exists.`);
    const today = new Date().toISOString().slice(0, 10);
    const changed = bumpVersions(root, version, today);
    git(root, "add", ...changed);
    git(root, "commit", "--quiet", "-m", `Release v${version}`);
    git(root, "tag", "-a", `v${version}`, "-m", `Inroad v${version}`);
    const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
    console.log(`Tagged v${version} (${changed.join(", ")}). To publish it, push the commit and the tag:\n\n  git push origin ${branch} v${version}\n`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
