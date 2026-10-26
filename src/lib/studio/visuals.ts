import type { StudioFormatId, StudioOption, VisualLayout } from "@/lib/domain/types";
import { FORMATS } from "./formats";
import type { Receipt } from "./receipts";

/**
 * Visuals: graphics built around a Studio option's approved words. Pure and browser-safe; the
 * server side (sanitizing, checking, rendering, calling OpenAI) lives in svg.ts, render.ts and
 * openai.ts.
 *
 * Two engines, used for what each is actually good at:
 *  - Claude designs the graphic as SVG. The Claude API reads images but has no image output, so it
 *    designs in code, which keeps every word exact and on-brand. Code renders the SVG to PNG and
 *    Claude looks at the result.
 *  - OpenAI's GPT Image models paint photos and illustrations (the image layer). As of 2026-10-26
 *    OpenAI lists gpt-image-2.5-sunburst (most capable) and gpt-image-2.5-flare (fastest); custom
 *    sizes are WIDTHxHEIGHT with edges ≤3840 px, multiples of 16, ratio ≤3:1, 655,360–8,294,400 px
 *    (https://developers.openai.com/api/docs/guides/image-prompting). Words never go in the painted
 *    layer; Claude sets them on top.
 */

export interface VisualPreset {
  id: string;
  label: string;
  /** For tight controls. */
  short: string;
  w: number;
  h: number;
  /** Fractions of the frame the platform's UI covers; keep text out. */
  safe?: { top: number; bottom: number; side: number };
  note: string;
  source?: string;
}

export const PRESETS: VisualPreset[] = [
  { id: "linkedin", short: "LinkedIn / X", label: "LinkedIn / X 1.91:1", w: 1200, h: 627, note: "LinkedIn single image, also fits X and link previews", source: "https://www.linkedin.com/help/lms/answer/a426534" },
  { id: "portrait", short: "Feed 4:5", label: "Feed 4:5", w: 1080, h: 1350, note: "Meta's recommended feed ratio; LinkedIn accepts 4:5 too", source: "https://www.facebook.com/business/help/103816146375741" },
  { id: "square", short: "Square", label: "Square 1:1", w: 1080, h: 1080, note: "Works in every feed" },
  {
    id: "story",
    short: "Story 9:16",
    label: "Story / Reels 9:16",
    w: 1080,
    h: 1920,
    safe: { top: 0.14, bottom: 0.35, side: 0.06 },
    note: "Keep text out of the top 14%, bottom 35% and 6% each side",
    source: "https://www.facebook.com/business/ads-guide/update/image/instagram-reels",
  },
  { id: "og", short: "Link preview", label: "Link preview 1200×630", w: 1200, h: 630, note: "Open Graph image for your site's pages", source: "https://developers.facebook.com/docs/sharing/webmasters/images" },
  { id: "product_hunt", short: "Product Hunt", label: "Product Hunt gallery", w: 1270, h: 760, note: "Gallery image; at least two are needed", source: "https://help.producthunt.com/en/articles/5473122-how-to-post-media" },
];

export function presetById(id: string): VisualPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** Formats that get graphics, and their presets best first. Show HN, search ads and text-only formats get none. */
export const VISUAL_FORMATS: Partial<Record<StudioFormatId, string[]>> = {
  image: ["portrait", "square", "linkedin", "story"],
  meta_ad: ["portrait", "square", "story"],
  linkedin_ad: ["linkedin", "square", "portrait"],
  linkedin_post: ["linkedin", "portrait", "square"],
  x_post: ["linkedin", "square"],
  product_hunt: ["product_hunt"],
  homepage_hero: ["og", "linkedin"],
  waitlist_page: ["og", "linkedin"],
  one_liner: ["square", "linkedin", "story"],
  billboard: ["linkedin", "square", "story"],
  customer_story: ["linkedin", "square", "portrait"],
  changelog: ["linkedin", "og"],
  email_announcement: ["og"],
  comparison_page: ["og", "linkedin"],
  short_video: ["story"],
};

