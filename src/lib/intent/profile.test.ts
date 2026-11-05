import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { chunks, hashText, intentProfile, isRetired, lexicalScore, planIntentQueries, queryKey, stackSites } from "./profile";

const ws = () => sampleWorkspace(NOW);

describe("chunks", () => {
  it("keeps the noun phrases between stop words, and drops a leading verb", () => {
    expect(chunks("Usage reconciliation for the month-end close")).toEqual(["usage reconciliation", "month-end close"]);
    expect(chunks("tying metered usage to invoices at month-end")).toEqual(["metered usage"]);
    expect(chunks("Revenue accounting teams at usage-priced software vendors")).toEqual(["revenue accounting", "usage-priced software vendors"]);
  });
});

describe("intentProfile", () => {
  it("listens for the buyer's public words first, then the category and the obstacle, never the founder's contacts", () => {
    const p = intentProfile(ws())!;
    expect(p.phrases.map((x) => x.phrase).slice(0, 4)).toEqual(["tie out usage", "usage reconciliation", "month-end close", "metered usage"]);
    expect(p.competitors.map((c) => c.label)).toEqual(["Meterbook", "Closewise"]);
    expect(p.anchor).toBe("usage");
    expect(p.pains.map((t) => t.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    const contacts = Object.values(ws().people).map((x) => x.name.toLowerCase().split(" ")[1]);
    const said = p.phrases.map((x) => x.phrase).join(" ");
    expect(contacts.some((n) => said.includes(n))).toBe(false);
  });

  it("is null before there's a playbook, and its hash changes when the playbook does", () => {
    expect(intentProfile({ ...ws(), foundation: null })).toBeNull();
    const a = intentProfile(ws())!.hash;
    const changed = ws();
    changed.foundation!.competitors[0].name = "Tallyhaul";
    expect(intentProfile(changed)!.hash).not.toBe(a);
    expect(hashText("same")).toBe(hashText("same"));
  });
});

describe("planIntentQueries", () => {
  it("quotes phrases for Hacker News and GitHub, pins competitor names to the space, and asks Software Recommendations", () => {
    const p = intentProfile(ws())!;
    const plan = planIntentQueries(p, {}, { reddit: true });
    const by = (s: string) => plan.queries.filter((q) => q.source === s).map((q) => q.query);
    expect(by("hn")).toEqual(['"tie out usage"', '"usage reconciliation"', '"month-end close"', '"metered usage"', '"usage export"', "Meterbook usage"]);
    expect(by("github")).toEqual(["Meterbook usage", "Closewise usage", '"tie out usage"']);
    expect(by("reddit")).toHaveLength(2);
    expect(stackSites(p)).toEqual(["softwarerecs", "stackoverflow", "money"]);
    expect(plan.queries.filter((q) => q.source === "stackexchange").map((q) => `${q.site}:${q.query}`)).toEqual([
      "softwarerecs:tie out usage",
      "softwarerecs:usage reconciliation",
      "stackoverflow:tie out usage",
      "stackoverflow:usage reconciliation",
      "money:tie out usage",
      "money:usage reconciliation",
    ]);
    expect(plan.retired).toEqual([]);
  });

  it("retires a query the founder keeps throwing away, ranks kept ones first, and leaves Reddit out without a provider", () => {
    const p = intentProfile(ws())!;
    const noisy = queryKey("hn", '"month-end close"');
    const good = queryKey("hn", '"usage export"');
    const plan = planIntentQueries(p, { [noisy]: { hits: 0, misses: 3 }, [good]: { hits: 2, misses: 0 } });
    const hn = plan.queries.filter((q) => q.source === "hn").map((q) => q.query);
    expect(hn[0]).toBe('"usage export"');
    expect(hn).not.toContain('"month-end close"');
    expect(plan.retired.map((q) => q.key)).toEqual([noisy]);
    expect(plan.queries.some((q) => q.source === "reddit")).toBe(false);
  });

  it("leaves GitHub issues out for a consumer company", () => {
    const consumer = ws();
    consumer.company!.market = "consumer";
    expect(planIntentQueries(intentProfile(consumer)!, {}).queries.some((q) => q.source === "github")).toBe(false);
  });
});

describe("isRetired", () => {
  it("needs three misses, and three times as many misses as keeps", () => {
    expect(isRetired(undefined)).toBe(false);
    expect(isRetired({ hits: 0, misses: 2 })).toBe(false);
    expect(isRetired({ hits: 0, misses: 3 })).toBe(true);
    expect(isRetired({ hits: 2, misses: 3 })).toBe(false);
    expect(isRetired({ hits: 1, misses: 3 })).toBe(true);
  });
});

describe("lexicalScore", () => {
  it("counts competitors double and a pain only when most of its words appear", () => {
    const p = intentProfile(ws())!;
    const hit = lexicalScore("Has anyone used Meterbook's reconciliation report for the usage export at month-end close?", p);
    expect(hit.matched.map((m) => m.label)).toContain("Meterbook");
    expect(hit.score).toBeGreaterThanOrEqual(3);
    expect(lexicalScore("GRANT USAGE ON SCHEMA billing TO analyst fails", p).score).toBe(0);
  });
});
