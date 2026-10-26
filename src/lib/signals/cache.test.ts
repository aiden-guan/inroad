import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetInFiles } from "@/lib/people/forget-files";
import { DATA_DIR } from "@/lib/store/settings";
import { makePerson } from "@/test/factories";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { TTL, cached, pruneCache } from "./cache";
import { resetGates } from "./gate";
import { githubOwnerKey } from "./github";
import { fetchJSON, fetchText } from "./http";
import { episodesWith } from "./podcasts";

/**
 * The lookup cache holds public pages, some of them about people (podcast searches by a champion's name,
 * a stargazer's GitHub profile). Its file names never spell out who, nothing outlives the longest TTL,
 * and "Delete their details" takes what was looked up about them.
 */

vi.mock("./http", async (actual) => ({ ...(await actual<typeof import("./http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const CACHE = path.join(DATA_DIR, "cache");
const files = () => (fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter((f) => f.endsWith(".json")) : []);
const itunes = (term: string, limit: number) => `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcastEpisode&limit=${limit}`;

beforeEach(() => {
  vi.clearAllMocks();
  resetGates();
  fs.rmSync(CACHE, { recursive: true, force: true });
  const r = routeFetches({ [itunes("Dana Okafor Pavewise", 10)]: fixture("itunes-podcasts.json") });
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
});

describe("the lookup cache", () => {
  it("names files by the kind of lookup only, never the person", async () => {
    expect((await episodesWith("Dana Okafor", "Pavewise")).length).toBeGreaterThan(0);
    await cached(githubOwnerKey("dana-dev"), TTL.week, async () => ({ login: "dana-dev", name: "Dana Okafor" }));
    expect(files().map((f) => f.replace(/\.[0-9a-f]{16}\.json$/, ""))).toEqual(expect.arrayContaining(["podcasts_v1", "gh_owner"]));
    for (const f of files()) expect(f).not.toMatch(/dana|okafor|pavewise/i);
  });

  it("drops what nothing would read again: older than the longest TTL", async () => {
    await cached("site:v1:old.example", TTL.week, async () => ({ ok: 1 }));
    await cached("site:v1:new.example", TTL.week, async () => ({ ok: 2 }));
    const [oldFile] = files().filter((f) => fs.readFileSync(path.join(CACHE, f), "utf8").includes('"ok":1'));
    const fiveWeeksAgo = (Date.now() - 5 * TTL.week) / 1000;
    fs.utimesSync(path.join(CACHE, oldFile), fiveWeeksAgo, fiveWeeksAgo);
    expect(pruneCache()).toBe(1);
    expect(files()).toHaveLength(1);
    expect(files()).not.toContain(oldFile);
  });

  it("forgets the podcast searches and GitHub profile of someone deleted", async () => {
    await episodesWith("Dana Okafor", "Pavewise");
    await cached(githubOwnerKey("dana-dev"), 4 * TTL.week, async () => ({ login: "dana-dev", name: "Dana Okafor" }));
    await cached(githubOwnerKey("lee-park"), 4 * TTL.week, async () => ({ login: "lee-park", name: "Lee Park" }));
    expect(files()).toHaveLength(3);
    const dana = makePerson("per_dana", "pavewise.com", { name: "Dana Okafor", notes: "Starred acmehq/acme-sdk on GitHub (2026-09-02) · https://github.com/dana-dev" });
    await forgetInFiles({ person: dana, company: "Pavewise", runIds: [] });
    expect(files()).toHaveLength(1);
    expect(fs.readFileSync(path.join(CACHE, files()[0]), "utf8")).toContain("lee-park");
  });
});
