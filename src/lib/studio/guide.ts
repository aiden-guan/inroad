import type { StudioFormatId, StudioOccasion, Workspace } from "@/lib/domain/types";
import { AUDIENCES, FORMATS, OCCASIONS, type Limit } from "./formats";
import { STUDIO_TELLS_FOR_PROMPT, lintStudio } from "./lint";
import { movesFor } from "./moves";
import { audienceFor, competitorsFor, formatBlocked, neverSayFor, receiptsFor, sourcedText, studioAllowWords } from "./receipts";

/**
 * Studio for outside agents (MCP `get_copy_guide` and `check_copy`, REST /api/v1/copy/*). The calling
 * agent writes with its own model; Inroad hands it the same format specs, moves, receipts and lint
 * the Studio workflow uses, so copy written anywhere meets the same bar. Zero tokens on our side.
 */

function limitView(l: Limit) {
  return { min: l.min ?? null, max: l.max ?? null, unit: l.unit, kind: l.kind, verified: l.verified, source: l.source ?? null };
}

export function copyGuide(ws: Workspace, args: { format: StudioFormatId; occasion?: StudioOccasion }) {
  const spec = FORMATS[args.format];
  const audience = audienceFor(ws);
  const occasion = args.occasion && (spec.occasions ?? Object.keys(OCCASIONS)).includes(args.occasion) ? args.occasion : spec.defaultOccasion;
  const receipts = receiptsFor(ws);
  const moves = movesFor({ format: spec.id, audience, occasion, receipts, competitors: competitorsFor(ws).length, bold: false });
  return {
    format: {
      id: spec.id,
      label: spec.label,
      reader_situation: spec.reading,
      parts: spec.parts.map((p) => ({
        key: p.key,
        label: p.label,
        hint: p.hint,
        optional: !!p.optional,
        prefix: p.prefix ?? null,
        list: p.list ? { split: p.list.split === "posts" ? "a line holding only ---" : "one per line", min: p.list.min, max: p.list.max } : null,
        limits: p.limits.map(limitView),
      })),
      total_limit: spec.total ? limitView(spec.total) : null,
      rules: spec.rules,
      options_to_write: spec.options,
    },
    occasion: { id: occasion, guide: OCCASIONS[occasion].guide },
    audience: { id: audience, label: AUDIENCES[audience].label, reader: ws.studio.profile?.reader || AUDIENCES[audience].reader },
    product_name: ws.studio.profile?.productName || ws.company?.name || null,
    moves: moves
      .filter((m) => !m.missing)
      .map(({ move }) => ({
        id: move.id,
        name: move.name,
        how: move.how,
        examples: move.examples.map((e) => ({ text: e.text, who: e.who, when: e.when, source: e.source })),
        evidence: move.evidence,
        backfires: move.backfires,
      })),
    moves_unavailable: moves.filter((m) => m.missing).map((m) => ({ id: m.move.id, needs: m.missing })),
    receipts: receipts.map((r) => ({ id: r.id, label: r.label, text: r.text, source: r.source ?? null, fact: r.fact, nameable: r.nameable })),
    never_say: neverSayFor(ws),
    fails: STUDIO_TELLS_FOR_PROMPT,
    rules: [
      "Every specific (number, customer, quote, ranking, price, “first”, “only”, “fastest”) must come from a receipt. Write [[what's missing]] instead of guessing.",
      "Name a customer only when its receipt is nameable. Receipts that aren't facts are beliefs: say them as the founder's view.",
      "Write each option with a different move. Learn the pattern from the examples; never copy their words.",
      "Run check_copy on every option before showing it. Fix every error.",
    ],
    blocked: formatBlocked(ws, spec.id),
    approval: "Inroad never publishes. The founder reviews and posts everything themselves.",
  };
}

export function checkCopy(ws: Workspace, args: { format: StudioFormatId; parts: Record<string, string> }) {
  const spec = FORMATS[args.format];
  const unknown = Object.keys(args.parts).filter((k) => !spec.parts.some((p) => p.key === k));
  const lint = lintStudio({
    format: spec.id,
    parts: args.parts,
    audience: audienceFor(ws),
    sourced: sourcedText(receiptsFor(ws)),
    allowWords: studioAllowWords(ws),
    competitors: competitorsFor(ws),
    neverSay: neverSayFor(ws),
  });
  return {
    passed: lint.passed,
    errors: lint.violations.filter((v) => v.severity === "error").map((v) => ({ code: v.code, part: v.part, detail: v.detail })),
    warnings: lint.violations.filter((v) => v.severity === "warn").map((v) => ({ code: v.code, part: v.part, detail: v.detail })),
    stats: lint.stats,
    ...(unknown.length ? { unknown_parts: unknown, expected_parts: spec.parts.map((p) => p.key) } : {}),
  };
}
