import { describe, expect, it } from "vitest";
import { quickAnswer, type QuickFacts } from "./quick";
import type { ResearchColumn } from "./types";

const col = (question: string, patch: Partial<ResearchColumn> = {}): ResearchColumn => ({ id: "col_test1", question, type: "yes_no", createdAt: "2026-11-01T10:00:00.000Z", ...patch });

const facts: QuickFacts = {
  domain: "fernwick.example",
  jobs: {
    boardUrl: "https://jobs.ashbyhq.com/fernwick",
    provider: "ashby",
    checkedOn: "2026-11-04",
    total: 9,
    teams: [
      { team: "Engineering", count: 5, titles: ["Senior Backend Engineer", "ML Engineer, Evals", "Billing Engineer"] },
      { team: "Finance", count: 1, titles: ["Billing Analyst"] },
      { team: "Go-to-market", count: 2, titles: ["Founding Account Executive", "Developer Advocate"] },
    ],
  },
  siteTech: { url: "https://fernwick.example", checkedOn: "2026-11-04", names: ["Segment", "Stripe", "Webflow"] },
  dnsTech: { url: "https://dns.google/resolve?name=fernwick.example&type=TXT", checkedOn: "2026-11-04", names: ["HubSpot", "Atlassian"] },
};

describe("answers code can settle without a model", () => {
  it("answers a hiring question from the job board, with the board as the source", () => {
    const a = quickAnswer(col("Are they hiring in finance?"), facts);
    expect(a).toMatchObject({ value: true, confidence: "high", note: "1 finance role on their Ashby job board." });
    expect(a?.sources).toEqual([{ url: "https://jobs.ashbyhq.com/fernwick", quote: "Finance roles (1): Billing Analyst", date: "2026-11-04", kind: "job_board", checked: true }]);
  });

  it("says no, at medium confidence, when the board lists nothing in that team", () => {
    const a = quickAnswer(col("Are they hiring in legal?"), facts);
    expect(a).toMatchObject({ value: false, confidence: "medium", note: "None of their 9 open roles are in legal." });
  });

  it("counts open roles for a number question only when the count is exact", () => {
    expect(quickAnswer(col("How many open roles do they have?", { type: "number" }), facts)).toMatchObject({ value: 9 });
    expect(quickAnswer(col("How many open finance roles?", { type: "number" }), facts)).toMatchObject({ value: 1 });
    // Sales roles are only found by title in another team: a floor, not a number.
    expect(quickAnswer(col("How many open sales roles?", { type: "number" }), facts)).toBeNull();
  });

  it("leaves hiring questions to the model without a job board, or when they name two teams", () => {
    expect(quickAnswer(col("Are they hiring in finance?"), { domain: "x.example" })).toBeNull();
    expect(quickAnswer(col("Are they hiring sales engineers?"), facts)).toBeNull();
  });

  it("answers yes to a tool they visibly use, and never no from a missing script", () => {
    expect(quickAnswer(col("Do they use HubSpot?"), facts)).toMatchObject({ value: true, confidence: "medium", note: "Their DNS has a HubSpot verification record." });
    expect(quickAnswer(col("Do they use Stripe?"), facts)?.sources[0]).toMatchObject({ kind: "site", url: "https://fernwick.example" });
    expect(quickAnswer(col("Do they use Salesforce?"), facts)).toBeNull();
    expect(quickAnswer(col("Did they stop using Stripe?"), facts)).toBeNull();
  });

  it("picks the one option code can see, and stays out of it when two could fit", () => {
    expect(quickAnswer(col("Which billing system do they use?", { type: "pick_one", options: ["Stripe", "Chargebee", "In-house"] }), facts)).toMatchObject({ value: "Stripe" });
    expect(quickAnswer(col("Which tools do they use?", { type: "pick_one", options: ["Stripe", "Segment"] }), facts)).toBeNull();
  });

  it("names the tool for a short-text question about a category", () => {
    expect(quickAnswer(col("Which billing system do they use?", { type: "text" }), facts)).toMatchObject({ value: "Stripe" });
    expect(quickAnswer(col("What do they use for support?", { type: "text" }), facts)).toBeNull();
  });

  it("leaves everything to the model when the founder wrote how to decide", () => {
    expect(quickAnswer(col("Are they hiring in finance?", { instructions: "Only count senior roles." }), facts)).toBeNull();
  });
});
