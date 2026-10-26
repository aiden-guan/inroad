import "server-only";
import { parse } from "node-html-parser";
import { z } from "zod";
import { AgentError, defineTool } from "@/lib/ai/engine";
import { coreFor, taskHeader } from "@/lib/ai/prompts/core";
import { BANNED_WORDS, CHIP_LABELS, CONSUMER_FOUNDATION_RULES, FOUNDATION_RULES, SNAPSHOT_RULES } from "@/lib/ai/prompts/foundation";
import { readMarket, type MarketRead } from "@/lib/consumer/market";
import { consumerChannelPlan, consumerCommercial, consumerGoal, growthDefaults } from "@/lib/consumer/plan";
import { daysBetween, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type {
  ChannelPlan,
  CommercialDefault,
  CompanySnapshot,
  Competitor,
  ConsumerModel,
  Evidence,
  FounderQuestion,
  Foundation,
  FoundationSection,
  ICP,
  GrowthModel,
  LearningChip,
  Market,
  Motion,
  OnboardingLedgerRow,
  Persona,
  Provenance,
  Workspace,
} from "@/lib/domain/types";
import { keepVersion } from "@/lib/playbook/revision";
import { runSteps, startRun } from "@/lib/runs/registry";
import { gatherSignals, type CompanySignals } from "@/lib/signals";
import { TTL, cached, invalidate } from "@/lib/signals/cache";
import { fetchText, toDomain } from "@/lib/signals/http";
import { siteDigestToText, type PageDigest, type SiteDigest } from "@/lib/signals/website";
import { ycByDomain, ycDirectory, type YcCompany } from "@/lib/signals/yc";
import discovery from "./discovery";
import partners from "./partners";
import { defineWorkflow } from "./types";

/**
 * W1 — the first bet (first run, also usable as a refresh).
 *
 *   1. Code reads the founder's site page by page (each page lands in the reading ledger with its real duration),
 *      then gathers DNS, job board, news, HN and the YC directory for free.
 *   2. Fast tier, effort low: "What I learned" chips (non-terminal share_learning, quotes checked against the page)
 *      and the company snapshot.
 *   3. Strategist, effort high, ≤3 searches for competitors: positioning → ICP bet → personas → messaging → questions,
 *      each persisted the moment it arrives via the non-terminal submit_section. Founder answers that arrive mid-run
 *      ride back on submit_section results, so no extra turns are spent polling for them.
 *   4. Code fills the rest: funnel math, channel plan, commercial default, provenance stamps.
 *   When the ICP lands, the discovery fast lane (3 accounts) starts in parallel.
 */

const Args = z.object({
  url: z.string().max(300).optional(),
  note: z.string().max(2000).optional(),
  founderName: z.string().max(80).optional(),
  /** "refresh" rebuilds the bet without touching the first-run state. */
  mode: z.enum(["onboarding", "refresh"]).optional(),
  /** The founder's "Who buys from you?" pick. Unset = the site decides (code read, then the snapshot). */
  market: z.enum(["b2b", "consumer"]).optional(),
  consumerModel: z.enum(["app", "dtc", "marketplace", "social", "prosumer"]).optional(),
});

const MAX_SUBPAGES = 4; // + home. Matches gatherSignals' default so its site cache key is shared.
const ALT_KINDS = ["competitor", "status_quo", "in_house", "hire"] as const;
const SIGNAL_TYPES = [
  "champion_job_change",
  "first_hire",
  "jd_names_pain",
  "new_leader",
  "funding",
  "stack_change",
  "launch",
  "compliance_deadline",
  "persona_post",
  "community_request",
  "public_pain",
  "filing",
  "hiring",
] as const;
const DETECTION = ["job_posts", "form_d", "press", "site", "yc_directory", "github", "dns", "hn", "founder_knowledge"] as const;
const REQUIRED: FoundationSection[] = ["positioning", "icp", "personas", "messaging"];
const BET_SECTIONS = ["positioning", "icp", "personas", "messaging", "questions"] as const;
/** Consumer bets add the growth model (not required: code has a default for every model). */
const CONSUMER_BET_SECTIONS = [...BET_SECTIONS, "growth"] as const;
const CONSUMER_MODELS = ["app", "dtc", "marketplace", "social", "prosumer"] as const;
const CONSUMER_SIGNAL_TYPES = ["life_event", "seasonal", "trend", "competitor_gap", "community_request", "public_pain", "launch", "persona_post"] as const;
const CONSUMER_DETECTION = ["community", "social", "app_reviews", "search_trends", "survey", "site", "press", "founder_knowledge"] as const;

/* ───────────────────────────── Reading the site (code, zero tokens) ───────────────────────────── */

const SUBPAGES: { label: string; re: RegExp }[] = [
  { label: "Pricing", re: /\/(pricing|plans)(\/|$)/i },
  { label: "Customers", re: /\/(customers|case-studies|customer-stories|stories|testimonials)(\/|$)/i },
  { label: "About", re: /\/(about|about-us|company|team)(\/|$)/i },
  { label: "Product", re: /\/(product|platform|features|how-it-works|solutions)(\/|$)/i },
];

interface PageRead {
  url: string;
  label: string;
  title: string;
  ms: number;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function digestPage(url: string, html: string, maxChars: number): PageDigest {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const title = clean(root.querySelector("title")?.text ?? "");
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const headings = [
    ...new Set(
      root
        .querySelectorAll("h1, h2, h3")
        .map((h) => clean(h.text))
        .filter((h) => h.length > 2 && h.length < 140),
    ),
  ].slice(0, 24);
  for (const el of root.querySelectorAll("nav, footer, svg, form, iframe, [aria-hidden=true]")) el.remove();
  const body = root.querySelector("main") ?? root.querySelector("body") ?? root;
  return { url, title, description, headings, text: clean(body.structuredText ?? body.text).slice(0, maxChars) };
}

function jobBoards(html: string): SiteDigest["jobBoards"] {
  const found = new Map<string, SiteDigest["jobBoards"][number]>();
  const add = (provider: SiteDigest["jobBoards"][number]["provider"], token: string) => {
    const t = token.toLowerCase();
    if (t && !["embed", "js", "api", "v1", "jobs"].includes(t)) found.set(`${provider}:${t}`, { provider, token: t });
  };
  for (const m of html.matchAll(/(?:boards|job-boards)(?:-api)?\.greenhouse\.io\/(?:embed\/job_board\?for=|v1\/boards\/)?([a-z0-9_-]+)/gi)) add("greenhouse", m[1]);
  for (const m of html.matchAll(/jobs\.lever\.co\/([a-z0-9_-]+)/gi)) add("lever", m[1]);
  for (const m of html.matchAll(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi)) add("ashby", m[1]);
  return [...found.values()];
}

async function timed(url: string) {
  const started = Date.now();
  const res = await fetchText(url);
  return { res, ms: Date.now() - started };
}

/**
 * Reads the home page and up to 4 key pages, reporting each one the moment it lands. We crawl here rather than in
 * gatherSignals so the ledger shows real pages with real durations; the digest is written to gatherSignals' cache.
 */
async function readSite(domain: string, onPage: (page: PageRead) => Promise<void>): Promise<{ site: SiteDigest; spa: boolean; market: MarketRead } | null> {
  let home = await timed(`https://${domain}`);
  if (!home.res) home = await timed(`https://www.${domain}`);
  if (!home.res) return null;

  const homePage = digestPage(home.res.url, home.res.body, 5000);
  await onPage({ url: home.res.url, label: "Home", title: homePage.title, ms: home.ms });

  const root = parse(home.res.body);
  const base = new URL(home.res.url);
  const sameHost = (h: string) => h.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  const links = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    try {
      const u = new URL(a.getAttribute("href") ?? "", base);
      if (sameHost(u.hostname)) links.add(`${u.origin}${u.pathname.replace(/\/$/, "")}`);
    } catch {
      // malformed href
    }
  }
  const chosen: { url: string; label: string }[] = [];
  for (const { label, re } of SUBPAGES) {
    const match = [...links].filter((l) => re.test(new URL(l).pathname)).sort((a, b) => a.length - b.length)[0];
    if (match && !chosen.some((c) => c.url === match)) chosen.push({ url: match, label });
  }

  const seen = new Set([home.res.url.replace(/\/$/, "")]);
  const subpages = await Promise.all(
    chosen.slice(0, MAX_SUBPAGES).map(async ({ url, label }) => {
      const { res, ms } = await timed(url);
      const final = res?.url.replace(/\/$/, "");
      if (!res || !final || seen.has(final)) return null; // redirected home, or failed
      seen.add(final);
      const page = digestPage(res.url, res.body, 3500);
      await onPage({ url: res.url, label, title: page.title, ms });
      return { page, html: res.body };
    }),
  );
  const ok = subpages.filter((p): p is { page: PageDigest; html: string } => !!p);
  const allHtml = [home.res.body, ...ok.map((p) => p.html)].join("\n");
  const ogName = root.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim();
  const titleName = homePage.title.split(/[|\-–—:·]/)[0]?.trim();
  const spa =
    homePage.text.length < 600 && /<div[^>]+id=["'](root|app|__next)["']|data-reactroot|ng-version|__NUXT__|<noscript>[^<]{0,200}javascript/i.test(home.res.body);

  const pages = [homePage, ...ok.map((p) => p.page)];
  return {
    spa,
    market: readMarket(allHtml, pages.map((p) => [p.title, p.description, p.headings.join(" "), p.text].join(" ")).join("\n")),
    site: {
      domain,
      name: ogName || titleName || domain,
      pages: [homePage, ...ok.map((p) => p.page)],
      jobBoards: jobBoards(allHtml),
      socials: {},
      tech: [],
    },
  };
}

/* ───────────────────────────── Evidence checks ───────────────────────────── */

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function urlKey(u: string) {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "");
}

/** Verbatim check: normalized substring, or ≥85% of 5-word shingles present. Ellipses split the quote into parts. */
function quoteMatches(quote: string, text: string): boolean {
  const t = norm(text);
  const parts = norm(quote)
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .split(/\s*(?:\.\.\.|…)\s*/)
    .filter((p) => p.split(" ").length >= 2);
  if (!parts.length) return false;
  return parts.every((p) => {
    if (t.includes(p)) return true;
    const words = p.split(" ");
    if (words.length < 6) return false;
    const shingles = Array.from({ length: words.length - 4 }, (_, i) => words.slice(i, i + 5).join(" "));
    return shingles.filter((s) => t.includes(s)).length / shingles.length >= 0.85;
  });
}

function pageText(p: PageDigest) {
  return [p.title, p.description, p.headings.join(" · "), p.text].join(" \n ");
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Every URL the strategist saw this run (search results, fetches), so competitor links can't be invented. */
function seenUrls(messages: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages as { content?: unknown }[]) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as { type?: string; content?: unknown }[]) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content as { url?: string }[]) if (r.url) out.add(urlKey(r.url));
      } else if (b.type === "web_fetch_tool_result") {
        const url = (b.content as { url?: string } | undefined)?.url;
        if (url) out.add(urlKey(url));
      }
    }
  }
  return out;
}

