import type { Action } from "@/lib/domain/actions";
import { newId } from "@/lib/domain/ids";
import type { Account, Deal, ForecastCategory, ISODate, ISODateTime, Person, Stage, Workspace } from "@/lib/domain/types";
import { askedToBeDeleted, companyDomainOf, isSuppressed, normalizeDomain, normalizeEmail } from "@/lib/hub/records";
import { headerKey, type ParsedCsv } from "@/lib/network/csv";
import { openStage } from "./stats";

/**
 * Open deals from a CRM export (HubSpot, Salesforce, Attio, Pipedrive or a spreadsheet), in code: columns map
 * themselves, the file's stage names map to Inroad's stages (shown, and changeable), and each row becomes an
 * account, its people and a deal. Zero tokens. Facts only: a date the file doesn't have stays unknown and is
 * recorded as unknown on the deal, so the forecast and the X-ray never read the import time as its history.
 * Pure and isomorphic: the browser previews exactly what it will import.
 */

export type DealFieldKey =
  | "name"
  | "company"
  | "domain"
  | "amount"
  | "currency"
  | "stage"
  | "status"
  | "closeDate"
  | "nextStep"
  | "nextStepDate"
  | "forecast"
  | "contacts"
  | "contactEmail"
  | "lastActivity"
  | "created"
  | "stageEntered"
  | "source";

export const DEAL_FIELDS: { key: DealFieldKey; label: string }[] = [
  { key: "name", label: "Deal name" },
  { key: "company", label: "Company" },
  { key: "domain", label: "Company website" },
  { key: "stage", label: "Stage" },
  { key: "status", label: "Open, won or lost" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "closeDate", label: "Close date" },
  { key: "nextStep", label: "Next step" },
  { key: "nextStepDate", label: "Next step date" },
  { key: "forecast", label: "Forecast category" },
  { key: "contacts", label: "Contacts" },
  { key: "contactEmail", label: "Contact email" },
  { key: "lastActivity", label: "Last activity" },
  { key: "created", label: "Created" },
  { key: "stageEntered", label: "Entered current stage" },
  { key: "source", label: "Source" },
];

export type DealMapping = Record<DealFieldKey, number | null>;

/** Header names as tools write them, compared by `headerKey` ("Deal Stage" → "dealstage"). Earlier wins. */
const ALIASES: Record<DealFieldKey, string[]> = {
  name: ["dealname", "opportunityname", "dealtitle", "deal", "opportunity", "name", "title", "dealnameprimary"],
  company: ["associatedcompany", "associatedcompanyprimary", "company", "companyname", "accountname", "account", "organization", "organizationname", "dealorganization", "organisation"],
  domain: ["companydomainname", "associatedcompanydomain", "companydomain", "domain", "domains", "website", "companywebsite", "accountwebsite", "organizationwebsite", "websiteurl", "url"],
  amount: ["amount", "dealamount", "dealvalue", "value", "amountusd", "annualcontractvalue", "acv", "arr", "opportunityamount", "amountincompanycurrency", "contractvalue"],
  currency: ["currency", "dealcurrency", "currencycode", "dealcurrencycode", "opportunitycurrency", "dealcurrencyofvalue", "currencyofvalue", "amountcurrency"],
  stage: ["dealstage", "stage", "stagename", "pipelinestage", "opportunitystage", "salesstage"],
  status: ["dealstatus", "status", "outcome"],
  closeDate: ["closedate", "expectedclosedate", "dealexpectedclosedate", "closingdate", "estimatedclosedate", "expectedclose", "targetclosedate", "closedat"],
  nextStep: ["nextstep", "nextsteps", "nextactivitysubject", "nextaction", "dealnextactivity"],
  nextStepDate: ["nextstepdate", "nextactivitydate", "dealnextactivitydate", "nextmeetingdate", "nextactiondate"],
  forecast: ["forecastcategory", "forecastcategoryname", "forecast"],
  contacts: ["associatedcontact", "associatedcontacts", "associatedcontactprimary", "associatedpeople", "contacts", "contact", "people", "contactperson", "dealcontactperson", "primarycontact"],
  contactEmail: ["contactemail", "primarycontactemail", "personemail", "email", "emailaddress", "emailaddresses"],
  lastActivity: ["lastactivitydate", "lastactivity", "dealdateoflastactivity", "dateoflastactivity", "lastcontacted", "lastengagementdate", "lastinteraction", "lastactivityat", "dealslastactivitydate", "deallastactivitydate"],
  created: ["createdate", "createddate", "created", "createdat", "dealcreated", "datecreated", "recordcreatedat", "opportunitycreateddate", "dealdealcreated"],
  stageEntered: ["dateenteredcurrentstage", "laststagechangedate", "stagechangedate", "stagechangedat", "laststagechange", "enteredstage", "dealstagechangetime"],
  source: ["source", "dealsource", "leadsource", "originalsource", "originalsourcetype", "channel", "acquisitionchannel"],
};

