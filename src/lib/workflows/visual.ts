import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { taskHeader } from "@/lib/ai/prompts/core";
import { IMAGE_PROMPT_WRITER, VISUAL_DESIGN_RULES, VISUAL_REVIEW } from "@/lib/ai/prompts/studio";
import { newId, nowISO } from "@/lib/domain/ids";
import type { StudioImage, StudioOption, StudioPiece, StudioVisual, VisualLayout, Workspace } from "@/lib/domain/types";
import { removeStudioFile, saveStudioFile } from "@/lib/studio/files";
import { FORMATS } from "@/lib/studio/formats";
import { generateImage, imageModel } from "@/lib/studio/openai";
import { receiptsFor, type Receipt } from "@/lib/studio/receipts";
import { renderPng, thumbnail } from "@/lib/studio/render";
import { checkDesign, sanitizeSvg, type SanitizedSvg } from "@/lib/studio/svg";
import { DEFAULT_PALETTE, LAYOUTS, VISUAL_FORMATS, approvedStrings, aspectLabel, checkImagePrompt, presetById, visualDirection, type VisualPreset } from "@/lib/studio/visuals";
import { defineWorkflow, type WorkflowContext } from "./types";

/**
 * W14 — Studio visuals: graphics for an option, built around its approved words.
 *   (optional) Claude writes an image prompt → code checks it → OpenAI GPT Image paints the picture
 *   layer, or the founder pastes the prompt into ChatGPT and uploads the result
 *   → Claude (Opus) designs 1–3 graphics as SVG, looking at the image layer if there is one
 *   → code sanitizes and checks every design (approved words only, contrast, safe zones, type size)
 *   → resvg renders the PNG → Claude (Sonnet) looks at the renders → one revision for designs that
 *   failed a check or the look → the revised ones are looked at again → persist SVG + PNG.
 * The Claude API has no image output, so Claude designs in code and reviews with vision. Nothing is posted.
 */

const LAYOUT_IDS = Object.keys(LAYOUTS) as [VisualLayout, ...VisualLayout[]];

const Args = z.object({
  pieceId: z.string().max(40),
  optionId: z.string().max(40),
  preset: z.string().max(30),
  layout: z.enum([...LAYOUT_IDS, "auto"]).optional(),
  /** An uploaded or earlier generated image to design around. */
  imageId: z.string().max(40).optional(),
  /** Paint a new image layer with OpenAI first (needs an OpenAI key). */
  generate: z.boolean().optional(),
  quality: z.enum(["low", "medium", "high"]).optional(),
  /** How many designs, 1–3. */
  variants: z.number().int().min(1).max(3).optional(),
  /** "prompt" writes the image prompt (to paste into ChatGPT) and stops there. */
  mode: z.enum(["design", "prompt"]).optional(),
  /** The founder's note on what the picture should show or how the graphic should feel. */
  direction: z.string().max(600).optional(),
});
type VisualArgs = z.infer<typeof Args>;

/** Unkept graphics kept per option; older ones (and their files) are removed. */
const MAX_PER_OPTION = 6;

/* ─────────────────────────────── Tools (stable, so the cache holds) ─────────────────────────────── */

const submitDesigns = defineTool({
  name: "submit_designs",
  description: "Submit every design. Call exactly once.",
  terminal: true,
  schema: z.object({
    designs: z
      .array(
        z.object({
          layout: z.enum(LAYOUT_IDS).describe("The layout this design uses, from <layouts>."),
          svg: z.string().max(30000).describe("The complete SVG document, starting with <svg and ending with </svg>."),
          why: z.string().max(200).describe("≤20 words: why this composition will stop the reader."),
        }),
      )
      .max(3),
  }),
});
type Designs = { designs: { layout: VisualLayout; svg: string; why: string }[] };

const submitReview = defineTool({
  name: "submit_review",
  description: "Submit your review of every image. Call exactly once.",
  terminal: true,
  schema: z.object({
    reviews: z
      .array(
        z.object({
          n: z.number().int().describe("The image number."),
          readable: z.boolean(),
          broken: z.boolean(),
          lowContrast: z.boolean(),
          template: z.boolean(),
          issues: z.array(z.string().max(100)).max(4),
          fix: z.string().max(300).describe("≤40 words, or empty."),
          score: z.number().int().min(1).max(10),
        }),
      )
      .max(3),
  }),
});
type Review = { n: number; readable: boolean; broken: boolean; lowContrast: boolean; template: boolean; issues: string[]; fix: string; score: number };

