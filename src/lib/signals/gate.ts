import "server-only";

/**
 * Polite request spacing per public API, shared across route bundles (the slots live on globalThis,
 * like GDELT's in news.ts). Each call takes the next free slot and waits for it, so concurrent
 * research never bursts past what a source's usage policy allows.
 */
export const GAPS = {
  /** SEC EDGAR fair access: at most 10 requests a second. 8 leaves room for the founder's own browsing. */
  sec: 125,
  /** iTunes Search: about 20 calls a minute. */
  itunes: 3100,
  /** Algolia's HN API allows 10,000 an hour; a small gap keeps bursts gentle. */
  hn: 250,
  /** GitHub's limit is hourly (see github.ts); this only smooths bursts. */
  github: 200,
} as const;

type GateKey = keyof typeof GAPS;

function slots(): Partial<Record<GateKey, number>> {
  const g = globalThis as unknown as { __inroadGates?: Partial<Record<GateKey, number>> };
  g.__inroadGates ??= {};
  return g.__inroadGates;
}

export async function politeGate(key: GateKey): Promise<void> {
  const s = slots();
  // A monotonic clock: a wall-clock jump (or a test's frozen Date) never stalls the queue.
  const now = performance.now();
  const next = s[key] ?? 0;
  const wait = Math.max(0, next - now);
  s[key] = Math.max(now, next) + GAPS[key];
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/** Tests start each case with every gate open. */
export function resetGates() {
  (globalThis as unknown as { __inroadGates?: unknown }).__inroadGates = {};
}
