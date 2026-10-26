import "server-only";
import { parse, type HTMLElement } from "node-html-parser";
import { fetchText } from "./http";

/**
 * Zero-token website reading. We crawl a handful of high-signal pages ourselves and hand
 * Claude a compact digest, instead of paying for an agent to browse.
 */

export interface PageDigest {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
}

export interface SiteDigest {
  domain: string;
  name: string;
  pages: PageDigest[];
  /** Detected applicant-tracking boards, e.g. { provider: "greenhouse", token: "acme" }. */
  jobBoards: { provider: "greenhouse" | "lever" | "ashby" | "workable"; token: string }[];
  socials: { linkedin?: string; x?: string; github?: string };
  tech: string[];
}

const KEY_PAGES: { kind: string; patterns: RegExp }[] = [
  { kind: "pricing", patterns: /\/(pricing|plans)(\/|$)/i },
  { kind: "customers", patterns: /\/(customers|case-studies|customer-stories|stories)(\/|$)/i },
  { kind: "about", patterns: /\/(about|company|about-us)(\/|$)/i },
  { kind: "product", patterns: /\/(product|platform|features|solutions)(\/|$)/i },
  { kind: "careers", patterns: /\/(careers|jobs|join|join-us)(\/|$)/i },
];

/**
 * Vendor script hosts and init snippets only, tested against what a page loads (see resourcesOf),
 * never its text: a customer logo or "Integrates with Marketo" is not their stack, and a cold
 * email built on that false premise is worse than none.
 */
const TECH_SIGNATURES: [string, RegExp][] = [
  ["HubSpot", /js\.hs-scripts\.com|js\.hs-analytics\.net|js\.hsforms\.net/i],
  ["Salesforce Pardot", /pardot\.com|pi\.pardot/i],
  ["Marketo", /munchkin\.marketo\.net|Munchkin\.init/],
  ["Segment", /cdn\.segment\.com/i],
  ["Intercom", /widget\.intercom\.io|intercomSettings/i],
  ["Drift", /js\.driftt\.com/i],
  ["Stripe", /js\.stripe\.com/i],
  ["Webflow", /data-wf-(page|site)/i],
  ["Framer", /framerusercontent|framer\.com\/m\//i],
  ["Next.js", /__NEXT_DATA__|\/_next\/static/i],
  ["Google Tag Manager", /googletagmanager\.com/i],
  ["Mixpanel", /cdn4?\.mxpnl\.com|mixpanel\.init/],
  ["Amplitude", /cdn\.amplitude\.com|amplitude\.getInstance/],
  ["PostHog", /\.i\.posthog\.com|app\.posthog\.com|posthog\.init/],
  ["Calendly", /assets\.calendly\.com/i],
  ["Clearbit", /tag\.clearbitscripts\.com|x\.clearbitjs\.com/i],
  ["6sense", /j\.6sc\.co/i],
  ["Qualified", /js\.qualified\.com/i],
  ["Zendesk", /static\.zdassets\.com/i],
];

function clean(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export function digestPage(url: string, html: string, maxChars: number): PageDigest {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const title = clean(root.querySelector("title")?.text ?? "");
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const headings = root
    .querySelectorAll("h1, h2, h3")
    .map((h) => clean(h.text))
    .filter((h) => h.length > 2 && h.length < 140)
    .slice(0, 24);

  for (const el of root.querySelectorAll("nav, footer, svg, form, iframe, [aria-hidden=true], .cookie, #cookie-banner")) {
    el.remove();
  }
  const body = (root.querySelector("main") ?? root.querySelector("body") ?? root) as HTMLElement;
  const text = clean((body.structuredText ?? body.text).replace(/<!DOCTYPE[^>]*>/gi, "")).slice(0, maxChars);
  return { url, title, description, headings: [...new Set(headings)], text };
}

/** What a page loads, not what it says: script/stylesheet/iframe URLs, inline scripts, <html> attributes. */
function resourcesOf(root: HTMLElement): string {
  const out = [root.querySelector("html")?.rawAttrs ?? ""];
  for (const el of root.querySelectorAll("script, link[href], iframe[src]")) {
    if (el.tagName === "SCRIPT") out.push(el.getAttribute("src") ?? "", el.rawText);
    else out.push(el.getAttribute("href") ?? el.getAttribute("src") ?? "");
  }
  return out.join("\n");
}

function detectJobBoards(html: string): SiteDigest["jobBoards"] {
  const found = new Map<string, SiteDigest["jobBoards"][number]>();
  const add = (provider: SiteDigest["jobBoards"][number]["provider"], token: string) => {
    const t = token.toLowerCase();
    if (!t || ["embed", "js", "api", "v1", "jobs"].includes(t)) return;
    found.set(`${provider}:${t}`, { provider, token: t });
  };
  for (const m of html.matchAll(/(?:boards|job-boards)(?:-api)?\.greenhouse\.io\/(?:embed\/job_board\?for=|v1\/boards\/)?([a-z0-9_-]+)/gi)) add("greenhouse", m[1]);
  for (const m of html.matchAll(/jobs\.lever\.co\/([a-z0-9_-]+)/gi)) add("lever", m[1]);
  for (const m of html.matchAll(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi)) add("ashby", m[1]);
  for (const m of html.matchAll(/apply\.workable\.com\/([a-z0-9_-]+)/gi)) add("workable", m[1]);
  return [...found.values()];
}

function detectSocials(html: string): SiteDigest["socials"] {
  const pick = (re: RegExp) => html.match(re)?.[0];
  return {
    linkedin: pick(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-z0-9_-]+/i),
    x: pick(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share)[a-z0-9_]+/i),
    github: pick(/https?:\/\/(?:www\.)?github\.com\/(?!features|login|about)[a-z0-9_-]+/i),
  };
}