export function presetsFor(format: StudioFormatId): VisualPreset[] {
  return (VISUAL_FORMATS[format] ?? []).map(presetById);
}

/** "4:5", "9:16", or "1.91:1" when the reduced ratio isn't a simple one. */
export function aspectLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  if (w / g <= 21 && h / g <= 21) return `${w / g}:${h / g}`;
  return `${(w / h).toFixed(2)}:1`;
}

export const LAYOUTS: Record<VisualLayout, { label: string; blurb: string; needsImage?: "screenshot" | "photo" }> = {
  statement: { label: "Statement", blurb: "The headline, big, with room to breathe." },
  stat: { label: "One number", blurb: "The number huge, what it measures, where it's from." },
  quote: { label: "Quote", blurb: "A user's words, attributed as the receipt allows." },
  before_after: { label: "Before / after", blurb: "Two columns: the old way and the new one." },
  announcement: { label: "Announcement", blurb: "What's new, for whom, and when." },
  screenshot: { label: "Real screenshot", blurb: "Your product's actual UI, framed, with the headline.", needsImage: "screenshot" },
  photo: { label: "Photo or illustration", blurb: "An image layer with the words set on top.", needsImage: "photo" },
};

/**
 * Font stacks the renderer can resolve on macOS, Windows and Linux. The sanitizer rewrites every
 * font-family to one of these (unquoted: the renderer ignores quoted names in a list).
 */
export const FONT_STACKS = {
  serif: ["Georgia", "Times New Roman", "DejaVu Serif", "Liberation Serif", "Noto Serif", "FreeSerif"],
  sans: ["Inter", "Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans", "Liberation Sans", "Noto Sans", "FreeSans"],
  mono: ["SF Mono", "Menlo", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "FreeMono"],
} as const;

/** Ink and paper, used when the founder hasn't set brand colors. */
export const DEFAULT_PALETTE = ["#14120F", "#F4F1EA", "#2F5BEA", "#C9C3B8"];

/* ───────────── OpenAI image sizes ───────────── */

