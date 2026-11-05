#!/usr/bin/env node
/**
 * WCAG 2 contrast for the text tokens in src/app/globals.css, both themes: `node scripts/contrast.mjs`.
 * --fg-2 and --fg-3 carry real words and numbers, so they need 4.5:1 on every paper they sit on; --fg-4 is for
 * decoration and disabled text and needs 3:1. Exits non-zero when a pair falls short.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");

/** The hex tokens declared in the first block that opens with `selector`. */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block in globals.css`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { light: tokens(":root"), dark: tokens('[data-theme="dark"]') };
const PAPERS = ["bg", "bg-subtle", "surface", "surface-raised"];
const NEEDS = { "fg-2": 4.5, "fg-3": 4.5, "fg-4": 3 };

let short = 0;
for (const [theme, t] of Object.entries(THEMES)) {
  console.log(`\n${theme}`);
  for (const [fg, need] of Object.entries(NEEDS)) {
    const cells = PAPERS.map((paper) => {
      const ratio = contrast(t[fg], t[paper]);
      if (ratio < need) short++;
      return `${paper} ${ratio.toFixed(2)}${ratio < need ? " ✗" : ""}`;
    });
    console.log(`  --${fg} ${t[fg]} (needs ${need}:1)  ${cells.join("  ")}`);
  }
}
if (short) {
  console.error(`\n${short} pair${short === 1 ? "" : "s"} below the bar.`);
  process.exit(1);
}