export async function crawlSite(domain: string, { maxPages = 4, perPageChars = 3500 } = {}): Promise<SiteDigest | null> {
  const home = (await fetchText(`https://${domain}`)) ?? (await fetchText(`https://www.${domain}`));
  if (!home) return null;

  const root = parse(home.body);
  const base = new URL(home.url);
  const links = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    try {
      const u = new URL(a.getAttribute("href") ?? "", base);
      if (u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) {
        links.add(`${u.origin}${u.pathname.replace(/\/$/, "")}`);
      }
    } catch {
      // ignore malformed hrefs
    }
  }

  const chosen: string[] = [];
  for (const { patterns } of KEY_PAGES) {
    const match = [...links].filter((l) => patterns.test(new URL(l).pathname)).sort((a, b) => a.length - b.length)[0];
    if (match && !chosen.includes(match)) chosen.push(match);
    if (chosen.length >= maxPages) break;
  }

  const subpages = await Promise.all(chosen.map((url) => fetchText(url).then((r) => (r ? { url: r.url, html: r.body } : null))));
  const allHtml = [home.body, ...subpages.filter(Boolean).map((p) => p!.html)].join("\n");
  const resources = [resourcesOf(root), ...subpages.filter(Boolean).map((p) => resourcesOf(parse(p!.html)))].join("\n");

  const pages = [
    digestPage(home.url, home.body, perPageChars * 1.5),
    ...subpages.filter(Boolean).map((p) => digestPage(p!.url, p!.html, perPageChars)),
  ];

  const ogName = root.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim();
  const titleName = pages[0].title.split(/[|\-–—:]/)[0]?.trim();

  return {
    domain,
    name: ogName || titleName || domain,
    pages,
    jobBoards: detectJobBoards(allHtml),
    socials: detectSocials(allHtml),
    tech: TECH_SIGNATURES.filter(([, re]) => re.test(resources)).map(([name]) => name),
  };
}

/** Compact text for a prompt. Roughly 1 token per 4 characters. */
export function siteDigestToText(site: SiteDigest): string {
  const lines = [`Website: ${site.domain} (${site.name})`];
  if (site.tech.length) lines.push(`Scripts loaded on their site: ${site.tech.join(", ")}`);
  for (const p of site.pages) {
    lines.push("", `## ${p.url}`, p.title && `Title: ${p.title}`, p.description && `Description: ${p.description}`);
    if (p.headings.length) lines.push(`Headings: ${p.headings.join(" · ")}`);
    lines.push(p.text);
  }
  return lines.filter(Boolean).join("\n");
}
