/**
 * Per-tool playbooks: how a real model would work through each workflow's tools, turn by turn, with
 * input built from what the request actually contains (the site it was shown, the evidence ids it was
 * given, the candidates it must screen). A playbook may also choose the turn's web search and its
 * thinking lines. Tools without a playbook get the schema-driven fallback in plan.mjs.
 *
 *   { name, match(ctx) → boolean, act(ctx) → { blocks }, search?(ctx), wantsSearch?(ctx), thinking?(ctx) }
 */
import { call, lastCall, submitted, text } from "./blocks.mjs";
import {
  addDays,
  attr,
  between,
  clip,
  datedLines,
  evidenceList,
  field,
  hash,
  plain,
  quoteFrom,
  sentenceCase,
  sitePages,
  slugOf,
  titleCase,
  todayOf,
  wordCount,
} from "./read.mjs";

const has = (ctx, ...names) => names.every((n) => ctx.toolNames.includes(n));
const result = (title, url, age = "2 weeks ago") => ({ type: "web_search_result", title, url, encrypted_content: "x", page_age: age });

/* ───────────── Who the founder sells to, from whatever the prompt says about them ───────────── */

function buyerOf(textBlob) {
  const t = String(textBlob ?? "").toLowerCase();
  if (/financ|billing|invoice|account(ing|s payable)|revenue|payment|ledger/.test(t)) return { fn: "finance", champion: ["Head of Finance", "Controller"], buyer: ["CFO", "VP Finance"], pain: "month-end close" };
  if (/engineer|developer|devops|platform team|infrastructure|api\b|code/.test(t)) return { fn: "engineering", champion: ["Head of Platform", "Engineering Manager"], buyer: ["VP Engineering", "CTO"], pain: "release work" };
  if (/sales|pipeline|crm|revops|go-to-market|gtm/.test(t)) return { fn: "revenue", champion: ["Head of Revenue Operations", "Sales Operations Manager"], buyer: ["VP Sales", "CRO"], pain: "pipeline reporting" };
  if (/hr\b|people team|recruit|hiring|talent|payroll/.test(t)) return { fn: "people", champion: ["Head of People", "People Operations Manager"], buyer: ["VP People", "COO"], pain: "onboarding" };
  if (/security|compliance|soc ?2|audit/.test(t)) return { fn: "security", champion: ["Head of Security", "Security Engineer"], buyer: ["CISO", "CTO"], pain: "audit prep" };
  return { fn: "operations", champion: ["Head of Operations", "Operations Manager"], buyer: ["COO", "VP Operations"], pain: "manual reporting" };
}

/* ───────────── W1a · the founder's own site: chips, then the snapshot ───────────── */

function siteOf(ctx) {
  const block = between(ctx.firstText, "site");
  const pages = sitePages(block);
  const website = /Website: (\S+) \(([^)]*)\)/.exec(block ?? "");
  return { pages, domain: website?.[1] ?? null, name: website?.[2] ?? null };
}

const founderSaid = (ctx) => {
  const f = between(ctx.firstText, "founder_input");
  return f && !/^Nothing yet\.?$/.test(f.trim()) ? f : null;
};

