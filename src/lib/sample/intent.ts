import type { Workspace } from "@/lib/domain/types";
import { itemId } from "@/lib/intent/feed";
import { intentProfile, planIntentQueries, queryKey } from "@/lib/intent/profile";
import { aggregateRadar } from "@/lib/intent/radar-model";
import type { IntentItem, IntentState, RadarPerson, RadarSuggestion } from "@/lib/intent/types";
import type { Clock } from "./clock";
import { DOMAIN } from "./ids";

/**
 * Research → Intent for Ledgerline: people asking in public about usage reconciliation and month-end close pain,
 * and developers active on the (fictional) competitors' repositories. Every post, person and host is made up
 * (`.example`), and quotes are the posts' own words. Nothing here touches the sample accounts' signals: adding one
 * is the founder's click ("Add to Fernwick"), so Today and the plays stay as the sample tells them.
 */

const MIN = 1;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const PAIN = {
  export: "The usage export eats the first week of every close",
  variance: "Variances booked as adjustments nobody can explain",
  late: "Revenue billed late or never",
  auditors: "Explaining usage revenue to auditors",
  obstacle: "tying metered usage to invoices at month-end",
};
const CATEGORY = "Usage reconciliation for the month-end close";

type Seed = Omit<IntentItem, "id" | "queryKey" | "foundAt" | "postedAt"> & { agoMinutes: number };