const submitImagePrompt = defineTool({
  name: "submit_image_prompt",
  description: "Submit the image prompt. Call exactly once.",
  terminal: true,
  schema: z.object({
    prompt: z.string().max(1400).describe("One paragraph, 60–140 words."),
    alt: z.string().max(200).describe("≤20 words: what the image shows, for alt text."),
  }),
});
type ImagePrompt = { prompt: string; alt: string };

/* ─────────────────────────────── Context ─────────────────────────────── */

interface Plan {
  ws: Workspace;
  piece: StudioPiece;
  option: StudioOption;
  preset: VisualPreset;
  receipts: Receipt[];
  approved: string[];
  headline: string;
  palette: string[];
  productName: string;
  direction: string;
  variants: number;
  image?: StudioImage;
}

function clip(text: string | null | undefined, n: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function lines(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n\n");
}

/** The approved words with what each is, so the designer knows the headline from the source line. */
function approvedBlock(plan: Plan): string {
  const spec = FORMATS[plan.piece.format];
  const rows: string[] = [];
  for (const p of spec.parts) {
    if (p.role === "visual" || p.key === "alt") continue;
    const text = plan.option.parts[p.key]?.trim();
    if (text) rows.push(`- ${p.label}: ${text}`);
  }
  for (const id of plan.option.receiptIds) {
    const r = plan.receipts.find((x) => x.id === id);
    if (!r) continue;
    if (r.fact) rows.push(`- Proof (${r.label}${r.nameable ? "" : "; don't name the person or company"}): ${clip(r.text, 300)}`);
    if (r.source) rows.push(`- Source: ${clip(r.source, 120)}`);
  }
  if (plan.productName) rows.push(`- Product name: ${plan.productName}`);
  return rows.join("\n");
}

function canvasBlock(p: VisualPreset): string {
  const safe = p.safe
    ? `Safe zone: keep all text out of the top ${Math.round(p.safe.top * p.h)}px, the bottom ${Math.round(p.safe.bottom * p.h)}px and ${Math.round(p.safe.side * p.w)}px at each side.`
    : `Keep text at least ${Math.round(p.w * 0.06)}px from every edge; feeds crop and round corners.`;
  return `<canvas width="${p.w}" height="${p.h}" ratio="${aspectLabel(p.w, p.h)}">${p.label}. ${p.note}. ${safe} Smallest type: ${Math.ceil(p.w / 54)}px.</canvas>`;
}

/** Layouts the designer may use: image layouts only with an image (and never "screenshot" for a painted one), "stat" only with a number. */
function allowedLayouts(plan: Plan, image: StudioImage | undefined, asked: VisualArgs["layout"]): VisualLayout[] {
  if (asked && asked !== "auto") return [asked];
  if (image) return image.source === "openai" ? ["photo"] : ["screenshot", "photo"];
  const hasNumber = /\d/.test(plan.approved.join(" "));
  return LAYOUT_IDS.filter((l) => !LAYOUTS[l].needsImage && (l !== "stat" || hasNumber));
}

function designTask(plan: Plan, layouts: VisualLayout[], image: StudioImage | undefined): string {
  const spec = FORMATS[plan.piece.format];
  return lines(
    taskHeader(),
    `<task>Design ${plan.variants === 1 ? "one graphic" : `${plan.variants} graphics`} for this ${spec.label}${plan.variants > 1 ? ", each a different layout or composition" : ""}.</task>`,
    canvasBlock(plan.preset),
    `<approved_text>\n${approvedBlock(plan)}\n</approved_text>`,
    `<layouts>\n${layouts.map((l) => `- ${l}: ${LAYOUTS[l].blurb}`).join("\n")}\n</layouts>`,
    `<brand>Colors (first is the background unless an image fills the frame): ${plan.palette.join(", ")}.</brand>`,
    image &&
      `<image width="${image.width}" height="${image.height}">${
        image.source === "openai"
          ? "A generated picture (attached). It goes in the slot, cropped to fill it. Never present it as the product or a customer."
          : "The founder's own image (attached). If it is a screenshot of the product, use the screenshot layout: it is shown whole in the slot. If it's a photo, use the photo layout: it fills the slot, cropped."
      } Look at it: put text where it is calm, and pick colors that work with it.</image>`,
    plan.direction && `<direction>\n${clip(plan.direction, 900)}\n</direction>`,
    plan.piece.brief && `<brief>\n${clip(plan.piece.brief, 900)}\n</brief>`,
    "Design now and submit with submit_designs.",
  );
}

function withImageBlock(text: string, png: Buffer | null): Anthropic.Beta.BetaMessageParam {
  if (!png) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      { type: "text", text },
      { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
    ],
  };
}

