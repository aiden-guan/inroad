import { parse, type HTMLElement, type Node } from "node-html-parser";
import type { StudioVisual } from "@/lib/domain/types";
import { FONT_STACKS, contrastRatio, parseColor, type VisualPreset } from "./visuals";

/**
 * Model-written SVG, made safe and checked. The SVG is rebuilt from an allowlist (elements,
 * attributes, values), so nothing it contains can run script or load anything: no <script>,
 * <foreignObject>, <image>, <style>, event handlers, external or data URLs. Then code checks what
 * a reader would notice: words that weren't approved, contrast, safe zones, tiny type, too much text.
 */

const ELEMENTS = new Set(["svg", "g", "defs", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "linearGradient", "radialGradient", "stop", "clipPath", "title", "desc"]);

const ATTRS = new Set([
  "id",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "width",
  "height",
  "d",
  "points",
  "dx",
  "dy",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "word-spacing",
  "text-anchor",
  "dominant-baseline",
  "text-decoration",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "clip-path",
  "clipPathUnits",
  "data-slot",
]);

const LOCAL_URL = /^url\(#[A-Za-z0-9_-]{1,64}\)$/;
const UNSAFE_VALUE = /javascript:|data:|expression\(|@import|<|>|url\(/i;

function decode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Any requested family → an unquoted stack the renderer resolves on every OS. */
export function fontStack(value: string): string {
  const names = decode(value)
    .split(",")
    .map((n) => n.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  const all = names.join(" ").toLowerCase();
  const kind = /mono|menlo|consolas|courier/.test(all) ? "mono" : /(^|[^-])serif|georgia|times|garamond|playfair|fraunces|newsreader/.test(all) && !/sans/.test(all) ? "serif" : "sans";
  const wanted = names.filter((n) => /^[A-Za-z0-9 -]{2,40}$/.test(n) && !/^(serif|sans-serif|monospace|system-ui|ui-[a-z-]+)$/i.test(n));
  return [...new Set([...wanted, ...FONT_STACKS[kind]])].join(", ");
}

export interface TextRun {
  text: string;
  x: number;
  y: number;
  size: number;
  fill: string | null;
  weight: string;
  anchor: string;
}

interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
}

export interface SanitizedSvg {
  svg: string;
  /** Where the image layer goes (the rect marked data-slot="image"), in canvas pixels. */
  slot: { x: number; y: number; w: number; h: number } | null;
  texts: TextRun[];
  /** What was stripped, for the founder ("2 event handlers", "an external image"). */
  removed: string[];
  /** The width/height/viewBox the model declared, before code forced the preset's. */
  declared: { w: number; h: number } | null;
  /** Solid shapes in paint order, for contrast checks. */
  shapes: Shape[];
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Every element under `el`, depth first. (The parser's selectors don't match camelCase SVG tags.) */
function elements(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const c of el.childNodes) {
    if (c.nodeType !== 1) continue;
    out.push(c as HTMLElement, ...elements(c as HTMLElement));
  }
  return out;
}

function inside(el: HTMLElement, tag: string): boolean {
  let n = el.parentNode as HTMLElement | null;
  while (n) {
    if (n.rawTagName === tag) return true;
    n = n.parentNode as HTMLElement | null;
  }
  return false;
}

/** A length in px; "1.2em" is relative to the font size. */
function length(v: string | undefined, fontSize: number): number {
  if (!v) return 0;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return /em\s*$/.test(v) ? n * fontSize : n;
}

/** Inherited presentation attributes, from the root down to this element. */
function inherited(el: HTMLElement, name: string): string | undefined {
  let n: HTMLElement | null = el;
  while (n) {
    const v = n.rawAttributes?.[name];
    if (v !== undefined) return decode(v);
    n = n.parentNode as HTMLElement | null;
  }
  return undefined;
}

export function sanitizeSvg(raw: string, preset: Pick<VisualPreset, "w" | "h">): SanitizedSvg {
  const removed: string[] = [];
  const note = (what: string) => {
    if (!removed.includes(what)) removed.push(what);
  };
  const root = parse(raw.trim(), { lowerCaseTagName: false, comment: false });
  const svgEl = root.childNodes.find((n): n is HTMLElement => n.nodeType === 1 && (n as HTMLElement).rawTagName === "svg") ?? null;
  const texts: TextRun[] = [];
  const shapes: Shape[] = [];
  const gradients = new Map<string, string>();
  let slot: SanitizedSvg["slot"] = null;
  if (!svgEl) return { svg: emptySvg(preset), slot, texts, removed: ["everything (no <svg> element)"], declared: null, shapes };

  const vb = svgEl.rawAttributes.viewBox?.trim().split(/[\s,]+/).map(Number);
  const declared = vb?.length === 4 && vb.every(Number.isFinite) ? { w: vb[2], h: vb[3] } : svgEl.rawAttributes.width ? { w: num(svgEl.rawAttributes.width), h: num(svgEl.rawAttributes.height) } : null;

  // First pass: gradient first-stop colors, so a gradient-filled background still has a color for contrast.
  for (const g of elements(svgEl).filter((e) => e.rawTagName === "linearGradient" || e.rawTagName === "radialGradient")) {
    const id = g.rawAttributes.id;
    const stop = elements(g).find((e) => e.rawTagName === "stop");
    if (id && stop) gradients.set(id, decode(stop.rawAttributes["stop-color"] ?? ""));
  }
  // Where the last line of each <text> sat, so stacked <tspan dy="1.2em"> lines land where they render.
  const cursor = new Map<HTMLElement, { x: number; y: number }>();
  const fillColor = (v: string | undefined): string | null => {
    if (!v || v === "none" || v === "transparent") return null;
    const m = v.match(/^url\(#([A-Za-z0-9_-]+)\)$/);
    return m ? (gradients.get(m[1]) ?? null) : v;
  };

  const out = (el: HTMLElement): string => {
    const tag = el.rawTagName;
    if (!ELEMENTS.has(tag)) {
      note(tag === "image" ? "an image reference" : tag === "script" ? "a script" : tag === "foreignObject" ? "embedded HTML" : `<${tag}>`);
      return "";
    }
    const attrs: string[] = [];
    for (const [nameRaw, valueRaw] of Object.entries(el.rawAttributes)) {
      const name = nameRaw.trim();
      let value = decode(valueRaw);
      if (/^on/i.test(name)) {
        note("event handlers");
        continue;
      }
      if (!ATTRS.has(name)) {
        if (/href/i.test(name)) note("a link or external reference");
        continue;
      }
      if (name === "font-family") value = fontStack(value);
      if (/url\(/i.test(value) && !LOCAL_URL.test(value.trim())) {
        note("an external URL");
        continue;
      }
      if (UNSAFE_VALUE.test(value) && !LOCAL_URL.test(value.trim())) {
        note("an unsafe value");
        continue;
      }
      if (name === "data-slot" && value !== "image") continue;
      attrs.push(`${name}="${escapeAttr(value)}"`);
    }

    if (tag === "rect" && el.rawAttributes["data-slot"] === "image" && !slot) {
      slot = { x: num(el.rawAttributes.x), y: num(el.rawAttributes.y), w: num(el.rawAttributes.width), h: num(el.rawAttributes.height) };
      // In paint order with no color: text over the image can't be contrast-checked in code (Claude's review looks at it).
      shapes.push({ ...slot, fill: null });
    } else if (tag === "rect" && !inside(el, "defs") && !inside(el, "clipPath")) {
      const w = el.rawAttributes.width?.trim().endsWith("%") ? (preset.w * num(el.rawAttributes.width)) / 100 : num(el.rawAttributes.width);
      const h = el.rawAttributes.height?.trim().endsWith("%") ? (preset.h * num(el.rawAttributes.height)) / 100 : num(el.rawAttributes.height);
      const opacity = num(inherited(el, "opacity"), 1) * num(inherited(el, "fill-opacity"), 1);
      if (opacity >= 0.9) shapes.push({ x: num(el.rawAttributes.x), y: num(el.rawAttributes.y), w, h, fill: fillColor(inherited(el, "fill") ?? "#000000") });
    }

    let inner = "";
    for (const child of el.childNodes) inner += serialize(child, el);
    return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${inner}</${tag}>`;
  };

  const serialize = (n: Node, parent: HTMLElement): string => {
    if (n.nodeType === 1) return out(n as HTMLElement);
    if (n.nodeType !== 3) return "";
    const text = (n as unknown as { text: string }).text;
    if (parent.rawTagName === "text" || parent.rawTagName === "tspan" || parent.rawTagName === "title" || parent.rawTagName === "desc") {
      const clean = text.replace(/\s+/g, " ");
      if ((parent.rawTagName === "text" || parent.rawTagName === "tspan") && clean.trim()) {
        const textEl = parent.rawTagName === "text" ? parent : ((parent.parentNode as HTMLElement | null) ?? parent);
        const size = num(inherited(parent, "font-size"), 16);
        const prev = cursor.get(textEl) ?? { x: num(textEl.rawAttributes.x), y: num(textEl.rawAttributes.y) };
        const x = parent.rawAttributes.x !== undefined ? num(parent.rawAttributes.x) : prev.x;
        const y = (parent.rawAttributes.y !== undefined && parent !== textEl ? num(parent.rawAttributes.y) : prev.y) + (parent !== textEl ? length(parent.rawAttributes.dy, size) : 0);
        cursor.set(textEl, { x, y });
        texts.push({
          text: clean.trim(),
          x,
          y,
          size,
          fill: fillColor(inherited(parent, "fill") ?? "#000000"),
          weight: inherited(parent, "font-weight") ?? "400",
          anchor: inherited(parent, "text-anchor") ?? "start",
        });
      }
      return escapeText(clean);
    }
    return "";
  };

  let body = "";
  for (const child of svgEl.childNodes) body += serialize(child, svgEl);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${preset.w}" height="${preset.h}" viewBox="0 0 ${preset.w} ${preset.h}">${body}</svg>`;
  return { svg, slot, texts, removed, declared, shapes };
}

function emptySvg(preset: Pick<VisualPreset, "w" | "h">): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${preset.w}" height="${preset.h}" viewBox="0 0 ${preset.w} ${preset.h}"></svg>`;
}

/* ───────────── Checks ───────────── */

/** Neutral labels a layout may add without making a claim. */
const LABELS = ["before", "after", "today", "new", "now", "source", "sources", "old way", "new way", "then", "with", "without", "vs", "versus", "launching", "introducing", "coming soon", "out now"];

function normWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}%$+.']+/gu, " ")
    .replace(/(^|\s)[.']+|[.']+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Check = StudioVisual["checks"][number];

export interface CheckContext {
  preset: VisualPreset;
  /** Every string the graphic may use (approvedStrings). */
  approved: string[];
  /** The line that must appear: the option's hook. */
  headline: string;
  /** An image goes on this graphic, so the design must mark a slot. */
  needsSlot?: boolean;
  /** A Meta ad: Meta's text-share guidance applies. */
  ad?: boolean;
}

/** What a reader would notice, in code. Contrast and sizes are estimates from the SVG's own numbers. */
export function checkDesign(s: SanitizedSvg, ctx: CheckContext): Check[] {
  const out: Check[] = [];
  const { preset } = ctx;
  if (s.declared && (Math.abs(s.declared.w - preset.w) > 1 || Math.abs(s.declared.h - preset.h) > 1)) {
    out.push({ code: "SIZE_MISMATCH", severity: "error", detail: `Designed for ${Math.round(s.declared.w)}×${Math.round(s.declared.h)}, not ${preset.w}×${preset.h}. Positions will be off.` });
  }
  if (s.removed.length) out.push({ code: "UNSAFE_REMOVED", severity: "warn", detail: `Removed ${s.removed.join(", ")} from the design.` });

  const corpus = ctx.approved.map((a) => ` ${normWords(a)} `);
  const labels = new Set(LABELS);
  const leading = new RegExp(`^(${LABELS.join("|")}) `);
  const bad = s.texts.map((t) => t.text).filter((t) => {
    let n = normWords(t);
    if (!n || labels.has(n)) return false;
    // "Source: discovery call" and "Before: four days" are a label plus approved words.
    while (leading.test(n)) n = n.replace(leading, "");
    return !corpus.some((c) => c.includes(` ${n} `));
  });
  if (bad.length) out.push({ code: "TEXT_NOT_APPROVED", severity: "error", detail: `Words that aren't in the approved copy: “${bad.slice(0, 2).join("”, “")}”. A graphic can't add claims.` });

  const head = normWords(ctx.headline).split(" ").slice(0, 3).join(" ");
  const all = normWords(s.texts.map((t) => t.text).join(" "));
  if (head && !all.includes(head)) out.push({ code: "TEXT_MISSING", severity: "warn", detail: "The headline isn't on the graphic." });

  // Contrast: each run against the last solid shape painted under its baseline point.
  let worst: { ratio: number; text: string; need: number } | null = null;
  for (const t of s.texts) {
    const fg = parseColor(t.fill);
    if (!fg) continue;
    const under = [...s.shapes].reverse().find((r) => t.x >= r.x - 1 && t.x <= r.x + r.w + 1 && t.y - t.size * 0.3 >= r.y && t.y - t.size * 0.3 <= r.y + r.h);
    const bg = parseColor(under?.fill ?? null);
    if (!bg) continue;
    const large = t.size >= 24 || (t.size >= 18.66 && /bold|[6-9]00/.test(t.weight));
    const need = large ? 3 : 4.5;
    const ratio = contrastRatio(fg, bg);
    if (ratio < need && (!worst || ratio < worst.ratio)) worst = { ratio, text: t.text, need };
  }
  if (worst) {
    out.push({ code: "LOW_CONTRAST", severity: "error", detail: `“${worst.text.slice(0, 32)}” has ${worst.ratio.toFixed(1)}:1 contrast; WCAG asks for ${worst.need}:1 at that size.` });
  }

  const sz = preset.safe;
  if (sz) {
    const outside = s.texts.find((t) => t.y - t.size < preset.h * sz.top || t.y > preset.h * (1 - sz.bottom) || t.x < preset.w * sz.side || t.x > preset.w * (1 - sz.side));
    if (outside) out.push({ code: "SAFE_ZONE", severity: "error", detail: `“${outside.text.slice(0, 32)}” sits where the platform's buttons and captions cover it.` });
  } else {
    const edge = s.texts.find((t) => (t.anchor === "start" && t.x < preset.w * 0.04) || t.y - t.size < preset.h * 0.03 || t.y > preset.h * 0.98);
    if (edge) out.push({ code: "SAFE_ZONE", severity: "warn", detail: `“${edge.text.slice(0, 32)}” is close to the edge; feeds crop and round corners.` });
  }

  // Widths are estimates (SVG has no wrapping and fonts differ by OS); Claude's review sees the real render.
  const over = s.texts.find((t) => {
    const width = t.text.length * t.size * (/bold|[6-9]00/.test(t.weight) ? 0.62 : 0.56);
    const left = t.anchor === "middle" ? t.x - width / 2 : t.anchor === "end" ? t.x - width : t.x;
    return left < -1 || left + width > preset.w + 1;
  });
  if (over) out.push({ code: "OVERFLOW", severity: "warn", detail: `“${over.text.slice(0, 32)}” probably runs off the canvas. Break it into shorter lines.` });

  if (ctx.needsSlot && !s.slot) out.push({ code: "NO_IMAGE_SLOT", severity: "error", detail: "The design has no place for the image." });

  // House heuristic: type under ~1/54 of the width is hard to read on a phone at feed size.
  const minSize = preset.w / 54;
  const tiny = s.texts.find((t) => t.size < minSize);
  if (tiny) out.push({ code: "SMALL_TYPE", severity: "warn", detail: `“${tiny.text.slice(0, 32)}” is ${Math.round(tiny.size)}px; under ${Math.round(minSize)}px is hard to read on a phone.` });

  // Meta reports ad images with under 20% text tend to perform better (https://www.facebook.com/business/help/980593475366490).
  // That's ads guidance, so it only applies to ads; a statement graphic for a feed is mostly type by design.
  const area = s.texts.reduce((a, t) => a + t.text.length * t.size * 0.55 * t.size * 1.2, 0);
  const share = area / (preset.w * preset.h);
  if (ctx.ad && share > 0.2) out.push({ code: "TEXT_HEAVY", severity: "warn", detail: `Text covers about ${Math.ceil(share * 100)}% of the image. Meta reports ads with under 20% tend to perform better.` });

  return out;
}
