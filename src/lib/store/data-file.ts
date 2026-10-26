import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Owner-only on disk: the workspace holds prospects' names, work emails, call notes and deals (personal
 * data), and settings.json and secrets.json hold keys, so other accounts on this computer can't read the
 * files. It doesn't reach the running app: the server answers any process on this computer over loopback
 * (src/lib/server/local-request.ts), so the computer is the trust boundary (README, "Only this computer").
 * Windows ignores these modes; its per-user profile folders do the same job.
 */
export const FILE_MODE = 0o600;
export const DIR_MODE = 0o700;

/** Creates a data folder (and any missing parents) that only this user can open. */
export function ensureDataDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
}

/**
 * Atomic, owner-only write (temp file, then rename), so a crash mid-write never leaves a half-written
 * file and no other user can read it in between. The chmod covers a temp file left by a crashed run.
 */
export function writeFileAtomic(file: string, contents: string | Uint8Array) {
  ensureDataDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: FILE_MODE });
  fs.chmodSync(tmp, FILE_MODE);
  fs.renameSync(tmp, file);
}

/**
 * Reads a JSON data file. Only a missing file yields `missing()`. Anything else (bad JSON, a failed
 * migration, EACCES/EMFILE) throws, so no caller ever holds an empty state that its next write
 * would save over the founder's data. A corrupt file is copied aside first.
 */
export function readDataFile<T>(file: string, missing: () => T, parse: (raw: unknown) => T = (raw) => raw as T): T {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return missing();
    throw err;
  }
  try {
    return parse(JSON.parse(text));
  } catch (err) {
    const copy = keepCopy(file);
    // Only the position from a JSON error: its message can quote file contents (keys, secrets).
    const why =
      err instanceof SyntaxError
        ? `invalid JSON${err.message.match(/ at position \d+( \(line \d+ column \d+\))?/)?.[0] ?? ""}`
        : err instanceof Error
          ? err.message
          : "unknown error";
    throw new Error(
      `${path.basename(file)} could not be read (${why}).${copy ? ` A copy was saved as ${path.basename(copy)}.` : ""} Fix or remove the file, then restart Inroad.`,
    );
  }
}

/** One copy per version of the file (named by mtime), however often it is read. */
function keepCopy(file: string): string | null {
  try {
    const copy = `${file}.corrupt-${Math.round(fs.statSync(file).mtimeMs)}`;
    if (!fs.existsSync(copy)) {
      fs.copyFileSync(file, copy);
      fs.chmodSync(copy, FILE_MODE);
    }
    return copy;
  } catch {
    return null;
  }
}

/** A JSON data file, written atomically and readable by this user only. */
export function writeDataFile(file: string, value: unknown) {
  writeFileAtomic(file, JSON.stringify(value, null, 2));
}

/** The files Inroad keeps at the top of its data folder (with their temp files and corrupt copies). */
const OWN_FILE = /^(workspace|threads|connections|network|desk|runs|hub|settings|secrets|keys|opt-outs|calibration|references|geo-cache)\.json(\.corrupt-\d+|\.\d+\.tmp)?$/;
/** Its folders there; everything inside them is Inroad's. */
const OWN_DIRS = new Set(["backups", "cache"]);

/**
 * Tightens what an older version (or a umask) left readable to others: Inroad's own files to 0600 and its
 * own folders (backups/, cache/ and what's in them) to 0700. Nothing else is touched: GTM_DATA_DIR may point
 * at a folder that holds other things too (a script keeps its execute bit), and then the folder itself is
 * left as it is and `foreign` says how many entries aren't Inroad's. Run once when the server starts.
 * Best-effort, and never follows a symlink.
 */
export function secureDataDir(dir: string): { changed: number; foreign: number } {
  let changed = 0;
  let foreign = 0;
  const tighten = (p: string, mode: number) => {
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || (st.mode & 0o777 & ~mode) === 0) return;
      fs.chmodSync(p, mode);
      changed++;
    } catch {
      // gone or not ours: leave it
    }
  };
  const entries = (d: string): fs.Dirent[] => {
    try {
      return fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const walk = (d: string, depth: number) => {
    tighten(d, DIR_MODE);
    for (const e of entries(d)) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 3) walk(p, depth + 1);
      } else if (e.isFile()) tighten(p, FILE_MODE);
    }
  };
  if (!fs.existsSync(dir)) return { changed, foreign };
  for (const e of entries(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && OWN_DIRS.has(e.name)) walk(p, 1);
    else if (e.isFile() && OWN_FILE.test(e.name)) tighten(p, FILE_MODE);
    else if (!e.isSymbolicLink()) foreign++;
  }
  // The folder itself only when it's Inroad's alone.
  if (!foreign) tighten(dir, DIR_MODE);
  return { changed, foreign };
}
