import "server-only";
import fs from "node:fs";
import path from "node:path";

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
    if (!fs.existsSync(copy)) fs.copyFileSync(file, copy);
    return copy;
  } catch {
    return null;
  }
}

/** Atomic write (temp file, then rename), so a crash mid-write never leaves a half-written file. */
export function writeDataFile(file: string, value: unknown, mode?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), mode === undefined ? undefined : { mode });
  fs.renameSync(tmp, file);
}