/* ───────────────────────────── Founder input ───────────────────────────── */

function founderLines(ws: Workspace): string[] {
  const o = ws.onboarding;
  const a = o.answers ?? {};
  const lines: string[] = [];
  const pick = ws.company?.marketSource === "founder" ? ws.company.market : o.market;
  if (pick) lines.push(`Who buys (founder's pick, final): ${pick === "consumer" ? "consumers" : "businesses"}${pick === "consumer" && ws.company?.marketSource === "founder" && ws.company.consumerModel ? ` (${ws.company.consumerModel})` : ""}`);
  if (o.note) lines.push(`Founder's note: ${o.note}`);
  if (a.who) lines.push(`Who buys (founder): ${a.who}`);
  if (a.last3) lines.push(`Last 3 users or design partners: ${a.last3}`);
  if (a.before) lines.push(`What they did before: ${a.before}`);
  for (const c of ws.company?.chips ?? []) {
    if (c.rejected) lines.push(`Founder says this is wrong · ${c.label}: "${c.text}". Don't use or cite it.`);
    else if (c.corrected) lines.push(`Correction · ${c.label}: ${c.text}`);
  }
  return lines;
}

/** Proof the founder marked wrong (a rejected Proof chip), matched by its quote, so it never reaches the snapshot or the bet. */
function rejectedProof(ws: Workspace): (quote: string | undefined) => boolean {
  const wrong = (ws.company?.chips ?? [])
    .filter((c) => c.key === "proof" && c.rejected)
    .flatMap((c) => c.evidenceIds.map((id) => ws.evidence[id]?.quote))
    .filter((q): q is string => !!q)
    .map(norm);
  return (quote) => {
    const q = quote ? norm(quote) : "";
    return !!q && wrong.some((w) => w.includes(q) || q.includes(w));
  };
}

function founderBlock(ws: Workspace) {
  const lines = founderLines(ws);
  return `<founder_input>\n${lines.length ? lines.join("\n") : "Nothing yet."}\n</founder_input>`;
}

function answerCount(ws: Workspace) {
  const a = ws.onboarding.answers ?? {};
  return [a.last3, a.before, a.who, ws.onboarding.note].filter((x) => x?.trim()).length + (ws.company?.chips.filter((c) => c.corrected || c.rejected).length ?? 0);
}

function provenance(ws: Workspace): Provenance {
  const siteSources = ws.onboarding.pagesRead ?? 0;
  const founderAnswers = answerCount(ws);
  const from = siteSources ? "From your site" : "From your description";
  const plus = founderAnswers ? ` + ${founderAnswers} answer${founderAnswers === 1 ? "" : "s"}` : "";
  return { siteSources, founderAnswers, conversationsConfirming: 0, label: `${from}${plus} · 0 conversations confirm this` };
}

/** Domains the founder named as recent users ("acme.com, northwind.io, Dana at Globex" → acme.com, northwind.io). */
function seedDomains(text: string | undefined, own: string | null): string[] {
  const found = (text ?? "").match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [];
  return [...new Set(found.map((d) => toDomain(d)).filter((d): d is string => !!d && d !== own))].slice(0, 10);
}

function namedCustomers(text: string | undefined) {
  return (text ?? "")
    .split(/,|;|\n|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1).length;
}

/* ───────────────────────────── Code-filled sections ───────────────────────────── */

type B2BMotion = Extract<Motion, "warm_network" | "signal_cold" | "investor_intros" | "communities" | "founder_content" | "exec_dinners" | "design_partner_program" | "launches">;

/** The code-filled parts for this workspace's market: the channel plan and the commercial default. */
function planFor(ws: Workspace, stage: CompanySnapshot["stage"]): ChannelPlan {
  return ws.company?.market === "consumer" ? consumerChannelPlan(ws) : channelPlan(ws, stage);
}

function commercialFor(ws: Workspace, band: ICP["employeeBand"], prev?: CommercialDefault): CommercialDefault {
  return ws.company?.market === "consumer" ? consumerCommercial(ws.company) : commercialDefault(ws.company, band, prev);
}

/** The goal is an output of capacity: meetings needed ÷ what the cold cap yields = the intro asks to plan for. */
function channelPlan(ws: Workspace, stage: CompanySnapshot["stage"]): ChannelPlan {
  const { goal, caps } = ws;
  const weeks = Math.max(4, Math.round(daysBetween(todayISO(), goal.byDate) / 7) || 12);
  const qualifiedNeeded = Math.ceil(goal.target / Math.max(0.05, goal.winRate));
  const discoveryCallsNeeded = Math.ceil(qualifiedNeeded / Math.max(0.05, goal.discoveryToQualified));
  const meetingsPerWeek = discoveryCallsNeeded / weeks;
  const coldMeetings = caps.firstTouchesPerWeek * goal.meetingRate;
  const INTRO_TO_MEETING = 0.35; // .5 of asks get made × .7 of intros meet (Inroad heuristic)
  const introAsks = Math.max(4, Math.ceil(Math.max(0, meetingsPerWeek - coldMeetings) / INTRO_TO_MEETING));
  const warning =
    introAsks > 8
      ? `Reaching ${goal.target} ${goal.targetLabel} by ${goal.byDate} takes about ${introAsks} intro asks a week on top of ${caps.firstTouchesPerWeek} cold emails. If your network can't carry that, add a monthly roundtable or give it more weeks. More cold email isn't the lever.`
      : undefined;

  const early = stage === "pre_launch" || stage === "design_partners";
  const all: Record<B2BMotion, Omit<ChannelPlan["motions"][number], "rank" | "motion">> = {
    design_partner_program: {
      why: "Before the product is proven, paid design partners buy you references and a real launch date.",
      weeklyTarget: "2 design-partner conversations",
      firstActions: ["Write the design-partner terms (paid, with a conversion date)", "List 10 teams who'd shape the product", "Ask each investor for 2 of them"],
    },
    warm_network: {
      why: "People who already know you or your product answer first. Every week starts here.",
      weeklyTarget: "3 warm asks to people who know you",
      firstActions: ["Import your LinkedIn connections", "Tag past users, design partners and ex-colleagues", "Ask your last 3 users who else has this problem"],
    },
    investor_intros: {
      why: "A specific ask turns investors and advisors into your best channel.",
      weeklyTarget: `${introAsks} intro asks to named companies`,
      firstActions: ["Send each investor 3 named target companies, not a vague ask", "Give them a 3-line forwardable blurb"],
    },
    signal_cold: {
      why: "Cold works when it rests on a dated, public reason to talk now and a point of view only you have.",
      weeklyTarget: `Up to ${caps.firstTouchesPerWeek} researched first emails (no more than ${caps.firstTouchesPerDayMax} a day)`,
      firstActions: ["Research the first 3 companies", "Write down one thing you've seen about the problem that most buyers haven't"],
    },
    communities: {
      why: "Your buyers ask for help in public. A useful answer there beats a cold email.",
      weeklyTarget: "3 helpful replies where buyers ask, no pitch",
      firstActions: ["Find the 2 communities where your buyer asks for help", "Answer one question this week"],
    },
    founder_content: {
      why: "Writing what you learn in calls makes later outreach warmer.",
      weeklyTarget: "1 optional post a week, from what you see in calls",
      firstActions: ["Post one pattern from your last 5 conversations"],
    },
    exec_dinners: {
      why: "A room of peers gets busy buyers to show up. Start with a virtual roundtable; host a dinner only with a co-host.",
      weeklyTarget: "1 roundtable a month",
      firstActions: ["Pick one question your buyers argue about", "Ask a customer or investor to co-host"],
    },
    launches: {
      why: "A launch is a spike, not a channel. Show HN only if people can try it without talking to sales.",
      weeklyTarget: "One launch when there's something to try",
      firstActions: ["Line up 5 users to comment honestly on launch day"],
    },
  };
  const order: B2BMotion[] = early
    ? ["design_partner_program", "warm_network", "investor_intros", "communities", "signal_cold", "founder_content", "exec_dinners"]
    : ["warm_network", "investor_intros", "signal_cold", "communities", "founder_content", "exec_dinners", "launches"];

  return {
    funnel: {
      qualifiedNeeded,
      discoveryCallsNeeded,
      coldContactsNeeded: caps.firstTouchesPerWeek * weeks,
      perWeek: {
        conversations: Math.ceil(meetingsPerWeek),
        firstTouches: caps.firstTouchesPerWeek,
        introAsks,
        meetings: Math.round(meetingsPerWeek * 10) / 10,
      },
      warning,
    },
    motions: order.map((motion, i) => ({ motion, rank: i + 1, ...all[motion] })),
  };
}

