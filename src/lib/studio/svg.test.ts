import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import type { StudioImage } from "@/lib/domain/types";
import { composeSvg, renderPng, thumbnail, thumbnailBytes } from "./render";
import { checkDesign, fontStack, sanitizeSvg } from "./svg";
import { aspectLabel, checkImagePrompt, contrastRatio, openaiSize, parseColor, presetById } from "./visuals";
import { imageInfo, isSafeName, readStudioFile, saveStudioFile, sweepStudioFiles } from "./files";
import { makeWorkspace } from "@/test/factories";

const linkedin = presetById("linkedin");
const story = presetById("story");
const approved = ["Close usage revenue in 6 hours instead of 4 days", "A design partner went from 4 days to 6 hours in their first close.", "Design partner, first close", "Ledgerline"];
const headline = approved[0];

function svg(body: string, w = 1200, h = 627): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

const GOOD = svg(
  `<rect width="1200" height="627" fill="#F4F1EA"/>` +
    `<text x="80" y="200" font-family="'Inter', sans-serif" font-size="64" font-weight="700" fill="#14120F">` +
    `<tspan x="80" dy="0">Close usage revenue</tspan><tspan x="80" dy="1.15em">in 6 hours instead of 4 days</tspan></text>` +
    `<text x="80" y="540" font-family="Georgia" font-size="24" fill="#14120F">Source: design partner, first close</text>`,
);

describe("sanitizeSvg", () => {
  it("keeps safe markup, forces the canvas size and finds text runs with their real line positions", () => {
    const s = sanitizeSvg(GOOD, linkedin);
    expect(s.svg).toContain('width="1200" height="627" viewBox="0 0 1200 627"');
    expect(s.removed).toEqual([]);
    expect(s.texts.map((t) => t.text)).toEqual(["Close usage revenue", "in 6 hours instead of 4 days", "Source: design partner, first close"]);
    expect(s.texts[0].y).toBe(200);
    expect(s.texts[1].y).toBeCloseTo(200 + 64 * 1.15);
    expect(s.texts[0].weight).toBe("700");
  });

  it("strips scripts, handlers, embedded HTML, external images and unsafe values", () => {
    const raw = svg(
      `<script>alert(1)</script><rect width="10" height="10" onclick="alert(1)" fill="url(https://evil.example/x)"/>` +
        `<image href="https://evil.example/a.png" width="10" height="10"/><foreignObject><div>hi</div></foreignObject>` +
        `<a href="javascript:alert(1)"><text x="1" y="1">x</text></a><style>*{}</style>`,
    );
    const s = sanitizeSvg(raw, linkedin);
    expect(s.svg).not.toMatch(/script|onclick|evil|foreignObject|<image|<a |<style|javascript/i);
    expect(s.removed).toEqual(expect.arrayContaining(["a script", "event handlers", "an external URL", "an image reference", "embedded HTML"]));
  });

  it("rewrites font families to an unquoted stack the renderer resolves", () => {
    expect(fontStack("'Playfair Display', serif")).toMatch(/^Playfair Display, Georgia, .*DejaVu Serif/);
    expect(fontStack('"Inter", system-ui, sans-serif')).toMatch(/^Inter, Helvetica Neue, .*DejaVu Sans/);
    expect(fontStack("Menlo, monospace")).toMatch(/^Menlo, SF Mono/);
    expect(fontStack("Inter")).not.toContain("'");
  });

  it("finds the image slot and puts it in paint order so text on it isn't contrast-checked against the background", () => {
    const raw = svg(`<rect width="1200" height="627" fill="#FFFFFF"/><rect data-slot="image" x="600" y="0" width="600" height="627" fill="#ccc"/><text x="700" y="300" font-size="40" fill="#FFFFFF">Ledgerline</text>`);
    const s = sanitizeSvg(raw, linkedin);
    expect(s.slot).toEqual({ x: 600, y: 0, w: 600, h: 627 });
    const checks = checkDesign(s, { preset: linkedin, approved, headline, needsSlot: true });
    expect(checks.map((c) => c.code)).not.toContain("LOW_CONTRAST");
    expect(checks.map((c) => c.code)).not.toContain("NO_IMAGE_SLOT");
  });

  it("returns an empty canvas when there's no svg element", () => {
    const s = sanitizeSvg("<div>nope</div>", linkedin);
    expect(s.texts).toEqual([]);
    expect(s.removed[0]).toMatch(/no <svg>/);
  });
});

