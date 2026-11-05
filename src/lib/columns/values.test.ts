import { describe, expect, it } from "vitest";
import type { ColumnCell, ResearchColumn } from "./types";
import { answerKey, answerOptions, cellLabel, compareCells, costLabel, durationLabel, estimateRest, questionKey, shortQuestion, suggestType } from "./values";

const col = (patch: Partial<ResearchColumn> = {}): ResearchColumn => ({ id: "col_test1", question: "Do they bill on usage?", type: "yes_no", createdAt: "2026-11-01T10:00:00.000Z", ...patch });
const cell = (value: ColumnCell["value"], patch: Partial<ColumnCell> = {}): ColumnCell => ({
  columnId: "col_test1",
  domain: "acme.example",
  value,
  confidence: value === null ? null : "high",
  sources: [],
  at: "2026-11-02T10:00:00.000Z",
  method: "model",
  ...patch,
});

describe("showing an answer", () => {
  it("labels every state, Unknown included", () => {
    expect(cellLabel(undefined)).toBe("");
    expect(cellLabel(cell(true))).toBe("Yes");
    expect(cellLabel(cell(false))).toBe("No");
    expect(cellLabel(cell(1200))).toBe("1,200");
    expect(cellLabel(cell("Stripe"))).toBe("Stripe");
    expect(cellLabel(cell(null))).toBe("Unknown");
    expect(cellLabel(cell(null, { error: "Search limit reached" }))).toBe("Failed");
  });

  it("shortens a long question at a word for the header", () => {
    expect(shortQuestion("Do they bill on usage?")).toBe("Do they bill on usage");
    expect(shortQuestion("Which billing system do they use for their enterprise customers today?", 30)).toBe("Which billing system do they…");
  });

  it("treats the same question, type, options and instructions as the same, whatever the case or punctuation", () => {
    expect(questionKey(col())).toBe(questionKey(col({ question: "do they bill on USAGE" })));
    expect(questionKey(col())).not.toBe(questionKey(col({ type: "text" })));
    expect(questionKey(col({ instructions: "Seats are no." }))).not.toBe(questionKey(col()));
  });
});

describe("proposing an answer type", () => {
  it("reads it from how the question starts", () => {
    expect(suggestType("Do they bill on usage?")).toBe("yes_no");
    expect(suggestType("Are they hiring in finance?")).toBe("yes_no");
    expect(suggestType("How many open roles do they have?")).toBe("number");
    expect(suggestType("Which billing system do they use?")).toBe("text");
    expect(suggestType("")).toBe("text");
  });
});

describe("filtering by answer", () => {
  const domains = ["a.example", "b.example", "c.example", "d.example", "e.example"];
  const cells: Record<string, ColumnCell> = {
    "a.example": cell(true, { domain: "a.example" }),
    "b.example": cell(false, { domain: "b.example" }),
    "c.example": cell(null, { domain: "c.example" }),
    "d.example": cell(null, { domain: "d.example", error: "Timed out" }),
  };

  it("buckets yes/no answers, unknowns, failures and companies not asked yet", () => {
    expect(domains.map((d) => answerKey(col(), cells[d]))).toEqual(["yes", "no", "unknown", "failed", "empty"]);
    expect(answerOptions(col(), cells, domains)).toEqual([
      { value: "yes", label: "Yes", count: 1 },
      { value: "no", label: "No", count: 1 },
      { value: "unknown", label: "Unknown", count: 1 },
      { value: "empty", label: "Not asked yet", count: 1 },
      { value: "failed", label: "Failed", count: 1 },
    ]);
  });

  it("offers each option of a pick-one column, and only shows Failed when something failed", () => {
    const pick = col({ type: "pick_one", options: ["Stripe", "Chargebee"] });
    const opts = answerOptions(pick, { "a.example": cell("Stripe") }, ["a.example", "b.example"]);
    expect(opts.map((o) => [o.value, o.count])).toEqual([
      ["Stripe", 1],
      ["Chargebee", 0],
      ["unknown", 0],
      ["empty", 1],
    ]);
  });
});

describe("sorting by a column", () => {
  const sortWith = (column: ResearchColumn, values: (ColumnCell | undefined)[], dir: "asc" | "desc") =>
    [...values].sort((a, b) => compareCells(column, a, b, dir)).map((c) => (c ? cellLabel(c) : "–"));

  it("puts numbers in order and blanks last in both directions", () => {
    const n = col({ type: "number" });
    const values = [cell(3), undefined, cell(10), cell(null), cell(1)];
    expect(sortWith(n, values, "desc")).toEqual(["10", "3", "1", "Unknown", "–"]);
    expect(sortWith(n, values, "asc")).toEqual(["1", "3", "10", "Unknown", "–"]);
  });

  it("sorts yes first, then no, then unknown", () => {
    expect(sortWith(col(), [cell(false), cell(null), cell(true)], "desc")).toEqual(["Yes", "No", "Unknown"]);
    expect(sortWith(col(), [cell(true), cell(false)], "asc")).toEqual(["No", "Yes"]);
  });

  it("sorts pick-one answers in the order the options were listed", () => {
    const pick = col({ type: "pick_one", options: ["Stripe", "Chargebee", "In-house"] });
    expect(sortWith(pick, [cell("In-house"), cell("Stripe"), cell("Chargebee")], "asc")).toEqual(["Stripe", "Chargebee", "In-house"]);
    expect(sortWith(pick, [cell("In-house"), cell("Stripe"), cell("Chargebee")], "desc")).toEqual(["In-house", "Chargebee", "Stripe"]);
  });
});

describe("the estimate for the rest", () => {
  it("multiplies what the preview actually cost per row by the rows left", () => {
    const preview = [
      cell(true, { costUsd: 0.002, searches: 1 }),
      cell(false, { costUsd: 0.004, searches: 1 }),
      cell(null, { costUsd: 0.003 }),
      cell(true, { costUsd: 0, method: "workspace" }),
      cell(true, { costUsd: 0, method: "reused" }),
    ];
    const est = estimateRest(preview, 40, 10_000);
    expect(est.rows).toBe(5);
    expect(est.modelRows).toBe(3);
    expect(est.previewUsd).toBeCloseTo(0.009);
    expect(est.restUsd).toBeCloseTo(0.072);
    expect(est.restSearches).toBe(16);
    expect(est.restMs).toBe(80_000);
    expect(est.unpriced).toBe(false);
  });

  it("is an honest $0.00 when the model charged nothing, and says when a price is missing", () => {
    expect(estimateRest([cell(true, { costUsd: 0 }), cell(false, { costUsd: 0 })], 10).restUsd).toBe(0);
    expect(estimateRest([cell(true, { costUsd: 0, unpriced: true })], 10).unpriced).toBe(true);
  });

  it("leaves failed rows out of the average", () => {
    const est = estimateRest([cell(true, { costUsd: 0.002 }), cell(null, { error: "Timed out", costUsd: 0.05 })], 10);
    expect(est.rows).toBe(1);
    expect(est.restUsd).toBeCloseTo(0.02);
  });

  it("prints small costs with a third decimal so a cheap preview isn't shown as free", () => {
    expect(costLabel(0)).toBe("$0.00");
    expect(costLabel(0.0042)).toBe("$0.004");
    expect(costLabel(0.38)).toBe("$0.38");
    expect(durationLabel(42_000)).toBe("about 40s");
    expect(durationLabel(190_000)).toBe("about 3 min");
  });
});
