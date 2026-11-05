import type { Confidence } from "@/lib/domain/types";
import type { CellSource, CellValue, ResearchColumn } from "./types";

/**
 * Answers that need no model: questions the facts Inroad already read in code settle on their own.
 * "Are they hiring in finance?" is a count on their job board; "Do they use HubSpot?" is a script on their
 * site or a record in their DNS. Zero tokens. Anything less clear-cut returns null and goes to the model,
 * with these facts as context. A missing script or record never answers "No": absence isn't evidence.
 */

export interface QuickFacts {
  domain: string;
  /** Their public job board, read in code. */
  jobs?: { boardUrl: string; provider: string; checkedOn: string; total: number; teams: { team: string; count: number; titles: string[] }[] };
  /** Vendor scripts their own pages load. */
  siteTech?: { url: string; checkedOn: string; names: string[] };
  /** SaaS verification records in their DNS. */
  dnsTech?: { url: string; checkedOn: string; names: string[] };
}

export interface QuickAnswer {
  value: CellValue;
  confidence: Confidence;
  sources: CellSource[];
  note: string;
}

/* ─────────────────────────── Hiring ─────────────────────────── */

const HIRING = /\b(hiring|recruiting|open ([a-z&-]+ )?(roles?|positions?|jobs?|reqs?)|job (posts?|postings?|openings?|listings?)|roles? open|job openings?)\b/i;

const TEAMS: { label: string; re: RegExp }[] = [
  { label: "finance", re: /\b(financ\w*|accounting|accountants?|fp&a|controllers?|treasury|billing|revenue (operations|accounting|accountants?))\b/i },
  { label: "sales", re: /\b(sales|account executives?|sdrs?|bdrs?)\b/i },
  { label: "engineering", re: /\b(engineer\w*|developers?|devops|sres?)\b/i },
  { label: "marketing", re: /\b(marketing|demand gen\w*)\b/i },
  { label: "data", re: /\b(data|analytics)\b/i },
  { label: "security", re: /\b(security|infosec)\b/i },
  { label: "design", re: /\b(design|designers?)\b/i },
  { label: "product", re: /\b(product managers?|product management)\b/i },
  { label: "support", re: /\b(support|customer success)\b/i },
  { label: "people", re: /\b(people|hr|human resources|recruiters?|talent)\b/i },
  { label: "legal", re: /\b(legal|counsel)\b/i },
];

function hiring(column: ResearchColumn, facts: QuickFacts): QuickAnswer | null {
  const q = column.question;
  if (!HIRING.test(q) || column.type === "pick_one" || !facts.jobs) return null;
  const teams = TEAMS.filter((t) => t.re.test(q));
  if (teams.length > 1) return null; // "sales engineers": two teams in one question, let the model read it
  const team = teams[0];
  const jobs = facts.jobs;
  const where = `their ${providerName(jobs.provider)} job board`;

  let count = 0;
  let exact = true;
  const titles: string[] = [];
  if (!team) {
    count = jobs.total;
    titles.push(...jobs.teams.flatMap((t) => t.titles).slice(0, 4));
  } else {
    for (const t of jobs.teams) {
      if (team.re.test(t.team)) {
        count += t.count;
        titles.push(...t.titles);
      } else {
        // A title in another team counts when nothing else claims it: "Billing Operations Analyst" is finance, "Billing Engineer" isn't.
        const m = t.titles.filter((title) => team.re.test(title) && !TEAMS.some((o) => o !== team && o.re.test(title)));
        if (m.length) {
          // Titles are a sample of each team's roles, so a count from them is a floor, not a number.
          exact = false;
          count += m.length;
          titles.push(...m);
        }
      }
    }
  }
  const what = team ? `${team.label} roles` : "open roles";
  const quote = team
    ? count
      ? clip(`${what.replace(/^./, (c) => c.toUpperCase())} (${count}): ${[...new Set(titles)].slice(0, 4).join("; ")}`)
      : clip(`Open roles (${jobs.total}): ${jobs.teams.slice(0, 4).map((t) => `${t.team} ${t.count}`).join(", ") || "none"}`)
    : clip(`Open roles (${jobs.total}): ${jobs.teams.slice(0, 4).map((t) => `${t.team} ${t.count}`).join(", ") || "none"}`);
  const source: CellSource = { url: jobs.boardUrl, quote, date: jobs.checkedOn, kind: "job_board", checked: true };

  if (column.type === "yes_no") {
    return count > 0
      ? { value: true, confidence: "high", sources: [source], note: `${count} ${count === 1 ? what.replace(/s$/, "") : what} on ${where}.` }
      : // A board can miss roles posted elsewhere, so "no" is medium at best.
        { value: false, confidence: "medium", sources: [source], note: team ? `None of their ${jobs.total} open roles are in ${team.label}.` : `No open roles on ${where}.` };
  }
  if (column.type === "number") {
    if (!exact) return null;
    return { value: count, confidence: "high", sources: [source], note: `Counted on ${where}.` };
  }
  // Short text.
  const list = [...new Set(titles)].slice(0, 3).join(", ");
  return {
    value: clip(count ? `${count} ${count === 1 ? what.replace(/s$/, "") : what}${list ? `: ${list}` : ""}` : team ? `None in ${team.label}` : "None open", 120),
    confidence: count ? "high" : "medium",
    sources: [source],
    note: `From ${where}.`,
  };
}

