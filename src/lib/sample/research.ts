import type { AutomationData, Monitor, MonitorObservation, OperationReceipt } from "@/lib/automation/types";
import { makeClock, type Clock } from "./clock";
import { DOMAIN } from "./ids";

/**
 * automation.json for the sample, so every Research tab has something real to look at: two recent searches with
 * their sources, three monitors (one of them the free intent monitor) with changes to review, and the receipts the
 * Outcomes tab counts. All made up, all on `.example` hosts, no person's name anywhere. Sample monitors never run.
 */

// Fixed v4-shaped ids: the automation routes only accept UUIDs.
const ID = {
  monitorIntent: "5f0c6c1e-6f2a-4d6b-9a51-0c3e7a1d2b01",
  monitorLeaders: "5f0c6c1e-6f2a-4d6b-9a51-0c3e7a1d2b02",
  monitorPricing: "5f0c6c1e-6f2a-4d6b-9a51-0c3e7a1d2b03",
  sessionHiring: "2b7e4f10-93c1-4a8e-8d42-61f0b3c9e701",
  sessionPricing: "2b7e4f10-93c1-4a8e-8d42-61f0b3c9e702",
  receiptHiring: "8c1d2e3f-4a5b-4c6d-9e7f-8a9b0c1d2e01",
  receiptPricing: "8c1d2e3f-4a5b-4c6d-9e7f-8a9b0c1d2e02",
} as const;

const receiptId = (n: number) => `8c1d2e3f-4a5b-4c6d-9e7f-${(0x8a9b0c1d2e10 + n).toString(16).padStart(12, "0")}`;
const observationId = (n: number) => `0d9e8f7a-6b5c-4d3e-8f1a-${(0x2b3c4d5e6f00 + n).toString(16).padStart(12, "0")}`;

function sessions(c: Clock): AutomationData["sessions"] {
  return [
    {
      id: ID.sessionHiring,
      at: c.ago(26 * 60),
      query: "Usage-priced API companies hiring a revenue accountant",
      includeDomains: [],
      excludeDomains: [],
      provider: "Firecrawl",
      results: [
        {
          url: "https://tallyhaul.example/careers/revenue-accountant",
          title: "Revenue Accountant, Usage Billing · Tallyhaul",
          description: "Own usage-to-invoice reconciliation for our per-request pricing, and partner with data engineering on the usage pipeline.",
          publishedAt: c.ago(3 * 24 * 60),
        },
        {
          url: "https://saasdispatch.example/news/brightmeter-series-a",
          title: "Brightmeter raises $18M to bring usage pricing to observability",
          description: "The company will move every plan to per-GB pricing this quarter and is hiring its first controller.",
          publishedAt: c.ago(9 * 24 * 60),
        },
        {
          url: "https://cindervale.example/pricing",
          title: "Pricing: pay per GB ingested · Cindervale",
          description: "Usage-based plans with committed-use discounts and quarterly true-ups for enterprise customers.",
        },
      ],
      queries: ["Usage-priced API companies hiring a revenue accountant"],
      warnings: [],
      receiptId: ID.receiptHiring,
      durationMs: 2140,
    },
    {
      id: ID.sessionPricing,
      at: c.ago(3 * 24 * 60),
      query: "API companies that moved to committed-use contracts this year",
      includeDomains: [],
      excludeDomains: [],
      provider: "Firecrawl",
      results: [
        {
          url: "https://northwind.example/blog/committed-use-plans",
          title: "Introducing committed-use plans · Northwind Metrics",
          description: "Commit to a monthly volume, pay less per GB, and true up at the end of each quarter.",
          publishedAt: c.ago(34 * 24 * 60),
        },
        {
          url: "https://glassmoor.example/blog/enterprise-plans",
          title: "Enterprise plans with annual commitments · Glassmoor",
          description: "Annual query commitments with overages billed monthly per 1,000 queries.",
          publishedAt: c.ago(21 * 24 * 60),
        },
      ],
      queries: ["API companies that moved to committed-use contracts this year"],
      warnings: ["Some sources had no publication date; they are marked."],
      receiptId: ID.receiptPricing,
      durationMs: 1810,
    },
  ];
}

function monitors(c: Clock): Monitor[] {
  return [
    {
      id: ID.monitorIntent,
      name: "People asking for it",
      kind: "intent",
      query: "Research → Intent queries from your playbook",
      intervalMinutes: 1440,
      recipe: "custom",
      keywords: [],
      enabled: true,
      createdAt: c.at(-12, "09:00"),
      nextRunAt: c.at(1, "09:00"),
      lastRunAt: c.ago(118),
      lastChangedAt: c.ago(118),
      failures: 0,
    },
    {
      id: ID.monitorLeaders,
      name: "Leadership changes",
      kind: "topic",
      query: `${DOMAIN.driftglass} new head of finance appointed`,
      intervalMinutes: 1440,
      recipe: "leadership",
      keywords: ["appointed", "joins", "controller", "head of finance"],
      enabled: true,
      createdAt: c.at(-15, "10:30"),
      nextRunAt: c.at(1, "10:30"),
      lastRunAt: c.ago(5 * 60),
      lastChangedAt: c.at(-4, "10:30"),
      failures: 0,
    },
    {
      id: ID.monitorPricing,
      name: "Rowanstack pricing page",
      kind: "page",
      query: "https://rowanstack.example/pricing",
      intervalMinutes: 10080,
      recipe: "revival",
      keywords: ["per row", "committed", "overage"],
      enabled: true,
      createdAt: c.at(-20, "08:15"),
      nextRunAt: c.at(2, "08:15"),
      lastRunAt: c.at(-5, "08:15"),
      lastChangedAt: c.at(-5, "08:15"),
      failures: 0,
    },
  ];
}