/* ─────────────────────────────── The image layer ─────────────────────────────── */

async function writeImagePrompt(ctx: WorkflowContext<VisualArgs>, plan: Plan): Promise<ImagePrompt> {
  const { preset } = plan;
  const where = preset.w > preset.h * 1.2 ? "one side (left or right third)" : preset.h > preset.w * 1.2 ? "the middle band" : "the top or bottom third";
  const task = lines(
    taskHeader(),
    `<task>Write the prompt for the picture layer of a ${FORMATS[plan.piece.format].label} graphic, ${preset.w}×${preset.h} (${aspectLabel(preset.w, preset.h)}). The words will be set on ${where}, so keep that area calm.</task>`,
    `<message note="what the graphic says; the picture supports it and contains no words">\n${approvedBlock(plan)}\n</message>`,
    `<brand>Colors: ${plan.palette.join(", ")}.</brand>`,
    plan.direction && `<direction>\n${clip(plan.direction, 900)}\n</direction>`,
    plan.piece.brief && `<brief>\n${clip(plan.piece.brief, 900)}\n</brief>`,
    "Write it now and submit with submit_image_prompt.",
  );
  const run = (content: string) =>
    ctx.agent<ImagePrompt>({ tier: "operator", system: IMAGE_PROMPT_WRITER, messages: [{ role: "user", content }], tools: [submitImagePrompt], effort: "low", maxTokens: 3000, requireTerminal: true });
  let res = await run(task);
  if (!res.result) throw new AgentError("I couldn't write the image prompt. Try again.", "unknown");
  let problems = checkImagePrompt(res.result.prompt);
  if (problems.length) {
    res = await run(lines(task, `<previous_prompt>\n${res.result.prompt}\n</previous_prompt>`, `Code checked it: ${problems.join(" ")} Rewrite it to fix that and submit again.`));
    if (!res.result) throw new AgentError("I couldn't write the image prompt. Try again.", "unknown");
    problems = checkImagePrompt(res.result.prompt);
    if (problems.length) throw new AgentError(`The image prompt kept breaking a rule (${problems.join(" ")}). Change the direction and try again.`, "bad_request");
  }
  return res.result;
}

/** The prompt as the founder pastes it into ChatGPT: the size and the no-text rule made explicit. */
function forChatGpt(prompt: string, preset: VisualPreset): string {
  const size = `Aspect ratio ${aspectLabel(preset.w, preset.h)} (${preset.w}×${preset.h} px).`;
  return `${prompt.trim()}\n\n${/no text/i.test(prompt) ? size : `${size} No text, letters, logos or interface anywhere in the image.`}`;
}

/* ─────────────────────────────── Designs ─────────────────────────────── */

interface Candidate {
  layout: VisualLayout;
  why: string;
  raw: string;
  s: SanitizedSvg;
  checks: StudioVisual["checks"];
  png: Buffer | null;
  review?: Review;
}

function fitFor(layout: VisualLayout): "cover" | "contain" {
  return layout === "screenshot" ? "contain" : "cover";
}

