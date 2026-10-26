import { addDays } from "@/lib/domain/ids";
import { TODAY } from "./factories";

/**
 * A small YC directory (the yc-oss mirror's shape) and the job boards of some of its companies, for
 * discovery runs with no network: 24 usage-billing and API companies that fit a finance-tooling ICP,
 * plus filler from other industries. The first six post a dated finance hire on Ashby.
 */

const FIT = [
  "Tallyrock", "Meterly", "Brightledger", "Quantaloop", "Northpeak", "Sablewire", "Coppergate", "Fernstack", "Lumenly", "Ratecard",
  "Usagewise", "Billwright", "Metricmint", "Invoiceforge", "Pricepoint", "Countwell", "Ledgerloop", "Tollbooth", "Gaugeworks", "Accruely",
  "Ratewell", "Meterbase", "Seatcount", "Tiermark",
];
const OTHER = ["Petpal", "Snackbox", "Clinicly", "Tutorly", "Roomly", "Gymbuddy", "Plantwise", "Dateable", "Cookery", "Travelnest"];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export const YC_ALL_URL = "https://yc-oss.github.io/api/companies/all.json";

export function ycDirectory(): Record<string, unknown>[] {
  const fit = FIT.map((name, i) => ({
    slug: slug(name),
    name,
    website: `https://${slug(name)}.com`,
    one_liner: `Usage-based billing API for ${i % 2 ? "infrastructure" : "SaaS"} companies`,
    long_description: `${name} meters usage and turns it into invoices for B2B software companies that price on usage. Finance teams use it to close the month.`,
    team_size: 30 + i * 7,
    industry: "B2B",
    subindustry: "B2B -> Finance and Accounting",
    tags: ["Fintech", "SaaS", "API", "Infrastructure", "Billing"],
    batch: i % 3 ? "Winter 2024" : "Summer 2023",
    status: "Active",
    stage: "Early",
    isHiring: i < 12,
    regions: ["United States of America"],
    all_locations: "San Francisco, CA, USA",
    launched_at: 1_700_000_000 + i * 86_400,
  }));
  const other = Array.from({ length: 100 }, (_, i) => {
    const name = `${OTHER[i % OTHER.length]} ${Math.floor(i / OTHER.length) + 1}`;
    return {
      slug: slug(name),
      name,
      website: `https://${slug(name)}.com`,
      one_liner: "A consumer app for everyday life",
      long_description: "Consumers use it on their phones.",
      team_size: 5 + i,
      industry: "Consumer",
      subindustry: "Consumer -> Lifestyle",
      tags: ["Consumer", "Mobile"],
      batch: "Winter 2022",
      status: "Active",
      stage: "Early",
      isHiring: false,
      regions: ["United States of America"],
      all_locations: "Austin, TX, USA",
      launched_at: 1_650_000_000 + i * 86_400,
    };
  });
  return [...fit, ...other];
}

/** Routes for routeFetches(): the directory, and Ashby boards (with owner pages) for the first six fits. */
export function discoveryRoutes(): Record<string, string> {
  const routes: Record<string, string> = { [YC_ALL_URL]: JSON.stringify(ycDirectory()) };
  for (const [i, name] of FIT.slice(0, 6).entries()) {
    const s = slug(name);
    routes[`https://api.ashbyhq.com/posting-api/job-board/${s}`] = JSON.stringify({
      apiVersion: "1",
      jobs: [
        { title: i % 2 ? "Founding Finance Lead" : "Head of Revenue Accounting", department: "Finance", location: "San Francisco", jobUrl: `https://jobs.ashbyhq.com/${s}/fin-${i}`, publishedAt: `${addDays(TODAY, -(3 + i))}T16:00:00.000+00:00`, isListed: true },
        { title: "Senior Software Engineer", department: "Engineering", location: "Remote", jobUrl: `https://jobs.ashbyhq.com/${s}/eng-${i}`, publishedAt: `${addDays(TODAY, -20)}T16:00:00.000+00:00`, isListed: true },
      ],
    });
    routes[`https://jobs.ashbyhq.com/${s}`] = `<html><title>${name} Careers</title></html>`;
  }
  return routes;
}

export const FIT_DOMAINS = FIT.map((n) => `${slug(n)}.com`);
export const HIRING_DOMAINS = FIT.slice(0, 6).map((n) => `${slug(n)}.com`);

/**
 * YC companies that share the ICP's tags and words but sell services TO that market (consultancies),
 * plus consumer filler: ranked in code they look like the segment, and the screen rejects every one.
 * The free source misfires; only the web search finds real buyers (SPEC W3, finding gtm-4).
 */
