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