function providerName(p: string): string {
  return p === "greenhouse" ? "Greenhouse" : p === "lever" ? "Lever" : p === "ashby" ? "Ashby" : p === "workable" ? "Workable" : p;
}

/* ─────────────────────────── Tools they use ─────────────────────────── */

/** Every vendor Inroad can see in code: from the scripts a site loads (signals/website.ts) and DNS records (signals/dns.ts). */
const VENDORS = [
  "HubSpot", "Salesforce Pardot", "Salesforce", "Marketo", "Segment", "Intercom", "Drift", "Stripe", "Webflow", "Framer", "Next.js",
  "Google Tag Manager", "Mixpanel", "Amplitude", "PostHog", "Calendly", "Clearbit", "6sense", "Qualified", "Zendesk", "Atlassian",
  "Slack", "Notion", "Linear", "Zoom", "OpenAI", "Anthropic", "Cursor", "1Password", "Docusign", "Adobe", "Miro", "Figma", "Gong",
  "Apollo", "Outreach", "Okta", "Vanta", "Drata", "Mailchimp", "SendGrid", "Amazon SES", "Customer.io",
];

const CATEGORIES: { re: RegExp; vendors: string[] }[] = [
  { re: /\b(billing|payments?|subscriptions?|invoic\w*|checkout)\b/i, vendors: ["Stripe"] },
  { re: /\b(crm|marketing automation)\b/i, vendors: ["HubSpot", "Salesforce", "Salesforce Pardot", "Marketo"] },
  { re: /\b(product analytics|analytics|event tracking|tag manager)\b/i, vendors: ["Segment", "Mixpanel", "Amplitude", "PostHog", "Google Tag Manager"] },
  { re: /\b(support|help ?desk|live chat|chat widget|ticketing)\b/i, vendors: ["Intercom", "Zendesk", "Drift", "Qualified"] },
  { re: /\b(website builder|site builder|cms|web framework)\b/i, vendors: ["Webflow", "Framer", "Next.js"] },
  { re: /\b(scheduling|booking|meeting links?)\b/i, vendors: ["Calendly"] },
  { re: /\b(sales engagement|sequencer|outbound tool)\b/i, vendors: ["Outreach", "Apollo"] },
  { re: /\b(compliance automation|soc ?2 tool|trust cent(er|re))\b/i, vendors: ["Vanta", "Drata"] },
  { re: /\b(identity provider|sso|idp)\b/i, vendors: ["Okta"] },
  { re: /\b(transactional email|email sending|email service)\b/i, vendors: ["SendGrid", "Mailchimp", "Amazon SES", "Customer.io"] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, vendor: string) => new RegExp(`(^|[^a-z0-9])${escape(vendor.toLowerCase())}($|[^a-z0-9])`, "i").test(text.toLowerCase());

function detected(facts: QuickFacts): Map<string, CellSource> {
  const out = new Map<string, CellSource>();
  if (facts.siteTech?.names.length) {
    const quote = clip(`Scripts loaded on their site: ${facts.siteTech.names.join(", ")}`);
    for (const n of facts.siteTech.names) out.set(n, { url: facts.siteTech.url, quote, date: facts.siteTech.checkedOn, kind: "site", checked: true });
  }
  if (facts.dnsTech?.names.length) {
    const quote = clip(`Verification records in their DNS: ${facts.dnsTech.names.join(", ")}`);
    for (const n of facts.dnsTech.names) if (!out.has(n)) out.set(n, { url: facts.dnsTech.url, quote, date: facts.dnsTech.checkedOn, kind: "dns", checked: true });
  }
  return out;
}

function why(vendor: string, s: CellSource): string {
  return s.kind === "dns" ? `Their DNS has a ${vendor} verification record.` : `Their site loads ${vendor}'s script.`;
}

function tools(column: ResearchColumn, facts: QuickFacts): QuickAnswer | null {
  const q = column.question;
  if (/\b(not|never|no longer|stop\w*|switch\w*|replac\w*|migrat\w*|churn\w*)\b|n't\b/i.test(q)) return null; // negations and changes need reading
  const seen = detected(facts);
  if (!seen.size) return null;
  const named = VENDORS.filter((v) => mentions(q, v));

  if (column.type === "yes_no") {
    // "Salesforce" inside "Salesforce Pardot" counts once.
    const hits = named.filter((v) => seen.has(v) || (v === "Salesforce" && seen.has("Salesforce Pardot")));
    if (!named.length || !hits.length) return null;
    const v = hits[0];
    const s = seen.get(v) ?? seen.get("Salesforce Pardot")!;
    // A script or a record shows an account with the vendor, not how much they use it.
    return { value: true, confidence: "medium", sources: dedupe(hits.map((h) => seen.get(h) ?? s)), note: why(v, s) };
  }

  if (column.type === "pick_one") {
    const opts = column.options ?? [];
    const matches = opts.filter((o) => [...seen.keys()].some((v) => mentions(o, v) || mentions(v, o)));
    if (matches.length !== 1) return null;
    const v = [...seen.keys()].find((x) => mentions(matches[0], x) || mentions(x, matches[0]))!;
    return { value: matches[0], confidence: "medium", sources: [seen.get(v)!], note: why(v, seen.get(v)!) };
  }

  if (column.type === "text" && !named.length) {
    const cat = CATEGORIES.find((c) => c.re.test(q));
    const hits = cat ? cat.vendors.filter((v) => seen.has(v)) : [];
    if (!hits.length) return null;
    return {
      value: clip(hits.slice(0, 3).join(", "), 120),
      confidence: "medium",
      sources: dedupe(hits.map((h) => seen.get(h)!)),
      note: hits.length === 1 ? why(hits[0], seen.get(hits[0])!) : "Seen in the scripts their site loads or their DNS records.",
    };
  }
  return null;
}

function dedupe(sources: CellSource[]): CellSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.url + s.quote) ? false : (seen.add(s.url + s.quote), true)));
}

function clip(s: string, max = 280): string {
  return s.length > max ? `${s.slice(0, max - 1).replace(/[\s,;]+\S*$/, "")}…` : s;
}

/** A zero-token answer when the facts settle the question; otherwise null (the model gets the question). */
export function quickAnswer(column: ResearchColumn, facts: QuickFacts): QuickAnswer | null {
  if (column.instructions?.trim()) return null; // the founder's own rule for deciding needs reading, not matching
  return hiring(column, facts) ?? tools(column, facts);
}
