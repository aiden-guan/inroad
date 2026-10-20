import "server-only";
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { addDays, daysBetween, newId } from "@/lib/domain/ids";
import type { Confidence, Connection, Evidence, SourceType } from "@/lib/domain/types";
import { DATA_DIR } from "@/lib/store/settings";

/**
 * The per-run evidence ledger for the dossier and prep workflows. Claude may only cite what it
 * records here, and code checks every record: the URL was in the material we gave it (or in its
 * own search results), the quote is really on that page, the date isn't in the future.
 */

/* ─────────────────────────────── Text matching ─────────────────────────────── */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/[^\p{L}\p{N}$%&']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prepared corpus for repeated lookups. */
export function corpus(text: string): string {
  return ` ${normalize(text)} `;
}

/**
 * Is `quote` really in `haystack` (a `corpus()`)? Case, whitespace, punctuation and quote marks
 * are ignored; long quotes need ≥85% of their 5-word shingles present, so a fixed typo passes but
 * a paraphrase doesn't.
 */
export function quoteIn(quote: string, haystack: string): boolean {
  const words = normalize(quote).split(" ").filter(Boolean);
  if (!words.length) return false;
  if (words.length < 6) return haystack.includes(` ${words.join(" ")} `);
  let hits = 0;
  const total = words.length - 4;
  for (let i = 0; i < total; i++) if (haystack.includes(` ${words.slice(i, i + 5).join(" ")} `)) hits++;
  return hits / total >= 0.85;
}

export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** `YYYY-MM-DD` or undefined. Rejects garbage; callers decide what to do with future dates. */
export function cleanDate(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : `${m[1]}-${m[2]}-${m[3]}`;
}

/* ─────────────────────────────── The ledger ─────────────────────────────── */

export interface LedgerSource {
  url: string;
  /** Exactly the text Claude was shown for this URL. */
  text: string;
  sourceType: SourceType;
  publishedAt?: string;
  /** The most this text can support, below the source type's own cap (e.g. a job title with no description). */
  maxConfidence?: Confidence;
}

export interface EvidenceInput {
  claim: string;
  quote: string;
  url: string;
  sourceType: SourceType;
  publishedAt: string | null;
  confidence: Confidence;
}

export interface LedgerEntry extends Omit<Evidence, "id" | "retrievedAt" | "runId"> {
  localId: string;
  check: "matched" | "snippet" | "existing";
}

const LEVELS: Confidence[] = ["low", "medium", "high"];
const cap = (c: Confidence, max: Confidence): Confidence => (LEVELS.indexOf(c) > LEVELS.indexOf(max) ? max : c);
const drop = (c: Confidence): Confidence => LEVELS[Math.max(0, LEVELS.indexOf(c) - 1)];
/** Two texts for one URL: the looser cap wins, and no cap if either has none. */
const looser = (a?: Confidence, b?: Confidence): Confidence | undefined => (a && b ? (LEVELS.indexOf(a) > LEVELS.indexOf(b) ? a : b) : undefined);

/** The most a source type can support (SPEC confidence rubric). */
const MAX_CONFIDENCE: Record<SourceType, Confidence> = {
  first_party: "high",
  filing: "high",
  job_post: "high",
  press: "medium",
  podcast: "medium",
  community: "low",
  search_snippet: "low",
  user_input: "high",
  integration: "medium",
};

export class Ledger {
  readonly entries: LedgerEntry[] = [];
  private sources = new Map<string, LedgerSource & { haystack: string }>();
  private all: string;
  private existing = new Map<string, Evidence>();

  constructor(
    sources: LedgerSource[],
    private readonly opts: { today: string; allowSnippets: boolean; prefix?: string; max?: number; existing?: Evidence[] },
  ) {
    for (const s of sources) {
      const key = normUrl(s.url);
      const prev = this.sources.get(key);
      // The same URL can appear twice (a page and a news line); keep all its text.
      const text = prev ? `${prev.text}\n${s.text}` : s.text;
      const maxConfidence = prev ? looser(prev.maxConfidence, s.maxConfidence) : s.maxConfidence;
      this.sources.set(key, { ...s, publishedAt: s.publishedAt ?? prev?.publishedAt, maxConfidence, text, haystack: corpus(text) });
    }
    this.all = corpus(sources.map((s) => s.text).join("\n"));
    // Evidence already on file can be cited by its real id.
    for (const e of opts.existing ?? []) if (!e.flaggedWrong) this.existing.set(e.id, e);
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.localId === id) || this.existing.has(id);
  }

  get(id: string): LedgerEntry | Evidence | undefined {
    return this.entries.find((e) => e.localId === id) ?? this.existing.get(id);
  }

  /** Records one piece of evidence and returns its id, or throws with a message Claude can act on. */
  record(input: EvidenceInput): string {
    const url = input.url.trim();
    const key = normUrl(url);
    const source = this.sources.get(key);
    const host = hostOf(url);
    const claim = input.claim.trim().slice(0, 200);
    const quote = input.quote.trim().replace(/^["“]|["”]$/g, "").slice(0, 300);

    const dupe = this.entries.find((e) => normUrl(e.url) === key && e.claim.toLowerCase() === claim.toLowerCase());
    if (dupe) return dupe.localId;
    if ((this.opts.max ?? 40) <= this.entries.length) throw new Error("Evidence limit reached. Submit with what you have.");

    let publishedAt = cleanDate(input.publishedAt) ?? source?.publishedAt?.slice(0, 10);
    if (publishedAt && publishedAt > this.opts.today) throw new Error(`publishedAt ${publishedAt} is in the future. Use the date shown on the source, or null.`);

    let sourceType: SourceType;
    let check: LedgerEntry["check"];
    if (source) {
      if (!quoteIn(quote, source.haystack)) {
        const elsewhere = quoteIn(quote, this.all);
        throw new Error(
          elsewhere
            ? `That quote isn't in the text for ${url}. Use the URL of the section the quote comes from.`
            : `Quote not found in the text for ${url}. Copy a verbatim span (no paraphrase), or drop this evidence.`,
        );
      }
      sourceType = source.sourceType;
      check = "matched";
    } else if (this.opts.allowSnippets && /^https?:\/\//.test(url)) {
      // Only search results can be cited outside the digest. Verified against the run's search
      // results after it ends; unverifiable snippets are dropped then.
      sourceType = "search_snippet";
      check = "snippet";
    } else {
      throw new Error(`${url} is not in the material you were given. Cite only URLs that appear in it.`);
    }

    let confidence = cap(input.confidence, MAX_CONFIDENCE[sourceType]);
    if (source?.maxConfidence) confidence = cap(confidence, source.maxConfidence);
    if (publishedAt && daysBetween(publishedAt, this.opts.today) > 365) confidence = drop(confidence);
    if (!publishedAt && sourceType === "press") publishedAt = undefined;

    const localId = `${this.opts.prefix ?? "e"}${this.entries.length + 1}`;
    this.entries.push({ localId, claim, quote, url, host, sourceType, publishedAt, confidence, check });
    return localId;
  }

  /** Drops snippet evidence whose URL never appeared in this run's search results. Returns dropped ids. */
  verifySnippets(searchUrls: Set<string>): Set<string> {
    const dropped = new Set<string>();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.check === "snippet" && !searchUrls.has(normUrl(e.url))) {
        dropped.add(e.localId);
        this.entries.splice(i, 1);
      }
    }
    return dropped;
  }

  /** Persists recorded entries as workspace evidence. Returns local id → real id. */
  commit(evidence: Record<string, Evidence>, runId: string, at: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const id of this.existing.keys()) map.set(id, id);
    for (const e of this.entries) {
      // Same URL + claim already on file → reuse it instead of duplicating.
      const prior = Object.values(evidence).find((x) => !x.flaggedWrong && normUrl(x.url) === normUrl(e.url) && x.claim.toLowerCase() === e.claim.toLowerCase());
      if (prior) {
        map.set(e.localId, prior.id);
        continue;
      }
      const id = newId("ev");
      evidence[id] = {
        id,
        claim: e.claim,
        quote: e.quote,
        url: e.url,
        host: e.host,
        sourceType: e.sourceType,
        publishedAt: e.publishedAt,
        retrievedAt: at,
        confidence: e.confidence,
        runId,
      };
      map.set(e.localId, id);
    }
    return map;
  }
}