/**
 * A corrected Stage chip, in the founder's words, mapped to the stage enum (null when nothing matches). Pre-launch and
 * design partners are checked first: "unpaid" and "no paying customers yet" contain the later patterns' words.
 */
function stageFromText(t: string | undefined): CompanySnapshot["stage"] | null {
  if (!t) return null;
  if (/pre-?launch|waitlist|coming soon|not (yet )?(live|launched)|no product/i.test(t)) return "pre_launch";
  if (/design partner|early access|\bbeta\b|unpaid|no (paying )?customers/i.test(t)) return "design_partners";
  if (/scal|series [b-z]\b|\b\d{2,}\+? (paying )?customers/i.test(t)) return "scaling";
  if (/paying|revenue|\b(arr|mrr)\b|customers/i.test(t)) return "early_revenue";
  return null;
}

const BANDS: Record<NonNullable<ICP["employeeBand"]>, string> = {
  lt50: "First annual contract $5–25K; pilot $1–5K",
  "50_300": "First annual contract $15–60K; pilot $5–15K",
  gt300: "First annual contract $50–150K; pilot $10–30K (skip $10K “feedback” deals at enterprise)",
  mixed: "First annual contract $15–60K; pilot $5–15K",
};

/** Paid from day one. Bands are Inroad heuristics until 5 real quotes replace them. */
function commercialDefault(company: CompanySnapshot | null, band: ICP["employeeBand"], prev?: CommercialDefault): CommercialDefault {
  const stage = company?.stage ?? "unknown";
  const days = prev?.daysToFirstValue;
  // Same rule as the Playbook card (SPEC): max(14, 2 × days to first value), capped at 45.
  const pilotDays = days && days > 0 ? Math.min(45, Math.max(14, Math.round(days * 2))) : 14;
  const priceAnchor = `${BANDS[band ?? "mixed"]}. A starting band (Inroad heuristic) until your quote log has 5 quotes. Price on value: about 10–20% of the annual value you quantify in discovery.`;
  const discountRule = "Discount only in exchange for something: a case study, a reference, a multi-year term or a signing date.";
  if (stage === "pre_launch" || stage === "design_partners") {
    return {
      structure: "paid_design_partner",
      terms:
        "Paid design partner: 10–20% of contract value up front, 2–6 months (about 3 is typical). Their side names an executive sponsor, a technical lead with system access and a business lead. A 60–90 minute kickoff, a weekly 30-minute standup, a real launch date, and a written conversion date and price. Free only for your first 1–2, capped at 60–90 days.",
      priceAnchor,
      discountRule,
      daysToFirstValue: days,
    };
  }
  return {
    structure: "paid_pilot",
    terms: `${pilotDays}-day paid pilot, priced within your champion's own sign-off limit. Success metric and ROI equation agreed in writing; ROI meeting booked at kickoff; the fee is credited to the annual contract. Then annual with a 30/60-day opt-out.`,
    priceAnchor,
    discountRule,
    daysToFirstValue: days,
  };
}

function skeleton(ws: Workspace, prev: Foundation | null): Foundation {
  return {
    version: (prev?.version ?? 0) + 1,
    generatedAt: nowISO(),
    positioning: { alternatives: [], differentiators: [], valueThemes: [], bestFit: [], category: { name: "", style: "head_to_head", why: "" } },
    icp: {
      hypothesis: { companyGroup: "", role: "", obstacle: "", cause: "", improvement: "", sentence: "" },
      primarySegment: "",
      testSlices: [],
      criteria: [],
      antiIcp: [],
      triggers: [],
      segmentLockedAt: prev?.icp.segmentLockedAt,
      betHistory: prev?.icp.betHistory,
    },
    personas: [],
    messaging: { oneLiner: "", themes: [], byPersona: [], bySignal: [], customerWords: [], bannedWords: [] },
    channelPlan: planFor(ws, ws.company?.stage ?? "unknown"),
    commercial: commercialFor(ws, prev?.icp.employeeBand, prev?.commercial),
    competitors: [],
    founderQuestions: (prev?.founderQuestions ?? []).filter((q) => q.answer && !q.id.startsWith("onb_")),
    confidence: "low",
    provenance: {},
  };
}

const ONB_QUESTIONS: (Omit<FounderQuestion, "answer" | "answeredAt"> & { key: "last3" | "before" | "who" })[] = [
  {
    id: "onb_last3",
    key: "last3",
    question: "Who are your last 3 users or design partners?",
    whyItMatters: "I rebuild the ideal customer from your best-fit users, not the average.",
    affects: ["icp"],
  },
  {
    id: "onb_before",
    key: "before",
    question: "What were they doing before you?",
    whyItMatters: "That's your real competition, and the words buyers use for the pain.",
    affects: ["positioning"],
  },
  { id: "onb_who", key: "who", question: "Who buys from you?", whyItMatters: "Your site didn't say clearly; this sets the ICP.", affects: ["icp"] },
];

const MAIL: Record<string, string> = {
  google: "Google Workspace mail",
  microsoft: "Microsoft 365 mail",
  other: "Custom mail host",
  none: "No mail records found",
};

/* ───────────────────────────── Tool schemas ───────────────────────────── */

const ChipInput = z.object({
  key: z.enum(["what", "who", "pricing", "proof", "alternatives", "stage"]),
  text: z.string().min(3).max(90).describe("Plain words, ≤90 characters"),
  source: z.enum(["site", "founder"]),
  sourceUrl: z.string().max(500).nullable().describe("A page URL from <site> when source is site; else null"),
  quote: z.string().max(300).nullable().describe("Words copied exactly from that page, ≤200 characters; else null"),
  confidence: z.enum(["high", "medium", "low"]),
});

const SnapshotInput = z.object({
  name: z.string().max(60),
  plainOneLiner: z.string().max(160).describe("≤20 words, grade 8"),
  whoItsFor: z.string().max(160).describe("≤20 words"),
  howYouCharge: z.object({
    model: z.enum(["seat", "usage", "flat", "custom_quote", "freemium", "unknown"]),
    isPublic: z.boolean(),
    summary: z.string().max(120).nullable(),
  }),
  proof: z
    .array(
      z.object({
        kind: z.enum(["metric", "logo", "quote", "case_study", "founder_credential"]),
        text: z.string().max(160),
        sourceUrl: z.string().max(500),
        quote: z.string().max(300).describe("Exact words from that page"),
      }),
    )
    .max(5),
  alternatives: z.array(z.object({ name: z.string().max(60), kind: z.enum(ALT_KINDS) })).max(5),
  stage: z.enum(["pre_launch", "design_partners", "early_revenue", "scaling", "unknown"]),
  messagingIssues: z
    .array(z.object({ issue: z.string().max(140), quote: z.string().max(200).describe("Exact site words"), fix: z.string().max(160).describe("≤20 words") }))
    .max(3),
  coverage: z.enum(["good", "thin"]),
  market: z.enum(["b2b", "consumer"]).describe("Who buys: consumer when people buy for themselves or their family"),
  consumerModel: z.enum(CONSUMER_MODELS).nullable().describe("Consumer only, else null"),
});
type SnapshotInput = z.infer<typeof SnapshotInput>;

const PositioningIn = z.object({
  alternatives: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        kind: z.enum(ALT_KINDS),
        whyChosenToday: z.string().max(200),
        domain: z.string().max(100).nullish().describe("Competitors only, e.g. acme.com"),
        sourceUrl: z.string().max(500).nullish().describe("URL where you saw this competitor this run"),
      }),
    )
    .min(1)
    .max(7),
  differentiators: z
    .array(
      z.object({
        capability: z.string().max(140),
        vsAlternative: z.string().max(60).describe("Name of one alternative above"),
        status: z.enum(["proven", "claimed"]),
        evidenceIds: z.array(z.string()).max(3).nullish(),
      }),
    )
    .max(5),
  valueThemes: z
    .array(
      z.object({
        theme: z.string().max(60),
        outcome: z.string().max(180),
        proofEvidenceIds: z.array(z.string()).max(3).nullish(),
        needsProof: z.boolean(),
      }),
    )
    .min(1)
    .max(3),
  bestFit: z.array(z.string().max(160)).min(1).max(5),
  category: z.object({ name: z.string().max(60), style: z.enum(["head_to_head", "big_fish_small_pond", "new_game"]), why: z.string().max(240) }),
  warning: z.string().max(240).nullish(),
});