function build(plan: Plan, d: Designs["designs"][number], layouts: VisualLayout[], image: StudioImage | undefined): Candidate {
  const layout = layouts.includes(d.layout) ? d.layout : layouts[0];
  const s = sanitizeSvg(d.svg, plan.preset);
  const checks = checkDesign(s, { preset: plan.preset, approved: plan.approved, headline: plan.headline, needsSlot: !!image, ad: plan.piece.format === "meta_ad" });
  let png: Buffer | null = null;
  try {
    png = renderPng({ svg: s.svg, image, slot: s.slot ?? undefined, fit: fitFor(layout) });
  } catch (err) {
    checks.push({ code: "RENDER_FAILED", severity: "error", detail: `The design didn't render: ${clip(err instanceof Error ? err.message : String(err), 120)}` });
  }
  return { layout, why: clip(d.why, 200), raw: d.svg, s, checks, png };
}

function errors(c: Candidate): number {
  return c.checks.filter((x) => x.severity === "error").length;
}

function needsWork(c: Candidate): boolean {
  const r = c.review;
  return errors(c) > 0 || (!!r && (r.score < 7 || r.broken || !r.readable || r.lowContrast));
}

async function design(ctx: WorkflowContext<VisualArgs>, message: Anthropic.Beta.BetaMessageParam): Promise<Designs> {
  const res = await ctx.agent<Designs>({
    tier: "strategist",
    system: VISUAL_DESIGN_RULES,
    messages: [message],
    tools: [submitDesigns],
    effort: "medium",
    maxTokens: 32000,
    requireTerminal: true,
  });
  if (!res.result?.designs.length) throw new AgentError("I couldn't finish the designs. Try again in a moment.", "unknown");
  return res.result;
}

/** Claude looks at the actual renders, at about phone width. A quality pass, not a gate. */
async function review(ctx: WorkflowContext<VisualArgs>, plan: Plan, items: { n: number; c: Candidate }[]): Promise<void> {
  const shown = items.filter(({ c }) => c.png);
  if (!shown.length) return;
  const width = plan.preset.w >= plan.preset.h ? 900 : 640;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `${shown.length === 1 ? "One graphic" : `${shown.length} graphics`} for a ${FORMATS[plan.piece.format].label} (${plan.preset.label}). The headline is: “${clip(plan.headline, 200)}”.` },
  ];
  for (const { n, c } of shown) {
    let small: Buffer;
    try {
      small = renderPng({ svg: c.s.svg, image: plan.image, slot: c.s.slot ?? undefined, fit: fitFor(c.layout), width });
    } catch {
      continue;
    }
    content.push({ type: "text", text: `Image ${n}:` }, { type: "image", source: { type: "base64", media_type: "image/png", data: small.toString("base64") } });
  }
  try {
    const res = await ctx.agent<{ reviews: Review[] }>({ tier: "operator", system: VISUAL_REVIEW, messages: [{ role: "user", content }], tools: [submitReview], effort: "low", maxTokens: 3000, requireTerminal: true });
    for (const r of res.result?.reviews ?? []) {
      const item = items.find((x) => x.n === r.n);
      if (item) item.c.review = r;
    }
  } catch (err) {
    if (err instanceof AgentError && err.code === "stopped") throw err;
  }
}

function feedback(items: { n: number; c: Candidate }[]): string {
  return items
    .map(({ n, c }) => {
      const code = c.checks.map((x) => `- ${x.severity === "error" ? "must fix" : "should fix"} (${x.code}): ${x.detail}`);
      const r = c.review;
      const look = r ? [...r.issues.map((i) => `- looked at the render: ${i}`), r.fix && `- suggested fix: ${r.fix}`].filter(Boolean) : [];
      return `Design ${n} (${c.layout}):\n${[...code, ...look].join("\n") || "- no notes"}`;
    })
    .join("\n\n");
}

/* ─────────────────────────────── Run ─────────────────────────────── */

