import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DATA_DIR } from "@/lib/store/settings";
import type { ReferenceEmail } from "./references";

/**
 * Permissioned reference emails for the critic (SPEC §4.0: human emails that got replies, matched by frame), when
 * someone puts them in `references.json` in the data folder. They replace the bundled set, which only models the
 * patterns. Read once per file change; a malformed file is ignored with a warning, never a failed draft.
 */

const FRAMES = ["founder_card", "4t", "problem_prompter", "mouse_trap", "observation_problem_proof", "referral", "permission_to_close"] as const;
const File = z.array(
  z.object({
    id: z.string().min(1).max(60),
    frames: z.array(z.enum(FRAMES)).min(1),
    step: z.number().int().min(1).max(3),
    subject: z.string().max(120).nullable(),
    body: z.string().min(20).max(2000),
  }),
);

let cache: { mtimeMs: number; refs: ReferenceEmail[] | undefined } | null = null;

export function localReferences(): ReferenceEmail[] | undefined {
  const file = path.join(DATA_DIR, "references.json");
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  if (cache?.mtimeMs === mtimeMs) return cache.refs;
  let refs: ReferenceEmail[] | undefined;
  try {
    const parsed = File.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    refs = parsed.length ? parsed : undefined;
  } catch (err) {
    console.warn("[references] references.json ignored:", err instanceof Error ? err.message : err);
  }
  cache = { mtimeMs, refs };
  return refs;
}