const IcpIn = z.object({
  hypothesis: z.object({
    companyGroup: z.string().max(100),
    role: z.string().max(80),
    obstacle: z.string().max(140),
    cause: z.string().max(140),
    improvement: z.string().max(140),
    sentence: z.string().max(360).describe("≤45 words"),
  }),
  primarySegment: z.string().max(100),
  testSlices: z.array(z.string().max(100)).max(2),
  employeeBand: z.enum(["lt50", "50_300", "gt300", "mixed"]),
  criteria: z
    .array(
      z.object({
        text: z.string().max(140),
        kind: z.enum(["firmographic", "technographic", "situational"]),
        mustHave: z.boolean(),
        detection: z.enum(DETECTION),
        status: z.enum(["validated", "hypothesis"]),
        howToTest: z.string().max(160).nullish(),
      }),
    )
    .min(1)
    .max(8),
  antiIcp: z.array(z.object({ text: z.string().max(120), reason: z.string().max(160) })).max(8),
  triggers: z.array(z.object({ type: z.enum(SIGNAL_TYPES), windowDays: z.number().int().min(7).max(365), implication: z.string().max(180) })).max(5),
  confirmIf: z.string().max(200),
  killIf: z.string().max(200),
});

const PersonaIn = z.object({
  role: z.enum(["economic_buyer", "champion", "technical_approver", "user", "blocker"]),
  titles: z.array(z.string().max(60)).min(1).max(6),
  kpis: z.array(z.string().max(100)).max(4),
  pains: z.array(z.string().max(160)).max(4),
  triggers: z.array(z.string().max(120)).max(3),
  objections: z.array(z.string().max(140)).max(3),
  wateringHoles: z
    .array(z.object({ name: z.string().max(80), kind: z.enum(["community", "podcast", "newsletter", "conference"]), url: z.string().max(300).nullish() }))
    .max(4),
  line: z.string().max(220).describe("≤25 words"),
});

const MessagingIn = z.object({
  oneLiner: z.string().max(240).describe("≤25 words"),
  themes: z
    .array(z.object({ valueTheme: z.number().int().min(1).max(3).describe("1-based index into positioning.valueThemes"), headline: z.string().max(90), vsAlternative: z.string().max(60) }))
    .max(3),
  byPersona: z.array(z.object({ persona: z.number().int().min(1).max(4).describe("1-based index into personas"), line: z.string().max(220) })).max(4),
  bySignal: z.array(z.object({ signal: z.enum(SIGNAL_TYPES), implication: z.string().max(200) })).max(6),
  customerWords: z.array(z.object({ phrase: z.string().max(80), source: z.enum(["site", "job_post", "review", "community", "founder"]) })).max(8),
  bannedWords: z.array(z.string().max(40)).max(16),
});

const QuestionIn = z.object({
  question: z.string().max(160),
  whyItMatters: z.string().max(160).describe("≤20 words"),
  affects: z.array(z.enum(["icp", "positioning", "pricing", "channel_plan"])).min(1).max(3),
});

const SectionInput = z.object({
  positioning: PositioningIn.nullish(),
  icp: IcpIn.nullish(),
  personas: z.array(PersonaIn).min(1).max(4).nullish(),
  messaging: MessagingIn.nullish(),
  questions: z.array(QuestionIn).max(5).nullish(),
});
type SectionInput = z.infer<typeof SectionInput>;

/* Consumer bet: the same sections with consumer enums, plus the growth model. */
const ConsumerIcpIn = z.object({
  hypothesis: z.object({
    companyGroup: z.string().max(100).describe("The audience group, e.g. first-time parents"),
    role: z.string().max(80).describe("The person in the moment"),
    obstacle: z.string().max(140),
    cause: z.string().max(140),
    improvement: z.string().max(140).describe("What they'd notice within a week"),
    sentence: z.string().max(360).describe("≤45 words"),
  }),
  primarySegment: z.string().max(100),
  testSlices: z.array(z.string().max(100)).max(2),
  criteria: z
    .array(
      z.object({
        text: z.string().max(140),
        kind: z.enum(["behavioral", "situational", "demographic"]),
        mustHave: z.boolean(),
        detection: z.enum(CONSUMER_DETECTION),
        status: z.enum(["validated", "hypothesis"]),
        howToTest: z.string().max(160).nullish(),
      }),
    )
    .min(1)
    .max(8),
  antiIcp: z.array(z.object({ text: z.string().max(120), reason: z.string().max(160) })).max(8),
  triggers: z.array(z.object({ type: z.enum(CONSUMER_SIGNAL_TYPES), windowDays: z.number().int().min(7).max(365), implication: z.string().max(180) })).max(5),
  confirmIf: z.string().max(200),
  killIf: z.string().max(200),
});

const ConsumerPersonaIn = PersonaIn.extend({
  role: z.enum(["user", "early_adopter", "payer", "influencer"]),
  titles: z.array(z.string().max(60)).min(1).max(6).describe("How the segment describes itself"),
  kpis: z.array(z.string().max(100)).max(4).describe("Jobs they want done, in their words"),
  wateringHoles: z
    .array(z.object({ name: z.string().max(80).describe("Specific: r/beyondthebump, not Reddit"), kind: z.enum(["community", "forum", "creator", "social", "newsletter", "podcast"]), url: z.string().max(300).nullish() }))
    .max(5),
});

const ConsumerMessagingIn = MessagingIn.extend({
  bySignal: z.array(z.object({ signal: z.enum(CONSUMER_SIGNAL_TYPES), implication: z.string().max(200) })).max(6),
  hooks: z.array(z.string().max(90).describe("≤12 words")).max(8),
});

const GrowthIn = z.object({
  northStar: z.object({ metric: z.string().max(80), why: z.string().max(160).describe("≤20 words") }),
  activation: z.object({ event: z.string().max(100), withinDays: z.number().int().min(1).max(30), howToTest: z.string().max(160).describe("≤20 words") }),
  cadence: z.enum(["daily", "weekly", "monthly", "occasional"]),
  primaryLoop: z.object({ kind: z.enum(["word_of_mouth", "viral", "content", "creator", "community", "marketplace", "paid"]), how: z.string().max(220).describe("≤30 words") }),
  firstHundred: z.array(z.string().max(120)).max(3),
});

const ConsumerSectionInput = z.object({
  positioning: PositioningIn.nullish(),
  icp: ConsumerIcpIn.nullish(),
  personas: z.array(ConsumerPersonaIn).min(1).max(4).nullish(),
  messaging: ConsumerMessagingIn.nullish(),
  growth: GrowthIn.nullish(),
  questions: z.array(QuestionIn).max(5).nullish(),
});

/** Either bet's input, as the save code reads it. */
type AnySection = {
  positioning?: z.infer<typeof PositioningIn> | null;
  icp?: (z.infer<typeof IcpIn> | (z.infer<typeof ConsumerIcpIn> & { employeeBand?: undefined })) | null;
  personas?: (z.infer<typeof PersonaIn> | z.infer<typeof ConsumerPersonaIn>)[] | null;
  messaging?: (z.infer<typeof MessagingIn> & { hooks?: string[] }) | z.infer<typeof ConsumerMessagingIn> | null;
  growth?: z.infer<typeof GrowthIn> | null;
  questions?: z.infer<typeof QuestionIn>[] | null;
};

const FinishInput = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().max(240).nullable().describe("One line on the weakest part of this bet, or null"),
});
type FinishInput = z.infer<typeof FinishInput>;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const bannedIn = (s: string) => BANNED_WORDS.filter((w) => new RegExp(`\\b${w.replace(/[-]/g, "[- ]?")}`, "i").test(s));

const DEFAULT_ANTI_ICP = [
  { re: /\bown(s|er|ership)?\b|\bno one\b|\bnobody\b/i, text: "No one owns the problem", reason: "Without an owner there's no champion and no budget." },
  {
    re: /spend|budget|time on it|paying/i,
    text: "Not spending money or time on it today",
    reason: "If they don't pay for it in money or hours now, it isn't urgent.",
  },
  { re: /complian|soc ?2|hipaa|gdpr|fedramp|security review/i, text: "Compliance gates we can't pass yet", reason: "A certification we don't have stalls the deal for months." },
  { re: /acv|deal size|\$2k|self-serve|too small/i, text: "Deal size under about $2K a year", reason: "That's a self-serve motion; founder-led sales can't pay for itself there." },
];

/** Consumer bets always say who it isn't for: rare needs, happy free habits, and children without consent (COPPA). */
const DEFAULT_ANTI_AUDIENCE = [
  { re: /rare|rarely|often|frequen|once a year|habit/i, text: "Needs it too rarely to form a habit", reason: "Retention needs the need to come back; a once-a-year need is a different, harder business." },
  { re: /happy|satisfied|free (app|habit|alternative)|good enough/i, text: "Happy with a free habit they already have", reason: "Switching costs attention. People who aren't frustrated don't switch." },
  { re: /under 13|children|kids|coppa|minor/i, text: "Children under 13, unless it's built for them", reason: "Collecting a child's data needs verifiable parental consent (COPPA, amended 2025)." },
];

/* ───────────────────────────── The workflow ───────────────────────────── */