/* ─────────────────────────────── Run helpers ─────────────────────────────── */

/** Every URL the model saw in web search / web fetch results during a run. */
export function seenWebUrls(messages: Anthropic.Beta.BetaMessageParam[]): Set<string> {
  const urls = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result") urls.add(normUrl(r.url));
      } else if (block.type === "web_fetch_tool_result") {
        const c = block.content as { type?: string; url?: string };
        if (c?.type === "web_fetch_result" && c.url) urls.add(normUrl(c.url));
      }
    }
  }
  return urls;
}

/**
 * A zod refinement that fails only on the first attempt. Claude gets one chance to fix bad
 * references; after that code repairs the result (drops what doesn't resolve) instead of looping.
 */
export function firstAttemptOnly<T>(check: (value: T) => string[]): (value: T, ctx: z.RefinementCtx) => void {
  let attempts = 0;
  return (value, ctx) => {
    const problems = check(value);
    if (!problems.length) return;
    if (attempts++ > 0) return;
    ctx.addIssue({ code: "custom", message: problems.slice(0, 6).join("; ") });
  };
}

/** Founder's LinkedIn connections (written by the network import). Read-only; names never go to Claude. */
export function readConnections(): Connection[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "connections.json"), "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { connections?: unknown }).connections)
        ? (raw as { connections: unknown[] }).connections
        : raw && typeof raw === "object"
          ? Object.values(raw as Record<string, unknown>)
          : [];
    return list.filter((c): c is Connection => !!c && typeof c === "object" && typeof (c as Connection).firstName === "string");
  } catch {
    return [];
  }
}

export function staleAfter(today: string, days = 7): string {
  return addDays(today, days);
}
