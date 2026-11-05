import "server-only";
import path from "node:path";
import { readDataFile, writeFileAtomic } from "./data-file";
import { DATA_DIR } from "./settings";

/**
 * A tiny JSON-file database for a single-user, local app.
 * - Atomic, owner-only writes (temp file, then rename) so a crash never corrupts data.
 * - Serialized mutations so concurrent agent runs can't clobber each other.
 * - Cheap saves: compact JSON (no indentation to build or write), and each update's draft is parsed from the text the
 *   last save wrote instead of deep-cloning the cache. The cached state is never mutated in place, so a reader still
 *   holding it keeps a consistent snapshot, and an update that throws leaves both the file and the cache as they were.
 */
export class FileDB<T> {
  private file: string;
  private cache: T | null = null;
  /** `cache` as compact JSON: what the file holds once anything was saved. Null until first needed after a read. */
  private text: string | null = null;
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
    this.text = null;
    return this.cache;
  }

  /** The current state as compact JSON, serialized once per change (not per call): send it as is. */
  json(): string {
    const state = this.read();
    this.text ??= JSON.stringify(state);
    return this.text;
  }

  /** Applies `fn` to a draft copy and persists the result. Mutations run one at a time. */
  update<R>(fn: (draft: T) => R): Promise<{ state: T; value: R; json: string }> {
    const next = this.queue.then(() => {
      // A deep copy by parsing the last saved text: cheaper than structuredClone, and JSON is all the file can hold.
      const draft = JSON.parse(this.json()) as T;
      const value = fn(draft);
      return { state: draft, value, json: this.write(draft) };
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  replace(state: T): Promise<T> {
    const next = this.queue.then(() => {
      // Like update, refuses (and keeps a copy) when the file on disk can't be read. No draft is needed: every
      // top-level key is replaced.
      this.read();
      const fresh = { ...state };
      this.write(fresh);
      return fresh;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private write(state: T): string {
    const text = JSON.stringify(state);
    writeFileAtomic(this.file, text);
    this.cache = state;
    this.text = text;
    return text;
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
