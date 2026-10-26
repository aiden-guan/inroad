/**
 * Updating Inroad where it runs from a git checkout (`npm start`, `npm run dev`): what's new upstream, and the
 * update itself. The launcher (scripts/serve.mjs) runs it, with the server stopped, when the founder clicks
 * Update in the app. Plain JS with the commands passed in, so it runs before any build and can be tested
 * against a real repository (src/lib/server/source-update.test.ts).
 *
 * An update only ever fast-forwards the branch the checkout follows, and only from a clean tree: it never
 * merges, rebases or throws away a change. If installing or building the new version fails, the checkout
 * goes back to the commit it was on and that version is installed and built again, so the app comes back
 * as it was.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {{ code: number; stdout: string; stderr: string }} RunResult
 * @typedef {(cmd: string, args: string[], opts?: { timeoutMs?: number; log?: boolean }) => Promise<RunResult>} Run
 * @typedef {{ sha: string; subject: string; date: string }} Change
 * @typedef {{
 *   kind: "git";
 *   branch: string | null;
 *   upstream: string | null;
 *   head: string;
 *   behind: number;
 *   ahead: number;
 *   dirty: string[];
 *   changes: Change[];
 *   fetched: boolean;
 *   fetchError: string | null;
 *   blocked: null | "no-upstream" | "detached" | "dirty" | "diverged";
 * } | { kind: "none"; reason: string }} SourceCheck
 */

const MAX_CHANGES = 30;

/** Plain-words reasons a one-click update can't run, with what to do instead. */
export const BLOCKED_REASON = {
  "no-upstream": "This copy of Inroad doesn't follow a branch on GitHub, so there's nothing to update from. Run git branch --set-upstream-to=origin/main once, then check again.",
  detached: "This copy of Inroad is on a fixed commit, not a branch, so there's nothing to update from. Run git checkout main, then check again.",
  dirty: "Some of Inroad's own files were changed on this computer, and updating could overwrite those changes. Commit or stash them (git stash), then update.",
  diverged: "This copy of Inroad has commits that aren't on GitHub, so it can't simply move forward. Merge or rebase them yourself (git pull), then update.",
};

/** The line of what a command printed that says why it failed: the first naming an error, else the last. */
function firstLine(r) {
  const lines = `${r.stderr}\n${r.stdout}`
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines.find((l) => /error|fatal|failed/i.test(l)) ?? lines.at(-1) ?? `exit code ${r.code}`).slice(0, 240);
}

/** Hash of the files whose change means dependencies must be installed again. */
export function dependencyStamp(root) {
  const hash = crypto.createHash("sha256");
  for (const name of ["package-lock.json", "package.json"]) {
    try {
      hash.update(fs.readFileSync(path.join(root, name)));
    } catch {
      hash.update(`missing:${name}`);
    }
  }
  return hash.digest("hex");
}

/**
 * Where this checkout stands against the branch it follows. With `fetch`, asks GitHub first (git fetch);
 * a failed fetch still answers from what was fetched before, and says why it couldn't fetch.
 * @param {{ run: Run; fetch?: boolean }} o
 * @returns {Promise<SourceCheck>}
 */