function seeds(): Seed[] {
  return [
    {
      key: "hn:51920114",
      thread: "hn:51920114",
      source: "hn",
      site: "Ask HN",
      url: "https://news.ycombinator.example/item?id=51920114",
      title: "Ask HN: How do you reconcile metered usage with what your billing system invoiced?",
      quote:
        "Every month-end our controller exports usage from the warehouse and VLOOKUPs it against invoice lines. It takes four days and we still book an adjustment we can't explain.",
      author: "mkessler",
      authorUrl: "https://news.ycombinator.example/user?id=mkessler",
      agoMinutes: 5 * HOUR,
      kind: "ask",
      relevance: 3,
      why: "Their controller spends four days a month matching warehouse usage to invoices and wants a better way.",
      matched: [
        { kind: "pain", label: PAIN.variance },
        { kind: "category", label: CATEGORY },
      ],
      query: '"usage reconciliation"',
    },
    {
      key: "hn:51917702",
      thread: "hn:51917702",
      source: "hn",
      site: "Ask HN",
      url: "https://news.ycombinator.example/item?id=51917702",
      title: "Ask HN: Meterbook or Closewise for the usage line in the close?",
      quote: "Has anyone used Meterbook's reconciliation report, or Closewise for the usage line? Our usage lives in the warehouse, not in billing.",
      author: "nkoval",
      authorUrl: "https://news.ycombinator.example/user?id=nkoval",
      agoMinutes: 14 * HOUR,
      kind: "compare",
      relevance: 3,
      why: "Choosing between your two competitors for usage that lives in the warehouse, where you win.",
      matched: [
        { kind: "competitor", label: "Meterbook" },
        { kind: "competitor", label: "Closewise" },
      ],
      company: { name: "Pebblecart", domain: "pebblecart.example", basis: "profile_site", evidence: "Hacker News profile: “Head of Finance Ops at pebblecart.example”" },
      query: "Closewise usage",
    },
    {
      key: "hn:51911358",
      thread: "hn:51904410",
      source: "hn",
      site: "Comment",
      url: "https://news.ycombinator.example/item?id=51911358",
      title: "Usage-based pricing is eating finance teams",
      quote: "We moved to per-token pricing in March and the close went from three days to nine. The usage export alone is a full day.",
      author: "jlindgren",
      authorUrl: "https://news.ycombinator.example/user?id=jlindgren",
      agoMinutes: 9 * HOUR,
      kind: "problem",
      relevance: 3,
      why: "Per-token pricing tripled their close, and the usage export takes a full day.",
      matched: [{ kind: "pain", label: PAIN.export }],
      company: { name: "Quayside Maps", domain: DOMAIN.quayside, basis: "profile_site", evidence: "Hacker News profile: “Controller at quayside.example”" },
      query: '"usage export"',
    },
    {
      key: "stackexchange:softwarerecs:91427",
      thread: "stackexchange:softwarerecs:91427",
      source: "stackexchange",
      site: "Software Recommendations",
      url: "https://softwarerecs.stackexchange.example/questions/91427",
      title: "Tool to match usage events from our warehouse to invoice line items",
      quote: "We bill per API call. I need something that ties raw usage events to the invoice line they landed on and flags what never got billed.",
      author: "M. Okonjo",
      authorUrl: "https://softwarerecs.stackexchange.example/users/40211",
      agoMinutes: DAY + 2 * HOUR,
      kind: "ask",
      relevance: 3,
      why: "Asking outright for a tool that ties usage events to invoice lines and flags unbilled usage.",
      matched: [
        { kind: "pain", label: PAIN.obstacle },
        { kind: "pain", label: PAIN.late },
      ],
      query: "usage reconciliation",
    },
    {
      key: "reddit:accounting:1q8zk2",
      thread: "reddit:accounting:1q8zk2",
      source: "reddit",
      site: "r/Accounting",
      url: "https://www.reddit.example/r/Accounting/comments/1q8zk2/",
      title: "Usage-based billing is wrecking our close",
      quote: "Half of my first week goes to tying out usage to invoices. The data team owns the usage tables and I own the variance.",
      author: "",
      agoMinutes: 2 * DAY + 3 * HOUR,
      kind: "problem",
      relevance: 2,
      why: "An accountant losing the first week of every close to usage tie-outs.",
      matched: [{ kind: "pain", label: PAIN.export }],
      query: '"tie out usage"',
    },
    {
      key: "github:meterbook/meterbook-node#412",
      thread: "github:meterbook/meterbook-node#412",
      source: "github",
      site: "meterbook/meterbook-node",
      url: "https://github.example/meterbook/meterbook-node/issues/412",
      title: "Metered usage that arrives after the invoice run is never billed",
      quote: "Metered usage that lands after the invoice run never reaches an invoice in Meterbook. We tie usage to invoices by hand at month-end to find it, and found the last gap in a customer dispute.",
      author: "rkapoor-fw",
      authorUrl: "https://github.example/rkapoor-fw",
      agoMinutes: 3 * DAY + 5 * HOUR,
      kind: "problem",
      relevance: 3,
      why: "Late usage never gets billed in Meterbook, and they found out from a customer dispute.",
      matched: [
        { kind: "pain", label: PAIN.late },
        { kind: "competitor", label: "Meterbook" },
      ],
      company: { name: "Fernwick", domain: DOMAIN.fernwick, basis: "profile", evidence: "GitHub profile: company “@fernwick”" },
      query: "Meterbook usage",
    },
    {
      key: "stackexchange:stackoverflow:80431977",
      thread: "stackexchange:stackoverflow:80431977",
      source: "stackexchange",
      site: "Stack Overflow",
      url: "https://stackoverflow.example/questions/80431977",
      title: "Reconciling a dbt usage model against billed invoice lines",
      quote: "Our dbt usage model and what billing actually rated drift apart every month. How do others reconcile the two before the invoice run?",
      author: "Priyanka S.",
      authorUrl: "https://stackoverflow.example/users/2290431",
      agoMinutes: 4 * DAY + 8 * HOUR,
      kind: "ask",
      relevance: 2,
      why: "A data engineer asking how others reconcile usage models with billing before invoices go out.",
      matched: [{ kind: "category", label: CATEGORY }],
      query: "usage reconciliation",
    },
    {
      key: "github:closewise/closewise-cli#88",
      thread: "github:closewise/closewise-cli#88",
      source: "github",
      site: "closewise/closewise-cli",
      url: "https://github.example/closewise/closewise-cli/issues/88",
      title: "Read usage events from a warehouse table instead of a CSV export",
      quote: "We'd like Closewise's usage reconciliation step to read events straight from our warehouse instead of a CSV export we rebuild every close.",
      author: "dmehta",
      authorUrl: "https://github.example/dmehta",
      agoMinutes: 6 * DAY + 4 * HOUR,
      kind: "ask",
      relevance: 2,
      why: "Wants Closewise to read usage from the warehouse instead of a CSV rebuilt every close.",
      matched: [
        { kind: "competitor", label: "Closewise" },
        { kind: "pain", label: PAIN.export },
      ],
      company: { name: "Lumenwire", domain: DOMAIN.lumenwire, basis: "profile", evidence: "GitHub profile: company “@lumenwire”" },
      query: "Closewise usage",
    },
    {
      key: "stackexchange:money:118804",
      thread: "stackexchange:money:118804",
      source: "stackexchange",
      site: "Personal Finance & Money",
      url: "https://money.stackexchange.example/questions/118804",
      title: "How should a small SaaS company document usage true-ups for its first audit?",
      quote: "Our auditors want to see how each usage invoice ties back to the events behind it, and all we have is a spreadsheet per month.",
      author: "R. Mbeki",
      authorUrl: "https://money.stackexchange.example/users/77310",
      agoMinutes: 18 * DAY,
      kind: "problem",
      relevance: 2,
      why: "A first audit needs a trail from usage invoices to events; they only have spreadsheets.",
      matched: [{ kind: "pain", label: PAIN.auditors }],
      query: "usage reconciliation",
    },
  ];
}