export async function runVisual(ctx: WorkflowContext<VisualArgs>) {
  const a = ctx.args;
  const ws = ctx.read();
  const piece = ws.studio.pieces[a.pieceId];
  const option = piece?.options.find((o) => o.id === a.optionId);
  if (!piece || !option) throw new AgentError("That option is gone. Pick another one.", "bad_request");
  const presets = VISUAL_FORMATS[piece.format];
  if (!presets?.length) throw new AgentError(`${FORMATS[piece.format].label} doesn't get graphics.`, "bad_request");
  const preset = presetById(presets.includes(a.preset) ? a.preset : presets[0]);
  const receipts = receiptsFor(ws);
  const productName = ws.studio.profile?.productName || ws.company?.name || "";
  const spec = FORMATS[piece.format];
  const headlinePart = spec.parts.find((p) => p.role !== "visual" && p.key !== "alt" && option.parts[p.key]?.trim());
  const plan: Plan = {
    ws,
    piece,
    option,
    preset,
    receipts,
    approved: approvedStrings(option, piece.format, receipts, productName),
    headline: headlinePart ? option.parts[headlinePart.key].trim() : "",
    palette: ws.studio.profile?.colors?.length ? ws.studio.profile.colors : DEFAULT_PALETTE,
    productName,
    direction: [visualDirection(option), a.direction?.trim()].filter(Boolean).join("\n"),
    variants: a.variants ?? 2,
  };

  let image = a.imageId ? ws.studio.images[a.imageId] : undefined;
  if (a.imageId && !image) throw new AgentError("That image is gone. Upload it again.", "bad_request");

  // The picture layer: a prompt (for ChatGPT or OpenAI's API), then optionally the painting.
  let prompt: string | undefined;
  if (a.mode === "prompt" || a.generate) {
    ctx.emit({ type: "status", text: "Writing the image prompt" });
    const written = await writeImagePrompt(ctx, plan);
    prompt = forChatGpt(written.prompt, preset);
    const text = prompt;
    await ctx.mutate((w) => {
      const o = w.studio.pieces[piece.id]?.options.find((x) => x.id === option.id);
      if (o) o.imagePrompt = { text, preset: preset.id, at: nowISO() };
    });
    if (a.mode === "prompt") {
      ctx.emit({ type: "action", text: "Prompt ready to paste into ChatGPT" });
      return { visualIds: [] as string[], imageId: undefined, prompt };
    }
    ctx.emit({ type: "status", text: `Painting the image with OpenAI (${imageModel()})` });
    const painted = await generateImage({ prompt: written.prompt, w: preset.w, h: preset.h, quality: a.quality, signal: ctx.signal });
    const id = newId("img");
    const record: StudioImage = {
      id,
      source: "openai",
      file: `${id}.png`,
      mime: "image/png",
      width: painted.width,
      height: painted.height,
      alt: clip(written.alt, 200),
      generated: { prompt: written.prompt, model: painted.model, size: painted.size, quality: painted.quality },
      createdAt: nowISO(),
    };
    saveStudioFile(record.file, painted.png);
    await ctx.mutate((w) => {
      w.studio.images[id] = record;
    });
    ctx.emit({ type: "action", text: `Painted ${painted.size} with ${painted.model}` });
    image = record;
  }
  plan.image = image;

  const layouts = allowedLayouts(plan, image, a.layout);
  if (layouts.some((l) => LAYOUTS[l].needsImage) && !image) throw new AgentError("That layout needs an image. Upload a screenshot or paint one first.", "bad_request");
  if (image?.source === "openai" && layouts.includes("screenshot")) throw new AgentError("A painted image can't stand in for a screenshot of your product. Upload a real one.", "bad_request");

  ctx.emit({ type: "status", text: plan.variants === 1 ? "Designing the graphic" : `Designing ${plan.variants} graphics` });
  const thumb = image ? thumbnail(image, 1024) : null;
  const task = designTask(plan, layouts, image);
  const first = await design(ctx, withImageBlock(task, thumb));
  let items = first.designs.slice(0, plan.variants).map((d, i) => ({ n: i + 1, c: build(plan, d, layouts, image) }));

  const passing = items.filter(({ c }) => !errors(c)).length;
  ctx.emit({ type: "action", text: `Rendered · ${passing} of ${items.length} pass the code checks (words, contrast, safe zones)` });
  ctx.emit({ type: "status", text: "Looking at the renders" });
  await review(ctx, plan, items);

  const failing = items.filter(({ c }) => needsWork(c));
  if (failing.length) {
    ctx.emit({ type: "status", text: failing.length === 1 ? "Fixing one design" : `Fixing ${failing.length} designs` });
    const current = items.map(({ n, c }) => `<design n="${n}" layout="${c.layout}">\n${c.s.svg}\n</design>`).join("\n");
    const ask = lines(
      task,
      `<current_designs>\n${current}\n</current_designs>`,
      `Code checked them and an art director looked at the renders. Fix these:\n\n${feedback(failing)}\n\nRevise ONLY the designs listed (keep what works). Submit all ${items.length} designs again, in the same order, with submit_designs.`,
    );
    const again = await design(ctx, withImageBlock(ask, thumb)).catch((err) => {
      if (err instanceof AgentError && err.code === "stopped") throw err;
      return null;
    });
    if (again && again.designs.length >= items.length) {
      const revised = failing.map(({ n }) => ({ n, c: build(plan, again.designs[n - 1], layouts, image) }));
      await review(ctx, plan, revised);
      items = items.map((item) => {
        const r = revised.find((x) => x.n === item.n);
        if (!r) return item;
        // A revision wins unless it brings more code errors or looks worse.
        const better = errors(r.c) < errors(item.c) || (errors(r.c) === errors(item.c) && (r.c.review?.score ?? 0) >= (item.c.review?.score ?? 0));
        return better ? r : item;
      });
    }
  }

  // Persist: SVG and full-size PNG as files, records in the workspace.
  const at = nowISO();
  const records: StudioVisual[] = items.map(({ c }) => {
    const id = newId("vis");
    const svgFile = `${id}.svg`;
    saveStudioFile(svgFile, c.s.svg);
    const pngFile = c.png ? `${id}.png` : null;
    if (pngFile && c.png) saveStudioFile(pngFile, c.png);
    const r = c.review;
    const checks = [...c.checks];
    if (r && (r.score < 7 || r.broken || r.lowContrast)) checks.push({ code: "REVIEW", severity: "warn", detail: clip(r.fix || r.issues.join("; ") || "Claude wouldn't post this one as is.", 240) });
    return {
      id,
      pieceId: piece.id,
      optionId: option.id,
      layout: c.layout,
      preset: preset.id,
      width: preset.w,
      height: preset.h,
      svgFile,
      pngFile,
      imageId: image?.id,
      slot: c.s.slot ?? undefined,
      why: c.why,
      checks,
      review: r ? { score: r.score, issues: r.issues.slice(0, 4), fix: r.fix } : undefined,
      aiImagery: image?.source === "openai",
      createdAt: at,
      runId: ctx.runId,
    };
  });
  // Best first: no errors, then Claude's score.
  records.sort((x, y) => x.checks.filter((c) => c.severity === "error").length - y.checks.filter((c) => c.severity === "error").length || (y.review?.score ?? 0) - (x.review?.score ?? 0));

  const stale = await ctx.mutate((w) => {
    records.forEach((r, i) => {
      w.studio.visuals[r.id] = { ...r, createdAt: new Date(Date.parse(at) - i).toISOString() };
    });
    const old = Object.values(w.studio.visuals)
      .filter((v) => v.optionId === option.id && !v.kept)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .slice(MAX_PER_OPTION);
    for (const v of old) delete w.studio.visuals[v.id];
    return old;
  });
  for (const v of stale) {
    removeStudioFile(v.svgFile);
    if (v.pngFile) removeStudioFile(v.pngFile);
  }

  const clean = records.filter((r) => !r.checks.some((c) => c.severity === "error")).length;
  ctx.emit({ type: "action", text: clean === records.length ? `${records.length === 1 ? "The graphic passes" : `All ${records.length} graphics pass`} every check` : `${clean} of ${records.length} graphics pass every check` });
  return { visualIds: records.map((r) => r.id), imageId: image?.id, prompt };
}

export default defineWorkflow({
  id: "visual",
  args: Args,
  title: (a) => (a.mode === "prompt" ? "Writing an image prompt" : a.generate ? "Painting a picture and designing graphics" : "Designing graphics"),
  ref: (a) => ({ kind: "studio", id: a.pieceId }),
  heavy: false,
  run: runVisual,
});
