import "server-only";
import { addDays, todayISO } from "@/lib/domain/ids";
import { readSettings } from "@/lib/store/settings";
import { TTL, cached } from "./cache";
import { politeGate } from "./gate";
import { API_UA, fetchJSON, fetchText } from "./http";

/**
 * SEC EDGAR Form D: the notice a US company files within 15 days of selling shares in a private round.
 * Free and keyless. It names the issuer, its state, the amount offered and sold, the date of the first
 * sale, and its executives and directors ("related persons"). It has no website, so callers resolve
 * the company's domain themselves.
 *
 * Endpoints (SEC fair-access rules: a declared User-Agent, at most 10 requests a second):
 *   full-text search  https://efts.sec.gov/LATEST/search-index?q=…&forms=D&dateRange=custom&startdt=…&enddt=…
 *   the filing        https://www.sec.gov/Archives/edgar/data/{cik}/{accession without dashes}/primary_doc.xml
 * Response shapes follow EDGAR's documented formats; they were not checked against the live service
 * from this sandbox.
 */

export interface FormDFiling {
  company: string;
  /** No leading zeros, as EDGAR's archive paths use it. */
  cik: string;
  /** 0001234567-26-000123 */
  accession: string;
  filedAt: string;
  /** The filing index page on sec.gov: what a person opens to check it. */
  url: string;
  /** Business-address states, e.g. ["CA"]. */
  states: string[];
  location?: string;
  isAmendment: boolean;
  // From the filing itself; absent when it couldn't be read.
  industry?: string;
  /** Undefined when the offering is "Indefinite". */
  totalOfferingUsd?: number;
  amountSoldUsd?: number;
  firstSaleOn?: string;
  yearOfInc?: number;
  relatedPersons: { name: string; relationship: string }[];
}

interface EftsHit {
  _id?: string;
  _source?: {
    ciks?: string[];
    display_names?: string[];
    file_date?: string;
    form?: string;
    root_forms?: string[];
    adsh?: string;
    biz_states?: string[];
    biz_locations?: string[];
  };
}
interface EftsResp {
  hits?: { hits?: EftsHit[] };
}

/** The SEC asks automated tools to name a contact (Settings → General → Public data). */
function secHeaders(): Record<string, string> {
  const contact = readSettings().secContact?.trim();
  return { "User-Agent": contact ? `Inroad local research ${contact}` : API_UA };
}

