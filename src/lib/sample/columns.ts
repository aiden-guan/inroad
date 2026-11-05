import type { CellSource, ColumnCell, ColumnsData, ResearchColumn } from "@/lib/columns/types";
import { makeClock, type Clock } from "./clock";
import { DOMAIN } from "./ids";

/**
 * Two research columns on Ledgerline's prospects, so the Companies table shows the feature on first load:
 * "Do they bill on usage?", asked of every prospect (one Unknown, because nothing checkable says), and "Are
 * they hiring in finance?", where most answers came free from job boards read in code and two companies
 * aren't asked yet. One saved view combines them. Quotes match each company's site and evidence in ./accounts.
 */

export const SAMPLE_COLUMN = { usage: "col_usage_billing", finance: "col_finance_hiring" } as const;

function columns(c: Clock): ResearchColumn[] {
  return [
    {
      id: SAMPLE_COLUMN.usage,
      question: "Do they bill on usage?",
      type: "yes_no",
      instructions: "Yes only if their own pages charge by a metered unit (events, GB, requests, minutes, devices). Seats or flat tiers are no.",
      createdAt: c.at(-1, "11:02"),
    },
    { id: SAMPLE_COLUMN.finance, question: "Are they hiring in finance?", type: "yes_no", createdAt: c.at(-1, "11:20") },
  ];
}

type Seed = { domain: string; value: boolean | null; confidence?: "high" | "medium" | "low"; sources: CellSource[]; note: string; costUsd: number; method?: ColumnCell["method"]; pages?: number; searches?: number };

const site = (domain: string, quote: string, date: string, path = ""): CellSource => ({ url: `https://${domain}${path}`, quote, date, kind: "site", checked: true });

function usageCells(c: Clock): Seed[] {
  const read = c.d(-1);
  return [
    {
      domain: DOMAIN.fernwick,
      value: true,
      confidence: "high",
      sources: [site(DOMAIN.fernwick, "Priced per 1,000 traces.", read), { url: "https://fernwick.example/blog/new-pricing", quote: "New pricing: per 1,000 traces", date: c.d(-50), kind: "page", checked: true }],
      note: "Their home page and pricing post both charge per 1,000 traces.",
      costUsd: 0.0016,
      pages: 4,
    },
    {
      domain: DOMAIN.driftglass,
      value: true,
      confidence: "high",
      sources: [site(DOMAIN.driftglass, "Pay per query and per GB stored.", read), { url: "https://driftglass.example/blog/usage-pricing", quote: "Usage pricing for every plan", date: c.d(-18), kind: "page", checked: true }],
      note: "Two meters: queries and GB stored, on every plan since the pricing change.",
      costUsd: 0.0018,
      pages: 4,
    },
    { domain: DOMAIN.bramblecast, value: true, confidence: "high", sources: [site(DOMAIN.bramblecast, "Pay per minute delivered.", read)], note: "Charged per minute of video delivered.", costUsd: 0.0012, pages: 3 },
    { domain: DOMAIN.ashgrove, value: true, confidence: "high", sources: [site(DOMAIN.ashgrove, "Global IoT connectivity, billed per active device.", read)], note: "Billed per active device each month.", costUsd: 0.0013, pages: 4 },
    { domain: DOMAIN.glassmoor, value: true, confidence: "high", sources: [site(DOMAIN.glassmoor, "Priced per 1,000 queries.", read)], note: "Charged per 1,000 search queries.", costUsd: 0.0011, pages: 3 },
    { domain: DOMAIN.hollowpine, value: true, confidence: "high", sources: [site(DOMAIN.hollowpine, "Pay per 1,000 sends.", read)], note: "Charged per 1,000 emails sent.", costUsd: 0.0011, pages: 2 },
    // The two prospects the sample's custom play fires on (./plays.ts); their descriptions carry these lines.
    { domain: "tallyhook.example", value: true, confidence: "high", sources: [site("tallyhook.example", "Priced per transaction.", read)], note: "Charged per payment transaction processed.", costUsd: 0.0012, pages: 3 },
    { domain: "mossbank.example", value: true, confidence: "high", sources: [site("mossbank.example", "Pay per GB processed.", read)], note: "Charged per GB of data its pipelines process.", costUsd: 0.0012, pages: 3 },
    {
      domain: DOMAIN.cinderpath,
      value: true,
      confidence: "medium",
      sources: [site(DOMAIN.cinderpath, "Priced per monthly active user.", read)],
      note: "Billed per monthly active user: a usage meter, though it may be sold in tiers.",
      costUsd: 0.0015,
      pages: 3,
    },
    { domain: DOMAIN.quayside, value: true, confidence: "high", sources: [site(DOMAIN.quayside, "Pay per 1,000 requests.", read)], note: "Charged per 1,000 API requests.", costUsd: 0.0012, pages: 3 },
    { domain: DOMAIN.quillfeather, value: true, confidence: "high", sources: [site(DOMAIN.quillfeather, "Pay only for the data you scan.", read, "/pricing")], note: "Charged by the GB of logs scanned.", costUsd: 0.0017, pages: 4 },
    {
      domain: DOMAIN.larkspur,
      value: null,
      sources: [],
      note: "Their pricing page only says “Talk to sales”, and nothing else I read says how they bill.",
      costUsd: 0.0024,
      pages: 3,
      searches: 1,
    },
    { domain: DOMAIN.ironvale, value: false, confidence: "high", sources: [site(DOMAIN.ironvale, "Per employee, per month. Billed annually.", read, "/pricing")], note: "Priced per employee seat.", costUsd: 0.0012, pages: 3 },
    { domain: DOMAIN.northwind, value: true, confidence: "high", sources: [site(DOMAIN.northwind, "Pay for what you ingest.", read)], note: "Charged per GB ingested.", costUsd: 0.0014, pages: 4 },
    { domain: DOMAIN.lumenwire, value: true, confidence: "high", sources: [site(DOMAIN.lumenwire, "Pay as you go.", read)], note: "Pay-as-you-go messaging and voice.", costUsd: 0.0013, pages: 3 },
  ];
}

