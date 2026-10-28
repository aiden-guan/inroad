import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { campaignById, campaignContext } from "./campaigns";
import {
  CAMPAIGN_MEDIA,
  campaignMedia,
  mediaOriginal,
  mediaPoster,
} from "./campaign-media";
import { campaignImageInfo } from "./campaign-media-cache";

describe("campaign creative sources", () => {
  it("ships the reviewed full-frame previews and their provenance in sync", () => {
    const manifest = JSON.parse(
      fs.readFileSync("docs/research/campaign-media-manifest.json", "utf8"),
    );
    expect(manifest.assets).toHaveLength(
      Object.values(CAMPAIGN_MEDIA).flat().length,
    );
    for (const asset of manifest.assets) {
      const media = campaignMedia(asset.campaign)[asset.index];
      expect(media.preview).toBe(asset.preview);
      expect(mediaPoster(media)).toBe(asset.original);
      expect(media.sourceUrl).toBe(asset.source);
      expect(media.credit).toBe(asset.credit);
      const bytes = fs.readFileSync(path.join("public", asset.preview));
      expect(campaignImageInfo(bytes)).toEqual({
        mime: "image/webp",
        width: asset.width,
        height: asset.height,
      });
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    }
  });
  it("connects original assets to known campaigns with attribution and valid player targets", () => {
    expect(Object.keys(CAMPAIGN_MEDIA)).toHaveLength(20);
    for (const [id, items] of Object.entries(CAMPAIGN_MEDIA)) {
      expect(campaignById(id), id).toBeDefined();
      expect(items.length, id).toBeGreaterThan(0);
      for (const item of items) {
        expect(new URL(item.sourceUrl).protocol).toBe("https:");
        expect(item.alt.length).toBeGreaterThan(15);
        expect(item.credit.length).toBeGreaterThan(10);
        if (item.kind === "youtube")
          expect(item.videoId).toMatch(/^[\w-]{11}$/);
        for (const url of [mediaPoster(item), mediaOriginal(item)]) {
          if (url.startsWith("/"))
            expect(fs.existsSync(path.join(process.cwd(), "public", url))).toBe(
              true,
            );
          else expect(new URL(url).protocol).toBe("https:");
        }
      }
    }
  });

  it("keeps records without verified creative separate and assets out of the writing context", () => {
    expect(campaignMedia("clicklearn-abm")).toEqual([]);
    expect(campaignMedia("cider-shorts")).toEqual([]);
    expect(campaignMedia("supabase-alternative")).toEqual([]);
    expect(campaignMedia("notion-creators")).toEqual([]);
    expect(campaignMedia("unknown")).toEqual([]);
    const wispr = campaignById("wispr-old-way")!;
    expect(campaignContext([wispr])).not.toContain("youtube");
    expect(mediaOriginal(campaignMedia(wispr.id)[0])).toBe(
      "https://www.youtube.com/watch?v=9KqGpxtsawc",
    );
  });
});
