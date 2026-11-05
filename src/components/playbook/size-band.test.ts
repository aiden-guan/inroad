import { describe, expect, it } from "vitest";
import type { ICP } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { betSizeBand, playbookMarkdown, priceBand } from "./model";

/** The size the bet states shows as the Company size value (marked "from the bet") instead of "Not set". */

const icp = (patch: Partial<Pick<ICP, "primarySegment" | "criteria">> & { group?: string; sentence?: string } = {}): Pick<ICP, "criteria" | "primarySegment" | "hypothesis"> => ({
  criteria: patch.criteria ?? [],
  primarySegment: patch.primarySegment ?? "",
  hypothesis: { companyGroup: patch.group ?? "", role: "", obstacle: "", cause: "", improvement: "", sentence: patch.sentence ?? "" },
});

const criterion = (text: string): ICP["criteria"][number] => ({ id: text, text, kind: "firmographic", mustHave: true, detection: "site", status: "hypothesis" });

describe("betSizeBand", () => {
  it("reads the range the bet states, in any of its places", () => {
    expect(betSizeBand(icp({ group: "Usage-priced B2B software companies with 50–300 people" }))).toBe("50_300");
    expect(betSizeBand(icp({ criteria: [criterion("Under 50 employees")] }))).toBe("lt50");
    expect(betSizeBand(icp({ primarySegment: "Fintechs with 1,000+ staff" }))).toBe("gt300");
    expect(betSizeBand(icp({ sentence: "Companies with 10 to 40 people where the founder still runs payroll" }))).toBe("lt50");
  });

  it("picks nothing when the bet is silent, spans two bands, or disagrees with itself", () => {
    expect(betSizeBand(icp({ group: "Usage-priced API companies" }))).toBeNull();
    expect(betSizeBand(icp({ group: "Companies with 20–200 employees" }))).toBeNull();
    expect(betSizeBand(icp({ group: "Teams of 50–300 people", criteria: [criterion("300+ employees")] }))).toBeNull();
    // Numbers that aren't headcount don't count.
    expect(betSizeBand(icp({ group: "Companies billing 50–300 GB a month" }))).toBeNull();
  });
});

describe("priceBand", () => {
  it("uses the bet's size until the founder sets one, and says so", () => {
    const ws = sampleWorkspace(NOW);
    expect(ws.foundation!.icp.employeeBand).toBeUndefined();
    expect(priceBand(ws)).toEqual({ band: "50_300", assumed: false, fromBet: true });
    expect(playbookMarkdown(ws, "2026-10-20")).toContain("Company size: 50–300 employees (from the segment bet)");

    ws.foundation!.icp.employeeBand = "gt300";
    expect(priceBand(ws)).toEqual({ band: "gt300", assumed: false, fromBet: false });

    ws.foundation!.icp.employeeBand = "mixed";
    ws.foundation!.icp.hypothesis.companyGroup = "Usage-priced software companies";
    ws.foundation!.icp.hypothesis.sentence = "Usage-priced software companies where the controller ties usage to invoices.";
    ws.foundation!.icp.primarySegment = "Usage-priced infrastructure companies";
    ws.foundation!.icp.criteria = ws.foundation!.icp.criteria.filter((c) => !/employees/.test(c.text));
    expect(priceBand(ws)).toEqual({ band: "50_300", assumed: true, fromBet: false });
  });
});