export async function checkSource({ run, fetch = false }) {
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return { kind: "none", reason: "This copy of Inroad isn't a git checkout, so it can't update itself. Download the latest version from GitHub and copy your data folder across." };
  }
  const head = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  const branchOut = await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = branchOut.code === 0 ? branchOut.stdout.trim() : null;
  const upOut = branch ? await run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]) : null;
  const upstream = upOut && upOut.code === 0 ? upOut.stdout.trim() : null;
  const dirty = (await run("git", ["status", "--porcelain", "--untracked-files=no"])).stdout
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
  const base = { kind: /** @type {const} */ ("git"), branch, upstream, head, dirty, fetched: false, fetchError: null };
  if (!branch) return { ...base, behind: 0, ahead: 0, changes: [], blocked: "detached" };
  if (!upstream) return { ...base, behind: 0, ahead: 0, changes: [], blocked: "no-upstream" };

  let fetched = false;
  let fetchError = null;
  if (fetch) {
    const slash = upstream.indexOf("/");
    const remote = upstream.slice(0, slash);
    const remoteBranch = upstream.slice(slash + 1);
    const f = await run("git", ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${remoteBranch}:refs/remotes/${upstream}`], { timeoutMs: 60_000 });
    fetched = f.code === 0;
    if (!fetched) fetchError = `Couldn't reach GitHub to check for updates (${firstLine(f)}).`;
  }

  const counts = (await run("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream}`])).stdout.trim().split(/\s+/).map(Number);
  const [ahead, behind] = [counts[0] || 0, counts[1] || 0];
  const log = behind ? await run("git", ["log", `--max-count=${MAX_CHANGES}`, "--no-merges", "--format=%H%x1f%s%x1f%cI", `HEAD..${upstream}`]) : { stdout: "" };
  const changes = log.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, date] = line.split("\x1f");
      return { sha, subject, date };
    });
  const blocked = behind && ahead ? "diverged" : behind && dirty.length ? "dirty" : null;
  return { ...base, fetched, fetchError, behind, ahead, changes, blocked };
}

/**
 * The update. The server must already be stopped. Steps: fetch, fast-forward, install dependencies when
 * they changed, build when the production server runs (`mode: "start"`). Any failure after the
 * fast-forward puts the checkout back and installs and builds the old version again.
 * @param {{ run: Run; root: string; mode: "dev" | "start"; npm: { cmd: string; args: string[] }; next: string; node: string; onStep?: (step: string) => void }} o
 * @returns {Promise<{ ok: true; from: string; to: string; changes: number } | { ok: false; error: string; rolledBack: boolean; step: string }>}
 */
export async function runSourceUpdate({ run, root, mode, npm, next, node, onStep = () => {} }) {
  onStep("checking");
  const check = await checkSource({ run, fetch: true });
  if (check.kind !== "git") return { ok: false, error: check.reason, rolledBack: false, step: "checking" };
  if (check.fetchError) return { ok: false, error: check.fetchError, rolledBack: false, step: "checking" };
  if (check.blocked) return { ok: false, error: BLOCKED_REASON[check.blocked], rolledBack: false, step: "checking" };
  if (!check.behind) return { ok: false, error: "Inroad is already up to date.", rolledBack: false, step: "checking" };

  const from = check.head;
  const depsBefore = dependencyStamp(root);
  const install = () => run(npm.cmd, [...npm.args, "ci", "--no-audit", "--no-fund"], { timeoutMs: 20 * 60_000, log: true });
  const build = () => run(node, [next, "build"], { timeoutMs: 20 * 60_000, log: true });

  onStep("downloading");
  const ff = await run("git", ["merge", "--ff-only", "--quiet", check.upstream], { log: true });
  if (ff.code !== 0) return { ok: false, error: `Couldn't move to the new version (${firstLine(ff)}). Nothing was changed.`, rolledBack: false, step: "downloading" };
  const to = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  const depsChanged = dependencyStamp(root) !== depsBefore;

  /** Back to `from`, with its dependencies and build, after `step` failed. */
  const rollBack = async (step, why) => {
    onStep("rolling-back");
    const reset = await run("git", ["reset", "--hard", "--quiet", from], { log: true });
    let back = reset.code === 0;
    if (back && depsChanged) back = (await install()).code === 0;
    if (back && mode === "start") back = (await build()).code === 0;
    const error = back
      ? `The update stopped while ${step} (${why}), so Inroad went back to the version you had. Your work is untouched.`
      : `The update stopped while ${step} (${why}), and going back didn't finish either. Your work is untouched. In this folder, run git reset --hard ${from.slice(0, 12)}, npm ci and npm run build, then npm start.`;
    return { ok: /** @type {const} */ (false), error, rolledBack: back, step };
  };

  if (depsChanged) {
    onStep("installing");
    const r = await install();
    if (r.code !== 0) return rollBack("installing", firstLine(r));
  }
  if (mode === "start") {
    onStep("building");
    const r = await build();
    if (r.code !== 0) return rollBack("building", firstLine(r));
  }
  onStep("restarting");
  return { ok: true, from, to, changes: check.behind };
}
