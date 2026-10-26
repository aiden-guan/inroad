import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ActionError } from "@/lib/domain/actions";
import { newId, nowISO } from "@/lib/domain/ids";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import type { ModelTier } from "@/lib/ai/models";
import type { AgentCall, AgentClient, ApiKeyPublic, KeyEffort, Scope } from "./types";

/**
 * `.data/keys.json`: agent keys (hashed, never the token), the per-key call log, and the
 * idempotency ledger for pushed activity. Belongs to this machine, like secrets.json.
 */

interface StoredKey extends ApiKeyPublic {
  hash: string;
}

interface KeysFile {
  keys: StoredKey[];
  /** Newest first. */
  calls: AgentCall[];
  /** `${keyId}:${source}:${externalId}` → our record id. */
  seen: Record<string, string>;
}

const LIMITS = { calls: 600, seen: 10_000, keys: 50 } as const;

const db = () => singletonDB<KeysFile>("keys.json", () => new FileDB<KeysFile>("keys.json", () => ({ keys: [], calls: [], seen: {} }), (raw) => ({ keys: [], calls: [], seen: {}, ...(raw as Partial<KeysFile>) })));

async function mutate<R>(fn: (f: KeysFile) => R): Promise<R> {
  const { value } = await db().update((draft) => {
    const value = fn(draft);
    draft.calls = draft.calls.slice(0, LIMITS.calls);
    const keys = Object.keys(draft.seen);
    if (keys.length > LIMITS.seen) for (const k of keys.slice(0, keys.length - LIMITS.seen)) delete draft.seen[k];
    return value;
  });
  return value;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type ApiKey = StoredKey;

function toPublic(k: StoredKey): ApiKeyPublic {
  const { hash: _hash, ...rest } = k;
  void _hash;
  return rest;
}

export function listKeys(): { keys: ApiKeyPublic[]; calls: AgentCall[] } {
  const f = db().read();
  return { keys: f.keys.filter((k) => !k.revokedAt).map(toPublic), calls: f.calls.slice(0, 200) };
}

export async function createKey(input: { name: string; client: AgentClient; scopes: Scope[]; model?: ModelTier; effort?: KeyEffort }): Promise<{ key: ApiKeyPublic; token: string }> {
  const token = `inr_${randomBytes(24).toString("base64url")}`;
  const key: StoredKey = {
    id: newId("key"),
    name: input.name.trim().slice(0, 40) || "Agent",
    client: input.client,
    scopes: [...new Set<Scope>(["read", ...input.scopes])],
    preview: `${token.slice(0, 8)}…${token.slice(-4)}`,
    createdAt: nowISO(),
    calls: 0,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    hash: sha256(token),
  };
  await mutate((f) => {
    if (f.keys.filter((k) => !k.revokedAt).length >= LIMITS.keys) throw new ActionError("You have 50 active agent keys. Revoke some first.");
    f.keys.push(key);
  });
  return { key: toPublic(key), token };
}

/** Changes the model and effort a key's asks run on. Takes effect from its next call. */
export async function updateKey(id: string, patch: { model?: ModelTier; effort?: KeyEffort }): Promise<ApiKeyPublic | null> {
  return mutate((f) => {
    const k = f.keys.find((x) => x.id === id && !x.revokedAt);
    if (!k) return null;
    if (patch.model) k.model = patch.model;
    if (patch.effort) k.effort = patch.effort;
    return toPublic(k);
  });
}

export async function revokeKey(id: string): Promise<boolean> {
  return mutate((f) => {
    const k = f.keys.find((x) => x.id === id && !x.revokedAt);
    if (!k) return false;
    k.revokedAt = nowISO();
    return true;
  });
}

/** Constant-time lookup of an active key by its token. */
export function verifyToken(token: string | null | undefined): ApiKey | null {
  if (!token || !/^inr_[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const given = Buffer.from(sha256(token), "hex");
  let found: StoredKey | null = null;
  for (const k of db().read().keys) {
    const stored = Buffer.from(k.hash, "hex");
    if (stored.length === given.length && timingSafeEqual(stored, given) && !k.revokedAt) found = k;
  }
  return found;
}

/** Records a call in the key's feed and bumps its usage. Fire and forget from the caller's view. */
export async function logCall(keyId: string, entry: Omit<AgentCall, "id" | "keyId" | "at">): Promise<void> {
  const at = nowISO();
  await mutate((f) => {
    const k = f.keys.find((x) => x.id === keyId);
    if (!k) return;
    k.lastUsedAt = at;
    k.calls += 1;
    f.calls.unshift({ id: newId("call"), keyId, at, ...entry, summary: entry.summary.slice(0, 160) });
  });
}

/** First-contact bookkeeping from MCP initialize: which client is on the other end. */
export async function noteClient(keyId: string, client: string): Promise<void> {
  const label = client.replace(/[^\w .@/-]+/g, "").slice(0, 60);
  await mutate((f) => {
    const k = f.keys.find((x) => x.id === keyId);
    if (!k) return;
    const changed = k.lastClient !== label;
    k.lastClient = label;
    k.lastUsedAt = nowISO();
    if (changed && label) f.calls.unshift({ id: newId("call"), keyId, at: k.lastUsedAt, tool: "initialize", via: "mcp", ok: true, summary: `Connected from ${label}` });
  });
}

export function seenRecord(key: string): string | undefined {
  return db().read().seen[key];
}

export async function markSeen(entries: Record<string, string>): Promise<void> {
  if (!Object.keys(entries).length) return;
  await mutate((f) => {
    Object.assign(f.seen, entries);
  });
}

/* ───────────── Rate limits (per key, in memory) ───────────── */

const WINDOW_MS = 60_000;
const CALLS_PER_MINUTE = 120;
const RECORDS_PER_HOUR = 2_000;

const buckets = (() => {
  const g = globalThis as unknown as { __inroadKeyBuckets?: Map<string, { calls: number[]; records: { at: number; n: number }[] }> };
  g.__inroadKeyBuckets ??= new Map();
  return g.__inroadKeyBuckets;
})();

/** Returns seconds to wait, or 0 when the call may proceed. */
export function rateLimit(keyId: string, now = Date.now()): number {
  const b = buckets.get(keyId) ?? { calls: [], records: [] };
  b.calls = b.calls.filter((t) => now - t < WINDOW_MS);
  if (b.calls.length >= CALLS_PER_MINUTE) {
    buckets.set(keyId, b);
    return Math.max(1, Math.ceil((WINDOW_MS - (now - b.calls[0])) / 1000));
  }
  b.calls.push(now);
  buckets.set(keyId, b);
  return 0;
}

const ASKS_PER_HOUR = 30;
const asks = (() => {
  const g = globalThis as unknown as { __inroadKeyAsks?: Map<string, number[]> };
  g.__inroadKeyAsks ??= new Map();
  return g.__inroadKeyAsks;
})();

/** ask_inroad spends the founder's tokens, so a looping agent gets a much tighter cap than plain reads. */
export function askBudget(keyId: string, now = Date.now()): { ok: boolean; retryInMin: number } {
  const recent = (asks.get(keyId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= ASKS_PER_HOUR) {
    asks.set(keyId, recent);
    return { ok: false, retryInMin: Math.max(1, Math.ceil((3_600_000 - (now - recent[0])) / 60_000)) };
  }
  recent.push(now);
  asks.set(keyId, recent);
  return { ok: true, retryInMin: 0 };
}

/** Records written in the last hour; writes past the cap are refused so a loop can't flood the workspace. */
export function recordBudget(keyId: string, want: number, now = Date.now()): { ok: boolean; left: number } {
  const b = buckets.get(keyId) ?? { calls: [], records: [] };
  b.records = b.records.filter((r) => now - r.at < 3_600_000);
  const used = b.records.reduce((n, r) => n + r.n, 0);
  const left = Math.max(0, RECORDS_PER_HOUR - used);
  if (want > left) {
    buckets.set(keyId, b);
    return { ok: false, left };
  }
  b.records.push({ at: now, n: want });
  buckets.set(keyId, b);
  return { ok: true, left: left - want };
}