const STACK: Record<string, string> = {
  "Software Recommendations": "softwarerecs",
  "Stack Overflow": "stackoverflow",
  "Personal Finance & Money": "money",
};

/** Developer radar people: their public profiles, as GitHub would show them. */
function radarPeople(c: Clock): RadarPerson[] {
  const at = (minutes: number) => c.ago(minutes);
  const repo = (r: string) => `https://github.example/${r}`;
  return [
    {
      login: "rkapoor-fw",
      url: repo("rkapoor-fw"),
      name: "Rhea Kapoor",
      company: "@fernwick",
      domain: DOMAIN.fernwick,
      basis: "company_org",
      activity: [
        {
          kind: "issue",
          repo: "meterbook/meterbook-node",
          url: repo("meterbook/meterbook-node/issues/412"),
          at: at(3 * DAY + 5 * HOUR),
          title: "Metered usage that arrives after the invoice run is never billed",
          quote: "Metered usage that lands after the invoice run never reaches an invoice in Meterbook. We tie usage to invoices by hand at month-end to find it.",
        },
      ],
    },
    {
      login: "tbaird",
      url: repo("tbaird"),
      name: "Tomás Baird",
      company: "Fernwick",
      domain: DOMAIN.fernwick,
      basis: "company_site",
      activity: [{ kind: "fork", repo: "meterbook/meterbook-node", url: repo("tbaird/meterbook-node"), at: at(5 * DAY) }],
    },
    {
      login: "squreshi",
      url: repo("squreshi"),
      name: "Sana Qureshi",
      company: "Fernwick",
      domain: DOMAIN.fernwick,
      basis: "email",
      activity: [
        {
          kind: "comment",
          repo: "meterbook/meterbook-node",
          url: repo("meterbook/meterbook-node/issues/412#issuecomment-2210457"),
          at: at(2 * DAY + 20 * HOUR),
          quote: "Same problem here. We reconcile trace usage against invoices by hand every close.",
        },
      ],
    },
    {
      login: "wliu-dg",
      url: repo("wliu-dg"),
      name: "Wei Liu",
      company: "@driftglass",
      domain: DOMAIN.driftglass,
      basis: "company_org",
      activity: [
        { kind: "comment", repo: "closewise/closewise-cli", url: repo("closewise/closewise-cli/issues/88#issuecomment-2207761"), at: at(5 * DAY + 2 * HOUR), quote: "Does this handle per-query usage that lands after the cutoff?" },
        { kind: "fork", repo: "meterbook/meterbook-node", url: repo("wliu-dg/meterbook-node"), at: at(9 * DAY) },
      ],
    },
    {
      login: "aamaro",
      url: repo("aamaro"),
      name: "Ana Amaro",
      company: "@pebblecart",
      domain: "pebblecart.example",
      basis: "company_org",
      activity: [
        {
          kind: "issue",
          repo: "closewise/closewise-cli",
          url: repo("closewise/closewise-cli/issues/91"),
          at: at(7 * DAY + 6 * HOUR),
          title: "The usage line shows a variance but not which events caused it",
          quote: "The usage line shows a variance but not which events caused it, so we still export everything to a spreadsheet.",
        },
      ],
    },
    {
      login: "hollowpine",
      url: repo("hollowpine"),
      name: "Hollowpine",
      domain: DOMAIN.hollowpine,
      basis: "company_org",
      activity: [{ kind: "fork", repo: "closewise/closewise-cli", url: repo("hollowpine/closewise-cli"), at: at(11 * DAY) }],
    },
    { login: "jfrost", url: repo("jfrost"), activity: [{ kind: "fork", repo: "meterbook/meterbook-node", url: repo("jfrost/meterbook-node"), at: at(4 * DAY) }] },
    {
      login: "kbello",
      url: repo("kbello"),
      company: "Freelance",
      activity: [{ kind: "comment", repo: "meterbook/meterbook-node", url: repo("meterbook/meterbook-node/issues/409#issuecomment-2201188"), at: at(12 * DAY), quote: "Is there a way to export the rated usage per customer?" }],
    },
  ];
}