/** "Acme Payments, Inc.  (CIK 0001234567)" → "Acme Payments, Inc." */
export function issuerName(display: string): string {
  return display
    .replace(/\s*\((?:CIK\s*)?\d{6,10}\)\s*$/i, "")
    .replace(/\s*\([A-Z.\-, ]{1,12}\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function archiveBase(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
}

export function filingIndexUrl(cik: string, accession: string): string {
  return `${archiveBase(cik, accession)}/${accession}-index.htm`;
}

function parseHits(data: EftsResp | null): FormDFiling[] {
  const out: FormDFiling[] = [];
  for (const h of data?.hits?.hits ?? []) {
    const s = h._source;
    const accession = s?.adsh ?? h._id?.split(":")[0];
    const cikRaw = s?.ciks?.[0];
    const name = s?.display_names?.[0];
    if (!s || !accession || !cikRaw || !name || !s.file_date) continue;
    const form = s.form ?? s.root_forms?.[0] ?? "D";
    if (!/^D(\/A)?$/.test(form)) continue;
    const cik = String(Number(cikRaw));
    out.push({
      company: issuerName(name),
      cik,
      accession,
      filedAt: s.file_date.slice(0, 10),
      url: filingIndexUrl(cik, accession),
      states: (s.biz_states ?? []).filter(Boolean).slice(0, 4),
      location: s.biz_locations?.[0] || undefined,
      isAmendment: form === "D/A",
      relatedPersons: [],
    });
  }
  return out;
}

/**
 * Recent Form D notices matching a full-text query (a company name, or an industry group such as
 * "Other Technology"), newest first, one per company: the original notice when it's there, else the amendment.
 */
export async function formDSearch(opts: { query: string; sinceDays: number; states?: string[]; limit?: number; today?: string }): Promise<FormDFiling[]> {
  const end = opts.today ?? todayISO();
  const start = addDays(end, -Math.max(1, opts.sinceDays));
  const q = opts.query.trim();
  if (!q) return [];
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=D&dateRange=custom&startdt=${start}&enddt=${end}`;
  let hits: FormDFiling[];
  try {
    hits = await cached(`formd:search:v1:${q}:${start}:${end}`, 12 * TTL.hour, async () => {
      await politeGate("sec");
      const data = await fetchJSON<EftsResp>(url, 12_000, { headers: secHeaders() });
      if (!data) throw new Error("EDGAR search unreachable");
      return parseHits(data);
    });
  } catch {
    return [];
  }
  const states = new Set((opts.states ?? []).map((s) => s.toUpperCase()));
  // The original notice dates the round; an amendment only updates it. Newest original per company.
  const byCik = new Map<string, FormDFiling>();
  for (const f of [...hits].sort((a, b) => Number(a.isAmendment) - Number(b.isAmendment) || b.filedAt.localeCompare(a.filedAt))) {
    if (states.size && !f.states.some((s) => states.has(s))) continue;
    if (!byCik.has(f.cik)) byCik.set(f.cik, f);
  }
  return [...byCik.values()].sort((a, b) => b.filedAt.localeCompare(a.filedAt)).slice(0, opts.limit ?? 20);
}

function tag(xml: string, name: string): string | undefined {
  const v = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1];
  return v === undefined ? undefined : decodeXml(v).trim() || undefined;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

function usd(v: string | undefined): number | undefined {
  if (!v || !/^\d+(\.\d+)?$/.test(v.trim())) return undefined;
  return Number(v);
}

/** The parts of a Form D primary_doc.xml that matter for selling: industry, amounts, dates, people. */
export function parseFormD(xml: string): Pick<FormDFiling, "industry" | "totalOfferingUsd" | "amountSoldUsd" | "firstSaleOn" | "yearOfInc" | "relatedPersons"> & { entityName?: string; isAmendment?: boolean } {
  const persons: FormDFiling["relatedPersons"] = [];
  for (const m of xml.matchAll(/<relatedPersonInfo>([\s\S]*?)<\/relatedPersonInfo>/gi)) {
    const block = m[1];
    const name = [tag(block, "firstName"), tag(block, "middleName"), tag(block, "lastName")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const roles = [...block.matchAll(/<relationship>([\s\S]*?)<\/relationship>/gi)].map((r) => decodeXml(r[1]).trim()).filter(Boolean);
    if (name) persons.push({ name: name.slice(0, 80), relationship: roles.join(", ").slice(0, 80) || "Related person" });
  }
  const year = tag(xml.match(/<yearOfInc>[\s\S]*?<\/yearOfInc>/i)?.[0] ?? "", "value");
  const firstSale = tag(xml.match(/<dateOfFirstSale>[\s\S]*?<\/dateOfFirstSale>/i)?.[0] ?? "", "value");
  return {
    entityName: tag(xml, "entityName"),
    industry: tag(xml, "industryGroupType"),
    totalOfferingUsd: usd(tag(xml, "totalOfferingAmount")),
    amountSoldUsd: usd(tag(xml, "totalAmountSold")),
    firstSaleOn: firstSale && /^\d{4}-\d{2}-\d{2}$/.test(firstSale) ? firstSale : undefined,
    yearOfInc: year && /^\d{4}$/.test(year) ? Number(year) : undefined,
    isAmendment: tag(xml, "isAmendment") === "true",
    relatedPersons: persons.slice(0, 12),
  };
}

/** Fills in a filing's amounts, industry and related persons. Filings never change, so this caches for a month. */
export async function formDDetail(f: FormDFiling): Promise<FormDFiling> {
  try {
    const detail = await cached(`formd:doc:v1:${f.accession}`, 4 * TTL.week, async () => {
      await politeGate("sec");
      const res = await fetchText(`${archiveBase(f.cik, f.accession)}/primary_doc.xml`, { timeoutMs: 10_000, maxBytes: 600_000, accept: "application/xml,text/xml", headers: secHeaders() });
      if (!res || !/<edgarSubmission/i.test(res.body)) throw new Error("Form D unreadable");
      return parseFormD(res.body);
    });
    const { entityName, isAmendment, ...rest } = detail;
    return { ...f, ...rest, company: f.company || entityName || f.company, isAmendment: f.isAmendment || Boolean(isAmendment) };
  } catch {
    return f;
  }
}

/* ─────────────────────────── Which filings to look at (code) ─────────────────────────── */

/**
 * Form D industry groups (the form's fixed list) a founder's ICP text points at, most specific first.
 * Pooled investment funds file most Form Ds and are never a buyer, so they're excluded everywhere.
 */
const INDUSTRY_GROUPS: [RegExp, string[]][] = [
  [/\b(banks?|banking|credit unions?|lenders?|lending|loans?|mortgages?)\b/i, ["Commercial Banking", "Other Banking & Financial Services"]],
  [/\b(insurance|insurers?|insurtech|carriers?|brokers?)\b/i, ["Insurance"]],
  [/\b(fintech|payments?|wealth|brokerage|accounting|financial services)\b/i, ["Other Banking & Financial Services"]],
  [/\b(clinics?|hospitals?|physicians?|dental|dentists?|practices|medical groups?|providers)\b/i, ["Hospitals & Physicians"]],
  [/\b(biotech\w*|life sciences|labs?)\b/i, ["Biotechnology"]],
  [/\b(pharma\w*|drug)\b/i, ["Pharmaceuticals"]],
  [/\b(health\s?care|healthtech|health tech|digital health|medtech)\b/i, ["Other Health Care"]],
  [/\b(real estate|proptech|property|properties|landlords?)\b/i, ["Other Real Estate"]],
  [/\b(construction|contractors?|builders?)\b/i, ["Construction"]],
  [/\b(manufactur\w*|factories|industrial)\b/i, ["Manufacturing"]],
  [/\b(retail\w*|e-?commerce|dtc|consumer brands?)\b/i, ["Retailing"]],
  [/\b(restaurants?|food service)\b/i, ["Restaurants"]],
  [/\b(energy|solar|climate|utilit\w*|batter\w*)\b/i, ["Other Energy"]],
  [/\b(hotels?|hospitality|travel)\b/i, ["Lodging & Conventions", "Tourism & Travel Services"]],
  [/\b(telecom\w*|wireless|carriers?)\b/i, ["Telecommunications"]],
  [/\b(agencies|agency|consultanc\w*|staffing|logistics|business services)\b/i, ["Business Services"]],
];

export function formDIndustries(text: string, max = 2): string[] {
  const out: string[] = [];
  for (const [re, groups] of INDUSTRY_GROUPS) if (re.test(text)) for (const g of groups) if (!out.includes(g)) out.push(g);
  // Software companies, whatever they sell, file as technology.
  if (out.length < max && (!out.length || /\b(software|saas|platform|api|developer|devtools|ai|cloud|infrastructure|security|data|startups?|app)\b/i.test(text))) out.push("Other Technology");
  return out.slice(0, max);
}

export const NOT_A_BUYER_INDUSTRY = /^(Pooled Investment Fund|Investing|Investment Banking|REITS? (&|and) Finance)$/i;

/** "$20M", "$1.5M", "$750K", or null when the amount wasn't disclosed. */
export function shortUsd(n: number | undefined): string | null {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 ? 1 : 0)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 && n < 10_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CITIES: [RegExp, string][] = [
  [/\b(nyc|brooklyn|manhattan)\b/i, "NY"],
  [/\b(sf|san francisco|bay area|silicon valley|los angeles|san diego|palo alto)\b/i, "CA"],
  [/\bboston\b/i, "MA"],
  [/\b(austin|dallas|houston)\b/i, "TX"],
  [/\bseattle\b/i, "WA"],
  [/\bchicago\b/i, "IL"],
  [/\b(denver|boulder)\b/i, "CO"],
  [/\bmiami\b/i, "FL"],
  [/\batlanta\b/i, "GA"],
];

/** US states named in a brief ("only NYC", "Texas banks"), as Form D business-state codes. */
export function statesIn(text: string): string[] {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const [name, code] of Object.entries(US_STATES)) if (new RegExp(`\\b${name}\\b`).test(t)) out.add(code);
  for (const [re, code] of CITIES) if (re.test(text)) out.add(code);
  return [...out];
}
