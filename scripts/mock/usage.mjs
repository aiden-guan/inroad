/**
 * Token counts and prompt caching, simulated closely enough that receipts, the monthly budget and the
 * caching claims can be checked offline. Counts are ~4 characters a token. The cache follows the
 * documented rules: render order tools → system → messages, explicit block markers plus top-level
 * automatic caching, a 20-block lookback from each breakpoint, a minimum cacheable prefix, 5-minute and
 * 1-hour TTLs that a read refreshes, and one namespace per model.
 */
import crypto from "node:crypto";

export const MIN_CACHEABLE_TOKENS = 1024;
const LOOKBACK = 20;
const TTL_MS = { "5m": 5 * 60_000, "1h": 60 * 60_000 };

/** hash of a prompt prefix → when its cache entry expires (ms since epoch) and its TTL */
const store = new Map();

export function resetCache() {
  store.clear();
}

export function tokensOf(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(text.length / 4));
}

function withoutMarker(block) {
  if (!block || typeof block !== "object") return block;
  const rest = { ...block };
  delete rest.cache_control;
  return rest;
}

/** What a content block costs as input. Text is its text; everything else its JSON. */
function blockTokens(block) {
  if (typeof block === "string") return tokensOf(block);
  if (block.type === "text") return tokensOf(block.text ?? "");
  if (block.type === "thinking") return tokensOf(block.thinking ?? "");
  if (block.type === "tool_result") return tokensOf(block.content ?? "") + 4;
  return tokensOf(withoutMarker(block));
}

export function systemBlocks(body) {
  if (!body.system) return [];
  return typeof body.system === "string" ? [{ type: "text", text: body.system }] : body.system;
}

export function messageBlocks(message) {
  return typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content ?? []);
}

/** The prompt as cacheable segments, in render order, each with its own marker (if any). */
export function segments(body) {
  const out = [];
  for (const tool of body.tools ?? []) out.push({ key: `tool:${JSON.stringify(withoutMarker(tool))}`, tokens: tokensOf(withoutMarker(tool)), marker: tool.cache_control });
  for (const block of systemBlocks(body)) out.push({ key: `system:${JSON.stringify(withoutMarker(block))}`, tokens: blockTokens(block), marker: block.cache_control });
  for (const m of body.messages ?? []) {
    for (const block of messageBlocks(m)) out.push({ key: `${m.role}:${JSON.stringify(withoutMarker(block))}`, tokens: blockTokens(block), marker: block.cache_control });
  }
  return out;
}

/** Breakpoints in render order: explicit markers, then the automatic one on the last block. */
export function breakpoints(body, segs = segments(body)) {
  const points = [];
  segs.forEach((s, index) => {
    if (s.marker) points.push({ index, ttl: s.marker.ttl ?? "5m", auto: false });
  });
  if (body.cache_control && segs.length) {
    const last = segs.length - 1;
    const ttl = body.cache_control.ttl ?? "5m";
    // An explicit marker on the last block with the same TTL makes automatic caching a no-op.
    if (!points.some((p) => p.index === last)) points.push({ index: last, ttl, auto: true });
  }
  return points;
}

/** Usage for one request's prompt, updating the simulated cache. */
export function promptUsage(body, now = Date.now()) {
  const segs = segments(body);
  const cum = [];
  const hashes = [];
  let running = 0;
  let h = crypto.createHash("sha1").update(String(body.model)).digest("hex");
  for (const s of segs) {
    running += s.tokens;
    h = crypto.createHash("sha1").update(h).update(s.key).digest("hex");
    cum.push(running);
    hashes.push(h);
  }
  const total = running;
  const points = breakpoints(body, segs).sort((a, b) => a.index - b.index);
  const alive = (hash) => (store.get(hash)?.until ?? 0) > now;

  let hit = -1;
  for (const p of points) {
    for (let j = p.index; j >= Math.max(0, p.index - LOOKBACK + 1); j--) {
      if (alive(hashes[j])) {
        hit = Math.max(hit, j);
        break;
      }
    }
  }
  const read = hit >= 0 ? cum[hit] : 0;
  if (hit >= 0) {
    // A read refreshes the entry's own TTL at no cost.
    const entry = store.get(hashes[hit]);
    store.set(hashes[hit], { ...entry, until: now + TTL_MS[entry.ttl] });
  }

  const creation = { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 };
  let covered = read;
  for (const p of points) {
    if (p.index <= hit || cum[p.index] < MIN_CACHEABLE_TOKENS) continue;
    const span = cum[p.index] - covered;
    if (span <= 0) continue;
    creation[p.ttl === "1h" ? "ephemeral_1h_input_tokens" : "ephemeral_5m_input_tokens"] += span;
    covered = cum[p.index];
    const ttl = p.ttl === "1h" ? "1h" : "5m";
    store.set(hashes[p.index], { until: now + TTL_MS[ttl], ttl });
  }
  const written = creation.ephemeral_5m_input_tokens + creation.ephemeral_1h_input_tokens;
  return {
    input_tokens: total - read - written,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: written,
    cache_creation: creation,
    promptTokens: total,
  };
}

/**
 * Reasoning tokens a turn spends before it writes anything visible. They count toward max_tokens and
 * output billing, like real adaptive thinking; the summary the stream shows is much shorter.
 */
export function hiddenThinkingTokens(effort, promptTokens) {
  const base = { low: 60, medium: 220, high: 600, xhigh: 1200, max: 2000 }[effort ?? "medium"] ?? 220;
  return base + Math.min(800, Math.round(promptTokens / 200));
}
