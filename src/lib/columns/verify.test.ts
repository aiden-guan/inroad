import { describe, expect, it } from "vitest";
import { corpus, normUrl } from "@/lib/deals/ledger";
import type { ResearchColumn, SourceKind } from "./types";
import { normalizeValue, verifyAnswer, type MaterialSource, type Submitted } from "./verify";

const TODAY = "2026-11-05";
const material = (...rows: [string, string, SourceKind, string?][]) =>
  new Map<string, MaterialSource>(rows.map(([url, text, kind, date]) => [normUrl(url), { url, text, haystack: corpus(text), kind, ...(date ? { date } : {}) }]));

const yesNo: Pick<ResearchColumn, "type" | "options"> = { type: "yes_no" };
const PRICING = "Title: Pricing\nPay per 1,000 traces. No seats, no minimums. Volume discounts start at 50 million traces a month.";
const site = material(["https://fernwick.example/pricing", PRICING, "site", "2026-11-04"], ["https://news.example/fernwick-pricing", "2026-09-16 · Fernwick moves to per-trace pricing · SaaS Dispatch", "page", "2026-09-16"]);

const submit = (patch: Partial<Submitted>): Submitted => ({ status: "answered", answer: "yes", confidence: "high", sources: [], note: "Their pricing page charges per 1,000 traces.", ...patch });

describe("checking an answer before it reaches a cell", () => {
  it("keeps an answer whose quote is really on the page it cites", () => {
    const v = verifyAnswer(yesNo, submit({ sources: [{ url: "https://www.fernwick.example/pricing/", quote: "Pay per 1,000 traces. No seats, no minimums.", publishedAt: null }] }), { material: site, today: TODAY });
    expect(v).toMatchObject({ value: true, confidence: "high", dropped: 0 });
    expect(v.sources).toEqual([{ url: "https://fernwick.example/pricing", quote: "Pay per 1,000 traces. No seats, no minimums.", date: "2026-11-04", kind: "site", checked: true }]);
  });

  it("turns an answer into Unknown when no quote checks out: never a guess", () => {
    const v = verifyAnswer(yesNo, submit({ sources: [{ url: "https://fernwick.example/pricing", quote: "Usage-based pricing for every team", publishedAt: null }] }), { material: site, today: TODAY });
    expect(v).toMatchObject({ value: null, confidence: null, sources: [], dropped: 1, note: "No source I could check supports an answer, so I left it unknown." });
  });

  it("drops URLs that were never shown, and answers with none left are Unknown", () => {
    const v = verifyAnswer(yesNo, submit({ sources: [{ url: "https://made-up.example/blog", quote: "Pay per 1,000 traces.", publishedAt: null }] }), { material: site, today: TODAY });
    expect(v.value).toBeNull();
    expect(v.dropped).toBe(1);
  });

  it("accepts a result from Claude's own search by URL, marked unchecked and capped at low", () => {
    const v = verifyAnswer(yesNo, submit({ sources: [{ url: "https://reviews.example/fernwick", quote: "Fernwick charges by trace volume", publishedAt: "2026-10-01" }] }), {
      material: site,
      searchUrls: new Set([normUrl("https://reviews.example/fernwick")]),
      today: TODAY,
    });
    expect(v).toMatchObject({ value: true, confidence: "low" });
    expect(v.sources[0]).toMatchObject({ kind: "search", checked: false, date: "2026-10-01" });
  });

  it("caps confidence by the best source, and a year-old source costs a level", () => {
    const news = verifyAnswer(yesNo, submit({ sources: [{ url: "https://news.example/fernwick-pricing", quote: "Fernwick moves to per-trace pricing", publishedAt: "2026-09-16" }] }), { material: site, today: TODAY });
    expect(news.confidence).toBe("medium");
    const old = material(["https://fernwick.example/blog/2024", "Every plan is metered by trace.", "site", "2024-06-01"]);
    expect(verifyAnswer(yesNo, submit({ sources: [{ url: "https://fernwick.example/blog/2024", quote: "Every plan is metered by trace.", publishedAt: null }] }), { material: old, today: TODAY }).confidence).toBe("medium");
  });

  it("drops a date in the future", () => {
    const v = verifyAnswer(yesNo, submit({ sources: [{ url: "https://fernwick.example/pricing", quote: "Pay per 1,000 traces.", publishedAt: "2027-01-01" }] }), { material: site, today: TODAY });
    expect(v.sources[0].date).toBe("2026-11-04");
  });

  it("keeps what was read when the model says unknown", () => {
    const v = verifyAnswer(yesNo, submit({ status: "unknown", answer: null, note: "Their pricing page only says talk to sales.", sources: [{ url: "https://fernwick.example/pricing", quote: "No seats, no minimums.", publishedAt: null }] }), { material: site, today: TODAY });
    expect(v).toMatchObject({ value: null, confidence: null, note: "Their pricing page only says talk to sales." });
    expect(v.sources).toHaveLength(1);
  });
});

describe("fitting an answer to the column", () => {
  it("reads yes/no, numbers, options and text, and rejects what doesn't fit", () => {
    expect(normalizeValue({ type: "yes_no" }, "Yes")).toBe(true);
    expect(normalizeValue({ type: "yes_no" }, "maybe")).toBeUndefined();
    expect(normalizeValue({ type: "number" }, "1,200")).toBe(1200);
    expect(normalizeValue({ type: "number" }, "about 40")).toBeUndefined();
    expect(normalizeValue({ type: "pick_one", options: ["Stripe", "Chargebee"] }, "stripe")).toBe("Stripe");
    expect(normalizeValue({ type: "pick_one", options: ["Stripe", "Chargebee"] }, "Recurly")).toBeUndefined();
    expect(normalizeValue({ type: "text" }, "  Stripe   Billing ")).toBe("Stripe Billing");
    expect(normalizeValue({ type: "text" }, null)).toBeUndefined();
  });

  it("makes an answer that doesn't fit the column Unknown", () => {
    const v = verifyAnswer({ type: "pick_one", options: ["Stripe", "Chargebee"] }, submit({ answer: "Recurly", sources: [{ url: "https://fernwick.example/pricing", quote: "Pay per 1,000 traces.", publishedAt: null }] }), { material: site, today: TODAY });
    expect(v).toMatchObject({ value: null, note: "The answer didn't fit this column, so I left it unknown." });
  });
});
