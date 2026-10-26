import "server-only";
import { Resvg } from "@resvg/resvg-js";
import type { StudioImage } from "@/lib/domain/types";
import { readStudioFile } from "./files";

/**
 * Renders a sanitized design to PNG on the server (resvg), so what the founder downloads, what
 * Claude reviews and what the page shows are the same pixels. An image layer replaces the
 * design's slot rect in place, so the designer controls what sits under and over it.
 */

const DEFAULT_FONT = process.platform === "darwin" ? "Helvetica" : process.platform === "win32" ? "Arial" : "DejaVu Sans";

/** The design with the image layer in place of its slot rect (or unchanged if the image file is gone). */
export function composeSvg(svg: string, image: StudioImage, slot: { x: number; y: number; w: number; h: number }, fit: "cover" | "contain"): string {
  const data = readStudioFile(image.file);
  if (!data) return svg;
  const href = `data:${image.mime};base64,${data.toString("base64")}`;
  const tag = `<image href="${href}" x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" preserveAspectRatio="${fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}"/>`;
  // The sanitizer kept the slot rect (attributes in allowlist order); swap it for the image.
  const replaced = svg.replace(/<rect\b[^>]*\bdata-slot="image"[^>]*>(<\/rect>)?/, tag);
  return replaced === svg ? svg.replace(/(<svg\b[^>]*>)/, `$1${tag}`) : replaced;
}

export interface RenderInput {
  svg: string;
  image?: StudioImage;
  slot?: { x: number; y: number; w: number; h: number };
  /** Screenshots are shown whole ("contain"); photos fill their slot ("cover"). */
  fit?: "cover" | "contain";
  /** Render narrower (for Claude's review), keeping the ratio. */
  width?: number;
}

export function renderPng(input: RenderInput): Buffer {
  const svg = input.image && input.slot ? composeSvg(input.svg, input.image, input.slot, input.fit ?? "cover") : input.svg;
  const resvg = new Resvg(svg, {
    fitTo: input.width ? { mode: "width", value: input.width } : { mode: "original" },
    font: { loadSystemFonts: true, defaultFontFamily: DEFAULT_FONT },
  });
  return resvg.render().asPng();
}

/** A smaller PNG of a stored image (for Claude to look at while designing); null if the file is gone. */
export function thumbnail(image: StudioImage, width: number): Buffer | null {
  const data = readStudioFile(image.file);
  if (!data) return null;
  const href = `data:${image.mime};base64,${data.toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}"><image href="${href}" width="${image.width}" height="${image.height}"/></svg>`;
  return new Resvg(svg, { fitTo: { mode: "width", value: Math.min(width, image.width) } }).render().asPng();
}