export default defineWorkflow({
  id: "foundation",
  args: Args,
  title: (a) => {
    const d = a.url ? toDomain(a.url) : null;
    return d ? `Reading ${d}` : "Reading your description";
  },
  ref: () => ({ kind: "playbook", id: "foundation" }),
  heavy: true,
  run: async (ctx) => {
    const { args } = ctx;
    const domain = args.url ? toDomain(args.url) : null;
    const note = args.note?.trim() ?? "";
    if (!domain && !note) throw new AgentError("Paste your website, or describe what you're building in two sentences.", "bad_request");
    const firstRun = args.mode !== "refresh" && ctx.read().onboarding.status !== "hired";
    // "Pick up where I left off" (or "Try again") after a stop or error mid-bet, on the same site and note: keep the
    // sections already saved and the discovery already started instead of paying for the whole bet again.
    const o0 = ctx.read().onboarding;
    const resume =
      firstRun &&
      (o0.status === "reading" || o0.status === "drafting") &&
      (o0.domain ?? null) === domain &&
      (o0.note ?? "") === note &&
      !!o0.sections?.snapshot &&
      !!ctx.read().foundation;
    // The stopped run's search results are gone with it; the hosts it saw survive in its step log.
    const priorHosts = new Set(
      resume && o0.runId
        ? runSteps(o0.runId)
            .filter((st) => st.type === "sources")
            .flatMap((st) => st.text.split(", ").map((h) => h.trim().toLowerCase().replace(/^www\./, "")))
        : [],
    );

    await ctx.mutate((ws) => {
      if (args.founderName) ws.founder.name = args.founderName;
      if (firstRun) {
        ws.onboarding = {
          ...ws.onboarding,
          status: "reading",
          runId: ctx.runId,
          url: args.url,
          domain: domain ?? undefined,
          note: note || undefined,
          market: args.market ?? ws.onboarding.market,
          site: domain ? "reading" : "none",
          pagesRead: 0,
          ledger: [],
          // The snapshot is rewritten below; the bet sections already saved stay.
          sections: resume ? { ...ws.onboarding.sections, snapshot: undefined } : {},
          discoveryRunId: resume ? ws.onboarding.discoveryRunId : undefined,
          error: undefined,
        };
      }
      const prev = ws.company && ws.company.domain === (domain ?? "") ? ws.company : null;
      if (firstRun || !ws.company) {
        ws.company = {
          name: prev?.name || (domain ? domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase()) : "Your company"),
          domain: domain ?? "",
          plainOneLiner: prev?.plainOneLiner ?? "",
          whoItsFor: prev?.whoItsFor ?? "",
          howYouCharge: prev?.howYouCharge ?? { model: "unknown", isPublic: false, summary: null },
          proof: prev?.proof ?? [],
          alternatives: prev?.alternatives ?? [],
          stage: prev?.stage ?? "unknown",
          messagingIssues: prev?.messagingIssues ?? [],
          coverage: prev?.coverage ?? "good",
          chips: prev?.chips ?? [],
          founderNote: note || undefined,
          emailProvider: prev?.emailProvider,
          market: args.market ?? prev?.market,
          consumerModel: args.market === "consumer" ? (args.consumerModel ?? prev?.consumerModel) : args.market ? undefined : prev?.consumerModel,
          marketSource: args.market ? "founder" : prev?.marketSource,
          marketHints: prev?.marketHints,
        };
      } else {
        if (note) ws.company.founderNote = note;
        if (args.market) Object.assign(ws.company, { market: args.market, consumerModel: args.market === "consumer" ? (args.consumerModel ?? ws.company.consumerModel) : undefined, marketSource: "founder" });
      }
    });

    const addRows = (rows: Omit<OnboardingLedgerRow, "id" | "at">[]) =>
      firstRun
        ? ctx.mutate((ws) => {
            ws.onboarding.ledger = [...(ws.onboarding.ledger ?? []), ...rows.map((r) => ({ ...r, id: newId("led"), at: nowISO() }))];
            ws.onboarding.pagesRead = ws.onboarding.ledger.filter((r) => r.kind === "page").length;
          })
        : Promise.resolve();

    /* 1 · Read */
    ctx.emit({ type: "status", text: domain ? `Reading ${domain}` : "Reading your description" });
    let read: Awaited<ReturnType<typeof readSite>> = null;
    if (domain) {
      read = await readSite(domain, async (page) => {
        ctx.emit({ type: "read", url: page.url, host: hostOf(page.url) });
        const path = urlKey(page.url);
        await addRows([{ kind: "page", label: page.label, detail: path, url: page.url, host: hostOf(page.url), ms: page.ms }]);
      });
      if (ctx.signal.aborted) throw new AgentError("Stopped.", "stopped");
      if (!read && !note) {
        if (firstRun) {
          await ctx.mutate((ws) => {
            ws.onboarding.status = "new";
            ws.onboarding.site = "unreachable";
            ws.onboarding.error = {
              code: "unreachable",
              message: `I couldn't reach ${domain}. Check the address, or tell me in one sentence what you sell and I'll start from that.`,
            };
          });
        }
        ctx.emit({ type: "status", text: `Couldn't reach ${domain}` });
        return { unreachable: true };
      }
    } else {
      await addRows([{ kind: "check", label: "Your description", detail: `${words(note)} words` }]);
    }

    const site = read?.site ?? null;
    if (site && domain) {
      // Share the crawl with every later gatherSignals() call for this domain (dossiers, refreshes).
      const key = `site:${domain}:${MAX_SUBPAGES}`;
      invalidate(key);
      await cached(key, TTL.week, async () => site);
    }
    const readable = site?.pages.filter((p) => p.text.length > 300).length ?? 0;
    const siteState: NonNullable<Workspace["onboarding"]["site"]> = !site ? "none" : read?.spa ? "spa" : readable < 3 ? "thin" : "ok";
    if (firstRun) await ctx.mutate((ws) => void (ws.onboarding.site = siteState));

    /* 2 · Free signals (parallel with the snapshot) */
    const signalsP: Promise<{ signals: CompanySignals | null; yc: YcCompany | null }> = (async () => {
      if (!domain || !site) return { signals: null, yc: null };
      const [signals, yc] = await Promise.all([
        gatherSignals(domain, { name: site.name, maxPages: MAX_SUBPAGES }).catch(() => null),
        ycDirectory()
          .then((dir) => ycByDomain(dir, domain) ?? null)
          .catch(() => null),
      ]);
      if (signals) ctx.noteFreeSignals(signals.lookups + (yc ? 1 : 0));
      const rows: Omit<OnboardingLedgerRow, "id" | "at">[] = [];
      if (signals?.dns) rows.push({ kind: "check", label: "DNS", detail: MAIL[signals.dns.emailProvider] });
      if (signals) {
        const n = signals.jobs.length;
        rows.push({ kind: "check", label: "Job board", detail: n ? `${n} open role${n === 1 ? "" : "s"} · ${signals.jobSource?.provider ?? "careers page"}` : "No public job board" });
        rows.push({ kind: "check", label: "News", detail: signals.news.length ? `${signals.news.length} recent mention${signals.news.length === 1 ? "" : "s"}` : "No recent news" });
        if (signals.hn.length) rows.push({ kind: "check", label: "Hacker News", detail: `${signals.hn.length} thread${signals.hn.length === 1 ? "" : "s"}` });
      }
      if (yc) rows.push({ kind: "check", label: "YC directory", detail: [yc.batch, yc.teamSize ? `${yc.teamSize} people` : null].filter(Boolean).join(" · ") });
      await addRows(rows);
      ctx.emit({ type: "status", text: "Checked DNS, job boards and news" });
      return { signals, yc };
    })();

    /* 3 · Chips + snapshot (fast tier) */
    const pages = new Map((site?.pages ?? []).map((p) => [urlKey(p.url), p]));
    const anyPageText = () => [...pages.values()].map(pageText).join("\n");
    const makeEvidence = (claim: string, quote: string, url: string, confidence: Evidence["confidence"]): Evidence => ({
      id: newId("ev"),
      claim: claim.slice(0, 200),
      quote: quote.slice(0, 300),
      url,
      host: hostOf(url),
      sourceType: "first_party",
      retrievedAt: nowISO(),
      confidence,
      runId: ctx.runId,
    });
    /** Resolves a model-cited page + quote to evidence, or explains what's wrong. */
    const checkQuote = (sourceUrl: string | null | undefined, quote: string | null | undefined): { page: PageDigest } | { error: string } => {
      if (!sourceUrl || !quote) return { error: "sourceUrl and quote are required when source is site." };
      const page = pages.get(urlKey(sourceUrl));
      if (!page) return { error: `${sourceUrl} isn't one of the pages in <site>. Use one of: ${[...pages.values()].map((p) => p.url).join(", ")}.` };
      if (!quoteMatches(quote, pageText(page))) {
        return { error: `That quote isn't on ${page.url}. Copy the words exactly from that page's text, or skip this chip.` };
      }
      return { page };
    };

    const shareLearning = defineTool({
      name: "share_learning",
      description:
        "Show the founder one thing you learned (a 'What I learned' chip) as soon as the pages support it. One chip per key; calling a key again replaces it. Code checks the quote against the page; paraphrases are rejected.",
      schema: ChipInput,
      label: (i) => `Learned · ${CHIP_LABELS[i.key]}`,
      run: async (i) => {
        let evidence: Evidence | null = null;
        if (i.source === "site") {
          const checked = checkQuote(i.sourceUrl, i.quote);
          if ("error" in checked) throw new Error(checked.error);
          evidence = makeEvidence(i.text, i.quote!, checked.page.url, i.confidence === "low" ? "medium" : "high");
        } else if (!founderLines(ctx.read()).length) {
          throw new Error("The founder hasn't told you anything yet. Cite a page from <site>.");
        }
        const outcome = await ctx.mutate((ws) => {
          if (!ws.company) return "missing";
          const existing = ws.company.chips.find((c) => c.key === i.key);
          if (existing?.rejected) return "rejected";
          if (existing?.corrected) return `corrected:${existing.text}`;
          if (evidence) ws.evidence[evidence.id] = evidence;
          const chip: LearningChip = { key: i.key, label: CHIP_LABELS[i.key], text: i.text, evidenceIds: evidence ? [evidence.id] : [], confidence: i.confidence };
          ws.company.chips = existing ? ws.company.chips.map((c) => (c.key === i.key ? chip : c)) : [...ws.company.chips, chip];
          return "shown";
        });
        if (outcome === "rejected") return "The founder said this one is wrong. Don't share this key again.";
        if (outcome.startsWith("corrected:")) return `The founder already corrected this one: "${outcome.slice(10)}". Use their version.`;
        return evidence ? `Shown. Evidence id ${evidence.id}.` : "Shown.";
      },
    });

    const submitSnapshot = defineTool({
      name: "submit_snapshot",
      description: "Submit the company snapshot once, after the chips. Every proof item and messaging issue quotes the site exactly.",
      schema: SnapshotInput,
      terminal: true,
      label: () => "Wrote the company snapshot",
    });

    const snapshotMessage = [
      taskHeader(),
      domain ? `The founder's website: ${domain}` : "The founder has no website yet. Work from their description.",
      site ? `<site>\n${siteDigestToText(site)}\n</site>` : "",
      founderBlock(ctx.read()),
      siteState === "spa" || siteState === "thin"
        ? `The site is thin (${readable} readable page${readable === 1 ? "" : "s"}). Set coverage "thin" and lean on the founder's words.`
        : "",
      read ? `<market_hints>\nCode read: ${read.market.market} (${read.market.confidence})${read.market.model ? `, looks like ${read.market.model}` : ""}. Seen: ${read.market.hints.join(", ") || "nothing decisive"}.\n</market_hints>` : "",
      "Share the chips the pages support, then call submit_snapshot.",
    ]
      .filter(Boolean)
      .join("\n\n");

    // The snapshot is a head start, not a gate: if Haiku refuses, truncates or is overloaded, the fallbacks below and the
    // strategist (which reads <free_signals> and has a refusal fallback) carry the run.
    let snap: SnapshotInput | undefined;
    try {
      const snapRun = await ctx.agent<SnapshotInput>({
        tier: "fast",
        effort: "low",
        maxTokens: 8000,
        system: [coreFor(ctx.read()), SNAPSHOT_RULES],
        messages: [{ role: "user", content: snapshotMessage }],
        tools: [shareLearning, submitSnapshot],
        requireTerminal: true,
      });
      snap = snapRun.result;
    } catch (err) {
      if (ctx.signal.aborted || (err instanceof AgentError && (err.code === "stopped" || err.code === "no_key" || err.code === "auth"))) throw err;
      console.warn("[foundation] snapshot failed, continuing without it:", err instanceof Error ? err.message : err);
      ctx.emit({ type: "status", text: "Couldn't summarize the site; drafting from the pages directly" });
    }

    const sigs = await signalsP;
    await ctx.mutate((ws) => {
      const c = ws.company;
      if (!c) return;
      const corrected = (key: LearningChip["key"]) => c.chips.find((x) => x.key === key && x.corrected)?.text;
      const chip = (key: LearningChip["key"]) => c.chips.find((x) => x.key === key && !x.rejected)?.text;
      const wrongProof = rejectedProof(ws);
      const proof: CompanySnapshot["proof"] = [];
      for (const p of snap?.proof ?? []) {
        if (wrongProof(p.quote)) continue; // the founder said it's wrong
        const checked = checkQuote(p.sourceUrl, p.quote);
        if ("error" in checked) continue; // unverifiable proof never reaches the playbook
        const ev = makeEvidence(p.text, p.quote, checked.page.url, "high");
        ws.evidence[ev.id] = ev;
        proof.push({ kind: p.kind, text: p.text, evidenceId: ev.id });
      }
      const text = anyPageText();
      Object.assign(c, {
        name: snap?.name?.trim() || site?.name || c.name,
        plainOneLiner: corrected("what") ?? (snap?.plainOneLiner || chip("what") || c.plainOneLiner),
        whoItsFor: corrected("who") ?? (snap?.whoItsFor || chip("who") || c.whoItsFor),
        howYouCharge: snap
          ? { ...snap.howYouCharge, summary: corrected("pricing") ?? snap.howYouCharge.summary }
          : { ...c.howYouCharge, summary: corrected("pricing") ?? chip("pricing") ?? c.howYouCharge.summary },
        proof,
        alternatives: snap?.alternatives.length ? snap.alternatives : [{ name: "Doing it by hand", kind: "status_quo" as const }],
        stage: stageFromText(corrected("stage")) ?? snap?.stage ?? c.stage,
        messagingIssues: (snap?.messagingIssues ?? []).filter((m) => quoteMatches(m.quote, text)),
        coverage: siteState === "ok" ? (snap?.coverage ?? "good") : "thin",
        tech: sigs.signals?.enrichment.tech.length ? sigs.signals.enrichment.tech : c.tech,
        emailProvider: sigs.signals?.dns?.emailProvider ?? c.emailProvider,
      } satisfies Partial<CompanySnapshot>);
      // Who buys: the founder's pick, else the snapshot's read of the pages, else the code read. Decides the bet's rules.
      const founderPick = c.marketSource === "founder" ? c.market : undefined;
      const market: Market = founderPick ?? snap?.market ?? read?.market.market ?? c.market ?? "b2b";
      const model: ConsumerModel | undefined =
        market === "consumer" ? ((founderPick ? c.consumerModel : undefined) ?? snap?.consumerModel ?? read?.market.model ?? c.consumerModel ?? "app") : undefined;
      Object.assign(c, { market, consumerModel: model, marketSource: founderPick ? "founder" : "site", marketHints: read?.market.hints ?? c.marketHints });
      if (market === "consumer" && firstRun && (!ws.goal.metric || ws.goal.metric === "deals")) Object.assign(ws.goal, consumerGoal(model ?? "app"));
      if (market === "b2b" && firstRun && ws.goal.metric && ws.goal.metric !== "deals") Object.assign(ws.goal, { metric: "deals", target: 5, targetLabel: "paid pilots or design partners" });
      if (firstRun) {
        ws.onboarding.sections = { ...ws.onboarding.sections, snapshot: nowISO() };
        ws.onboarding.status = "drafting";
      }
      if ((firstRun && !resume) || !ws.foundation) {
        // Rewriting the bet from the site again: the version it replaces stays restorable.
        if (ws.foundation) keepVersion(ws, { version: ws.foundation.version, at: nowISO(), changes: ["Rewritten from your site"], source: "rebuild", runId: ctx.runId });
        ws.foundation = skeleton(ws, ws.foundation);
      }
      else if (resume) {
        // Kept sections stay; the code-filled parts follow the stage this read found.
        ws.foundation.channelPlan = planFor(ws, c.stage);
        ws.foundation.commercial = commercialFor(ws, ws.foundation.icp.employeeBand, ws.foundation.commercial);
      }
    });

    /* 4 · The bet (strategist, once) */
    ctx.emit({ type: "status", text: "Drafting your first bet" });
    const consumer = ctx.read().company?.market === "consumer";
    const betSections: readonly FoundationSection[] = consumer ? CONSUMER_BET_SECTIONS : BET_SECTIONS;
    const saved = new Set<FoundationSection>(resume ? betSections.filter((k) => ctx.read().onboarding.sections?.[k]) : []);
    let deliveredInput = founderLines(ctx.read()).join("\n");

    const evidenceBlock = () => {
      const ws = ctx.read();
      const wrong = new Set((ws.company?.chips ?? []).filter((c) => c.rejected).flatMap((c) => c.evidenceIds));
      const mine = Object.values(ws.evidence).filter((e) => e.runId === ctx.runId && !wrong.has(e.id));
      return mine.length ? mine.map((e) => `[${e.id}] ${e.claim} — "${e.quote}" (${e.url})`).join("\n") : "None yet. Differentiators are claimed and themes need proof.";
    };

    const startDiscovery = async () => {
      const ws = ctx.read();
      if (!firstRun || ws.onboarding.discoveryRunId || !ws.foundation) return;
      // Discovery screens against the ICP criteria saved above; a `brief` would add an extra must-have
      // criterion (and is capped at 300 chars), so the first run sends none.
      const seeds = seedDomains(ws.onboarding.answers?.last3, domain);
      try {
        // Consumer: who to talk to first is where the audience gathers (creators, communities), found once segments land.
        const run = consumer
          ? await startRun(partners, { mode: "find", count: 6, source: "onboarding" })
          : await startRun(discovery, { count: 3, source: "onboarding", seedDomains: seeds.length ? seeds : undefined });
        await ctx.mutate((w) => void (w.onboarding.discoveryRunId = run.id));
        ctx.emit({ type: "action", text: consumer ? "Started finding creators and communities" : "Started finding companies" });
      } catch (err) {
        console.warn("[foundation] couldn't start discovery:", err);
      }
    };

    const submitSection = defineTool({
      name: "submit_section",
      description: consumer
        ? "Save one or more finished sections of the bet. The founder sees each the moment it's saved. Order: positioning alone; then icp (the audience bet) + personas (segments); then messaging + growth + questions (with finish_bet in the same turn). Sections you leave out stay as they are."
        : "Save one or more finished sections of the bet. The founder sees each the moment it's saved. Order: positioning alone; then icp + personas; then messaging + questions (with finish_bet in the same turn). Sections you leave out stay as they are.",
      schema: (consumer ? ConsumerSectionInput : SectionInput) as z.ZodType<AnySection>,
      label: (i: AnySection) => `Wrote ${betSections.filter((k) => i[k as keyof AnySection]).join(" + ")}`,
      run: async (input: AnySection) => {
        const ws = ctx.read();
        const f = ws.foundation;
        if (!f) throw new Error("The workspace has no playbook yet.");
        const errors: string[] = [];
        const knownEvidence = (ids: string[] | null | undefined) => (ids ?? []).filter((id) => ws.evidence[id]);
        const unknownEvidence = [
          ...(input.positioning?.differentiators.flatMap((d) => d.evidenceIds ?? []) ?? []),
          ...(input.positioning?.valueThemes.flatMap((t) => t.proofEvidenceIds ?? []) ?? []),
        ].filter((id) => !ws.evidence[id]);
        if (unknownEvidence.length) errors.push(`Unknown evidence ids: ${[...new Set(unknownEvidence)].join(", ")}. Cite only ids from <evidence>.`);
        const themeCount = input.positioning?.valueThemes.length ?? f.positioning.valueThemes.length;
        const personaCount = input.personas?.length ?? f.personas.length;
        if (input.messaging) {
          const m = input.messaging;
          if (words(m.oneLiner) > 27) errors.push(`messaging.oneLiner is ${words(m.oneLiner)} words; keep it to 25.`);
          const banned = [...new Set([m.oneLiner, ...m.themes.map((t) => t.headline)].flatMap(bannedIn))];
          if (banned.length) errors.push(`Banned words in messaging: ${banned.join(", ")}. Say it plainly.`);
          if (m.themes.some((t) => t.valueTheme > themeCount)) errors.push("messaging.themes points at a value theme that doesn't exist. Submit positioning first.");
          if (m.byPersona.some((p) => p.persona > personaCount)) errors.push("messaging.byPersona points at a persona that doesn't exist. Submit personas first.");
        }
        if (input.icp && words(input.icp.hypothesis.sentence) > 50) errors.push("icp.hypothesis.sentence is too long; keep it under 45 words.");
        if (errors.length) throw new Error(`Not saved. Fix and call submit_section again: ${errors.join(" ")}`);

        const now = nowISO();
        const keys: FoundationSection[] = [];
        await ctx.mutate((w) => {
          const fd = w.foundation;
          if (!fd) return;
          const prov = provenance(w);
          if (input.positioning) {
            const p = input.positioning;
            fd.positioning = {
              alternatives: p.alternatives.map((a) => ({
                name: a.name,
                kind: a.kind,
                whyChosenToday: a.whyChosenToday,
                domain: a.kind === "competitor" ? (toDomain(a.domain ?? "") ?? undefined) : undefined,
                sourceUrl: a.sourceUrl ?? undefined,
              })),
              differentiators: p.differentiators.map((d) => {
                const ids = knownEvidence(d.evidenceIds);
                return { capability: d.capability, vsAlternative: d.vsAlternative, status: d.status === "proven" && ids.length ? "proven" : "claimed", evidenceIds: ids };
              }),
              valueThemes: p.valueThemes.map((t) => {
                const proof = knownEvidence(t.proofEvidenceIds).map((id) => ({ text: w.evidence[id].claim, evidenceId: id }));
                return { id: newId("vt"), theme: t.theme, outcome: t.outcome, proof, needsProof: !proof.length || t.needsProof };
              }),
              bestFit: p.bestFit,
              category: p.category,
              warning: p.warning ?? undefined,
            };
            keys.push("positioning");
          }
          if (input.icp) {
            const i = input.icp;
            const canValidate = namedCustomers(w.onboarding.answers?.last3) >= 3;
            const anti = [...i.antiIcp];
            for (const d of consumer ? DEFAULT_ANTI_AUDIENCE : DEFAULT_ANTI_ICP) if (!i.antiIcp.some((a) => d.re.test(`${a.text} ${a.reason}`))) anti.push({ text: d.text, reason: d.reason });
            const band = "employeeBand" in i ? i.employeeBand : undefined;
            fd.icp = {
              ...fd.icp,
              hypothesis: i.hypothesis,
              primarySegment: i.primarySegment,
              testSlices: i.testSlices,
              employeeBand: band,
              criteria: i.criteria.map((c) => {
                const validated = c.status === "validated" && canValidate;
                return {
                  id: newId("icp"),
                  text: c.text,
                  kind: c.kind,
                  mustHave: c.mustHave,
                  detection: c.detection,
                  status: validated ? "validated" : "hypothesis",
                  howToTest: validated ? undefined : (c.howToTest ?? (consumer ? "Check it against your first 20 users and their week-4 retention." : "Check it on the next 25 touches and 5 calls.")),
                };
              }),
              antiIcp: anti,
              triggers: i.triggers,
              confirmIf: i.confirmIf,
              killIf: i.killIf,
            };
            fd.commercial = commercialFor(w, band, fd.commercial);
            keys.push("icp");
          }
          if (input.personas) {
            fd.personas = input.personas.map(
              (p): Persona => ({
                id: newId("per"),
                role: p.role,
                titles: p.titles,
                kpis: p.kpis,
                pains: p.pains,
                triggers: p.triggers,
                objections: p.objections,
                wateringHoles: p.wateringHoles.map((h) => ({ name: h.name, kind: h.kind, url: h.url ?? undefined })),
                line: p.line,
              }),
            );
            keys.push("personas");
          }
          if (input.messaging) {
            const m = input.messaging;
            fd.messaging = {
              oneLiner: m.oneLiner,
              themes: m.themes.flatMap((t) => {
                const vt = fd.positioning.valueThemes[t.valueTheme - 1];
                return vt ? [{ valueThemeId: vt.id, headline: t.headline, vsAlternative: t.vsAlternative }] : [];
              }),
              byPersona: m.byPersona.flatMap((b) => {
                const per = fd.personas[b.persona - 1];
                return per ? [{ personaId: per.id, line: b.line }] : [];
              }),
              bySignal: m.bySignal,
              customerWords: m.customerWords,
              bannedWords: [...new Set([...m.bannedWords, ...BANNED_WORDS])],
              hooks: "hooks" in m && m.hooks?.length ? m.hooks : undefined,
            };
            keys.push("messaging");
          }
          if (input.growth && consumer) {
            const g = input.growth;
            const base = growthDefaults(w);
            const growth: GrowthModel = {
              ...base,
              northStar: g.northStar,
              activation: { event: g.activation.event, withinDays: g.activation.withinDays, status: "hypothesis", howToTest: g.activation.howToTest },
              cadence: g.cadence,
              primaryLoop: g.primaryLoop,
              firstHundred: g.firstHundred.length ? g.firstHundred : base.firstHundred,
            };
            fd.growth = growth;
            keys.push("growth");
          }
          if (input.questions) {
            const keep = fd.founderQuestions.filter((q) => q.answer || q.id.startsWith("onb_"));
            fd.founderQuestions = [
              ...keep,
              ...input.questions.map((q): FounderQuestion => ({ id: newId("fq"), question: q.question, whyItMatters: q.whyItMatters, affects: q.affects })),
            ];
            keys.push("questions");
          }
          fd.provenance = { ...fd.provenance };
          for (const k of keys) fd.provenance[k] = prov;
          if (firstRun) {
            w.onboarding.sections = { ...w.onboarding.sections };
            for (const k of keys) w.onboarding.sections[k] = now;
          }
        });
        for (const k of keys) saved.add(k);
        // Consumer discovery searches where the segments gather, so it waits for them.
        if (keys.includes(consumer ? "personas" : "icp")) await startDiscovery();

        const lines = founderLines(ctx.read()).join("\n");
        const fresh = lines !== deliveredInput ? lines : "";
        deliveredInput = lines;
        const left = betSections.filter((k) => !saved.has(k));
        return [
          `Saved: ${keys.join(", ")}.`,
          fresh ? `NEW FOUNDER INPUT (authoritative; apply it to what's left):\n${fresh}` : "",
          left.length ? `Still to send: ${left.join(", ")}.` : "All sections saved. Call finish_bet now if you haven't.",
        ]
          .filter(Boolean)
          .join("\n\n");
      },
    });

    const finishBet = defineTool({
      name: "finish_bet",
      description: "Call once, after the last submit_section (same turn is fine). Overall confidence in this bet.",
      schema: FinishInput,
      terminal: true,
      label: () => "Finished the first bet",
    });

    const ws0 = ctx.read();
    const digest = (sigs.signals?.digest ?? (site ? siteDigestToText(site) : `No website. The founder's description:\n${note}`)).slice(0, 26_000);
    const yc = sigs.yc;
    const betMessage = [
      taskHeader(),
      `<company_snapshot>\n${snapshotText(ws0.company)}\n</company_snapshot>`,
      `<evidence>\n${evidenceBlock()}\n</evidence>`,
      founderBlock(ws0),
      `<free_signals>\n${digest}${yc ? `\n\n## YC directory\n${yc.name} · ${yc.batch} · ${yc.teamSize ?? "?"} people · ${yc.industry} · ${yc.oneLiner}` : ""}\n</free_signals>`,
      siteState !== "ok"
        ? `Coverage: the site was ${siteState === "none" ? "unavailable" : "thin"}. Confidence stays low, and your first founder question asks ${consumer ? "who uses it and when" : "who buys and why"}.`
        : "",
      saved.size && ws0.foundation ? savedSectionsText(ws0.foundation, saved) : "",
      saved.size
        ? `Already saved: ${[...saved].join(", ")}. Send only: ${betSections.filter((k) => !saved.has(k)).join(", ")} with submit_section, then finish_bet.`
        : consumer
          ? "This company sells to consumers. Write the first bet now: competitor searches first (at most 3), then submit_section with positioning; then icp (the audience bet) + personas (segments); then messaging + growth + questions together with finish_bet."
          : "Write the first bet now: competitor searches first (at most 3), then submit_section with positioning; then icp + personas; then messaging + questions together with finish_bet.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const betOptions = {
      tier: "strategist" as const,
      effort: "high" as const,
      // Competitor searches only feed positioning; a resumed bet that already has it doesn't search again.
      webSearch: saved.has("positioning") ? 0 : 3,
      system: [coreFor(ws0), consumer ? CONSUMER_FOUNDATION_RULES : FOUNDATION_RULES],
      tools: [finishBet, submitSection],
      requireTerminal: true,
      // Sections are saved as they arrive; a missing finish_bet falls through to the continuation below.
      optionalResult: true,
    };
    if (resume && saved.has(consumer ? "personas" : "icp")) await startDiscovery(); // no-op when the stopped run already started it

    let missing = REQUIRED.filter((k) => !saved.has(k));
    let betMessages: unknown[] = [];
    let finish: FinishInput | undefined;
    if (!missing.length) {
      // Resumed with every required section already saved: nothing left for the strategist.
      finish = { confidence: ctx.read().foundation?.confidence ?? "low", note: null };
    } else {
      // The bet message is re-read on every later turn (at least 3 by design), so it carries its own cache breakpoint.
      let bet = await ctx.agent<FinishInput>({
        ...betOptions,
        messages: [{ role: "user", content: [{ type: "text", text: betMessage, cache_control: { type: "ephemeral" } }] }],
      });
      missing = REQUIRED.filter((k) => !saved.has(k));
      if (missing.length && !ctx.signal.aborted) {
        // One continuation on the same conversation, only when the model stopped early.
        const ask = `You haven't saved: ${missing.join(", ")}. Send them now with submit_section, then call finish_bet.`;
        const messages = [...bet.messages];
        const last = messages[messages.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) messages[messages.length - 1] = { ...last, content: [...last.content, { type: "text", text: ask }] };
        else messages.push({ role: "user", content: ask });
        const more = await ctx.agent<FinishInput>({ ...betOptions, messages });
        bet = { ...more, result: more.result ?? bet.result };
        missing = REQUIRED.filter((k) => !saved.has(k));
      }
      betMessages = bet.messages;
      finish = bet.result;
    }

    /* 5 · Close out: verify links, fold in answers, stamp it */
    const seen = seenUrls(betMessages);
    for (const u of [...(sigs.signals?.urls ?? []), ...(site?.pages.map((p) => p.url) ?? [])]) seen.add(urlKey(u));
    const seenHosts = new Set([...[...seen].map((u) => u.split("/")[0]), ...priorHosts]);
    const wasSeen = (u: string | undefined): u is string => !!u && (seen.has(urlKey(u)) || priorHosts.has(hostOf(u)));
    await ctx.mutate((ws) => {
      const f = ws.foundation;
      if (!f) return;
      f.positioning.alternatives = f.positioning.alternatives.map((a) => ({
        ...a,
        sourceUrl: wasSeen(a.sourceUrl) ? a.sourceUrl : undefined,
        domain: a.domain && (seenHosts.has(a.domain) || (wasSeen(a.sourceUrl) && hostOf(a.sourceUrl) === a.domain)) ? a.domain : undefined,
      }));
      for (const p of f.personas) p.wateringHoles = p.wateringHoles.map((h) => ({ ...h, url: wasSeen(h.url) ? h.url : undefined }));
      f.competitors = f.positioning.alternatives
        .filter((a) => a.kind === "competitor")
        .slice(0, 5)
        .map(
          (a): Competitor => ({
            name: a.name,
            domain: a.domain,
            whenWeWin: f.positioning.differentiators.find((d) => d.vsAlternative.toLowerCase() === a.name.toLowerCase())?.capability ?? "",
            whenWeLose: a.whyChosenToday,
            landmineQuestions: [],
            sourceUrl: a.sourceUrl,
          }),
        );
      const answers = ws.onboarding.answers ?? {};
      const at = nowISO();
      const onb: FounderQuestion[] = ONB_QUESTIONS.filter((q) => q.key !== "who" || answers.who).map(({ key, ...q }) => ({
        ...q,
        answer: answers[key]?.trim() || undefined,
        answeredAt: answers[key]?.trim() ? at : undefined,
      }));
      f.founderQuestions = [...onb, ...f.founderQuestions.filter((q) => !q.id.startsWith("onb_"))];
      f.confidence = siteState !== "ok" ? "low" : (finish?.confidence ?? "low");
      f.generatedAt = at;
      if (ws.company) {
        const c = ws.company;
        const corrected = (key: LearningChip["key"]) => c.chips.find((x) => x.key === key && x.corrected)?.text;
        c.plainOneLiner = corrected("what") ?? c.plainOneLiner;
        c.whoItsFor = corrected("who") ?? c.whoItsFor;
        if (corrected("pricing")) c.howYouCharge = { ...c.howYouCharge, summary: corrected("pricing")! };
        const s = stageFromText(corrected("stage"));
        if (s && s !== c.stage) {
          c.stage = s;
          f.channelPlan = planFor(ws, s);
          f.commercial = commercialFor(ws, f.icp.employeeBand, f.commercial);
        }
        // Proof the founder marked wrong after the snapshot was written.
        const wrongProof = rejectedProof(ws);
        c.proof = c.proof.filter((p) => !wrongProof(p.evidenceId ? ws.evidence[p.evidenceId]?.quote : undefined));
      }
      if (firstRun) ws.onboarding.status = "offer";
    });

    ctx.emit({ type: "action", text: missing.length ? `Saved what I could · missing ${missing.join(", ")}` : "Your first bet is ready" });
    return { sections: [...saved], missing, confidence: ctx.read().foundation?.confidence, discoveryRunId: ctx.read().onboarding.discoveryRunId ?? null };
  },
});