function observations(c: Clock): MonitorObservation[] {
  return [
    {
      id: observationId(1),
      monitorId: ID.monitorIntent,
      at: c.ago(118),
      title: "People asking for it",
      summary: "Ask HN: Meterbook or Closewise for the usage line in the close? · Tool to match usage events from our warehouse to invoice line items",
      urls: ["https://news.ycombinator.example/item?id=51917702", "https://softwarerecs.stackexchange.example/questions/91427"],
      read: false,
    },
    {
      id: observationId(2),
      monitorId: ID.monitorPricing,
      at: c.at(-5, "08:16"),
      title: "Rowanstack pricing page",
      summary: "Committed plans now bill overages per 1,000 rows synced, reconciled at the end of each quarter.",
      urls: ["https://rowanstack.example/pricing"],
      read: false,
    },
    {
      id: observationId(3),
      monitorId: ID.monitorLeaders,
      at: c.at(-4, "10:31"),
      title: "Leadership changes",
      summary: "Driftglass names a VP Finance to lead its move to committed-use enterprise contracts",
      urls: ["https://saasdispatch.example/news/driftglass-vp-finance"],
      read: true,
    },
  ];
}

function receipts(c: Clock): OperationReceipt[] {
  const at = (minutes: number) => c.ago(minutes);
  const rows: OperationReceipt[] = [
    {
      id: ID.receiptHiring,
      at: at(26 * 60),
      kind: "research",
      provider: "Firecrawl",
      query: "Usage-priced API companies hiring a revenue accountant",
      durationMs: 2140,
      resultCount: 3,
      cached: false,
      costUsd: null,
      sourceUrls: ["https://tallyhaul.example/careers/revenue-accountant", "https://saasdispatch.example/news/brightmeter-series-a", "https://cindervale.example/pricing"],
      accountDomains: [DOMAIN.northwind, DOMAIN.saltmarsh],
    },
    {
      id: ID.receiptPricing,
      at: at(3 * 24 * 60),
      kind: "research",
      provider: "Firecrawl",
      query: "API companies that moved to committed-use contracts this year",
      durationMs: 1810,
      resultCount: 2,
      cached: false,
      costUsd: null,
      sourceUrls: ["https://northwind.example/blog/committed-use-plans", "https://glassmoor.example/blog/enterprise-plans"],
      accountDomains: [DOMAIN.glassmoor],
    },
  ];
  const ops: Omit<OperationReceipt, "id">[] = [
    { at: at(26 * 60), kind: "search", provider: "Firecrawl", query: "Usage-priced API companies hiring a revenue accountant", durationMs: 2140, resultCount: 3, requests: 1, cached: false, costUsd: null },
    { at: at(3 * 24 * 60), kind: "search", provider: "Firecrawl", query: "API companies that moved to committed-use contracts this year", durationMs: 1810, resultCount: 2, requests: 1, cached: false, costUsd: null },
    { at: at(118), kind: "fetch", provider: "Hacker News", query: "Intent scan: 6 queries", durationMs: 41_200, resultCount: 74, requests: 6, cached: false, costUsd: 0 },
    { at: at(118), kind: "fetch", provider: "Stack Exchange", query: "Intent scan: 6 queries", durationMs: 41_200, resultCount: 39, requests: 5, cached: false, costUsd: 0 },
    { at: at(118), kind: "fetch", provider: "GitHub", query: "Intent scan: 3 queries", durationMs: 41_200, resultCount: 22, requests: 3, cached: false, costUsd: 0 },
    { at: at(118), kind: "search", provider: "Firecrawl", query: '"usage export"', durationMs: 1650, resultCount: 5, requests: 1, cached: false, costUsd: null },
    { at: at(26 * 60), kind: "fetch", provider: "GitHub", query: "Developer radar: meterbook/meterbook-node, closewise/closewise-cli", durationMs: 23_800, resultCount: 8, requests: 17, cached: false, costUsd: 0 },
    { at: at(5 * 24 * 60), kind: "monitor", provider: "Monitor", query: "Rowanstack pricing page", durationMs: 840, resultCount: 1, cached: false, costUsd: 0 },
    { at: at(2 * 24 * 60), kind: "fetch", provider: "Hacker News", query: "Intent scan: 6 queries", durationMs: 380, resultCount: 70, requests: 0, cached: true, costUsd: 0 },
  ];
  return [...rows, ...ops.map((op, i) => ({ ...op, id: receiptId(i) }))].sort((a, b) => b.at.localeCompare(a.at));
}

export function sampleAutomation(now = new Date()): AutomationData {
  const c = makeClock(now);
  return { version: 1, connections: [], monitors: monitors(c), observations: observations(c), receipts: receipts(c), sessions: sessions(c), imports: [] };
}
