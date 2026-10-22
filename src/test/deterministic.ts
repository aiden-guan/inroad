import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

/**
 * What a recorded tape needs to replay: the same ids and the same "today" as when it was recorded, so
 * the ids a response cites still exist. Use in a test file:
 *
 *   vi.mock("@/lib/domain/ids", async (actual) => (await import("@/test/deterministic")).deterministicIds(await actual()));
 *   beforeEach(() => freshRun());
 */

let n = 0;

export function deterministicIds<T extends object>(actual: T): T {
  return { ...actual, newId: (prefix: string) => `${prefix}_t${(++n).toString(36).padStart(8, "0")}` };
}

/** Same ids, same clock, empty signal caches (disk and in-memory): every test starts where its tape started. */
export function freshRun(now: Date) {
  n = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  fs.rmSync(path.join(process.env.GTM_DATA_DIR!, "cache"), { recursive: true, force: true });
  const g = globalThis as Record<string, unknown>;
  for (const k of ["__inroadYc", "__inroadYcPending", "__gdeltNextSlot", "__inroadGates", "__inroadGithub"]) delete g[k];
}