function financeCells(c: Clock): Seed[] {
  const checked = c.d(-1);
  const board = (url: string, quote: string): CellSource => ({ url, quote, date: checked, kind: "job_board", checked: true });
  return [
    { domain: DOMAIN.fernwick, value: true, confidence: "high", sources: [board("https://jobs.ashbyhq.com/fernwick", "Finance roles (1): Billing Analyst")], note: "1 finance role on their Ashby job board.", costUsd: 0, method: "workspace" },
    { domain: DOMAIN.ashgrove, value: true, confidence: "high", sources: [board("https://apply.workable.com/ashgrove", "Finance roles (1): Revenue Accounting Manager")], note: "1 finance role on their Workable job board.", costUsd: 0, method: "workspace" },
    { domain: DOMAIN.driftglass, value: false, confidence: "medium", sources: [board("https://boards.greenhouse.io/driftglass", "Open roles (9): Engineering 6, Sales 3")], note: "None of their 9 open roles are in finance.", costUsd: 0, method: "workspace" },
    { domain: DOMAIN.glassmoor, value: false, confidence: "medium", sources: [board("https://jobs.lever.co/glassmoor", "Open roles (3): Engineering 3")], note: "None of their 3 open roles are in finance.", costUsd: 0, method: "workspace" },
    {
      domain: DOMAIN.cinderpath,
      value: true,
      confidence: "high",
      sources: [{ url: "https://cinderpath.example/careers/senior-accountant", quote: "Senior Accountant: own the monthly close for revenue and AR", date: c.d(-20), kind: "evidence", checked: true }],
      note: "A Senior Accountant posting from 20 days ago, on their careers page.",
      costUsd: 0.0009,
      pages: 3,
    },
    { domain: DOMAIN.bramblecast, value: null, sources: [], note: "No public job board found, and nothing else I read lists their open roles.", costUsd: 0.0011, pages: 3 },
    { domain: DOMAIN.hollowpine, value: null, sources: [], note: "No public job board found, and their careers page couldn't be read.", costUsd: 0.001, pages: 2 },
    { domain: DOMAIN.quayside, value: null, sources: [], note: "No public job board found. Their site lists no finance roles, but that doesn't mean there are none.", costUsd: 0.0012, pages: 3 },
  ];
}

export function sampleColumns(now = new Date()): ColumnsData {
  const c = makeClock(now);
  const cols = columns(c);
  const cell = (columnId: string, at: string, runId: string) => (s: Seed): [string, ColumnCell] => [
    s.domain,
    {
      columnId,
      domain: s.domain,
      value: s.value,
      confidence: s.value === null ? null : (s.confidence ?? "medium"),
      sources: s.sources,
      note: s.note,
      at,
      method: s.method ?? "model",
      runId,
      costUsd: s.costUsd,
      searches: s.searches ?? 0,
      pagesRead: s.pages ?? 0,
    },
  ];
  return {
    columns: cols,
    hidden: [],
    cells: {
      [SAMPLE_COLUMN.usage]: Object.fromEntries(usageCells(c).map(cell(SAMPLE_COLUMN.usage, c.at(-1, "11:06"), "run_sample_column_usage"))),
      [SAMPLE_COLUMN.finance]: Object.fromEntries(financeCells(c).map(cell(SAMPLE_COLUMN.finance, c.at(-1, "11:22"), "run_sample_column_finance"))),
    },
    views: [
      {
        id: "view_usage_finance",
        name: "Usage billing, hiring finance",
        filters: { tiers: [], signals: [], statuses: [], sources: [], answers: { [SAMPLE_COLUMN.usage]: ["yes"], [SAMPLE_COLUMN.finance]: ["yes"] } },
        sort: { key: "priority", dir: "desc" },
        columns: [SAMPLE_COLUMN.usage, SAMPLE_COLUMN.finance],
        createdAt: c.at(-1, "11:30"),
      },
    ],
  };
}
