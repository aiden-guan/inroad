import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "@/lib/store/settings";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { resetGates } from "./gate";
import { resetGithubBudget } from "./github";
import { fetchJSON, fetchText } from "./http";
import { attendeeEpisodes, publicRecords } from "./public-records";

vi.mock("./http", async (actual) => ({ ...(await actual<typeof import("./http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const TODAY = "2026-10-20";
const efts = (q: string) => `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=D&dateRange=custom&startdt=2024-10-20&enddt=${TODAY}`;
const itunes = (term: string, limit: number) => `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcastEpisode&limit=${limit}`;
const FILING = "https://www.sec.gov/Archives/edgar/data/1987654/000198765426000002/0001987654-26-000002-index.htm";

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  return r.requested;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGates();
  resetGithubBudget();
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
});

describe("publicRecords", () => {
  it("finds the company's own Form D and the champion's podcast episodes, as quotable dated sources", async () => {
    serve({
      [efts('"Pavewise"')]: fixture("edgar-search.json"),
      "https://www.sec.gov/Archives/edgar/data/1987654/000198765426000002/primary_doc.xml": fixture("edgar-formd.xml"),
      [itunes("Dana Okafor Pavewise", 10)]: fixture("itunes-podcasts.json"),
      [itunes("Pavewise", 8)]: fixture("itunes-podcasts.json"),
    });
    const r = await publicRecords("pavewise.com", "Pavewise", { people: ["Dana Okafor"], today: TODAY });

    // Other issuers in the same search (Ledgerly, a fund) aren't this company.
    expect(r.filings.map((f) => f.company)).toEqual(["Pavewise Inc."]);
    const filing = r.sources.find((s) => s.sourceType === "filing")!;
    expect(filing).toMatchObject({ url: FILING, publishedAt: "2026-10-02" });
    expect(filing.text).toBe(
      [
        `2026-10-02 · Form D filed by Pavewise Inc. (New York, NY) · ${FILING}`,
        "Total Offering Amount: $18,000,000",
        "Total Amount Sold: $18,000,000",
        "Date of First Sale: 2026-09-18",
        "Industry Group: Other Technology",
        "Year of Incorporation: 2023",
        "Related persons: Dana Okafor (Executive Officer, Director); Priya Raman (Executive Officer)",
      ].join("\n"),
    );
    // The stranger with the same name is left out; the company-title search adds nothing new.
    expect(r.podcasts.map((e) => [e.podcast, e.about])).toEqual([
      ["The Finance Stack", "Dana Okafor"],
      ["Pricing Talks", "Dana Okafor"],
    ]);
    expect(r.sources.filter((s) => s.sourceType === "podcast").map((s) => s.publishedAt)).toEqual(["2026-10-08", "2026-08-12"]);
    expect(r.dated).toEqual([
      `2026-10-02 · SEC filing · Form D, $18M sold · ${FILING}`,
      "2026-10-08 · podcast · Dana Okafor (Pavewise) on rebuilding finance ops after a Series A · https://podcasts.apple.com/us/podcast/dana-okafor-pavewise/id1500000001?i=1000671234567",
      "2026-08-12 · podcast · Usage pricing with Dana Okafor · https://podcasts.apple.com/us/podcast/usage-pricing/id1500000003?i=1000650000001",
    ]);
    // Every source's text appears verbatim in the digest, so a quote from the digest checks out.
    for (const s of r.sources) expect(r.digest).toContain(s.text);
    expect(r.digest).toMatch(/## SEC Form D filings/);
    expect(r.github).toBeNull();
  });

  it("adds the GitHub org the site links to, and drops a guessed org whose site is someone else's", async () => {
    serve({
      "https://api.github.com/users/acmehq": fixture("github-org.json"),
      "https://api.github.com/orgs/acmehq/repos?sort=pushed&per_page=30": fixture("github-repos.json"),
      "https://api.github.com/orgs/acmehq/public_members?per_page=30": fixture("github-members.json"),
    });
    const linked = await publicRecords("acme.dev", "Ac", { github: "acmehq", today: TODAY });
    expect(linked.github?.org).toBe("acmehq");
    expect(linked.sources).toEqual([expect.objectContaining({ url: "https://github.com/acmehq", sourceType: "first_party", text: expect.stringContaining("- acme-sdk: 1240★ · TypeScript · pushed 2026-10-14") })]);

    resetGithubBudget();
    const guessed = await publicRecords("acmehq.com", "Ac", { github: true, today: TODAY });
    expect(guessed.github).toBeNull();
    expect(guessed.digest).toBe("");
  });

  it("skips Form D for a name too short to tell apart, and costs nothing when no person is named", async () => {
    const requested = serve({});
    const r = await publicRecords("ab.io", "Ab", { today: TODAY });
    expect(r).toMatchObject({ filings: [], podcasts: [], github: null, digest: "" });
    expect(requested).toEqual([]);
  });

  it("finds the episodes a call's attendees appeared on, with their company named, never for a first name alone", async () => {
    const requested = serve({ [itunes("Dana Okafor Pavewise", 10)]: fixture("itunes-podcasts.json") });
    const eps = await attendeeEpisodes([{ name: "Dana Okafor" }, { name: "Priya" }], "Pavewise");
    expect(eps).toEqual([
      {
        person: "Dana Okafor",
        date: "2026-10-08",
        url: "https://podcasts.apple.com/us/podcast/dana-okafor-pavewise/id1500000001?i=1000671234567",
        line: "2026-10-08 · podcast · Dana Okafor on The Finance Stack: Dana Okafor (Pavewise) on rebuilding finance ops after a Series A",
      },
      {
        person: "Dana Okafor",
        date: "2026-08-12",
        url: "https://podcasts.apple.com/us/podcast/usage-pricing/id1500000003?i=1000650000001",
        line: "2026-08-12 · podcast · Dana Okafor on Pricing Talks: Usage pricing with Dana Okafor",
      },
    ]);
    expect(requested).toEqual([itunes("Dana Okafor Pavewise", 10)]);
  });
});