describe("checkDesign", () => {
  const codes = (raw: string, preset = linkedin, extra: { needsSlot?: boolean; ad?: boolean } = {}) => checkDesign(sanitizeSvg(raw, preset), { preset, approved, headline, ...extra }).map((c) => c.code);

  it("passes a clean design", () => {
    expect(codes(GOOD)).toEqual([]);
  });

  it("flags words that aren't approved, but allows labels and split lines", () => {
    expect(codes(svg(`<rect width="1200" height="627" fill="#fff"/><text x="80" y="200" font-size="60" fill="#000">Trusted by 500 teams</text>`))).toContain("TEXT_NOT_APPROVED");
    expect(codes(svg(`<rect width="1200" height="627" fill="#fff"/><text x="80" y="200" font-size="60" fill="#000">Before</text><text x="80" y="300" font-size="60" fill="#000">4 days</text>`))).not.toContain("TEXT_NOT_APPROVED");
    // Whole words only: "use" is not approved just because "usage" is.
    expect(codes(svg(`<rect width="1200" height="627" fill="#fff"/><text x="80" y="200" font-size="60" fill="#000">use</text>`))).toContain("TEXT_NOT_APPROVED");
  });

  it("flags a missing headline", () => {
    expect(codes(svg(`<rect width="1200" height="627" fill="#fff"/><text x="80" y="200" font-size="60" fill="#000">Ledgerline</text>`))).toContain("TEXT_MISSING");
  });

  it("flags low contrast against the shape under the text, including gradient backgrounds", () => {
    expect(codes(svg(`<rect width="1200" height="627" fill="#F4F1EA"/><text x="80" y="200" font-size="60" fill="#E0DCD0">Close usage revenue in 6 hours instead of 4 days</text>`))).toContain("LOW_CONTRAST");
    const gradient = svg(
      `<defs><linearGradient id="bg"><stop offset="0" stop-color="#111111"/><stop offset="1" stop-color="#333333"/></linearGradient></defs><rect width="1200" height="627" fill="url(#bg)"/><text x="80" y="200" font-size="30" fill="#222222">Ledgerline</text>`,
    );
    expect(codes(gradient)).toContain("LOW_CONTRAST");
  });

  it("enforces story safe zones as errors", () => {
    const raw = svg(`<rect width="1080" height="1920" fill="#fff"/><text x="100" y="1800" font-size="60" fill="#000">Ledgerline</text>`, 1080, 1920);
    const checks = checkDesign(sanitizeSvg(raw, story), { preset: story, approved, headline });
    expect(checks.find((c) => c.code === "SAFE_ZONE")?.severity).toBe("error");
  });

  it("flags tiny type, text-heavy canvases, likely overflow, a declared size mismatch and a missing image slot", () => {
    expect(codes(svg(`<rect width="1200" height="627" fill="#fff"/><text x="80" y="200" font-size="12" fill="#000">Ledgerline</text>`))).toContain("SMALL_TYPE");
    const heavy = Array.from({ length: 6 }, (_, i) => `<text x="80" y="${90 + i * 90}" font-size="80" fill="#000">in 6 hours instead of 4 days</text>`).join("");
    expect(codes(svg(`<rect width="1200" height="627" fill="#fff"/>${heavy}`), linkedin, { ad: true })).toEqual(expect.arrayContaining(["TEXT_HEAVY", "OVERFLOW"]));
    // Meta's text-share guidance is about ads; organic graphics aren't flagged.
    expect(codes(svg(`<rect width="1200" height="627" fill="#fff"/>${heavy}`))).not.toContain("TEXT_HEAVY");
    expect(codes(svg(`<rect width="1080" height="1080" fill="#fff"/>`, 1080, 1080))).toContain("SIZE_MISMATCH");
    expect(codes(GOOD, linkedin, { needsSlot: true })).toContain("NO_IMAGE_SLOT");
  });
});

