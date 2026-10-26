import "server-only";
import fs from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";
import { TOOL_DOMAINS } from "@/lib/connectors/catalog";
import { writeFileAtomic } from "@/lib/store/data-file";
import { DATA_DIR, readSettings } from "@/lib/store/settings";
import { fetchBytes, fetchText, toDomain } from "./http";

/**
 * Company icons for /api/favicon, from each company's own website and nobody else. A favicon service
 * (Google's s2) would be told every domain on the founder's target list, which is exactly the list a
 * founder keeps private. So:
 *  - Off by default: the UI shows the company's first letter and nothing is fetched.
 *  - With Settings → General → Company icons on "Each company's own icon", the server asks the company's
 *    site for its icon (the homepage's <link rel="icon">, else /favicon.ico) through the same SSRF guard
 *    as research, keeps it under cache/icons for 30 days (a miss for 7), and serves it same-origin.
 *  - The marks of the tools Inroad connects to (HubSpot, Slack…) are always fetched that way: they say
 *    nothing about the founder's prospects.
 * Raster images only: an SVG served from this origin could run script.
 */

export type IconType = "image/png" | "image/x-icon" | "image/gif" | "image/jpeg" | "image/webp";
export interface Icon {
  type: IconType;
  bytes: Buffer;
}

const HIT_TTL = 30 * 86_400_000;
const MISS_TTL = 7 * 86_400_000;
const ICONS_DIR = () => path.join(DATA_DIR, "cache", "icons");

/** The image format from its first bytes, whatever the server claimed. Null for SVG, HTML and anything else. */
export function sniffImage(b: Uint8Array): IconType | null {
  if (b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return "image/x-icon";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/**
 * Icon URLs a page declares, best first: sizes nearest 64px, PNG before ICO, apple-touch-icon after the
 * real icons, never SVG. Relative hrefs resolve against the page's own (final) URL.
 */
export function iconLinks(html: string, pageUrl: string): string[] {
  const root = parse(html);
  const found: { url: string; score: number }[] = [];
  for (const el of root.querySelectorAll("link")) {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("icon") && !rel.includes("apple-touch-icon")) continue;
    const href = el.getAttribute("href")?.trim();
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (!href || type.includes("svg") || /\.svg(\?|#|$)/i.test(href)) continue;
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:|^data:image\//i.test(url)) continue;
    const size = Number((el.getAttribute("sizes") ?? "").match(/(\d+)x\d+/i)?.[1] ?? 0);
    const score = (rel.includes("icon") ? 0 : 50) + (size ? Math.abs(64 - size) / 4 : 10) + (/\.png(\?|$)|image\/png/i.test(url + type) ? 0 : 5);
    found.push({ url, score });
  }
  return found.sort((a, b) => a.score - b.score).map((f) => f.url);
}

/** Is fetching this domain's icon allowed? Only with the setting on, or for a tool Inroad connects to. */
export function iconsAllowed(domain: string): boolean {
  return TOOL_DOMAINS.has(domain) || readSettings().companyIcons === "site";
}

type Cached = { at: number; type?: IconType; data?: string };

function cacheFile(domain: string) {
  return path.join(ICONS_DIR(), `${domain.replace(/[^a-z0-9.-]/gi, "_")}.json`);
}

function readCached(domain: string, now: number): Icon | null | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(domain), "utf8")) as Cached;
    if (now - c.at > (c.data ? HIT_TTL : MISS_TTL)) return undefined;
    return c.data && c.type ? { type: c.type, bytes: Buffer.from(c.data, "base64") } : null;
  } catch {
    return undefined;
  }
}

function writeCached(domain: string, icon: Icon | null, now: number) {
  try {
    const c: Cached = icon ? { at: now, type: icon.type, data: icon.bytes.toString("base64") } : { at: now };
    writeFileAtomic(cacheFile(domain), JSON.stringify(c));
  } catch {
    // the cache is best-effort
  }
}

function decodeDataUrl(url: string): Buffer | null {
  const m = url.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  return m ? Buffer.from(m[1], "base64") : null;
}

async function fetchIcon(domain: string): Promise<Icon | null> {
  const home = await fetchText(`https://${domain}/`, { timeoutMs: 6_000, maxBytes: 400_000 });
  const candidates = [...(home ? iconLinks(home.body, home.url) : []), `https://${domain}/favicon.ico`];
  for (const url of [...new Set(candidates)].slice(0, 4)) {
    const bytes = url.startsWith("data:") ? decodeDataUrl(url) : (await fetchBytes(url))?.bytes;
    const type = bytes && bytes.length <= 200_000 ? sniffImage(bytes) : null;
    if (bytes && type) return { type, bytes };
  }
  return null;
}

const g = globalThis as unknown as { __inroadIcons?: Map<string, Promise<Icon | null>> };
const inflight = (g.__inroadIcons ??= new Map());

/** The icon for a domain from the disk cache or the company's own site; null when it has none we can show. */
export async function companyIcon(raw: string, now = Date.now()): Promise<Icon | null> {
  const domain = toDomain(raw);
  if (!domain) return null;
  const hit = readCached(domain, now);
  if (hit !== undefined) return hit;
  let p = inflight.get(domain);
  if (!p) {
    p = fetchIcon(domain)
      .then((icon) => {
        writeCached(domain, icon, now);
        return icon;
      })
      .finally(() => inflight.delete(domain));
    inflight.set(domain, p);
  }
  return p;
}