export const IMAGE_MODELS = [
  { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", note: "OpenAI's most capable image model" },
  { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", note: "OpenAI's fastest high-quality model" },
  { id: "gpt-image-2", label: "GPT Image 2", note: "Previous generation; custom sizes" },
] as const;

export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-sunburst";

const MIN_PIXELS = 655_360;
// Sizes above 2560×1440 are experimental per OpenAI's reference, so stay under that budget.
const MAX_PIXELS = 2560 * 1440;

/** The size to request from OpenAI for a frame: same ratio, legal edges, within the pixel budget. */
export function openaiSize(w: number, h: number, model: string): string {
  if (!/^gpt-image-2/.test(model)) {
    // Older GPT Image models take three fixed sizes; pick the nearest ratio and crop.
    const r = w / h;
    return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
  }
  let ratio = w / h;
  ratio = Math.min(3, Math.max(1 / 3, ratio));
  const target = Math.min(MAX_PIXELS, Math.max(MIN_PIXELS, w * h));
  let height = Math.sqrt(target / ratio);
  let width = height * ratio;
  const round = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  width = Math.min(3840, round(width));
  height = Math.min(3840, round(height));
  // Rounding can dip under the minimum; grow the short edge a step at a time.
  while (width * height < MIN_PIXELS) {
    if (width <= height) width += 16;
    else height += 16;
  }
  return `${width}x${height}`;
}

/* ───────────── What may be written on a graphic ───────────── */

/**
 * The only words a graphic may carry: the option's own text (already linted and reader-checked),
 * the receipts it rests on (for a source line), and the product name. Code checks the SVG against
 * these, so a design can't add a claim the copy never made.
 */
export function approvedStrings(option: Pick<StudioOption, "parts" | "receiptIds">, format: StudioFormatId, receipts: Receipt[], productName: string): string[] {
  const spec = FORMATS[format];
  const out: string[] = [];
  for (const p of spec.parts) {
    if (p.role === "visual" || p.key === "alt") continue;
    const text = option.parts[p.key]?.trim();
    if (text) out.push(text);
  }
  for (const id of option.receiptIds) {
    const r = receipts.find((x) => x.id === id);
    if (!r) continue;
    if (r.fact) out.push(r.text);
    if (r.source) out.push(r.source);
  }
  if (productName) out.push(productName);
  return out;
}

/** Visual direction from the option, when the format has one (the image format's "What the image shows"). */
export function visualDirection(option: Pick<StudioOption, "parts">): string {
  return (option.parts.visual ?? "").trim();
}

/* ───────────── Image prompts (for GPT Image, or pasted into ChatGPT) ───────────── */

/**
 * Rules for every image prompt. Shown to Claude when it writes one, to outside agents through
 * get_copy_guide, and enforced in part by checkImagePrompt.
 * FTC: AI-generated reviews and testimonials are covered by the Consumer Reviews and Testimonials
 * Rule (16 CFR 465, effective 2024-10-21, https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).
 * TikTok requires labels on realistic AI-generated images, audio and video
 * (https://www.tiktok.com/community-guidelines/en/integrity-authenticity); Meta shows an "AI info"
 * label and asks advertisers to disclose photorealistic AI content
 * (https://about.fb.com/news/2026/02/meta-prepares-for-2026-us-midterms/).
 */
export const IMAGE_PROMPT_RULES = [
  "No words, letters, numbers or logos in the image. The headline is set on top in code, exactly as approved.",
  "Never the product's interface. Real UI comes from an uploaded screenshot; a painted one would misrepresent the product.",
  "No people presented as customers, users or reviewers, and no one's real likeness. Generated people next to a quote would be a fake testimonial.",
  "Show a real-world moment, place or object from the brief: the desk at month-end, the phone in a hand on a train. Specific beats pretty.",
  "Leave calm, low-detail space where the text will sit, and say where in the prompt.",
  "No AI-art clichés: glowing brains, robots, holograms, neon circuitry, floating particles, rockets, light bulbs, handshakes, abstract node networks.",
  "Photographic or illustrated, but one consistent style, lit plainly. Describe the lens, light and palette like a photographer would.",
];

const PROMPT_FLAGS: { re: RegExp; detail: string }[] = [
  { re: /\b(robots?|humanoid|glowing brain|holograms?|holographic|neon|circuit(ry| board)?|floating particles|rockets?|light ?bulbs?|handshakes?|node network|network of nodes)\b/i, detail: "uses an AI-art cliché" },
  { re: /\b(text|words?|letters?|caption|headline|logo|typography)\s+(that\s+)?(says|reads|saying|reading|with)\b|\bwith the (words|text)\b|["“][^"”]{3,}["”]\s+(written|printed|on)\b/i, detail: "asks for words in the image" },
  { re: /\b(dashboard|user interface|\bUI\b|screenshot|app screen|web page|landing page)\b/i, detail: "paints the product's interface" },
  { re: /\b(customer|user|client|reviewer)s?\b[^.]{0,40}\b(smiling|happy|holding|using|testimonial)\b|\btestimonial\b/i, detail: "shows people as customers" },
];

/** Problems with an image prompt, in plain words. Empty when it's fine. */
export function checkImagePrompt(prompt: string): string[] {
  return PROMPT_FLAGS.filter((f) => f.re.test(prompt)).map((f) => `The prompt ${f.detail}.`);
}

/* ───────────── Contrast (WCAG 2.x relative luminance) ───────────── */

export function parseColor(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const named: Record<string, string> = { white: "#ffffff", black: "#000000" };
  const hex = named[v] ?? v;
  const m3 = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (m3) return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16)];
  const m6 = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/);
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)];
  const rgb = hex.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio between two colors, 1–21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
