import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR, writeSettings } from "@/lib/store/settings";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { resetGates } from "./gate";
import { githubBudget, githubOrg, githubPerson, githubRepoActivity, githubSearchIssues, githubStargazers, orgLine, resetGithubBudget } from "./github";
import { fetchJSON, fetchText } from "./http";

vi.mock("./http", async (actual) => ({ ...(await actual<typeof import("./http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const API = "https://api.github.com";
const user = (login: string, extra: Record<string, unknown> = {}) => JSON.stringify({ login, html_url: `https://github.com/${login}`, type: "User", ...extra });

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  return r.requested;
}

const ORG_ROUTES = {
  [`${API}/users/acmehq`]: fixture("github-org.json"),
  [`${API}/orgs/acmehq/repos?sort=pushed&per_page=30`]: fixture("github-repos.json"),
  [`${API}/orgs/acmehq/public_members?per_page=30`]: fixture("github-members.json"),
};

const STAR_ROUTES = {
  [`${API}/repos/acmehq/acme-sdk`]: JSON.stringify({ full_name: "acmehq/acme-sdk", stargazers_count: 3 }),
  [`${API}/repos/acmehq/acme-sdk/stargazers?per_page=100&page=1`]: fixture("github-stargazers.json"),
  // Works at an org whose site is pavewise.com; her own blog is a personal site.
  [`${API}/users/dana-dev`]: user("dana-dev", { name: "Dana Okafor", company: "@pavewise", blog: "https://dana.dev", location: "New York" }),
  [`${API}/users/pavewise`]: JSON.stringify({ login: "pavewise", type: "Organization", blog: "https://pavewise.com" }),
  // A company name and a site that matches it.
  [`${API}/users/lee-ledgerly`]: user("lee-ledgerly", { name: "Lee Park", company: "Ledgerly", blog: "ledgerly.io" }),
  // Nothing to go on but a github.io page.
  [`${API}/users/samtinkers`]: user("samtinkers", { blog: "https://samtinkers.github.io" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetGates();
  resetGithubBudget();
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
});
afterEach(() => writeSettings({ githubToken: undefined }));

describe("githubOrg", () => {
  it("lists live public repos by stars, members and the org's site", async () => {
    serve(ORG_ROUTES);
    const org = await githubOrg("acmehq");
    expect(org).toMatchObject({ org: "acmehq", name: "Acme", domain: "acme.dev", rateLimited: false });
    expect(org!.repos.map((r) => [r.name, r.stars, r.language])).toEqual([
      ["acme-sdk", 1240, "TypeScript"],
      ["acme-cli", 320, "Go"],
    ]);
    expect(org!.publicMembers).toEqual([
      { login: "jo-acme", url: "https://github.com/jo-acme" },
      { login: "sam-acme", url: "https://github.com/sam-acme" },
    ]);
    expect(orgLine(org!)).toBe("GitHub acmehq: 2 public repos · top: acme-sdk (1.2k★, TypeScript) · pushed 2026-10-14");
  });

  it("sends GitHub's headers, and the token only when the founder saved one", async () => {
    serve(ORG_ROUTES);
    await githubOrg("acmehq");
    const opts = vi.mocked(fetchText).mock.calls[0][1]!;
    expect(opts.headers).toMatchObject({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": expect.stringMatching(/^Inroad\//) });
    expect(opts.headers).not.toHaveProperty("Authorization");
    expect(opts).toMatchObject({ allowErrors: true, responseHeaders: ["x-ratelimit-remaining", "x-ratelimit-reset"] });

    fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
    writeSettings({ githubToken: "github_pat_test" });
    await githubOrg("acmehq");
    expect(vi.mocked(fetchText).mock.calls.at(-1)![1]!.headers).toMatchObject({ Authorization: "Bearer github_pat_test" });
  });

  it("refuses names GitHub doesn't allow, and is null for an unknown org", async () => {
    serve({});
    expect(await githubOrg("../etc")).toBeNull();
    expect(await githubOrg("nobody-here")).toBeNull();
    expect(fetchText).toHaveBeenCalledTimes(1);
  });
});

describe("githubStargazers", () => {
  it("reads the newest stars with each profile's company domain, and never a personal site", async () => {
    serve(STAR_ROUTES);
    const r = await githubStargazers("https://github.com/acmehq/acme-sdk");
    expect(r).toMatchObject({ repo: "acmehq/acme-sdk", total: 3, rateLimited: false });
    expect(r!.stargazers.map((s) => [s.login, s.company, s.domain, s.domainBasis])).toEqual([
      ["samtinkers", undefined, undefined, undefined],
      ["lee-ledgerly", "Ledgerly", "ledgerly.io", "company_site"],
      ["dana-dev", "pavewise", "pavewise.com", "company_org"],
    ]);
    expect(r!.stargazers[2]).toMatchObject({ name: "Dana Okafor", location: "New York", starredAt: "2026-09-02T10:00:00Z", url: "https://github.com/dana-dev" });
  });

  it("stops at the rate limit and says so, keeping the logins it already has", async () => {
    serve({
      ...STAR_ROUTES,
      [`${API}/users/lee-ledgerly`]: { body: '{"message":"API rate limit exceeded for 203.0.113.9."}', status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1800) } },
    });
    const r = await githubStargazers("acmehq/acme-sdk");
    expect(r!.rateLimited).toBe(true);
    expect(r!.stargazers.map((s) => [s.login, s.company ?? null])).toEqual([
      ["samtinkers", null],
      ["lee-ledgerly", null],
      ["dana-dev", null],
    ]);
    // Once the budget is gone, nothing else goes out until it resets.
    const before = vi.mocked(fetchText).mock.calls.length;
    expect(await githubOrg("acmehq")).toMatchObject({ rateLimited: true, repos: [] });
    expect(vi.mocked(fetchText).mock.calls.length).toBe(before);
  });

  it("is null for something that isn't owner/name", async () => {
    serve({});
    expect(await githubStargazers("just-a-name")).toBeNull();
    expect(fetchText).not.toHaveBeenCalled();
  });
});

describe("since GitHub restricted stargazer lists (July 2026)", () => {
  it("says the list is restricted instead of pretending the repo doesn't exist", async () => {
    serve({
      [`${API}/repos/acmehq/acme-sdk`]: JSON.stringify({ full_name: "acmehq/acme-sdk", stargazers_count: 3 }),
      [`${API}/repos/acmehq/acme-sdk/stargazers?per_page=100&page=1`]: { body: '{"message":"Requires authentication"}', status: 401 },
    });
    expect(await githubStargazers("acmehq/acme-sdk")).toMatchObject({ repo: "acmehq/acme-sdk", stargazers: [], restricted: true, rateLimited: false });
  });
});

describe("developer radar lookups", () => {
  it("places a profile from an @org after a role, and an organization from its own site", async () => {
    serve({
      [`${API}/users/dev-m`]: user("dev-m", { name: "Dev M", company: "Backend Engineer @lumen" }),
      [`${API}/users/lumen`]: JSON.stringify({ login: "lumen", type: "Organization", blog: "lumen.example" }),
      [`${API}/users/hollowpine`]: JSON.stringify({ login: "hollowpine", type: "Organization", blog: "https://hollowpine.example" }),
    });
    expect(await githubPerson("dev-m")).toMatchObject({ login: "dev-m", company: "Backend Engineer @lumen", domain: "lumen.example", domainBasis: "company_org" });
    expect(await githubPerson("hollowpine")).toMatchObject({ type: "Organization", domain: "hollowpine.example", domainBasis: "company_org" });
    expect((await githubPerson("dev-m"))!.cached).toBe(true);
  });

  it("keeps the search budget apart from the hourly one, and caches a repo's activity for an hour", async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 60);
    const requested = serve({
      [`${API}/search/issues?q=${encodeURIComponent("Meterbook usage is:issue")}&sort=created&order=desc&per_page=20`]: { body: '{"items":[]}', headers: { "x-ratelimit-remaining": "1", "x-ratelimit-reset": reset } },
      [`${API}/repos/a/b/forks?sort=newest&per_page=100`]: "[]",
      [`${API}/repos/a/b/issues?state=all&sort=created&direction=desc&per_page=100`]: "[]",
      [`${API}/repos/a/b/issues/comments?sort=created&direction=desc&per_page=100&since=${encodeURIComponent("2026-10-06T00:00:00.000Z")}`]: "[]",
      [`${API}/repos/a/b/stargazers/history`]: '[{"week":1793000000,"total":4,"days":[1,1,1,1,0,0,0]}]',
    });
    expect(await githubSearchIssues("Meterbook usage is:issue")).toMatchObject({ rateLimited: false, cached: false });
    expect(githubBudget("search").remaining).toBe(1);
    expect(githubBudget("core").remaining).toBeUndefined();
    // One search left is the reserve: the next one waits for the minute to reset.
    expect(await githubSearchIssues("Closewise usage is:issue")).toMatchObject({ rateLimited: true });
    const first = await githubRepoActivity("a/b", "2026-10-06T00:00:00.000Z");
    expect(first).toMatchObject({ requests: 4, rateLimited: false, forks: [], issues: [] });
    const again = await githubRepoActivity("a/b", "2026-10-06T00:00:00.000Z");
    expect(again.requests).toBe(0);
    expect(requested.filter((u) => u.includes("/repos/a/b/"))).toHaveLength(4);
  });
});

