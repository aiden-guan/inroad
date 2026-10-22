import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR, writeSettings } from "@/lib/store/settings";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { formDDetail, formDIndustries, formDSearch, issuerName, parseFormD, shortUsd, statesIn } from "./edgar";
import { resetGates } from "./gate";
import { fetchJSON, fetchText } from "./http";

vi.mock("./http", () => ({ fetchText: vi.fn(), fetchJSON: vi.fn(), API_UA: "Inroad/test" }));

const TODAY = "2026-10-20";
const search = (q: string, start: string) => `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=D&dateRange=custom&startdt=${start}&enddt=${TODAY}`;
const DOC = "https://www.sec.gov/Archives/edgar/data/1987654/000198765426000002/primary_doc.xml";

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  return r.requested;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGates();
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
});
afterEach(() => {
  vi.useRealTimers();
  writeSettings({ secContact: undefined });
});

describe("formDSearch", () => {
  it("lists recent Form D notices newest first, one per company, with the filing's index page", async () => {
    serve({ [search('"Other Technology"', "2026-07-22")]: fixture("edgar-search.json") });
    const filings = await formDSearch({ query: '"Other Technology"', sinceDays: 90, today: TODAY });
    expect(filings.map((f) => [f.company, f.filedAt, f.isAmendment])).toEqual([
      ["Northgate Opportunity Fund II, L.P.", "2026-10-12", false],
      ["Pavewise Inc.", "2026-10-02", false],
      ["Ledgerly Technologies, Inc.", "2026-09-24", false],
    ]);
    expect(filings[1]).toMatchObject({
      cik: "1987654",
      accession: "0001987654-26-000002",
      url: "https://www.sec.gov/Archives/edgar/data/1987654/000198765426000002/0001987654-26-000002-index.htm",
      states: ["NY"],
      location: "New York, NY",
    });
  });

  it("filters by business state and caps the list", async () => {
    serve({ [search('"Other Technology"', "2026-07-22")]: fixture("edgar-search.json") });
    expect((await formDSearch({ query: '"Other Technology"', sinceDays: 90, states: ["ny"], today: TODAY })).map((f) => f.company)).toEqual(["Pavewise Inc."]);
    expect(await formDSearch({ query: '"Other Technology"', sinceDays: 90, limit: 1, today: TODAY })).toHaveLength(1);
  });

  it("names a contact in the User-Agent when the founder gave one, and is empty when EDGAR is down", async () => {
    writeSettings({ secContact: "founder@acme.com" });
    serve({});
    expect(await formDSearch({ query: "Acme", sinceDays: 30, today: TODAY })).toEqual([]);
    expect(vi.mocked(fetchJSON).mock.calls[0][2]).toEqual({ headers: { "User-Agent": "Inroad local research founder@acme.com" } });
  });

  it("spaces requests to stay under the SEC's ten a second", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 20, 9, 0) });
    serve({});
    const a = formDSearch({ query: "One", sinceDays: 30, today: TODAY });
    const b = formDSearch({ query: "Two", sinceDays: 30, today: TODAY });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(130);
    await Promise.all([a, b]);
    expect(fetchJSON).toHaveBeenCalledTimes(2);
  });
});

describe("Form D documents", () => {
  it("reads the industry, amounts, first sale, year of incorporation and related persons", () => {
    expect(parseFormD(fixture("edgar-formd.xml"))).toEqual({
      entityName: "Pavewise Inc.",
      industry: "Other Technology",
      totalOfferingUsd: 18_000_000,
      amountSoldUsd: 18_000_000,
      firstSaleOn: "2026-09-18",
      yearOfInc: 2023,
      isAmendment: false,
      relatedPersons: [
        { name: "Dana Okafor", relationship: "Executive Officer, Director" },
        { name: "Priya Raman", relationship: "Executive Officer" },
      ],
    });
  });

  it("leaves an indefinite offering amount out", () => {
    const fund = parseFormD(fixture("edgar-formd-fund.xml"));
    expect(fund.industry).toBe("Pooled Investment Fund");
    expect(fund.totalOfferingUsd).toBeUndefined();
    expect(fund.amountSoldUsd).toBe(40_000_000);
    expect(fund.firstSaleOn).toBeUndefined();
  });

  it("fills a filing in from its primary document, and keeps the index entry when the document can't be read", async () => {
    serve({ [DOC]: fixture("edgar-formd.xml") });
    const base = { company: "Pavewise Inc.", cik: "1987654", accession: "0001987654-26-000002", filedAt: "2026-10-02", url: "x", states: ["NY"], isAmendment: false, relatedPersons: [] };
    const full = await formDDetail(base);
    expect(full).toMatchObject({ industry: "Other Technology", amountSoldUsd: 18_000_000, relatedPersons: [{ name: "Dana Okafor" }, { name: "Priya Raman" }] });
    expect(await formDDetail({ ...base, accession: "0001987654-26-000009" })).toEqual({ ...base, accession: "0001987654-26-000009" });
  });
});

describe("helpers", () => {
  it("cleans issuer display names", () => {
    expect(issuerName("Pavewise Inc.  (CIK 0001987654)")).toBe("Pavewise Inc.");
    expect(issuerName("Big Co Holdings (BIGC)  (CIK 0000012345)")).toBe("Big Co Holdings");
  });

  it("maps an ICP to Form D industry groups, technology last", () => {
    expect(formDIndustries("Regional banks and credit unions with 50-500 employees")).toEqual(["Commercial Banking", "Other Banking & Financial Services"]);
    expect(formDIndustries("Outpatient clinics that run their own scheduling software")).toEqual(["Hospitals & Physicians", "Other Technology"]);
    expect(formDIndustries("Series A developer-tool startups")).toEqual(["Other Technology"]);
  });

  it("reads US states and cities from a brief", () => {
    expect(statesIn("only NYC and Boston")).toEqual(["NY", "MA"]);
    expect(statesIn("Texas or California banks").sort()).toEqual(["CA", "TX"]);
    expect(statesIn("anywhere in Europe")).toEqual([]);
  });

  it("writes amounts the way people say them", () => {
    expect([18_000_000, 1_500_000, 750_000, 2_000_000_000, undefined].map(shortUsd)).toEqual(["$18M", "$1.5M", "$750K", "$2B", null]);
  });
});