/** Pipedrive writes "Deal - Title", "Organization - Website": the object prefix goes, the field stays. */
function keyOf(header: string): string {
  return headerKey(header.replace(/^(deal|organization|organisation|person|opportunity|account)\s*[-–:]\s*/i, ""));
}

export function autoMapDeals(headers: string[]): DealMapping {
  const keys = headers.map(keyOf);
  const used = new Set<number>();
  const mapping = Object.fromEntries(DEAL_FIELDS.map((f) => [f.key, null])) as DealMapping;
  for (const f of DEAL_FIELDS) {
    for (const alias of ALIASES[f.key]) {
      const i = keys.findIndex((k, j) => k === alias && !used.has(j));
      if (i >= 0) {
        mapping[f.key] = i;
        used.add(i);
        break;
      }
    }
  }
  return mapping;
}

/* ─────────────────────────────── Stages ─────────────────────────────── */

export type StageChoice = Stage | "skip";

/** What each stage choice means on import. Won counts only when it closed inside the period being forecast. */
export const STAGE_CHOICES: { value: StageChoice; label: string }[] = [
  { value: "talking", label: "Talking" },
  { value: "qualified", label: "Qualified" },
  { value: "pilot", label: "Pilot" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "skip", label: "Leave out" },
];

/** First match wins: closed outcomes before stage words, since "Closed won" also says "won". */
const STAGE_RULES: [StageChoice, RegExp][] = [
  ["won", /closed ?won|\bwon\b|\bsigned\b|\bbooked\b/],
  ["lost", /closed ?lost|\blost\b|disqualif|\bdead\b|churn|no ?decision|\brejected\b|cancel/],
  ["skip", /nurtur|on ?hold|\bpaused?\b|\bparked\b|dormant/],
  ["proposal", /proposal|contract|negotiat|\bquote|pricing|\blegal\b|procurement|paperwork|redline|verbal|\bcommit|decision ?makers? ?bought|closing|signature|order ?form|perception ?analysis/],
  ["pilot", /pilot|\btrial|\bpoc\b|proof ?of ?concept|evaluation|technical ?(validation|win)|testing/],
  ["qualified", /qualif|discovery|\bdemo|presentation|needs ?analysis|value ?prop|solution|scoping|\bsql\b|opportunit|in ?progress|decision ?makers?|meeting ?(held|done|completed)|engaged/],
  ["talking", /appointment|\blead\b|\bnew\b|prospect|contact ?(made|ed)|first ?(meeting|call)|\bintro|initial|\bmql\b|outreach|interest|meeting ?(booked|scheduled|set)|connected|\bopen\b/],
];

/** A stage name from another tool, read as one of Inroad's. Unmatched names default to Qualified and say so. */
export function guessStage(label: string): { stage: StageChoice; sure: boolean } {
  const text = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const [stage, re] of STAGE_RULES) if (re.test(text)) return { stage, sure: true };
  return { stage: "qualified", sure: false };
}

/** Lowercased, trimmed: how the stage map is keyed. */
export const stageKey = (label: string) => label.trim().toLowerCase();

