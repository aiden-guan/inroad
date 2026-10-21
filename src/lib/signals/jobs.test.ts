import { describe, expect, it, vi } from "vitest";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { fetchJSON, fetchText } from "./http";
import { findOpenRoles, summarizeRoles, type JobPosting } from "./jobs";

vi.mock("./http", () => ({ fetchText: vi.fn(), fetchJSON: vi.fn() }));

const GREENHOUSE = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
const LEVER = "https://api.lever.co/v0/postings/acme-labs?mode=json";
const ASHBY = "https://api.ashbyhq.com/posting-api/job-board/saltmarsh";
const WORKABLE = "https://www.workable.com/api/accounts/acme?details=false";

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  return r.requested;
}

describe("findOpenRoles from a known board", () => {
  it("maps Greenhouse jobs, newest first", async () => {
    serve({ [GREENHOUSE]: fixture("greenhouse-jobs.json") });
    const { jobs, source } = await findOpenRoles([{ provider: "greenhouse", token: "acme" }], "acme.com");
    expect(source).toEqual({ provider: "greenhouse", token: "acme" });
    expect(jobs.map((j) => j.title)).toEqual(["Founding Finance Lead", "Senior Billing Engineer", "Senior Billing Engineer", "Office Manager"]);
    expect(jobs[0]).toEqual({ title: "Founding Finance Lead", team: "Finance", location: "Remote (US)", url: "https://boards.greenhouse.io/acme/jobs/7301002", postedAt: "2026-10-18T09:30:00-04:00" });
    expect(jobs[3].team).toBeUndefined();
  });

  it("maps Lever postings, with epoch dates and the department as a fallback team", async () => {
    serve({ [LEVER]: fixture("lever-postings.json") });
    const { jobs } = await findOpenRoles([{ provider: "lever", token: "acme-labs" }], "acme.com");
    expect(jobs).toEqual([
      { title: "Revenue Operations Analyst", team: "Finance", location: "New York", url: "https://jobs.lever.co/acme-labs/5c0e7b1a", postedAt: "2026-10-17T12:00:00.000Z" },
      { title: "Solutions Engineer", team: "Go to market", location: "Remote", url: "https://jobs.lever.co/acme-labs/7d1f8c2b", postedAt: "2026-09-17T12:00:00.000Z" },
    ]);
  });

  it("maps Ashby jobs and drops unlisted ones", async () => {
    serve({ [ASHBY]: fixture("ashby-board.json") });
    const { jobs } = await findOpenRoles([{ provider: "ashby", token: "saltmarsh" }], "saltmarsh.com");
    expect(jobs.map((j) => [j.title, j.team])).toEqual([
      ["Head of Finance Operations", "Finance"],
      ["Platform Engineer", "Infrastructure"],
    ]);
  });

  it("maps Workable jobs, joining city and country", async () => {
    serve({ [WORKABLE]: fixture("workable-account.json") });
    const { jobs } = await findOpenRoles([{ provider: "workable", token: "acme" }], "acme.com");
    expect(jobs.map((j) => j.location)).toEqual(["Lisbon, Portugal", undefined]);
  });

  it("moves on to the next board when one is empty", async () => {
    serve({ [GREENHOUSE]: JSON.stringify({ jobs: [] }), [LEVER]: fixture("lever-postings.json") });
    const r = await findOpenRoles(
      [
        { provider: "greenhouse", token: "acme" },
        { provider: "lever", token: "acme-labs" },
      ],
      "acme.com",
    );
    expect(r.source).toEqual({ provider: "lever", token: "acme-labs" });
  });

  it("keeps the 60 newest roles", async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ title: `Role ${i}`, updated_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:${String(i).padStart(2, "0")}Z` }));
    serve({ [GREENHOUSE]: JSON.stringify({ jobs: many }) });
    const { jobs } = await findOpenRoles([{ provider: "greenhouse", token: "acme" }], "acme.com");
    expect(jobs).toHaveLength(60);
    expect(jobs.map((j) => j.postedAt)).toEqual([...jobs.map((j) => j.postedAt)].sort().reverse());
  });

  it("never looks up reserved domains", async () => {
    const requested = serve({});
    expect(await findOpenRoles([{ provider: "greenhouse", token: "acme" }], "acme.example")).toEqual({ jobs: [] });
    expect(requested).toEqual([]);
  });
});

describe("findOpenRoles by guessing the board", () => {
  it("guesses from the domain and keeps a board whose owner is the company", async () => {
    const requested = serve({ [ASHBY]: fixture("ashby-board.json"), "https://jobs.ashbyhq.com/saltmarsh": "<html><title>Saltmarsh Compute Jobs</title></html>" });
    const r = await findOpenRoles([], "saltmarsh.com");
    expect(r.source).toEqual({ provider: "ashby", token: "saltmarsh" });
    expect(r.jobs).toHaveLength(2);
    expect(requested).toEqual([ASHBY, "https://jobs.ashbyhq.com/saltmarsh"]);
  });

  it("drops another company's board that happens to share the slug", async () => {
    serve({ [ASHBY]: fixture("ashby-board.json"), "https://jobs.ashbyhq.com/saltmarsh": "<html><title>Brine Kitchen Careers</title></html>" });
    expect(await findOpenRoles([], "saltmarsh.com")).toEqual({ jobs: [] });
  });

  it("verifies Greenhouse ownership through the board API when the boards themselves are guesses", async () => {
    serve({ [GREENHOUSE]: fixture("greenhouse-jobs.json"), "https://boards-api.greenhouse.io/v1/boards/acme": fixture("greenhouse-board.json") });
    const r = await findOpenRoles([{ provider: "greenhouse", token: "acme" }], "acme.com", { guessed: true });
    expect(r.source).toEqual({ provider: "greenhouse", token: "acme" });
    expect(await findOpenRoles([{ provider: "greenhouse", token: "acme" }], "other.com", { guessed: true, name: "Other Co" })).toEqual({ jobs: [] });
  });
});

describe("summarizeRoles", () => {
  it("groups roles by team, biggest team first, unique titles", () => {
    const jobs: JobPosting[] = [
      { title: "Billing Engineer", team: "Engineering" },
      { title: "Billing Engineer", team: "Engineering" },
      { title: "Platform Engineer", team: "Engineering" },
      { title: "Controller", team: "Finance" },
      { title: "Office Manager" },
    ];
    expect(summarizeRoles(jobs)).toBe("Engineering (3): Billing Engineer; Platform Engineer\nFinance (1): Controller\nOther (1): Office Manager");
    expect(summarizeRoles([])).toBe("No public job board found.");
  });
});
