import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "@/lib/store/settings";
import * as mediaRegistry from "./campaign-media";
import {
  campaignPoster,
  campaignVideoAvailability,
  resetCampaignMediaChecks,
} from "./campaign-media-cache";

// Small binary headers are sufficient to exercise the boundary; no publisher is contacted by tests.
function png(width = 640, height = 360) {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const imageResponse = (width = 640, height = 360) =>
  new Response(png(width, height), {
    headers: { "Content-Type": "image/png" },
  });
let fetchMock: ReturnType<typeof vi.fn>;
const registeredMedia = mediaRegistry.campaignMedia;
beforeEach(() => {
  vi.restoreAllMocks();
  // Keep exercising the publisher/cache path independently of the shipped previews.
  vi.spyOn(mediaRegistry, "campaignMedia").mockImplementation((id) =>
    registeredMedia(id).map((item) => ({ ...item, preview: undefined })),
  );
  fs.rmSync(path.join(DATA_DIR, "cache", "campaign-media"), {
    recursive: true,
    force: true,
  });
  resetCampaignMediaChecks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("campaign media availability", () => {
  it("serves every bundled preview on a first launch without a network or existing cache", async () => {
    vi.mocked(mediaRegistry.campaignMedia).mockRestore();
    fetchMock.mockRejectedValue(new Error("Offline"));
    for (const [id, items] of Object.entries(mediaRegistry.CAMPAIGN_MEDIA)) {
      for (let index = 0; index < items.length; index++) {
        const poster = await campaignPoster(id, index);
        expect(poster?.mime, `${id}[${index}]`).toBe("image/webp");
        expect(poster!.bytes.length).toBeGreaterThan(1000);
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("can recover from a missing bundled file using the validated publisher path", async () => {
    vi.mocked(mediaRegistry.campaignMedia).mockImplementation((id) =>
      registeredMedia(id).map((item) => ({
        ...item,
        preview: "/campaign-library/missing-test-preview.webp",
      })),
    );
    fetchMock.mockResolvedValueOnce(imageResponse());
    expect((await campaignPoster("spotify-wrapped", 0))?.bytes).toEqual(png());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("only fetches a curated asset, never an arbitrary URL or archived clip", async () => {
    expect(await campaignPoster("https://example.com/attack", 0)).toBeNull();
    expect(await campaignPoster("cider-shorts", 0)).toBeNull();
    expect(await campaignPoster("spotify-wrapped", 200)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects an HTTP-200 unavailable-video placeholder and HTML disguised as an image", async () => {
    fetchMock.mockResolvedValueOnce(imageResponse(120, 90));
    expect(await campaignPoster("wispr-old-way", 0)).toBeNull();
    fetchMock.mockResolvedValueOnce(
      new Response("<html>not a picture</html>", {
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    expect(await campaignPoster("ramp-time-money", 0)).toBeNull();
  });
  it("keeps a valid original locally and serves it when the publisher later fails", async () => {
    fetchMock.mockResolvedValueOnce(imageResponse());
    const first = await campaignPoster("spotify-wrapped", 0);
    expect(first?.mime).toBe("image/png");
    expect(first?.bytes).toEqual(png());
    const dir = path.join(DATA_DIR, "cache", "campaign-media");
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    if (process.platform !== "win32")
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    fs.utimesSync(file, old, old);
    resetCampaignMediaChecks();
    fetchMock.mockRejectedValueOnce(new Error("Publisher offline"));
    expect((await campaignPoster("spotify-wrapped", 0))?.bytes).toEqual(
      first?.bytes,
    );
  });
  it("refuses oversized publisher responses before caching", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(png(), {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(9 * 1024 * 1024),
        },
      }),
    );
    expect(await campaignPoster("spotify-wrapped", 0)).toBeNull();
    expect(fs.existsSync(path.join(DATA_DIR, "cache", "campaign-media"))).toBe(
      false,
    );
  });
  it("does not offer private videos as playable and distinguishes an outage from removal", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await campaignVideoAvailability("wispr-old-way", 0)).toBe(
      "unavailable",
    );
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    expect(await campaignVideoAvailability("ramp-time-money", 0)).toBe(
      "unknown",
    );
    expect(await campaignVideoAvailability("spotify-wrapped", 0)).toBe(
      "unavailable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("requires valid public video metadata and briefly caches availability", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        type: "video",
        title: "Official campaign",
        provider_name: "YouTube",
      }),
    );
    expect(await campaignVideoAvailability("wispr-old-way", 0)).toBe(
      "available",
    );
    expect(await campaignVideoAvailability("wispr-old-way", 0)).toBe(
      "available",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://www.youtube.com/oembed",
    );
    fetchMock.mockResolvedValueOnce(new Response("login required"));
    expect(await campaignVideoAvailability("ramp-time-money", 0)).toBe(
      "unknown",
    );
  });
});
