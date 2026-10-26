import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Plain JS, run by the launcher before any build.
import { bumpVersions } from "../../../scripts/release.mjs";
import { checkSource, runSourceUpdate } from "../../../scripts/source-update.mjs";
import { updatingPage } from "../../../scripts/updating-page.mjs";

/**
 * One-click updates for a git checkout, against real repositories on disk: a bare one stands in for GitHub
 * and a clone is the founder's copy of Inroad. git runs for real; npm and next build are stand-ins that
 * record what they were asked and fail on demand, so a failed install or build can be seen to roll back.
 */

let dir: string;
let remote: string;
let upstream: string;
let app: string;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(cwd: string, file: string, body: string, message: string) {
  fs.writeFileSync(path.join(cwd, file), body);
  git(cwd, "add", "--all");
  git(cwd, "commit", "--quiet", "-m", message);
}

/** A commit on GitHub the founder's copy doesn't have yet. */
function publish(file: string, body: string, message: string) {
  commit(upstream, file, body, message);
  git(upstream, "push", "--quiet", "origin", "main");
}

type Call = { cmd: string; args: string[] };

/** git for real; npm ci and next build recorded, with exit codes taken from `codes` in order (0 when it runs out). */
function runner(codes: { install?: number[]; build?: number[] } = {}) {
  const calls: Call[] = [];
  const run = async (cmd: string, args: string[]) => {
    if (cmd === "git") {
      const r = spawnSync(cmd, args, { cwd: app, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    }
    calls.push({ cmd, args });
    const kind = args.includes("ci") ? "install" : "build";
    const code = codes[kind]?.shift() ?? 0;
    return { code, stdout: "", stderr: code ? `npm error ${kind} broke` : "" };
  };
  return { run, calls };
}

const update = (run: ReturnType<typeof runner>["run"], mode: "dev" | "start" = "start") =>
  runSourceUpdate({ run, root: app, mode, npm: { cmd: "npm", args: [] }, next: "/next", node: "node" });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-update-"));
  remote = path.join(dir, "github.git");
  upstream = path.join(dir, "maintainer");
  app = path.join(dir, "inroad");
  git(dir, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", "--quiet", remote, upstream);
  git(upstream, "config", "user.email", "maintainer@example.com");
  git(upstream, "config", "user.name", "Maintainer");
  git(upstream, "checkout", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(upstream, "package.json"), '{"name":"inroad","version":"0.1.0"}\n');
  commit(upstream, "package-lock.json", '{"lockfileVersion":3}\n', "First version");
  git(upstream, "push", "--quiet", "-u", "origin", "main");
  git(dir, "clone", "--quiet", remote, app);
  git(app, "config", "user.email", "founder@example.com");
  git(app, "config", "user.name", "Founder");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("checking for updates", () => {
  it("is up to date right after cloning", async () => {
    const c = await checkSource({ run: runner().run, fetch: true });
    expect(c).toMatchObject({ kind: "git", branch: "main", upstream: "origin/main", behind: 0, ahead: 0, blocked: null, fetched: true, fetchError: null });
  });

  it("lists what's new on GitHub once it has asked, newest first", async () => {
    publish("a.txt", "a", "Add the lead map");
    publish("b.txt", "b", "Fix the Today queue");
    const { run } = runner();
    expect(await checkSource({ run })).toMatchObject({ behind: 0 });
    const c = await checkSource({ run, fetch: true });
    expect(c).toMatchObject({ behind: 2, blocked: null });
    expect(c.kind === "git" && c.changes.map((ch) => ch.subject)).toEqual(["Fix the Today queue", "Add the lead map"]);
  });

  it("won't overwrite a file changed on this computer, but ignores files git doesn't track", async () => {
    publish("a.txt", "a", "Something new");
    fs.writeFileSync(path.join(app, "notes.txt"), "mine");
    expect(await checkSource({ run: runner().run, fetch: true })).toMatchObject({ behind: 1, blocked: null, dirty: [] });
    fs.writeFileSync(path.join(app, "package.json"), '{"name":"inroad","version":"0.1.0","mine":true}\n');
    expect(await checkSource({ run: runner().run, fetch: true })).toMatchObject({ behind: 1, blocked: "dirty", dirty: ["package.json"] });
  });

  it("can't move forward past commits made here", async () => {
    publish("a.txt", "a", "Upstream change");
    commit(app, "local.txt", "x", "My own change");
    expect(await checkSource({ run: runner().run, fetch: true })).toMatchObject({ behind: 1, ahead: 1, blocked: "diverged" });
  });

  it("says when there's nothing to update from", async () => {
    git(app, "checkout", "--quiet", "--detach");
    expect(await checkSource({ run: runner().run })).toMatchObject({ blocked: "detached" });
    git(app, "checkout", "--quiet", "-b", "experiment");
    expect(await checkSource({ run: runner().run })).toMatchObject({ blocked: "no-upstream" });
    fs.rmSync(path.join(app, ".git"), { recursive: true, force: true });
    expect(await checkSource({ run: runner().run })).toMatchObject({ kind: "none", reason: expect.stringMatching(/isn't a git checkout/) });
  });

  it("answers from what it knew when GitHub can't be reached", async () => {
    git(app, "remote", "set-url", "origin", path.join(dir, "gone.git"));
    const c = await checkSource({ run: runner().run, fetch: true });
    expect(c).toMatchObject({ kind: "git", fetched: false, fetchError: expect.stringMatching(/^Couldn't reach GitHub/), behind: 0 });
  });
});

describe("updating", () => {
  it("moves forward and builds, without reinstalling when dependencies didn't change", async () => {
    const before = git(app, "rev-parse", "HEAD");
    publish("a.txt", "a", "Something new");
    const { run, calls } = runner();
    const r = await update(run);
    expect(r).toMatchObject({ ok: true, from: before, to: git(upstream, "rev-parse", "HEAD"), changes: 1 });
    expect(git(app, "rev-parse", "HEAD")).toBe(git(upstream, "rev-parse", "HEAD"));
    expect(calls).toEqual([{ cmd: "node", args: ["/next", "build"] }]);
  });

  it("installs again when the lockfile changed, and skips the build for the dev server", async () => {
    publish("package-lock.json", '{"lockfileVersion":3,"new":true}\n', "Bump a dependency");
    const { run, calls } = runner();
    expect(await update(run, "dev")).toMatchObject({ ok: true });
    expect(calls).toEqual([{ cmd: "npm", args: ["ci", "--no-audit", "--no-fund"] }]);
  });

  it("goes back to the version it had when the build fails, and builds that again", async () => {
    const before = git(app, "rev-parse", "HEAD");
    publish("package-lock.json", '{"lockfileVersion":3,"new":true}\n', "Breaks the build");
    const { run, calls } = runner({ build: [1, 0] });
    const r = await update(run);
    expect(r).toMatchObject({ ok: false, rolledBack: true, step: "building", error: expect.stringMatching(/went back to the version you had/) });
    expect(git(app, "rev-parse", "HEAD")).toBe(before);
    expect(fs.readFileSync(path.join(app, "package-lock.json"), "utf8")).toBe('{"lockfileVersion":3}\n');
    // The new version's install and build, then the old version's.
    expect(calls.map((c) => c.args.includes("ci") ? "install" : "build")).toEqual(["install", "build", "install", "build"]);
  });

  it("says exactly what to run when going back fails too", async () => {
    const before = git(app, "rev-parse", "HEAD");
    publish("a.txt", "a", "Breaks the build");
    const r = await update(runner({ build: [1, 1] }).run);
    expect(r).toMatchObject({ ok: false, rolledBack: false, error: expect.stringContaining(`git reset --hard ${before.slice(0, 12)}, npm ci and npm run build`) });
  });

  it("refuses before touching anything when it can't update", async () => {
    const { run, calls } = runner();
    expect(await update(run)).toMatchObject({ ok: false, error: "Inroad is already up to date." });
    publish("a.txt", "a", "New");
    fs.writeFileSync(path.join(app, "package.json"), "{}\n");
    expect(await update(run)).toMatchObject({ ok: false, error: expect.stringMatching(/changed on this computer/) });
    expect(calls).toEqual([]);
  });
});

describe("the page shown while it updates", () => {
  it("names the step, reloads itself and runs no script", () => {
    const html = updatingPage("building");
    expect(html).toContain("Building it");
    expect(html).toContain('http-equiv="refresh" content="2"');
    expect(html).not.toMatch(/<script/i);
    expect(updatingPage("<img onerror=x>")).not.toContain("<img");
  });
});

describe("cutting a release", () => {
  it("sets the version everywhere the tag is checked against, and dates the changelog", () => {
    fs.mkdirSync(path.join(app, "desktop", "app"), { recursive: true });
    fs.writeFileSync(path.join(app, "desktop", "app", "package.json"), '{"name":"inroad-desktop","version":"0.1.0"}\n');
    fs.writeFileSync(path.join(app, "package-lock.json"), '{"name":"inroad","version":"0.1.0","packages":{"":{"version":"0.1.0"}}}\n');
    fs.writeFileSync(path.join(app, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n- Updates\n");
    expect(bumpVersions(app, "0.2.0", "2026-10-27")).toEqual(["package.json", "desktop/app/package.json", "package-lock.json", "CHANGELOG.md"]);
    const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(app, rel), "utf8"));
    expect([read("package.json").version, read("desktop/app/package.json").version, read("package-lock.json").version, read("package-lock.json").packages[""].version]).toEqual(["0.2.0", "0.2.0", "0.2.0", "0.2.0"]);
    expect(fs.readFileSync(path.join(app, "CHANGELOG.md"), "utf8")).toContain("## [Unreleased]\n\n---\n\n## [v0.2.0] — 2026-10-27\n\n### Added\n- Updates");
    expect(() => bumpVersions(app, "0.2.0", "2026-10-27")).toThrow(/already has v0.2.0/);
    expect(() => bumpVersions(app, "two", "2026-10-27")).toThrow(/isn't a version/);
  });
});