/** The distinct stage names in the file (the status column fills in when there's no stage), most common first. */
export function stageValues(parsed: ParsedCsv, mapping: DealMapping): { label: string; count: number }[] {
  const col = mapping.stage ?? mapping.status;
  if (col === null) return [];
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of parsed.rows) {
    const label = row[col]?.trim();
    if (!label) continue;
    const k = stageKey(label);
    const hit = counts.get(k) ?? { label, count: 0 };
    hit.count++;
    counts.set(k, hit);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function defaultStageMap(values: { label: string }[]): Record<string, StageChoice> {
  return Object.fromEntries(values.map((v) => [stageKey(v.label), guessStage(v.label).stage]));
}

/* ─────────────────────────────── Cells ─────────────────────────────── */

const SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR" };

/**
 * "$45,000", "45.000,00 €", "USD 45000", "45k", "1.2M" → the number and the currency it names. Thousands and
 * decimal marks are read from their positions. Zero, negative and unreadable amounts come back empty: CRMs write
 * 0 for "not set".
 */
export function parseAmount(raw: string | undefined): { value?: number; currency?: string } {
  let s = (raw ?? "").trim();
  if (!s) return {};
  let currency: string | undefined;
  const code = s.match(/\b([A-Z]{3})\b/);
  if (code) {
    currency = code[1];
    s = s.replace(code[0], "");
  }
  const symbol = s.match(/[$€£¥₹]/);
  if (symbol) {
    currency ??= SYMBOLS[symbol[0]];
    s = s.replace(/[$€£¥₹]/g, "");
  }
  s = s.replace(/\s|'/g, "").toLowerCase();
  const scale = s.endsWith("mm") ? 1e6 : s.endsWith("m") ? 1e6 : s.endsWith("k") ? 1e3 : 1;
  s = s.replace(/(mm|m|k)$/, "");
  if (!/^-?[\d.,]+$/.test(s)) return { currency };
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  let normal: string;
  if (comma >= 0 && dot >= 0) normal = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) normal = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (dot >= 0) normal = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  else normal = s;
  const value = Number(normal) * scale;
  return Number.isFinite(value) && value > 0 ? { value: Math.round(value), currency } : { currency };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function iso(y: number, m: number, d: number): ISODate | undefined {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return undefined;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Day-first or month-first for a whole column: any first number over 12 settles it; US order otherwise. */
export function dateOrder(values: (string | undefined)[]): "mdy" | "dmy" {
  for (const v of values) {
    const m = v?.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
    if (m && Number(m[1]) > 12) return "dmy";
    if (m && Number(m[2]) > 12) return "mdy";
  }
  return "mdy";
}

/** "2026-11-30", "2026-11-30 14:00", "11/30/2026", "30.11.2026" (with `dmy`), "Nov 30, 2026", "30 Nov 2026" → a date. */
export function parseDate(raw: string | undefined, order: "mdy" | "dmy" = "mdy"): ISODate | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return order === "dmy" ? iso(Number(m[3]), Number(m[2]), Number(m[1])) : iso(Number(m[3]), Number(m[1]), Number(m[2]));
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*\.?[\s-]+(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return undefined;
}

/** "Jane Doe (jane@acme.com); Sam Lee <sam@acme.com>", "jane@acme.com, sam@acme.com" or "Jane Doe; Sam Lee" → people. */
export function parseContacts(raw: string | undefined): { name?: string; email?: string }[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const emails = s.match(/[^\s<>(),;]+@[^\s<>(),;]+/g) ?? [];
  const parts = s.includes(";") || s.includes("\n") ? s.split(/[;\n]/) : emails.length > 1 || !emails.length ? s.split(",") : [s];
  const out: { name?: string; email?: string }[] = [];
  for (const part of parts) {
    const email = normalizeEmail(part.match(/[^\s<>(),;]+@[^\s<>(),;]+/)?.[0]) ?? undefined;
    const name = part.replace(/[^\s<>(),;]+@[^\s<>(),;]+/g, "").replace(/[<>()[\]"]/g, "").replace(/\s+/g, " ").trim() || undefined;
    if (email || (name && name.length <= 80)) out.push({ ...(name ? { name } : {}), ...(email ? { email } : {}) });
  }
  return out.slice(0, 6);
}

/** A CRM's forecast category, when it's one Inroad has. */
export function parseForecast(raw: string | undefined): ForecastCategory | undefined {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim() || /closed|won|lost/.test(s)) return undefined;
  if (/commit/.test(s)) return "commit";
  if (/best|upside|probable/.test(s)) return "best_case";
  if (/omit|not ?forecast|exclude/.test(s)) return "omitted";
  if (/pipeline/.test(s)) return "pipeline";
  return undefined;
}

/** Where a deal came from, in Inroad's words, when the file's source column says something it can read. */
export function parseSource(raw: string | undefined): Deal["source"] | undefined {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return undefined;
  if (/investor|vc\b/.test(s)) return "investor_intro";
  if (/refer/.test(s)) return "referral";
  if (/partner|intro|warm/.test(s)) return "warm_intro";
  if (/dinner/.test(s)) return "dinner";
  if (/event|conference|webinar|trade ?show|meetup|roundtable|summit/.test(s)) return "event";
  if (/community|slack|discord|forum/.test(s)) return "community";
  if (/content|blog|seo|organic|podcast|newsletter|social/.test(s)) return "content";
  if (/network|founder|personal|friend/.test(s)) return "network";
  if (/outbound|cold|prospect|sdr|bdr|sequence|signal|email ?campaign/.test(s)) return "signal_cold";
  if (/inbound|website|\bweb\b|demo request|form|paid|\bads?\b|ppc|direct|search/.test(s)) return "inbound";
  return undefined;
}

/* ─────────────────────────────── The plan ─────────────────────────────── */

export type DealSkip = "no_company" | "no_stage" | "lost" | "left_out" | "won_earlier" | "won_undated" | "duplicate" | "existing" | "own_company" | "limit";

export const SKIP_LABELS: Record<DealSkip, string> = {
  no_company: "No company website or work email to match the company by",
  no_stage: "No stage",
  lost: "Closed lost",
  left_out: "A stage you chose to leave out",
  won_earlier: "Won outside this quarter",
  won_undated: "Won, with no close date",
  duplicate: "A second open deal at the same company (Inroad keeps one, the larger)",
  existing: "Already in Inroad",
  own_company: "Your own company",
  limit: "Past the 500-deal limit",
};

/** Open deals beyond this are left out, soonest close first kept: a file of thousands is a filter away from useful. */
export const DEAL_IMPORT_LIMIT = 500;

export interface PlannedDeal {
  /** Row number in the file, counting the header as row 1. */
  line: number;
  name: string;
  company: string;
  domain: string;
  /** An open stage, or won (inside the period). */
  stage: Stage;
  amountUsd?: number;
  /** The amount was in this currency, so it was left off: Inroad forecasts in USD and never converts. */
  otherCurrency?: string;
  closeDate?: ISODate;
  created?: ISODate;
  stageEntered?: ISODate;
  lastActivity?: ISODate;
  nextStep?: { what?: string; date?: ISODate };
  forecast?: ForecastCategory;
  source?: Deal["source"];
  contacts: { name?: string; email?: string }[];
}

export interface DealImportPlan {
  deals: PlannedDeal[];
  skipped: { line: number; name: string; reason: DealSkip }[];
  open: { count: number; usd: number; unpriced: number };
  won: { count: number; usd: number };
  /** Deals whose amounts were in another currency and were left off. */
  otherCurrency: number;
  /** What the file has no column for. The X-ray says what it can't check instead of guessing. */
  absent: { created: boolean; stageDate: boolean; activity: boolean; contacts: boolean; nextStep: boolean; closeDate: boolean; amount: boolean; source: boolean };
}

/**
 * Reads the rows into deals to import. Open deals come in; won deals only when they closed inside `period` (they
 * are this period's closed won); lost and parked ones stay in the CRM. One open deal per company, the larger.
 */
export function planDealImport(
  ws: Pick<Workspace, "accounts" | "deals" | "company" | "suppression">,
  parsed: ParsedCsv,
  mapping: DealMapping,
  stageMap: Record<string, StageChoice>,
  period: { start: ISODate; end: ISODate },
): DealImportPlan {
  const col = (row: string[], k: DealFieldKey) => (mapping[k] === null ? undefined : row[mapping[k]!]?.trim() || undefined);
  const orders = Object.fromEntries(
    (["closeDate", "created", "lastActivity", "stageEntered", "nextStepDate"] as const).map((k) => [k, dateOrder(mapping[k] === null ? [] : parsed.rows.map((r) => r[mapping[k]!]))]),
  ) as Record<"closeDate" | "created" | "lastActivity" | "stageEntered" | "nextStepDate", "mdy" | "dmy">;
  const date = (row: string[], k: keyof typeof orders) => parseDate(col(row, k), orders[k]);
  const own = ws.company?.domain;

  const skipped: DealImportPlan["skipped"] = [];
  const candidates: PlannedDeal[] = [];
  parsed.rows.forEach((row, i) => {
    const line = i + 2;
    const contacts = [...parseContacts(col(row, "contacts")), ...parseContacts(col(row, "contactEmail"))].filter((c, j, all) => !c.email || all.findIndex((x) => x.email === c.email) === j).slice(0, 6);
    const companyCell = col(row, "company");
    const domain =
      normalizeDomain(col(row, "domain")?.split(/[;,\s]/)[0]) ??
      normalizeDomain(companyCell?.match(/\(([^)]+\.[a-z]{2,})\)/i)?.[1]) ??
      contacts.map((c) => companyDomainOf(c.email)).find(Boolean) ??
      null;
    const company = companyCell?.replace(/\s*\([^)]*\)\s*$/, "").trim() || undefined;
    const name = col(row, "name") ?? company ?? domain ?? `Row ${line}`;
    if (!domain) return void skipped.push({ line, name, reason: "no_company" });
    if (own && domain === own) return void skipped.push({ line, name, reason: "own_company" });

    // A status column (Pipedrive's open/won/lost) settles closed outcomes; the stage says where open ones are.
    const status = col(row, "status")?.toLowerCase();
    const label = col(row, "stage") ?? col(row, "status");
    const mapped = /\bwon\b/.test(status ?? "") ? "won" : /\blost\b/.test(status ?? "") ? "lost" : label ? (stageMap[stageKey(label)] ?? guessStage(label).stage) : undefined;
    if (!mapped) return void skipped.push({ line, name, reason: "no_stage" });
    if (mapped === "lost" || mapped === "nurture") return void skipped.push({ line, name, reason: "lost" });
    if (mapped === "skip") return void skipped.push({ line, name, reason: "left_out" });

    const closeDate = date(row, "closeDate");
    if (mapped === "won") {
      if (!closeDate) return void skipped.push({ line, name, reason: "won_undated" });
      if (closeDate < period.start || closeDate > period.end) return void skipped.push({ line, name, reason: "won_earlier" });
    }
    const amount = parseAmount(col(row, "amount"));
    const currency = (col(row, "currency")?.toUpperCase().match(/[A-Z]{3}/)?.[0] ?? amount.currency) || undefined;
    const usd = !currency || currency === "USD";
    const nextWhat = col(row, "nextStep");
    const nextDate = date(row, "nextStepDate");
    candidates.push({
      line,
      name: name.slice(0, 120),
      company: (company ?? name).slice(0, 120),
      domain,
      stage: mapped,
      ...(amount.value && usd ? { amountUsd: amount.value } : {}),
      ...(amount.value && !usd ? { otherCurrency: currency } : {}),
      ...(closeDate ? { closeDate } : {}),
      ...(date(row, "created") ? { created: date(row, "created") } : {}),
      ...(date(row, "stageEntered") ? { stageEntered: date(row, "stageEntered") } : {}),
      ...(date(row, "lastActivity") ? { lastActivity: date(row, "lastActivity") } : {}),
      ...(nextWhat || nextDate ? { nextStep: { ...(nextWhat ? { what: nextWhat.slice(0, 200) } : {}), ...(nextDate ? { date: nextDate } : {}) } } : {}),
      ...(parseForecast(col(row, "forecast")) && mapped !== "won" ? { forecast: parseForecast(col(row, "forecast")) } : {}),
      ...(parseSource(col(row, "source")) ? { source: parseSource(col(row, "source")) } : {}),
      contacts,
    });
  });

  // One open deal per company: the larger stays (ties: the sooner close). A company already open here is left as is.
  const openHere = new Set(Object.values(ws.deals).filter((d) => openStage(d.stage)).map((d) => d.accountDomain));
  const namesHere = new Set(Object.values(ws.deals).map((d) => `${d.accountDomain}|${d.name.toLowerCase()}`));
  const byDomain = new Map<string, PlannedDeal>();
  const deals: PlannedDeal[] = [];
  const ranked = [...candidates].sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0) || (a.closeDate ?? "9999").localeCompare(b.closeDate ?? "9999") || a.line - b.line);
  for (const d of ranked) {
    if (openHere.has(d.domain) || namesHere.has(`${d.domain}|${d.name.toLowerCase()}`)) {
      skipped.push({ line: d.line, name: d.name, reason: "existing" });
      continue;
    }
    if (d.stage !== "won") {
      if (byDomain.has(d.domain)) {
        skipped.push({ line: d.line, name: d.name, reason: "duplicate" });
        continue;
      }
      byDomain.set(d.domain, d);
    }
    deals.push(d);
  }
  const open = deals.filter((d) => d.stage !== "won").sort((a, b) => (a.closeDate ?? "9999").localeCompare(b.closeDate ?? "9999"));
  for (const d of open.slice(DEAL_IMPORT_LIMIT)) skipped.push({ line: d.line, name: d.name, reason: "limit" });
  const kept = new Set(open.slice(0, DEAL_IMPORT_LIMIT));
  const final = deals.filter((d) => d.stage === "won" || kept.has(d)).sort((a, b) => a.line - b.line);
  const openKept = final.filter((d) => d.stage !== "won");
  const wonKept = final.filter((d) => d.stage === "won");
  const has = (k: DealFieldKey) => mapping[k] !== null;
  return {
    deals: final,
    skipped: skipped.sort((a, b) => a.line - b.line),
    open: { count: openKept.length, usd: openKept.reduce((n, d) => n + (d.amountUsd ?? 0), 0), unpriced: openKept.filter((d) => !d.amountUsd).length },
    won: { count: wonKept.length, usd: wonKept.reduce((n, d) => n + (d.amountUsd ?? 0), 0) },
    otherCurrency: final.filter((d) => d.otherCurrency).length,
    absent: {
      created: !has("created"),
      stageDate: !has("stageEntered"),
      activity: !has("lastActivity"),
      contacts: !has("contacts") && !has("contactEmail"),
      nextStep: !has("nextStep") && !has("nextStepDate"),
      closeDate: !has("closeDate"),
      amount: !has("amount"),
      source: !has("source"),
    },
  };
}