/** What a resumed bet already saved, so it can send only the rest and its 1-based indices still resolve. */
function savedSectionsText(f: Foundation, saved: Set<FoundationSection>): string {
  const lines: string[] = [];
  if (saved.has("positioning")) {
    const p = f.positioning;
    if (p.category.name) lines.push(`Category: ${p.category.name}`);
    lines.push(`Alternatives: ${p.alternatives.map((a) => `${a.name} (${a.kind})`).join(", ")}`);
    if (p.bestFit.length) lines.push(`Best fit: ${p.bestFit.join("; ")}`);
    lines.push("Value themes (1-based, for messaging.themes):", ...p.valueThemes.map((t, i) => `${i + 1}. ${t.theme}: ${t.outcome}`));
  }
  if (saved.has("icp") && f.icp.hypothesis.sentence) lines.push(`ICP bet: ${f.icp.hypothesis.sentence}`);
  if (saved.has("personas")) lines.push("Personas (1-based, for messaging.byPersona):", ...f.personas.map((p, i) => `${i + 1}. ${p.role} · ${p.titles[0] ?? ""}`));
  if (saved.has("messaging") && f.messaging.oneLiner) lines.push(`One-liner: ${f.messaging.oneLiner}`);
  if (saved.has("growth") && f.growth) lines.push(`North star: ${f.growth.northStar.metric}. Activation: ${f.growth.activation.event}.`);
  return `<saved_sections>\n${lines.join("\n")}\n</saved_sections>`;
}

