import "server-only";
import path from "node:path";
import { readDataFile, writeFileAtomic } from "./data-file";
import { DATA_DIR } from "./settings";

/**
 * A tiny JSON-file database for a single-user, local app.
 * - Atomic, owner-only writes (temp file, then rename) so a crash never corrupts data.
 * - Serialized mutations so concurrent agent runs can't clobber each other.
 */
export class FileDB<T> {
  private file: string;
  private cache: T | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    name: string,
    private readonly initial: () => T,
    private readonly migrate: (raw: unknown) => T = (raw) => raw as T,
  ) {
    this.file = path.join(DATA_DIR, name);
  }

  /**
   * Throws (and caches nothing) when the file exists but can't be read or parsed, so `update()`
   * rejects instead of writing an empty state over it.
   */
  read(): T {
    if (this.cache) return this.cache;
    this.cache = readDataFile(this.file, this.initial, this.migrate);
    return this.cache;
  }

  /** Applies `fn` to a draft copy and persists the result. Mutations run one at a time. */
  update<R>(fn: (draft: T) => R): Promise<{ state: T; value: R }> {
    const next = this.queue.then(() => {
      const draft = structuredClone(this.read());
      const value = fn(draft);
      this.write(draft);
      return { state: draft, value };
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  replace(state: T): Promise<T> {
    return this.update((draft) => {
      Object.assign(draft as object, state);
      for (const key of Object.keys(draft as object)) {
        if (!(key in (state as object))) delete (draft as Record<string, unknown>)[key];
      }
    }).then((r) => r.state);
  }

  private write(state: T) {
    writeFileAtomic(this.file, JSON.stringify(state, null, 2));
    this.cache = state;
  }
}

/**
 * One FileDB per file per process. Route handlers can be bundled separately in dev,
 * so module-level singletons aren't enough; pin the instance to globalThis.
 */
export function singletonDB<T>(name: string, create: () => FileDB<T>): FileDB<T> {
  const g = globalThis as unknown as { __fileDBs?: Map<string, FileDB<unknown>> };
  g.__fileDBs ??= new Map();
  let db = g.__fileDBs.get(name) as FileDB<T> | undefined;
  if (!db) {
    db = create();
    g.__fileDBs.set(name, db as FileDB<unknown>);
  }
  return db;
}
