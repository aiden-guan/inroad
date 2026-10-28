import type { StudioFormatId, StudioOccasion, Workspace } from "@/lib/domain/types";
import { AUDIENCES, FORMATS, OCCASIONS, type Limit } from "./formats";
import { STUDIO_TELLS_FOR_PROMPT, lintStudio } from "./lint";
import { movesFor } from "./moves";
import { recommendedCampaigns } from "./campaigns";
import { audienceFor, competitorsFor, formatBlocked, neverSayFor, receiptsFor, sourcedText, studioAllowWords } from "./receipts";
import { checkDesign, sanitizeSvg } from "./svg";
import { DEFAULT_PALETTE, IMAGE_PROMPT_RULES, LAYOUTS, VISUAL_FORMATS, presetById, presetsFor } from "./visuals";

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
    campaign_inspiration: recommendedCampaigns({ format: spec.id, audience, occasion, moves }).map((campaign) => ({ id: campaign.id, brand: campaign.brand, title: campaign.title, approach: campaign.approach, adaptation: campaign.adaptation, source: campaign.source.url })),
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
      "Campaign inspiration is creative context, not product evidence. Never reuse another brand's results or claims as facts about this product.",
      "Run check_copy on every option before showing it. Fix every error.",
    ],
    blocked: formatBlocked(ws, spec.id),
    visual: visualGuide(ws, spec.id),
    approval: "Inroad never publishes. The founder reviews and posts everything themselves.",
  };
}

/** How to make the graphic for a format, for agents that design their own (then run check_graphic). Null for text-only formats. */
function visualGuide(ws: Workspace, format: StudioFormatId) {
  const presets = presetsFor(format);
  if (!presets.length) return null;
  return {
    sizes: presets.map((p) => ({ id: p.id, label: p.label, width: p.w, height: p.h, safe_zone: p.safe ?? null, note: p.note, source: p.source ?? null })),
    layouts: Object.entries(LAYOUTS).map(([id, l]) => ({ id, label: l.label, how: l.blurb, needs_image: l.needsImage ?? null })),
    brand_colors: ws.studio.profile?.colors?.length ? ws.studio.profile.colors : DEFAULT_PALETTE,
    rules: [
      "Every word on the graphic comes from the checked copy or a receipt, verbatim (split into lines at word boundaries). Neutral labels allowed: Before, After, Today, New, Now, Source, Old way, New way, With, Without, vs, Introducing, Launching, Coming soon, Out now.",
      "No invented numbers, charts, logos, reviews, star ratings or product UI. The product's UI only appears as a real screenshot the founder supplied.",
      "Text contrast at least 4.5:1 (3:1 for large text), nothing smaller than width/54 px, text inside the safe zone. In Meta ads, text under about 20% of the image.",
      "As SVG: exact width/height/viewBox; rect, circle, path, text, tspan, gradients and clipPath only; no <image>, <style>, <script>, CSS classes or external URLs. Mark where a picture goes with <rect data-slot=\"image\" …/>.",
      "Run check_graphic on the SVG with the copy it carries. Fix every error.",
    ],
    image_prompt_rules: IMAGE_PROMPT_RULES,
    disclosure: "If a picture layer is AI-generated, say so when posting: Meta and TikTok ask for disclosure of realistic AI imagery.",
  };
}

/** Sanitizes and checks a graphic (SVG) the way Studio checks its own designs: words, contrast, safe zones, type size. */
export function checkGraphic(ws: Workspace, args: { format: StudioFormatId; preset?: string; svg: string; parts: Record<string, string> }) {
  const allowed = VISUAL_FORMATS[args.format] ?? [];
  const preset = presetById(args.preset && allowed.includes(args.preset) ? args.preset : (allowed[0] ?? "linkedin"));
  const receipts = receiptsFor(ws);
  const productName = ws.studio.profile?.productName || ws.company?.name || "";
  const words = Object.values(args.parts).map((t) => t.trim()).filter(Boolean);
  const approved = [...words, ...receipts.filter((r) => r.fact).map((r) => r.text), ...receipts.flatMap((r) => (r.source ? [r.source] : [])), ...(productName ? [productName] : [])];
  const s = sanitizeSvg(args.svg, preset);
  const checks = checkDesign(s, { preset, approved, headline: words[0] ?? "", ad: args.format === "meta_ad" });
  return {
    passed: !checks.some((c) => c.severity === "error"),
    size: { preset: preset.id, width: preset.w, height: preset.h },
    errors: checks.filter((c) => c.severity === "error").map((c) => ({ code: c.code, detail: c.detail })),
    warnings: checks.filter((c) => c.severity === "warn").map((c) => ({ code: c.code, detail: c.detail })),
    image_slot: s.slot,
    removed: s.removed,
    note: "Code checks estimate positions from the SVG's own numbers. Render it and look before posting.",
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