export function sampleRepoSuggestions(): RadarSuggestion[] {
  return [
    { full: "meterbook/meterbook-node", url: "https://github.example/meterbook/meterbook-node", stars: 2140, why: "Meterbook's own repository (their site, meterbook.example, is on the org)", verified: true },
    { full: "meterbook/meterbook-python", url: "https://github.example/meterbook/meterbook-python", stars: 610, why: "Meterbook's own repository (their site, meterbook.example, is on the org)", verified: true },
    { full: "closewise/closewise-cli", url: "https://github.example/closewise/closewise-cli", stars: 860, why: "Closewise's own repository (their site, closewise.example, is on the org)", verified: true },
  ];
}

export function sampleIntent(c: Clock, ws: Pick<Workspace, "foundation" | "company">): IntentState {
  const profile = intentProfile(ws);
  const keyFor = (s: Seed) => queryKey(s.source, s.query, s.source === "stackexchange" ? STACK[s.site ?? ""] : undefined);
  const items: IntentItem[] = seeds()
    .map(({ agoMinutes, ...s }) => ({ ...s, id: itemId(s.key), queryKey: keyFor({ ...s, agoMinutes }), postedAt: c.ago(agoMinutes), foundAt: c.ago(Math.min(agoMinutes, 118)) }))
    .sort((a, b) => b.foundAt.localeCompare(a.foundAt));
  const noisy = queryKey("hn", '"month-end close"');
  const people = radarPeople(c);
  const companies = aggregateRadar(people, {
    windowDays: 30,
    profile,
    exclude: ["meterbook.example", "closewise.example", DOMAIN.ledgerline],
    names: { [DOMAIN.fernwick]: "Fernwick", [DOMAIN.driftglass]: "Driftglass", [DOMAIN.hollowpine]: "Hollowpine", "pebblecart.example": "Pebblecart" },
  });
  return {
    version: 1,
    items,
    dismissed: [
      { thread: "hn:51874002", at: c.ago(3 * DAY), queryKey: noisy },
      { thread: "hn:51869115", at: c.ago(3 * DAY), queryKey: noisy },
      { thread: "hn:51866931", at: c.ago(2 * DAY), queryKey: noisy },
    ],
    // Three "month-end close" posts were about retail stock counts and payroll: that query is retired until the founder restores it.
    feedback: { [noisy]: { hits: 0, misses: 3 }, [queryKey("hn", '"usage reconciliation"')]: { hits: 1, misses: 0 } },
    scans: [
      {
        at: c.ago(118),
        durationMs: 41_200,
        windowDays: 30,
        queries: profile ? planIntentQueries(profile, { [noisy]: { hits: 0, misses: 3 } }, { reddit: true }).queries : [],
        requests: {
          hn: { made: 6, cached: 0, failed: 0 },
          stackexchange: { made: 5, cached: 1, failed: 0 },
          github: { made: 3, cached: 0, failed: 0 },
          reddit: { made: 2, cached: 0, failed: 0 },
        },
        skipped: [{ source: "bluesky", reason: "Bluesky's public search now needs a signed-in account." }],
        fetched: 143,
        candidates: 38,
        judged: 31,
        reused: 7,
        kept: items.length,
        added: items.length,
        costUsd: 0.0021,
        tokens: { input: 18_400, output: 3_100 },
        warnings: [],
      },
    ],
    radar: {
      repos: [
        { full: "meterbook/meterbook-node", url: "https://github.example/meterbook/meterbook-node", stars: 2140, starsLast30: 96, description: "Node SDK for Meterbook usage billing", ownerDomain: "meterbook.example" },
        { full: "closewise/closewise-cli", url: "https://github.example/closewise/closewise-cli", stars: 860, starsLast30: 31, description: "Run Closewise reconciliations from the command line", ownerDomain: "closewise.example" },
      ],
      windowDays: 30,
      at: c.ago(26 * HOUR),
      people,
      companies,
      totals: { engaged: people.length, profilesRead: people.length, placed: people.filter((p) => p.domain).length, rateLimited: false, withToken: false },
      requests: 17,
      warnings: [],
      durationMs: 23_800,
    },
  };
}