/* ─────────────────────────────── Into the workspace ─────────────────────────────── */

/** Noon local time on a date: what a file's date becomes as a timestamp, safe from time-zone edges. */
function noon(date: ISODate): ISODateTime {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

const later = (a: ISODate, b: ISODate | undefined) => (b && b > a ? b : a);

function nameFromEmail(email: string): string {
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The actions that import a plan: an account per new company, a person per new contact (never anyone who asked to
 * be deleted or is suppressed), and a deal with the dates the file had. Dates it didn't have are named in
 * `deal.imported.unknown`, and their stand-in is the import time. Next steps without a date stay a note, since a
 * dated next step is a commitment on someone's calendar. Applied through the ordinary action route.
 */
export function dealImportActions(ws: Pick<Workspace, "accounts" | "people" | "suppression">, plan: DealImportPlan, o: { at: ISODateTime; from: string }): Action[] {
  const actions: Action[] = [];
  const accounts = new Set(Object.keys(ws.accounts));
  const people = Object.values(ws.people);
  const made = new Map<string, string>();
  // Wins first: a company with a win this quarter and an open deal ends up pointing at the open one.
  const order = [...plan.deals].sort((a, b) => Number(a.stage !== "won") - Number(b.stage !== "won") || a.line - b.line);
  for (const p of order) {
    if (!accounts.has(p.domain)) {
      const account: Account = {
        domain: p.domain,
        name: p.company,
        status: "in_pipeline",
        source: "csv_import",
        sourceDetail: o.from,
        addedAt: o.at,
        // Unscored until a dossier scores it against the ICP; B keeps it visible without claiming fit.
        fitScore: 50,
        tier: "B",
        criteria: [],
        signals: [],
        whyNow: null,
        whyNowScore: 0,
        peopleIds: [],
        warmPathCount: 0,
        watch: true,
      };
      actions.push({ type: "account.add", account });
      accounts.add(p.domain);
    }

    const contacts: Deal["contacts"] = [];
    for (const c of p.contacts) {
      if (c.email && (isSuppressed(ws as Workspace, c.email, undefined) || askedToBeDeleted(ws as Workspace, c.email))) continue;
      const key = c.email ?? `${p.domain}|${c.name?.toLowerCase()}`;
      const existing =
        made.get(key) ??
        people.find((x) => (c.email && x.email?.toLowerCase() === c.email) || (!c.email && !!c.name && x.accountDomain === p.domain && x.name.toLowerCase() === c.name.toLowerCase()))?.id;
      if (existing) {
        if (!contacts.some((x) => x.personId === existing)) contacts.push({ personId: existing });
        continue;
      }
      const person: Person = {
        id: newId("per"),
        accountDomain: p.domain,
        name: c.name ?? nameFromEmail(c.email!),
        title: "",
        ...(c.email ? { email: c.email } : {}),
        evidenceIds: [],
        confidence: "medium",
        mayHaveLeft: false,
        contactPaths: c.email ? [{ kind: "integration", value: c.email, via: o.from, verified: false, founderConfirmed: false }] : [],
        jurisdiction: "unknown",
        doNotContact: false,
        source: "csv_import",
      };
      actions.push({ type: "person.upsert", person });
      made.set(key, person.id);
      contacts.push({ personId: person.id });
    }

    const unknown: NonNullable<Deal["imported"]>["unknown"] = [];
    if (!p.created) unknown.push("created");
    if (p.stage !== "talking" && p.stage !== "won" && !p.stageEntered) unknown.push("stage_date");
    if (!p.lastActivity) unknown.push("activity");
    if (plan.absent.contacts) unknown.push("contacts");
    if (!p.source) unknown.push("source");

    // Only dates the file had become history. Without a created date there's no start entry to write.
    const created = p.created ? noon(p.created) : undefined;
    const history: Deal["stageHistory"] = [];
    if (created) history.push({ stage: "talking", at: created });
    if (p.stage === "won") history.push({ stage: "won", at: noon(later(p.closeDate!, p.created)) });
    else if (p.stage !== "talking") history.push({ stage: p.stage, at: p.stageEntered ? noon(later(p.stageEntered, p.created)) : o.at });
    if (!history.length) history.push({ stage: "talking", at: o.at });

    const dated = p.nextStep?.date;
    const note = p.nextStep?.what && !dated ? `Next step from ${o.from}, with no date: ${p.nextStep.what}` : undefined;
    const deal: Deal = {
      id: newId("deal"),
      accountDomain: p.domain,
      name: p.name,
      stage: p.stage,
      stageHistory: history,
      source: p.source ?? "inbound",
      ...(p.amountUsd ? { amountUsd: p.amountUsd } : {}),
      ...(p.closeDate ? { closeDate: p.closeDate } : {}),
      ...(dated ? { nextStep: { what: p.nextStep?.what ?? "Next activity on your CRM", date: dated, buyerAgreed: false } } : {}),
      ...(note ? { notes: note } : {}),
      ...(p.forecast ? { forecastCall: { category: p.forecast, at: o.at, note: `From ${o.from}` } } : {}),
      contacts,
      meetingIds: [],
      createdAt: created ?? o.at,
      updatedAt: o.at,
      lastActivityAt: p.lastActivity ? noon(p.lastActivity) : o.at,
      imported: { at: o.at, from: o.from, stage: p.stage, ...(unknown.length ? { unknown } : {}) },
    };
    actions.push({ type: "deal.create", deal });
    if (p.stage === "won") actions.push({ type: "account.update", domain: p.domain, patch: { status: "customer" } });
  }
  return actions;
}
