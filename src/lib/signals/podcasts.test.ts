import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "@/lib/store/settings";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { resetGates } from "./gate";
import { fetchJSON, fetchText } from "./http";
import { episodesWith, podcastSearch } from "./podcasts";

vi.mock("./http", async (actual) => ({ ...(await actual<typeof import("./http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const itunes = (term: string, limit: number) => `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcastEpisode&limit=${limit}`;

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
afterEach(() => vi.useRealTimers());

describe("podcastSearch", () => {
  it("maps iTunes episodes", async () => {
    serve({ [itunes("Dana Okafor", 8)]: fixture("itunes-podcasts.json") });
    const eps = await podcastSearch("Dana Okafor");
    expect(eps[0]).toEqual({
      title: "Dana Okafor (Pavewise) on rebuilding finance ops after a Series A",
      podcast: "The Finance Stack",
      releaseDate: "2026-10-08T07:00:00Z",
      url: "https://podcasts.apple.com/us/podcast/dana-okafor-pavewise/id1500000001?i=1000671234567",
      description: "Dana Okafor, CEO of Pavewise, on why the first finance hire inherits a spreadsheet, and what they changed after raising.",
    });
    expect(eps).toHaveLength(3);
  });

  it("spaces calls about three seconds apart (iTunes allows about 20 a minute)", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 20, 9, 0) });
    serve({});
    const a = podcastSearch("first term");
    const b = podcastSearch("second term");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchJSON).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([a, b]);
    expect(fetchJSON).toHaveBeenCalledTimes(2);
  });
});

describe("episodesWith", () => {
  it("keeps episodes that name the person and their company, newest first", async () => {
    serve({ [itunes("Dana Okafor Pavewise", 10)]: fixture("itunes-podcasts.json") });
    const eps = await episodesWith("Dana Okafor", "Pavewise");
    expect(eps.map((e) => e.podcast)).toEqual(["The Finance Stack", "Pricing Talks"]);
  });

  it("needs a full name, so a first name alone never matches strangers", async () => {
    serve({});
    expect(await episodesWith("Dana")).toEqual([]);
    expect(fetchJSON).not.toHaveBeenCalled();
  });
});
