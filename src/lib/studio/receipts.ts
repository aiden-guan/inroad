import type { StudioAudience, StudioFormatId, StudioOption, StudioPiece, Workspace } from "@/lib/domain/types";
import { allowWordsFor } from "@/lib/quality/context";
import { FORMATS } from "./formats";
import { lintStudio } from "./lint";

/**
 * Receipts: everything copy may state as a specific. Code gathers them from the workspace, the
 * writer cites them by id, and lint checks every number and superlative against their text.
 * Nothing here is generated; a receipt is something the founder approved, wrote or said.
 */

export type ReceiptKind = "material" | "claim" | "pov" | "customer_words" | "theme" | "objection" | "company" | "alternative";

export interface Receipt {
  id: string;
  kind: ReceiptKind;
  /** Short label for chips: "Metric", "Your story", "Customer words". */
  label: string;
  text: string;
  /** Where it comes from (a URL, "Stripe dashboard, Sept 2026"), when known. */
  source?: string;
  /** May copy state it as a fact? (A value theme that still needs proof may not.) */
  fact: boolean;
  /** May the customer or person in it be named in public copy? */
  nameable: boolean;
}

/** Stable short hash for receipts that have no id of their own (customer phrases). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const MATERIAL_LABEL: Record<Workspace["studio"]["material"][number]["kind"], string> = {
  story: "Your story",
  number: "Your number",
  quote: "User quote",
  demo: "Demo moment",
  fact: "Fact",
  belief: "Your belief",
  enemy: "The old way",
  limit: "What it can't do yet",
};

const CLAIM_LABEL: Record<Workspace["claims"][number]["kind"], string> = {
  metric: "Metric",
  customer: "Customer",
  logo: "Logo",
  credential: "Credential",
  capability: "Capability",
  security: "Security",
};

export function receiptsFor(ws: Workspace): Receipt[] {
  const out: Receipt[] = [];
  const c = ws.company;
  if (c?.plainOneLiner) out.push({ id: "co_what", kind: "company", label: "What you do", text: c.plainOneLiner, fact: true, nameable: true });
  if (c?.howYouCharge.summary) out.push({ id: "co_price", kind: "company", label: "Pricing", text: c.howYouCharge.summary, fact: true, nameable: true });
  for (const m of ws.studio?.material ?? []) {
    out.push({ id: m.id, kind: "material", label: MATERIAL_LABEL[m.kind], text: m.text, source: m.source, fact: m.kind !== "belief" && m.kind !== "enemy", nameable: m.permission !== "anonymized_only" });
  }
  for (const cl of ws.claims) {
    if (!cl.approved) continue;
    out.push({ id: cl.id, kind: "claim", label: CLAIM_LABEL[cl.kind], text: cl.text, fact: true, nameable: cl.permission === "public" });
  }
  for (const p of ws.povs) out.push({ id: p.id, kind: "pov", label: "Your point of view", text: p.text, source: p.evidence, fact: false, nameable: true });
  const f = ws.foundation;
  if (f) {
    for (const w of f.messaging.customerWords) out.push({ id: `cw_${hash(w.phrase)}`, kind: "customer_words", label: "Customer words", text: w.phrase, source: w.source, fact: false, nameable: false });
    for (const a of f.positioning.alternatives) {
      out.push({ id: `alt_${hash(a.name)}`, kind: "alternative", label: "What they use today", text: `${a.name}${a.whyChosenToday ? `: ${a.whyChosenToday}` : ""}`, fact: false, nameable: a.kind === "competitor" });
    }
    for (const t of f.positioning.valueThemes) {
      out.push({ id: t.id, kind: "theme", label: t.needsProof ? "Value theme (unproven)" : "Value theme", text: `${t.theme}: ${t.outcome}`, fact: !t.needsProof, nameable: true });
    }
  }
  for (const o of ws.objections) if (o.approved) out.push({ id: o.id, kind: "objection", label: "Objection answer", text: `${o.objection} → ${o.response}`, fact: true, nameable: true });
  return out;
}

/**
 * Text numbers and superlatives may come from: every receipt and its source, except value themes
 * that still need proof (an outcome being validated is not yet a fact). Matches the outreach lint,
 * which also accepts the founder's points of view and their basis.
 */
export function sourcedText(receipts: Receipt[]): string {
  return receipts
    .filter((r) => r.fact || r.kind !== "theme")
    .flatMap((r) => [r.text, r.source ?? ""])
    .filter(Boolean)
    .join("\n");
}

/** Customer proof a case study can be written from. */
export function hasCustomerProof(ws: Workspace): boolean {
  return ws.claims.some((c) => c.approved && (c.kind === "customer" || c.kind === "metric")) || (ws.studio?.material ?? []).some((m) => m.kind === "story" || m.kind === "quote");
}

/** Competitor names from the playbook: comparative claims about them need substantiation. */
export function competitorsFor(ws: Workspace): string[] {
  const names = [...(ws.foundation?.competitors ?? []).map((c) => c.name), ...(ws.foundation?.positioning.alternatives ?? []).filter((a) => a.kind === "competitor").map((a) => a.name)];
  return [...new Set(names.filter((n) => n && n.length > 1))];
}

/** The founder's vocabulary: exempt from word lists and counted as concrete. */
export function studioAllowWords(ws: Workspace): string[] {
  const name = ws.studio?.profile?.productName || ws.company?.name;
  return [...new Set([...allowWordsFor(ws), ...(name ? [name] : []), ...(ws.foundation?.messaging.customerWords ?? []).map((w) => w.phrase)])];
}

export function neverSayFor(ws: Workspace): string[] {
  return [...new Set([...(ws.studio?.profile?.neverSay ?? []), ...(ws.foundation?.messaging.bannedWords ?? [])].map((w) => w.trim()).filter(Boolean))];
}

export function audienceFor(ws: Workspace): StudioAudience {
  return ws.studio?.profile?.audience ?? "b2b";
}

/** Lints one option exactly as the workflow does, with optional live edits. Used by the workflow, the editor and actions. */
export function lintOption(ws: Workspace, piece: Pick<StudioPiece, "format" | "audience" | "options">, option: Pick<StudioOption, "id" | "parts">, parts?: Record<string, string>) {
  const receipts = receiptsFor(ws);
  return lintStudio({
    format: piece.format,
    parts: parts ?? option.parts,
    audience: piece.audience,
    sourced: sourcedText(receipts),
    allowWords: studioAllowWords(ws),
    competitors: competitorsFor(ws),
    neverSay: neverSayFor(ws),
    siblings: piece.options.filter((o) => o.id !== option.id).map((o) => o.parts),
  });
}

/** True when the format can be written from what the workspace holds. Returns the reason when not. */
export function formatBlocked(ws: Workspace, format: StudioFormatId): string | null {
  if (FORMATS[format].needs === "customer_proof" && !hasCustomerProof(ws)) {
    return "A customer story needs a real result: approve a customer or metric claim in Playbook, or add a user's story or quote to your material.";
  }
  return null;
}