// System-font discovery and real PNG compositing can exceed Vitest's 5s default under load.
describe("renderPng", { timeout: 20000 }, () => {
  it("renders a sanitized design to a PNG of the preset size", () => {
    const s = sanitizeSvg(GOOD, linkedin);
    const png = renderPng({ svg: s.svg });
    expect(imageInfo(png)).toEqual({ mime: "image/png", width: 1200, height: 627 });
    const small = renderPng({ svg: s.svg, width: 600 });
    expect(imageInfo(small)?.width).toBe(600);
    if (process.env.STUDIO_RENDER_OUT) fs.writeFileSync(process.env.STUDIO_RENDER_OUT, png);
  });

  it("puts the image layer where the slot was, in paint order, and text painted after it stays on top", () => {
    const red = new Resvg(svg(`<rect width="400" height="300" fill="#FF0000"/>`, 400, 300)).render().asPng();
    saveStudioFile("img_redtest01.png", red);
    const image: StudioImage = { id: "img_redtest01", source: "upload", file: "img_redtest01.png", mime: "image/png", width: 400, height: 300, alt: "red", createdAt: "2026-10-26T00:00:00.000Z" };
    const s = sanitizeSvg(svg(`<rect width="1200" height="627" fill="#FFFFFF"/><rect data-slot="image" x="600" y="0" width="600" height="627" fill="#ccc"/><rect x="900" y="300" width="20" height="20" fill="#0000FF"/>`), linkedin);
    const composed = composeSvg(s.svg, image, s.slot!, "cover");
    expect(composed).not.toContain('data-slot="image"');
    const px = new Resvg(composed).render();
    const at = (x: number, y: number) => Array.from(px.pixels.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 3));
    expect(at(700, 100)).toEqual([255, 0, 0]); // image fills its slot
    expect(at(100, 100)).toEqual([255, 255, 255]); // background untouched
    expect(at(910, 310)).toEqual([0, 0, 255]); // painted after the slot: on top
    expect(imageInfo(thumbnail(image, 200)!)?.width).toBe(200);
    expect(imageInfo(thumbnailBytes(Buffer.from(red), image, 200))).toEqual({ mime: "image/png", width: 200, height: 150 });
  });
});

describe("studio files", () => {
  it("only reads and writes code-generated names", () => {
    expect(isSafeName("vis_a1b2c3d4e5.png")).toBe(true);
    expect(isSafeName("../settings.json")).toBe(false);
    expect(isSafeName("vis_a1b2c3d4e5.png/../../x")).toBe(false);
    expect(() => saveStudioFile("../x.png", "nope")).toThrow();
    expect(readStudioFile("../../etc/passwd")).toBeNull();
  });

  it("sweeps files nothing refers to, but not ones a run may still be saving", () => {
    saveStudioFile("vis_keep000001.png", "a");
    saveStudioFile("vis_orphan0001.png", "b");
    const ws = makeWorkspace();
    ws.studio.visuals.vis_keep000001 = { id: "vis_keep000001", pieceId: "p", optionId: "o", layout: "statement", preset: "og", width: 1200, height: 630, svgFile: "vis_keep000001.svg", pngFile: "vis_keep000001.png", why: "", checks: [], aiImagery: false, createdAt: "2026-10-26T00:00:00.000Z" };
    expect(sweepStudioFiles(ws)).toBe(0); // too new
    sweepStudioFiles(ws, Date.now() + 11 * 60_000);
    expect(readStudioFile("vis_keep000001.png")).not.toBeNull();
    expect(readStudioFile("vis_orphan0001.png")).toBeNull();
  });
});

describe("visual helpers", () => {
  it("sizes OpenAI requests to legal custom sizes with the frame's ratio", () => {
    for (const p of ["linkedin", "portrait", "square", "story", "og", "product_hunt"].map(presetById)) {
      const [w, h] = openaiSize(p.w, p.h, "gpt-image-2.5-sunburst").split("x").map(Number);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(w * h).toBeGreaterThanOrEqual(655_360);
      expect(w * h).toBeLessThanOrEqual(2560 * 1440);
      expect(Math.abs(w / h - p.w / p.h)).toBeLessThan(0.05);
    }
    expect(openaiSize(1200, 627, "some-older-model")).toBe("1536x1024");
  });

  it("labels aspect ratios", () => {
    expect(aspectLabel(1080, 1350)).toBe("4:5");
    expect(aspectLabel(1080, 1920)).toBe("9:16");
    expect(aspectLabel(1200, 627)).toBe("1.91:1");
  });

  it("checks image prompts for words, UI, fake customers and clichés", () => {
    expect(checkImagePrompt("A laptop on a kitchen table at 7am, overcast window light. No text anywhere.")).toEqual([]);
    expect(checkImagePrompt("A glowing brain made of neon circuitry")).toHaveLength(1);
    expect(checkImagePrompt("A sign with the words 'Close faster'")).toHaveLength(1);
    expect(checkImagePrompt("A dashboard showing revenue")).toHaveLength(1);
    expect(checkImagePrompt("A happy customer smiling at her phone")).toHaveLength(1);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 0);
    expect(contrastRatio(parseColor("rgb(118,118,118)")!, parseColor("white")!)).toBeGreaterThan(4.5);
  });

  it("reads PNG and JPEG dimensions and rejects other files", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x00, 0x00]);
    expect(imageInfo(jpeg)).toEqual({ mime: "image/jpeg", width: 800, height: 600 });
    expect(imageInfo(Buffer.from("GIF89a................................"))).toBeNull();
  });
});
