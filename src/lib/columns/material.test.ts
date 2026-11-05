import { describe, expect, it } from "vitest";
import { normUrl, quoteIn } from "@/lib/deals/ledger";
import type { Evidence } from "@/lib/domain/types";
import { makeAccount, makeDossier, makeSignal } from "@/test/factories";
import { buildMaterial, type Gathered } from "./material";

const CHECKED = "2026-11-04T08:00:00.000Z";
const TODAY = "2026-11-05";

const gathered: Gathered = {
  site: {
    domain: "fernwick.example",
    name: "Fernwick",
    pages: [
      { url: "https://fernwick.example", title: "Fernwick", description: "Trace, evaluate and monitor LLM apps. Priced per 1,000 traces.", headings: ["Evals in production"], text: "Ship LLM features with confidence." },
      { url: "https://fernwick.example/pricing", title: "Pricing", description: "", headings: [], text: "Pay per 1,000 traces. No seats, no minimums." },
    ],
    jobBoards: [{ provider: "ashby", token: "fernwick" }],
    socials: {},
    tech: ["Segment", "Stripe"],
  },
  jobs: [
    { title: "Billing Analyst", team: "Finance", url: "https://jobs.ashbyhq.com/fernwick/1", postedAt: "2026-10-24T12:00:00.000Z" },
    { title: "Senior Backend Engineer", team: "Engineering", url: "https://jobs.ashbyhq.com/fernwick/2", postedAt: "2026-10-10T12:00:00.000Z" },
  ],
  jobSource: { provider: "ashby", token: "fernwick" },
  news: [],
  dns: { emailProvider: "google", mx: [], spf: null, dmarc: null, saas: ["HubSpot"] },
};

const evidence: Record<string, Evidence> = {
  ev_fw_jd: {
    id: "ev_fw_jd",
    claim: "Billing Analyst posting: reconcile metered trace usage to invoices.",
    quote: "Reconcile metered trace usage to invoices every month.",
    url: "https://fernwick.example/careers/billing-analyst",
    host: "fernwick.example",
    sourceType: "job_post",
    publishedAt: "2026-10-24",
    retrievedAt: CHECKED,
    confidence: "high",
  },
  ev_wrong: { id: "ev_wrong", claim: "Wrong", quote: "Something wrong", url: "https://x.example", host: "x.example", sourceType: "press", retrievedAt: CHECKED, confidence: "low", flaggedWrong: { at: CHECKED } },
};

describe("the material a research question is answered from", () => {
  const account = makeAccount("fernwick.example", {
    name: "Fernwick",
    oneLiner: "Evaluation and monitoring for LLM apps.",
    signals: [makeSignal("sig_fw", { evidenceId: "ev_fw_jd", url: "https://fernwick.example/careers/billing-analyst", date: "2026-10-24" })],
    dossier: makeDossier({ facts: [{ text: "Flagged", evidenceIds: ["ev_wrong"] }] }),
  });
  const m = buildMaterial({ account, evidence, gathered, checkedAt: CHECKED, today: TODAY });

  it("gives every source a URL with exactly the text shown for it, so quotes can be checked", () => {
    const pricing = m.sources.get(normUrl("https://fernwick.example/pricing"))!;
    expect(pricing).toMatchObject({ kind: "site", date: "2026-11-04" });
    expect(quoteIn("Pay per 1,000 traces.", pricing.haystack)).toBe(true);
    expect(m.prompt).toContain("## https://fernwick.example/pricing\nSource: their site · read 2026-11-04\n");
    expect(m.pages).toBe(2);
  });

  it("adds what code saw: the scripts on their home page, their DNS records and their job board", () => {
    const home = m.sources.get(normUrl("https://fernwick.example"))!;
    expect(quoteIn("Scripts loaded on their site: Segment, Stripe", home.haystack)).toBe(true);
    expect(m.sources.get(normUrl("https://dns.google/resolve?name=fernwick.example&type=TXT"))).toMatchObject({ kind: "dns" });
    expect(m.sources.get(normUrl("https://jobs.ashbyhq.com/fernwick"))?.text).toContain("Finance (1): Billing Analyst");
    expect(m.facts).toMatchObject({
      jobs: { boardUrl: "https://jobs.ashbyhq.com/fernwick", total: 2, teams: [{ team: "Finance", count: 1 }, { team: "Engineering", count: 1 }] },
      siteTech: { names: ["Segment", "Stripe"] },
      dnsTech: { names: ["HubSpot"] },
    });
  });

  it("includes evidence on file, never evidence flagged wrong, and keeps Inroad's own notes out of the sources", () => {
    expect(m.sources.get(normUrl("https://fernwick.example/careers/billing-analyst"))).toMatchObject({ kind: "evidence", date: "2026-10-24" });
    expect([...m.sources.values()].some((s) => s.url === "https://x.example")).toBe(false);
    expect(m.prompt).toContain("Inroad's notes (context only, not a source): Evaluation and monitoring for LLM apps.");
  });

  it("falls back to what enrichment found when the site can't be read, and says when there's nothing", () => {
    const enriched = makeAccount("quiet.example", {
      enrichment: { crawledAt: "2026-10-30T08:00:00.000Z", title: "Quiet", description: "Pay as you go.", tech: [], socials: {}, jobBoard: { provider: "lever", token: "quiet" }, openRoles: 3, rolesByTeam: [{ team: "Engineering", count: 3, titles: ["SRE"] }], news: [] },
    });
    const fromFile = buildMaterial({ account: enriched, evidence: {}, gathered: null, checkedAt: CHECKED, today: TODAY });
    expect(fromFile.sources.get(normUrl("https://quiet.example"))).toMatchObject({ kind: "site", date: "2026-10-30" });
    expect(fromFile.facts.jobs).toMatchObject({ boardUrl: "https://jobs.lever.co/quiet", total: 3, checkedOn: "2026-10-30" });

    const stale = buildMaterial({ account: { ...enriched, enrichment: { ...enriched.enrichment!, crawledAt: "2026-09-01T08:00:00.000Z" } }, evidence: {}, gathered: null, checkedAt: CHECKED, today: TODAY });
    expect(stale.facts.jobs).toBeUndefined();

    const empty = buildMaterial({ account: makeAccount("nothing.example"), evidence: {}, gathered: null, checkedAt: CHECKED, today: TODAY });
    expect(empty.sources.size).toBe(0);
    expect(empty.prompt).toContain("None yet");
  });
});
