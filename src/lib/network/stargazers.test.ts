import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetGates } from "@/lib/signals/gate";
import { resetGithubBudget } from "@/lib/signals/github";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { DATA_DIR } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeAccount, makeWorkspace } from "@/test/factories";
import { routeFetches } from "@/test/http-fixtures";
import { undoImport } from "./import";
import { importStargazers } from "./stargazers";
import { readNetwork } from "./store";

vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const API = "https://api.github.com";
const user = (login: string, extra: Record<string, unknown> = {}) => JSON.stringify({ login, html_url: `https://github.com/${login}`, type: "User", ...extra });
const star = (login: string, at: string) => ({ starred_at: at, user: { login, html_url: `https://github.com/${login}` } });

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
}

const ROUTES = {
  [`${API}/repos/acmehq/acme-sdk`]: JSON.stringify({ full_name: "acmehq/acme-sdk", stargazers_count: 5 }),
  [`${API}/repos/acmehq/acme-sdk/stargazers?per_page=100&page=1`]: JSON.stringify([
    star("dana-dev", "2026-09-02T10:00:00Z"),
    star("lee-ledgerly", "2026-09-20T10:00:00Z"),
    star("samtinkers", "2026-10-01T10:00:00Z"),
    star("mo-northwind", "2026-10-05T10:00:00Z"),
    star("founder", "2026-10-06T10:00:00Z"),
  ]),
  [`${API}/users/dana-dev`]: user("dana-dev", { name: "Dana Okafor", company: "@pavewise", blog: "https://dana.dev", location: "New York" }),
  [`${API}/users/pavewise`]: JSON.stringify({ login: "pavewise", type: "Organization", blog: "https://pavewise.com" }),
  [`${API}/users/lee-ledgerly`]: user("lee-ledgerly", { name: "Lee Park", company: "Ledgerly", blog: "ledgerly.io" }),
  [`${API}/users/samtinkers`]: user("samtinkers", { blog: "https://samtinkers.github.io" }),
  // No site, but the company is one the founder already tracks.
  [`${API}/users/mo-northwind`]: user("mo-northwind", { name: "Mo Ade", company: "Northwind" }),
  // The founder's own team starring their repo is not a lead.
  [`${API}/users/founder`]: user("founder", { name: "Founder", company: "Acme", blog: "https://acme.dev" }),
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetGates();
  resetGithubBudget();
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
  await replaceWorkspace(
    makeWorkspace({
      company: { name: "Acme", domain: "acme.dev" } as never,
      accounts: { "northwind.io": makeAccount("northwind.io", { name: "Northwind", status: "new" }) },
    }),
  );
});

describe("importing a repo's stargazers", () => {
  it("places each stargazer at the company their profile names, and skips the ones it can't place", async () => {
    serve(ROUTES);
    const b = await importStargazers({ repo: "https://github.com/acmehq/acme-sdk" });
    expect(b).toMatchObject({ kind: "github", fileName: "acmehq/acme-sdk", rows: 5, skipped: 2 });
    expect(b.github).toEqual({ repo: "acmehq/acme-sdk", total: 5, read: 5, matched: 3, rateLimited: false, withToken: false });
    expect(b.counts).toEqual({ accountsCreated: 2, accountsUpdated: 1, peopleCreated: 3, peopleUpdated: 0 });

    const ws = readWorkspace();
    expect(ws.accounts["pavewise.com"]).toMatchObject({ source: "stargazers", sourceDetail: "Starred acmehq/acme-sdk on GitHub", tags: ["stargazer"], status: "new" });
    expect(ws.accounts["ledgerly.io"].name).toBe("Ledgerly");
    expect(ws.accounts["northwind.io"].tags).toContain("stargazer");
    const dana = Object.values(ws.people).find((p) => p.name === "Dana Okafor")!;
    expect(dana).toMatchObject({ accountDomain: "pavewise.com", source: "stargazers", location: "New York", notes: "Starred acmehq/acme-sdk on GitHub (2026-09-02) · https://github.com/dana-dev" });
    expect(Object.values(ws.people).map((p) => p.accountDomain).sort()).toEqual(["ledgerly.io", "northwind.io", "pavewise.com"]);
    expect(readNetwork().imports[0].id).toBe(b.id);
  });

  it("can be undone like a list import", async () => {
    serve(ROUTES);
    const b = await importStargazers({ repo: "acmehq/acme-sdk" });
    const { message } = await undoImport(b.id);
    expect(message).toBe("Removed 2 companies and 3 people.");
    const ws = readWorkspace();
    expect(Object.keys(ws.accounts)).toEqual(["northwind.io"]);
    expect(ws.accounts["northwind.io"].tags ?? []).not.toContain("stargazer");
  });

  it("says so plainly when the repo doesn't exist or GitHub's hourly limit is used up", async () => {
    serve({});
    await expect(importStargazers({ repo: "acmehq/nope" })).rejects.toThrow(/couldn't find that repository/);
    serve({
      [`${API}/repos/acmehq/acme-sdk`]: { body: '{"message":"API rate limit exceeded"}', status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) } },
    });
    await expect(importStargazers({ repo: "acmehq/acme-sdk" })).rejects.toThrow(/hourly limit is used up.*add a GitHub token in Settings/);
  });
});