const snapshotPlaybook = {
  name: "snapshot",
  match: (ctx) => has(ctx, "share_learning", "submit_snapshot"),
  thinking: () => ["Reading the founder's pages for what they sell and who buys it.", "Quoting the site exactly so every chip has a source.", "Then the snapshot."],
  act(ctx) {
    const { pages, name, domain } = siteOf(ctx);
    const home = pages[0];
    const founder = founderSaid(ctx);
    const description = home?.description || quoteFrom(home?.body, { min: 5, max: 20 }) || (founder ? clip(founder.replace(/^Founder's note:\s*/m, ""), 18) : "");
    if (!ctx.calls.some((c) => c.name === "share_learning")) {
      const chips = [];
      if (home) {
        const what = home.description ? clip(home.description, 12) : quoteFrom(home.body, { max: 10 });
        if (what) chips.push(call("share_learning", { key: "what", text: clip(plain(what), 14, 90), source: "site", sourceUrl: home.url, quote: what, confidence: "high" }));
        const whoLine = [home.description, home.headings, home.body].join("\n").match(/\bfor ([^.,\n]{6,80})/i);
        if (whoLine) chips.push(call("share_learning", { key: "who", text: clip(sentenceCase(plain(whoLine[1])), 12, 90), source: "site", sourceUrl: home.url, quote: clip(whoLine[0], 12), confidence: "medium" }));
        const pricing = pages.find((p) => /pricing|plans/i.test(p.url));
        const priceQuote = pricing && (pricing.description || quoteFrom(pricing.body, { min: 3, max: 10 }));
        if (pricing && priceQuote) chips.push(call("share_learning", { key: "pricing", text: clip(plain(priceQuote), 12, 90), source: "site", sourceUrl: pricing.url, quote: priceQuote, confidence: "high" }));
      } else if (founder) {
        chips.push(call("share_learning", { key: "what", text: clip(plain(description), 14, 90) || "What the founder described", source: "founder", sourceUrl: null, quote: null, confidence: "medium" }));
      }
      if (chips.length) return { blocks: [text("Here's what the pages say so far. "), ...chips] };
    }
    const all = pages.map((p) => [p.title, p.description, p.headings, p.body].join("\n")).join("\n");
    const pricing = pages.find((p) => /pricing|plans/i.test(p.url));
    const pricingText = pricing ? [pricing.description, pricing.body].join(" ") : "";
    const model = /per (seat|user)/i.test(pricingText) ? "seat" : /usage|metered|per (call|request|event)/i.test(pricingText) ? "usage" : /\$\d/.test(pricingText) ? "flat" : pricing ? "custom_quote" : "unknown";
    const proofPage = pages.find((p) => /\d+%|\d+x|customers|trusted by/i.test(p.body));
    const proofQuote = proofPage && (proofPage.body.split(/(?<=[.!?])\s+|\n+/).find((s) => /\d+%|\d+x|customers|trusted by/i.test(s) && wordCount(s) >= 4) ?? null);
    const buyer = buyerOf(all || founder);
    const who = (all.match(/\bfor ([^.,\n]{6,80})/i)?.[1] ?? `${buyer.fn} teams at growing companies`).trim();
    return {
      blocks: [
        call("submit_snapshot", {
          name: clip(name ?? domain?.split(".")[0] ?? "Your company", 6, 60),
          plainOneLiner: clip(plain(description) || `Software for ${who}`, 20, 160),
          whoItsFor: clip(sentenceCase(plain(who)), 20, 160),
          howYouCharge: { model, isPublic: /\$\d/.test(pricingText), summary: pricing ? clip(plain(pricing.description || quoteFrom(pricing.body, { min: 3 }) || "See the pricing page"), 16, 120) : null },
          proof: proofQuote ? [{ kind: /\d/.test(proofQuote) ? "metric" : "logo", text: clip(proofQuote, 20, 160), sourceUrl: proofPage.url, quote: clip(proofQuote, 30, 300) }] : [],
          alternatives: [{ name: "Spreadsheets and manual work", kind: "status_quo" }],
          stage: /customers|case stud|trusted by/i.test(all) ? "early_revenue" : /waitlist|coming soon/i.test(all) ? "pre_launch" : "design_partners",
          messagingIssues: [],
          coverage: /The site is thin/.test(ctx.firstText) || pages.length < 3 ? "thin" : "good",
        }),
      ],
    };
  },
};

/* ───────────── W1b · the first bet: positioning → icp + personas → messaging + questions → finish ───────────── */

const BET_ORDER = ["positioning", "icp", "personas", "messaging", "questions"];

function betState(ctx) {
  const saved = new Set();
  const already = /Already saved: ([a-z, ]+)\./.exec(ctx.firstText)?.[1];
  for (const k of already?.split(/,\s*/) ?? []) saved.add(k.trim());
  for (const c of ctx.calls) {
    if (c.name !== "submit_section" || c.isError || !c.result) continue;
    const m = /Saved: ([a-z, ]+)\./.exec(c.result);
    for (const k of m?.[1].split(/,\s*/) ?? []) saved.add(k.trim());
  }
  return saved;
}

function competitorOf(ctx) {
  const snap = between(ctx.firstText, "company_snapshot") ?? "";
  const own = field(snap, "Name") ?? "Acme";
  const stem = slugOf(own).slice(0, 4) || "acme";
  const names = ["Ledgerline", "Northbeam", "Clearpath", "Tallyworks", "Brightdesk"];
  const name = names[hash(stem) % names.length];
  return { name, domain: `${slugOf(name)}.com`, url: `https://www.g2.com/products/${slugOf(name)}/competitors/alternatives` };
}

function betSections(ctx, need) {
  const snap = between(ctx.firstText, "company_snapshot") ?? "";
  const what = plain(field(snap, "What it does") ?? "Software that replaces a manual process");
  const who = plain(field(snap, "Who it's for") ?? "operations teams at growing companies");
  const buyer = buyerOf(`${what} ${who} ${between(ctx.firstText, "founder_input") ?? ""}`);
  const evidence = evidenceList(between(ctx.firstText, "evidence"));
  const ev = evidence[0]?.id;
  const comp = competitorOf(ctx);
  // A result URL only counts if the model saw it this run.
  const seen = ctx.results.find((r) => r.url === comp.url);
  const lastError = lastCall(ctx, "submit_section")?.isError ? lastCall(ctx, "submit_section").result : "";
  const cite = (id) => (id && !/Unknown evidence ids/.test(lastError) ? [id] : null);
  const segment = clip(who, 10, 100);
  const out = {};
  if (need.has("positioning")) {
    out.positioning = {
      alternatives: [
        { name: "Spreadsheets and manual work", kind: "status_quo", whyChosenToday: "It's free and already in place, so nobody has to ask for budget.", domain: null, sourceUrl: null },
        { name: comp.name, kind: "competitor", whyChosenToday: "A known name buyers find first when they search for the category.", domain: seen ? comp.domain : null, sourceUrl: seen ? comp.url : null },
      ],
      differentiators: [{ capability: clip(`Does the ${buyer.pain} work in hours instead of days`, 14, 140), vsAlternative: "Spreadsheets and manual work", status: cite(ev) ? "proven" : "claimed", evidenceIds: cite(ev) }],
      valueThemes: [
        { theme: "Hours back every week", outcome: clip(`The ${buyer.fn} team stops rebuilding the same ${buyer.pain} by hand`, 20, 180), proofEvidenceIds: cite(ev), needsProof: !cite(ev) },
        { theme: "Fewer errors", outcome: "Numbers people trust without a second check", proofEvidenceIds: null, needsProof: true },
      ],
      bestFit: [clip(sentenceCase(segment), 16, 160)],
      category: { name: clip(titleCase(`${buyer.fn} automation`), 4, 60), style: "head_to_head", why: "Buyers already budget for this and compare a few options." },
      warning: null,
    };
  }
  if (need.has("icp")) {
    const sentence = clip(`${sentenceCase(segment)} where the ${buyer.champion[0].toLowerCase()} still owns ${buyer.pain} by hand, because the team grew faster than its tools; we make it a same-day job.`, 44, 340);
    out.icp = {
      hypothesis: {
        companyGroup: clip(segment, 12, 100),
        role: buyer.champion[0],
        obstacle: clip(`${sentenceCase(buyer.pain)} takes days every month`, 14, 140),
        cause: "The team grew faster than its tools",
        improvement: clip(`${sentenceCase(buyer.pain)} done the same day`, 14, 140),
        sentence,
      },
      primarySegment: clip(segment, 12, 100),
      testSlices: [],
      employeeBand: "50_300",
      criteria: [
        { text: clip(`Is ${segment}`, 18, 140), kind: "firmographic", mustHave: true, detection: "yc_directory", status: "hypothesis", howToTest: "Check it on the next 25 touches and 5 calls." },
        { text: "Between 20 and 300 employees", kind: "firmographic", mustHave: false, detection: "site", status: "hypothesis", howToTest: null },
        { text: clip(`Hiring for ${buyer.fn} roles in the last 90 days`, 14, 140), kind: "situational", mustHave: false, detection: "job_posts", status: "hypothesis", howToTest: null },
      ],
      antiIcp: [{ text: "Agencies and consultancies", reason: "They resell the work instead of owning the problem." }],
      triggers: [{ type: "hiring", windowDays: 90, implication: clip(`A new ${buyer.fn} hire means ${buyer.pain} is about to change hands`, 24, 180) }],
      confirmIf: "3 of the next 5 calls name this pain before we do",
      killIf: "Buyers say a spreadsheet is good enough after a demo",
    };
  }
  if (need.has("personas")) {
    out.personas = [
      { role: "champion", titles: buyer.champion, kpis: [clip(`${sentenceCase(buyer.pain)} time`, 6, 100)], pains: [clip(`Rebuilding ${buyer.pain} by hand every month`, 14, 160)], triggers: ["A new hire on the team"], objections: ["We'll fix it with a script"], wateringHoles: [], line: clip(`You stop rebuilding ${buyer.pain} by hand.`, 24, 220) },
      { role: "economic_buyer", titles: buyer.buyer, kpis: ["Team hours per month"], pains: ["Paying senior people to do manual work"], triggers: ["Planning next year's hires"], objections: ["Not a priority this quarter"], wateringHoles: [], line: "Your team spends its time on the work you hired it for." },
    ];
  }
  if (need.has("messaging")) {
    out.messaging = {
      oneLiner: clip(`${sentenceCase(what.replace(/\.$/, ""))}, so ${buyer.fn} teams get ${buyer.pain} done the same day.`, 24, 240),
      themes: [{ valueTheme: 1, headline: "Hours back every week", vsAlternative: "Spreadsheets and manual work" }],
      byPersona: [{ persona: 1, line: clip(`You stop rebuilding ${buyer.pain} by hand.`, 24, 220) }],
      bySignal: [{ signal: "hiring", implication: clip(`A new ${buyer.fn} hire inherits ${buyer.pain}; we make their first month easier.`, 28, 200) }],
      customerWords: [],
      bannedWords: [],
    };
  }
  if (need.has("questions")) {
    out.questions = [
      { question: "Which of your last 3 customers had this problem worst, and why?", whyItMatters: "It sharpens who we look for first.", affects: ["icp"] },
      { question: "What did they pay for before you, in money or hours?", whyItMatters: "It sets the price anchor.", affects: ["pricing"] },
    ];
  }
  return out;
}

const betPlaybook = {
  name: "bet",
  match: (ctx) => has(ctx, "submit_section", "finish_bet"),
  thinking: () => ["Positioning first: what they'd use instead of this.", "Then who buys, and the words to use with them.", "Saving each section as it's ready."],
  wantsSearch: (ctx) => !betState(ctx).has("positioning"),
  search(ctx) {
    const comp = competitorOf(ctx);
    const snap = between(ctx.firstText, "company_snapshot") ?? "";
    const own = field(snap, "Name") ?? "the product";
    return {
      query: `${own} alternatives competitors`,
      results: [
        result(`Top ${comp.name} alternatives and competitors in 2026`, comp.url, "1 month ago"),
        result(`${comp.name} pricing and reviews`, `https://${comp.domain}/pricing`, "3 weeks ago"),
        result(`How finance and ops teams compare tools in this category`, "https://www.forbes.com/sites/category-buyers-guide", "2 months ago"),
      ],
    };
  },
  act(ctx) {
    const saved = betState(ctx);
    const pending = BET_ORDER.filter((k) => !saved.has(k));
    if (!pending.length) {
      if (submitted(ctx, "finish_bet")) return { blocks: [text("The bet is saved.")] };
      return { blocks: [call("finish_bet", { confidence: "medium", note: "The ICP rests on the site and your answers; calls will confirm or kill it." })] };
    }
    // The order the tool asks for: positioning alone; icp + personas; messaging + questions with finish_bet.
    const next = pending[0] === "positioning" ? ["positioning"] : pending[0] === "icp" || pending[0] === "personas" ? pending.filter((k) => k === "icp" || k === "personas") : pending;
    const blocks = [call("submit_section", betSections(ctx, new Set(next)))];
    if (next.includes("messaging") || next.includes("questions")) blocks.push(call("finish_bet", { confidence: "medium", note: "The ICP rests on the site and your answers; calls will confirm or kill it." }));
    return { blocks };
  },
};

/* ───────────── W3 · discovery: screening cards, and the capped web-search fallback ───────────── */

function candidateCards(textBlob) {
  const out = [];
  const lines = String(textBlob ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\[(\d+)\] (\S+) · (.+?) — (.*)$/.exec(lines[i]);
    if (!m) continue;
    const extra = [];
    for (let j = i + 1; j < lines.length && /^\s{4}/.test(lines[j]); j++) extra.push(lines[j].trim());
    out.push({ i: Number(m[1]), domain: m[2], name: m[3], oneLiner: m[4], facts: extra.join(" · ") });
  }
  return out;
}

const screenPlaybook = {
  name: "screen",
  match: (ctx) => has(ctx, "submit_screen") && /Criteria \(id · must\/nice · text\)/.test(ctx.firstText),
  thinking: () => ["Checking each card against the criteria.", "Unknown is not false: most situational facts aren't on a card.", "One result per candidate."],
  act(ctx) {
    const crits = [...ctx.firstText.matchAll(/^- (\S+) · (must|nice) · (.+)$/gm)].map((m) => ({ id: m[1], must: m[2] === "must", text: m[3] }));
    const cards = candidateCards(between(ctx.firstText, "candidates") ?? ctx.firstText.slice(ctx.firstText.indexOf("Candidates:")));
    const results = cards.map((c) => {
      const card = `${c.name} ${c.oneLiner} ${c.facts}`;
      const agency = /\b(agency|consultanc|staffing|recruit)/i.test(card);
      // A deterministic one in six is a clear miss, the way real screens drop some.
      const miss = hash(c.domain) % 6 === 0;
      return {
        i: c.i,
        domain: c.domain,
        criteria: crits.map((cr, k) => {
          if (/situational|hiring|pain|budget|tool/i.test(cr.text) && !/hiring/i.test(card)) return { id: cr.id, met: "unknown", why: "" };
          if (miss && k === 0 && cr.must) return { id: cr.id, met: "false", why: clip(`Card says ${c.oneLiner}`, 8) };
          return { id: cr.id, met: "true", why: clip(c.oneLiner || c.name, 8) };
        }),
        antiIcp: agency ? "Agencies and consultancies" : null,
        note: clip(c.oneLiner || `${c.name}, no description`, 12),
      };
    });
    return { blocks: [call("submit_screen", { results })] };
  },
};

const networkPlaybook = {
  name: "network",
  match: (ctx) => has(ctx, "submit_screen") && /where the founder has LinkedIn connections/.test(ctx.firstText),
  act(ctx) {
    const rows = [...ctx.firstText.matchAll(/^\[(\d+)\] (.+?) · (\d+) connections? · titles: (.*)$/gm)];
    const results = rows.map((m) => {
      const titles = m[4];
      const unlikely = /recruit|talent acquisition|student|professor|university|agency|consult/i.test(`${m[2]} ${titles}`);
      const likely = !unlikely && /\b(head|vp|director|chief|founder|cto|cfo|coo)\b/i.test(titles);
      return { i: Number(m[1]), fit: unlikely ? "unlikely" : likely ? "likely" : "unknown", reason: clip(unlikely ? `Titles point to ${titles.split(",")[0]}` : likely ? `Leaders on file: ${titles.split(",")[0]}` : "Not enough on the name or titles", 14, 90) };
    });
    return { blocks: [call("submit_screen", { results })] };
  },
};

const FIRMS = ["Tallyrock", "Meterly", "Brightledger", "Quantaloop", "Northpeak", "Sablewire", "Coppergate", "Fernstack", "Halcyon Ops", "Lumenly"];

const candidatesPlaybook = {
  name: "candidates",
  match: (ctx) => has(ctx, "submit_candidates"),
  search(ctx) {
    const titles = /Buyer titles[^:]*: ([^\n]+)/.exec(ctx.firstText)?.[1]?.split(", ") ?? ["Head of Operations"];
    const avoid = new Set([...(ctx.firstText.match(/[a-z0-9-]+\.(?:com|io|ai|co)/gi) ?? [])].map((d) => d.toLowerCase()));
    const firms = FIRMS.filter((f) => !avoid.has(`${slugOf(f)}.com`)).slice(0, 5);
    return {
      query: `site:jobs.ashbyhq.com OR site:boards.greenhouse.io "${titles[0]}"`,
      results: firms.map((f, i) => result(`${i % 2 ? "Founding" : "Head of"} ${titles[0].replace(/^(Head of|VP|Director of)\s*/i, "")} at ${f}`, `https://jobs.ashbyhq.com/${slugOf(f)}/${1000 + i}`, `${i + 1} weeks ago`)),
    };
  },
  act(ctx) {
    const seen = ctx.results.filter((r) => /jobs\.ashbyhq\.com|greenhouse\.io|lever\.co/.test(r.url));
    const candidates = seen.slice(0, 15).map((r) => {
      const firm = r.title.split(" at ").pop();
      return { name: firm, domain: `${slugOf(firm)}.com`, oneLiner: clip(`Hiring: ${r.title.split(" at ")[0]}`, 20), sourceUrl: r.url, evidence: clip(r.title, 20) };
    });
    return { blocks: [call("submit_candidates", { candidates })] };
  },
};

/* ───────────── W4 · the dossier: record evidence (in parallel), then submit citing the ids ───────────── */

function dossierTarget(ctx) {
  const m = /Research (.+?) \(([a-z0-9.-]+)\) and write the dossier/.exec(ctx.firstText);
  return { name: m?.[1] ?? "the company", domain: m?.[2] ?? "example.com" };
}

/** Everything the dossier prompt lets the model cite, with a verbatim quote for each: dated items first. */
function citable(ctx) {
  const digest = between(ctx.firstText, "digest") ?? "";
  const pages = [];
  for (const p of sitePages(digest)) {
    const q1 = p.description || quoteFrom(p.body, { min: 5, max: 14 });
    if (q1) pages.push({ url: p.url, quote: q1, claim: clip(q1, 30, 200), sourceType: "first_party", publishedAt: null, kind: "page" });
    const q2 = quoteFrom(p.body, { min: 6, max: 16, skip: 1 });
    if (q2 && q2 !== q1) pages.push({ url: p.url, quote: q2, claim: clip(q2, 30, 200), sourceType: "first_party", publishedAt: null, kind: "page" });
  }
  const items = [];
  for (const d of datedLines(digest).slice(0, 6)) {
    const job = /ashbyhq|greenhouse|lever\.co|workable|ycombinator\.com\/companies\/.+\/jobs/.test(d.url);
    const hn = /news\.ycombinator\.com/.test(d.url);
    items.push({ url: d.url, quote: d.title, claim: clip(job ? `Hiring: ${d.title}` : d.title, 30, 200), sourceType: job ? "job_post" : hn ? "community" : "press", publishedAt: d.date, kind: job ? "job" : hn ? "hn" : "news" });
  }
  const today = todayOf(ctx.firstText);
  for (const r of ctx.results) {
    const weeks = /(\d+) (week|month|day)s? ago/.exec(r.page_age ?? "");
    const days = weeks ? Number(weeks[1]) * (weeks[2] === "month" ? 30 : weeks[2] === "week" ? 7 : 1) : null;
    items.push({ url: r.url, quote: r.title, claim: clip(r.title, 30, 200), sourceType: "search_snippet", publishedAt: days !== null ? addDays(today, -days) : null, kind: /raises|funding|series/i.test(r.title) ? "funding" : "news" });
  }
  return [...items, ...pages.slice(0, 4)];
}

const dossierPlaybook = {
  name: "dossier",
  match: (ctx) => has(ctx, "record_evidence", "submit_dossier"),
  thinking: (ctx) => [`Reading ${dossierTarget(ctx).name}'s site, open roles and news.`, "Recording each fact with its exact quote before I use it.", "Then the dossier, citing only what I recorded."],
  wantsSearch: (ctx) => /You may run up to \d+ web searches/.test(ctx.firstText) && !ctx.calls.length,
  search(ctx) {
    const { name, domain } = dossierTarget(ctx);
    const slug = slugOf(name);
    return {
      query: `"${name}" (raises OR funding) 2026`,
      results: [
        result(`${name} raises $18M Series A to expand its team`, `https://techcrunch.com/2026/09/30/${slug}-raises-series-a`, "3 weeks ago"),
        result(`${name} is hiring a Head of Finance`, `https://jobs.ashbyhq.com/${slug}/head-of-finance`, "2 weeks ago"),
        result(`${name} on Hacker News: how we run the business on two people`, `https://news.ycombinator.com/item?id=${(hash(domain) % 9_000_000) + 41_000_000}`, "1 month ago"),
      ],
    };
  },
  act(ctx) {
    const recorded = ctx.calls.filter((c) => c.name === "record_evidence");
    if (!recorded.length) {
      const items = citable(ctx).slice(0, 10);
      if (!items.length) return { blocks: [call("submit_dossier", emptyDossier(ctx))] };
      return {
        blocks: [
          text("Recording what I'll cite. "),
          ...items.map((it) => call("record_evidence", { claim: it.claim, quote: it.quote, url: it.url, sourceType: it.sourceType, publishedAt: it.publishedAt, confidence: it.sourceType === "first_party" ? "high" : "medium" })),
        ],
      };
    }
    if (submitted(ctx, "submit_dossier")) return { blocks: [text("The dossier is saved.")] };
    const ok = recorded
      .filter((c) => !c.isError && c.result)
      .map((c) => {
        try {
          return { id: JSON.parse(c.result).id, ...c.input };
        } catch {
          return null;
        }
      })
      .filter((e) => e?.id);
    return { blocks: [call("submit_dossier", buildDossier(ctx, ok))] };
  },
};

function emptyDossier(ctx) {
  const { name } = dossierTarget(ctx);
  return {
    snapshot: { plainDescription: `${name}; the material I was given doesn't say what they sell.`, descriptionEvidenceIds: [], stage: "Unknown", funding: null, headcount: null, hq: null },
    facts: [],
    signals: [],
    committee: [{ role: "champion", likelyTitles: ["Head of Operations"], people: [] }],
    painHypotheses: [],
    angles: [],
    discoveryOpeners: [],
    risks: ["Too little public information to judge fit"],
    unknowns: ["What they sell and to whom", "No named champion found"],
    recommendation: { move: "watch", personName: null, why: "Nothing public to start a conversation from yet." },
  };
}

function buildDossier(ctx, ev) {
  const { name } = dossierTarget(ctx);
  const today = todayOf(ctx.firstText);
  // Who the founder sells to (their company context), else a guess from the target's own material.
  const buyer = buyerOf(between(ctx.system, "company_context")?.match(/^(What it does|Who it's for):.*$/gm)?.join(" ") || between(ctx.firstText, "digest"));
  const pages = ev.filter((e) => e.sourceType === "first_party");
  const dated = ev.filter((e) => e.publishedAt && e.publishedAt <= today).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const jobs = dated.filter((e) => e.sourceType === "job_post" || /hiring/i.test(e.claim));
  const funding = dated.find((e) => /raises|funding|series/i.test(e.quote));
  const top = jobs[0] ?? funding ?? dated[0];
  const signalOf = (e) => {
    const firstHire = /\b(head of|founding|first)\b/i.test(e.quote);
    const fresh = (Date.parse(today) - Date.parse(e.publishedAt)) / 86_400_000 <= 30;
    return {
      type: /raises|funding|series/i.test(e.quote) ? "funding" : firstHire ? "first_hire" : e.sourceType === "job_post" ? "hiring" : e.sourceType === "community" ? "community_request" : "launch",
      headline: clip(e.quote, 14),
      date: e.publishedAt,
      evidenceId: e.id,
      strength: fresh && firstHire ? 3 : fresh ? 2 : 1,
      implication: clip(`Likely means ${buyer.pain} is about to change hands, and the new owner will want it fixed early.`, 25),
    };
  };
  const signals = [...new Map([...jobs, ...(funding ? [funding] : []), ...dated].map((e) => [e.id, e])).values()].slice(0, 4).map(signalOf);
  const description = pages[0] ? clip(plain(pages[0].quote), 28) : `${name}; their site wasn't readable.`;
  return {
    snapshot: {
      plainDescription: description,
      descriptionEvidenceIds: pages.slice(0, 1).map((e) => e.id),
      stage: funding ? "Series A" : "Unknown",
      funding: funding ? { round: "Series A", amountUsd: /\$(\d+)M/.test(funding.quote) ? Number(/\$(\d+)M/.exec(funding.quote)[1]) * 1_000_000 : null, date: funding.publishedAt, useOfFunds: null, evidenceId: funding.id } : null,
      headcount: null,
      hq: null,
    },
    facts: [...pages.slice(0, 2), ...jobs.slice(0, 2)].map((e) => ({ text: clip(e.claim, 24), evidenceIds: [e.id] })),
    signals,
    committee: [
      { role: "champion", likelyTitles: buyer.champion, people: [] },
      { role: "economic_buyer", likelyTitles: buyer.buyer, people: [] },
    ],
    painHypotheses: top ? [{ pain: clip(`${sentenceCase(buyer.pain)} is still done by hand while the team grows`, 28), valueThemeId: null, evidenceIds: [top.id], confidence: jobs.length ? "medium" : "low" }] : [],
    angles: top
      ? [
          {
            title: clip(jobs.length ? "A new hire inherits the problem" : "Growth outpaces the process", 8),
            signal: clip(`${top.quote} (${top.publishedAt})`, 28),
            interpretation: clip(`The ${buyer.champion[0].toLowerCase()} will own ${buyer.pain} from day one.`, 28),
            pressure: clip(`${sentenceCase(buyer.pain)} breaks first when a second person touches it.`, 28),
            pov: "Most teams answer with another hire, who then spends a quarter rebuilding the same spreadsheet.",
            povId: null,
            proofClaimId: null,
            credential: null,
            ask: clip(`Is ${buyer.pain} part of what that hire will own?`, 18),
            evidenceIds: [top.id],
            bestFor: "champion",
            strength: jobs.length ? 4 : 3,
          },
        ]
      : [],
    discoveryOpeners: top ? [{ q: clip(`You're hiring for ${clip(top.quote, 6)}. Is that to take ${buyer.pain} off someone's plate?`, 28), evidenceId: top.id }] : [],
    risks: ["They may already run this on an in-house script"],
    unknowns: ["No named champion found", "Current tooling for this work"],
    recommendation: { move: signals.some((s) => s.strength >= 2) ? "cold_email" : "watch", personName: null, why: clip(signals.length ? `A dated reason to talk: ${signals[0].headline}.` : "Good fit, but nothing dated to start from yet.", 24) },
  };
}

/* ───────────── W5 · drafts, the critic, and reading replies ───────────── */

function draftContext(ctx) {
  const task = between(ctx.firstText, "task") ?? "";
  const recipient = between(ctx.firstText, "recipient") ?? "";
  const named = /^([^,\n]+?)(?:, ([^\n]+?))? at ([^\n(]+?) \(([a-z0-9.-]+)\)/m.exec(recipient);
  const angle = between(ctx.firstText, "angle") ?? "";
  const evidence = evidenceList(between(ctx.firstText, "evidence"));
  const prior = between(ctx.firstText, "prior_touches") ?? "";
  const frames = /Allowed frames: ([a-z_, ]+)\./.exec(task)?.[1]?.split(/,\s*/) ?? ["founder_card"];
  const povs = /Least-used POVs: ([a-z0-9_, ]+)\./i.exec(ctx.firstText)?.[1]?.split(/,\s*/).filter(Boolean) ?? [];
  const creds = /credential claim id \(([^)]+)\)/.exec(ctx.firstText)?.[1]?.split(/,\s*/) ?? [];
  const step = /step 3|final step/i.test(task) ? 3 : /step 2|follow-up/i.test(task) ? 2 : 1;
  return {
    first: named && !/^Nobody named/.test(named[1]) ? named[1].split(" ")[0] : null,
    company: named?.[3]?.trim() ?? attr(ctx.firstText, "their_reply", "from")?.split(" at ").pop() ?? "your team",
    signal: /signal: ([^\n]+)/.exec(angle)?.[1] ?? null,
    ask: /suggested question: ([^\n]+)/.exec(angle)?.[1] ?? null,
    // A follow-up cites evidence the earlier touches didn't.
    evidence: step > 1 ? evidence.filter((e) => !prior.includes(e.quote.slice(0, 30))).concat(evidence) : evidence,
    frames,
    povId: povs[0] ?? null,
    credentialClaimId: !povs.length && creds.length ? creds[0] : null,
    step,
  };
}

/**
 * A short exact phrase from the evidence quote, safe to put in the body as a cited span: the most
 * readable segment of it (structured quotes like "Company: A → B; Position: X" give "X").
 */
function spanPhrase(ev) {
  const q = (ev?.quote ?? "").replace(/^["“]|["”]$/g, "");
  const segments = q
    .split(/\s*(?:[;:→|·]|\s-\s|—)\s*/)
    .map((s) => s.trim().replace(/[,.!?]+$/, ""))
    .filter((s) => /^[\w$%&' ,.-]+$/.test(s) && s.split(/\s+/).length >= 2);
  if (!segments.length) return null;
  const best = [...segments].reverse().find((s) => s.split(/\s+/).length <= 8) ?? segments[0];
  return best.split(/\s+/).slice(0, 8).join(" ");
}

/** The first sentence states the fact (line 1 may not open with "Saw", "Noticed" or "Congrats"). */
function opener(d, ev, phrase) {
  const claim = `${ev?.claim ?? ""} ${ev?.sourceType ?? ""}`;
  if (/hiring|open role|job_post|posted/i.test(claim)) return `${d.company} is hiring a ${phrase}.`;
  if (/moved to|joined|new (head|vp|director)|appointed|promoted|as head/i.test(claim)) return `${d.company} has a new ${phrase}.`;
  if (/rais|series|funding/i.test(claim)) return `${d.company} announced ${phrase}.`;
  return `Your site puts it plainly: ${phrase}.`;
}

function emailBody(d, plainOpen = false) {
  const ev = plainOpen ? null : d.evidence[0];
  const phrase = ev ? spanPhrase(ev) : null;
  const hello = d.first ? `Hi ${d.first},` : "Hi there,";
  const ask = d.ask && /\?$/.test(d.ask) ? d.ask : "Is that on your list for this quarter?";
  if (d.step === 3) {
    return { body: `${hello}\n\nI'll stop here so I don't crowd your inbox. If someone else on the team owns this, who should I talk to?`, phrase: null, ev: null };
  }
  if (d.step === 2) {
    const line = phrase ? `One more thought on the ${phrase} news.` : "One more thought on my last note.";
    return { body: `${hello}\n\n${line} The first fix is usually a new spreadsheet, and it breaks again once a second person edits it.\n\n${ask}`, phrase, ev };
  }
  const open = phrase ? opener(d, ev, phrase) : `Your team at ${d.company} keeps growing.`;
  const body = `${hello}\n\n${open} When that work changes hands, the old way of doing it usually breaks first, and the new owner spends weeks rebuilding it.\n\nMost teams try a hire or a script. Both take a quarter before anything gets easier for you.\n\n${ask}`;
  return { body, phrase, ev };
}

const draftPlaybook = {
  name: "draft",
  match: (ctx) => has(ctx, "submit_draft"),
  act(ctx) {
    const d = draftContext(ctx);
    // A revision request (lint or the critic): the plain version, without the phrase that drew it.
    const revising = lastCall(ctx, "submit_draft")?.isError ?? false;
    const { body, phrase, ev } = emailBody(d, revising);
    const frame = d.step === 3 ? (d.frames.find((f) => f === "permission_to_close") ?? d.frames[0]) : d.frames[0];
    return {
      blocks: [
        call("submit_draft", {
          frame,
          subject: d.step === 1 ? clip(`${(phrase ?? d.company).toLowerCase()}`, 4, 60) : null,
          body,
          personalizedSpans: phrase && ev ? [{ text: phrase, evidenceId: ev.id }] : [],
          povId: d.povId,
          credentialClaimId: d.credentialClaimId,
          claimIds: [],
          assetId: null,
        }),
      ],
    };
  },
};

const linkedinPlaybook = {
  name: "linkedin",
  match: (ctx) => has(ctx, "submit_linkedin"),
  act(ctx) {
    const d = draftContext(ctx);
    const phrase = spanPhrase(d.evidence[0]);
    const noNote = /No note/.test(between(ctx.firstText, "task") ?? "");
    const message = clip(`${d.first ? `Hi ${d.first}, ` : ""}thanks for connecting. ${phrase ? `Saw ${phrase}.` : ""} When that work changes hands it often breaks first. ${d.ask && /\?$/.test(d.ask) ? d.ask : "Is that on your list this quarter?"}`.replace(/\s+/g, " "), 60, 300);
    return {
      blocks: [
        call("submit_linkedin", {
          note: noNote ? null : clip(`${d.first ? `${d.first}, ` : ""}we both work on ${d.company}'s kind of problem. Happy to connect.`, 30, 200),
          recommendNoNote: noNote,
          message,
          personalizedSpans: phrase && message.includes(phrase) ? [{ text: phrase, evidenceId: d.evidence[0].id }] : [],
          povId: d.povId,
          credentialClaimId: d.credentialClaimId,
        }),
      ],
    };
  },
};

const introPlaybook = {
  name: "intro",
  match: (ctx) => has(ctx, "submit_intro"),
  act(ctx) {
    const d = draftContext(ctx);
    const phrase = spanPhrase(d.evidence[0]);
    const forwardable = `I'm building a tool for teams like ${d.company}'s.${phrase ? ` ${sentenceCase(phrase)}, which is usually when this work changes hands.` : ""} Would ${d.first ?? "the right person"} give me 20 minutes of their view on how they handle it today?`;
    return {
      blocks: [
        call("submit_intro", {
          wrapper: `Would you be open to introducing me to ${d.first ?? "the right person"} at ${d.company}? A short note you can forward is below. No pressure if the timing is off.`,
          subject: clip(`Intro to ${d.company}`, 5, 80),
          forwardable,
          personalizedSpans: phrase ? [{ text: sentenceCase(phrase), evidenceId: d.evidence[0].id }].filter((s) => forwardable.includes(s.text)) : [],
          povId: d.povId,
          credentialClaimId: d.credentialClaimId,
          claimIds: [],
        }),
      ],
    };
  },
};

const replyPlaybook = {
  name: "reply",
  match: (ctx) => has(ctx, "submit_reply"),
  act(ctx) {
    const task = between(ctx.firstText, "task") ?? "";
    const intent = /They read it as: ([a-z_]+)/.exec(task)?.[1] ?? "positive";
    const from = attr(ctx.firstText, "their_reply", "from") ?? "";
    const first = from.split(/[ ,]/)[0] || "there";
    const availability = /Availability: ([^.<]+)/.exec(between(ctx.firstText, "scheduling") ?? "")?.[1];
    const checkBack = /checking back on (\d{4}-\d{2}-\d{2})/.exec(ctx.firstText)?.[1] ?? null;
    const bodies = {
      positive: `Thanks, ${first}. ${availability ? `Would ${availability.split(/[,;]/)[0].trim()} work for 20 minutes?` : "Would Tuesday or Wednesday afternoon next week work for 20 minutes?"}`,
      info_request: `Thanks, ${first}. Short version: it takes the manual part off your team's plate in the first week. Would a 20-minute walkthrough on your own numbers help?`,
      referral: `Thanks, ${first}, that helps. I'll reach out to them and mention you pointed me their way.`,
      not_now: `Understood, ${first}. I'll check back${checkBack ? ` on ${checkBack}` : " in a couple of months"} unless something changes before then.`,
      objection: `Fair question, ${first}. Most teams we talk to felt the same until the second person touched the process. Worth 20 minutes to compare notes?`,
      negative: `Thanks for the straight answer, ${first}. I won't follow up on this.`,
    };
    return { blocks: [call("submit_reply", { body: bodies[intent] ?? bodies.positive, assetId: null, claimIds: [], checkBackOn: intent === "not_now" ? checkBack : null })] };
  },
};

const replyReadPlaybook = {
  name: "reply_read",
  match: (ctx) => has(ctx, "submit_reply_read"),
  act(ctx) {
    const reply = between(ctx.firstText, "reply") ?? ctx.firstText;
    const t = reply.toLowerCase();
    const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(reply)?.[0] ?? null;
    const referral = /\b(talk to|loop in|reach out to|speak (to|with)|cc'?ing|owns this)\b/.test(t);
    const intent = /\b(unsubscribe|remove me|stop emailing)\b/.test(t)
      ? "unsubscribe"
      : /out of (the )?office|on leave|until (monday|tuesday|wednesday|thursday|friday|next week)/.test(t) && !/\?/.test(t)
        ? "ooo"
        : referral
          ? "referral"
          : /not now|next (quarter|year)|circle back|after (q[1-4]|the holidays)|maybe later/.test(t)
            ? "not_now"
            : /not interested|no thanks|please don'?t|we'?re all set/.test(t)
              ? "negative"
              : /already (use|have)|too expensive|we built|in-house|why would/.test(t)
                ? "objection"
                : /\?/.test(t) && /cost|price|pricing|how (long|much|does)|more (info|detail)|what does/.test(t)
                  ? "info_request"
                  : "positive";
    const who = referral ? /\b(?:talk to|loop in|reach out to|speak (?:to|with))\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(reply)?.[1] ?? null : null;
    const later = /next quarter/.test(t) ? addDays(todayOf(ctx.firstText), 90) : null;
    return { blocks: [call("submit_reply_read", { intent, summary: clip(reply.replace(/\s+/g, " "), 18, 120), referralName: who, referralEmail: referral ? email : null, checkBackOn: later })] };
  },
};

const critiquePlaybook = {
  name: "critique",
  match: (ctx) => has(ctx, "submit_critique"),
  act(ctx) {
    const mine = /Spans from email ([AB])|Email ([AB]) (?:has no spans|states no)/.exec(ctx.firstText);
    const label = mine?.[1] ?? mine?.[2] ?? "A";
    const verdict = { wouldReply: true, fatalIssues: [], rewrite: "" };
    return { blocks: [call("submit_critique", { a: verdict, b: verdict, preferred: label, unsupportedSpans: [], povObvious: false })] };
  },
};

export const PLAYBOOKS = [snapshotPlaybook, betPlaybook, screenPlaybook, networkPlaybook, candidatesPlaybook, dossierPlaybook, draftPlaybook, linkedinPlaybook, introPlaybook, replyPlaybook, replyReadPlaybook, critiquePlaybook];