function snapshotText(c: CompanySnapshot | null): string {
  if (!c) return "Unknown company.";
  const lines = [
    `Name: ${c.name}${c.domain ? ` (${c.domain})` : ""}`,
    `What it does: ${c.plainOneLiner || "unknown"}`,
    `Who it's for: ${c.whoItsFor || "unknown"}`,
    `Pricing: ${c.howYouCharge.model}${c.howYouCharge.isPublic ? " (public)" : ""}${c.howYouCharge.summary ? ` — ${c.howYouCharge.summary}` : ""}`,
    `Stage: ${c.stage}. Coverage: ${c.coverage}.`,
    c.market ? `Market: ${c.market === "consumer" ? `consumers${c.consumerModel ? ` (${c.consumerModel})` : ""}` : "businesses"}${c.marketSource === "founder" ? ", the founder's pick" : ""}${c.marketHints?.length ? `. Seen on the site: ${c.marketHints.join(", ")}` : ""}.` : "",
    c.proof.length ? `Proof on the site: ${c.proof.map((p) => `${p.text}${p.evidenceId ? ` [${p.evidenceId}]` : ""}`).join("; ")}` : "Proof on the site: none found.",
    c.alternatives.length ? `Alternatives the site implies: ${c.alternatives.map((a) => `${a.name} (${a.kind})`).join(", ")}` : "",
    c.messagingIssues.length ? `Messaging issues: ${c.messagingIssues.map((m) => `${m.issue} ("${m.quote}")`).join("; ")}` : "",
    c.emailProvider ? `Email provider: ${c.emailProvider}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