export function vendorDirectory(): Record<string, unknown>[] {
  const vendors = ["Billcraft Partners", "Meterwise Advisory", "Usage Ops Collective", "Ratebook Consulting", "Invoicewell Agency", "Revrec Partners", "Pricing Guild", "Cloudbill Advisors"].map((name, i) => ({
    slug: slug(name),
    name,
    website: `https://${slug(name)}.com`,
    one_liner: "Billing consultancy agency for usage-priced SaaS and infrastructure companies",
    long_description: `${name} is a consultancy: we set up usage-based billing and revenue accounting for B2B software companies.`,
    team_size: 12 + i,
    industry: "B2B",
    subindustry: "B2B -> Finance and Accounting",
    tags: ["Fintech", "SaaS", "API", "Infrastructure", "Billing"],
    batch: "Winter 2024",
    status: "Active",
    stage: "Early",
    isHiring: false,
    regions: ["United States of America"],
    all_locations: "San Francisco, CA, USA",
    launched_at: 1_700_000_000,
  }));
  return [...vendors, ...ycDirectory().filter((c) => (c.industry as string) === "Consumer")];
}

/** Homepages for the companies the mock's web search turns up (the first FIT names), so they resolve. */
export function searchHitSites(): Record<string, string> {
  return Object.fromEntries(
    FIT.slice(0, 10).map((n) => [`https://${slug(n)}.com`, `<html><head><title>${n} | Usage billing</title><meta name="description" content="Usage-based billing API for B2B software companies."></head></html>`]),
  );
}

/* ───────────── HN "Who is hiring?" and SEC Form D, for ICPs whose criteria are detected there ───────────── */

export const HN_THREAD_SEARCH = "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6";
export const HN_THREAD_ITEMS = "https://hn.algolia.com/api/v1/items/45512001";

const HIRING = ["Gridmeter", "Tokenbill", "Quotawise", "Usageflow", "Rateplane", "Meterworks", "Burstly", "Computeledger", "Spendgauge", "Callcount", "Unitwise", "Linemeter"];
export const HN_DOMAINS = HIRING.map((n) => `${slug(n)}.com`);

/** This month's thread: twelve usage-billed infrastructure companies, each hiring its first finance lead. */
export function hnHiringRoutes(): Record<string, string> {
  const children = HIRING.map((name, i) => ({
    id: 45512200 + i,
    created_at: `${addDays(TODAY, -(4 + (i % 5)))}T15:00:00.000Z`,
    author: `${slug(name)}_team`,
    type: "comment",
    parent_id: 45512001,
    text: `${name} | Founding Finance Lead, Senior Backend Engineer | Remote (US) | <a href="https:&#x2F;&#x2F;${slug(name)}.com&#x2F;careers" rel="nofollow">https:&#x2F;&#x2F;${slug(name)}.com&#x2F;careers</a><p>${name} is usage-based billing infrastructure for API companies; customers pay per call. We&#x27;re ${40 + i * 10} people and hiring our first finance lead to own revenue accounting.`,
    children: [],
  }));
  return {
    [HN_THREAD_SEARCH]: JSON.stringify({ hits: [{ objectID: "45512001", title: "Ask HN: Who is hiring? (October 2026)", author: "whoishiring", created_at: `${addDays(TODAY, -19)}T15:01:00Z` }] }),
    [HN_THREAD_ITEMS]: JSON.stringify({ id: 45512001, title: "Ask HN: Who is hiring? (October 2026)", children }),
  };
}

const efts = (q: string) => `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=D&dateRange=custom&startdt=${addDays(TODAY, -90)}&enddt=${TODAY}`;

/** EDGAR full-text search for tech Form Ds (two issuers and a fund), Pavewise's filing, and both issuers' homepages. */
export function formDRoutes(search: string, doc: string): Record<string, string> {
  return {
    [efts('"Other Technology"')]: search,
    "https://www.sec.gov/Archives/edgar/data/1987654/000198765426000002/primary_doc.xml": doc,
    "https://pavewise.com": `<html><head><title>Pavewise | Usage billing for infrastructure APIs</title><meta name="description" content="Pavewise meters API usage and bills it for infrastructure companies."></head></html>`,
    "https://ledgerly.io": `<html><head><title>Ledgerly — usage-based invoicing</title><meta name="description" content="Ledgerly turns metered usage into invoices for B2B software companies."></head></html>`,
  };
}
