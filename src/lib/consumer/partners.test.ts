import { describe, expect, it } from "vitest";
import { partnerCopy, partnerFromUrl, partnerKey } from "./partners";

describe("partnerFromUrl", () => {
  it("reads the platform, kind and handle from where people follow or gather", () => {
    expect(partnerFromUrl("https://www.reddit.com/r/running/comments/abc")).toEqual({ platform: "reddit", kind: "community", handle: "r/running" });
    expect(partnerFromUrl("https://www.youtube.com/@mayaruns/videos")).toEqual({ platform: "youtube", kind: "creator", handle: "@mayaruns" });
    expect(partnerFromUrl("https://www.tiktok.com/@maya.runs")).toEqual({ platform: "tiktok", kind: "creator", handle: "@maya.runs" });
    expect(partnerFromUrl("https://financeops.substack.com/p/close")).toEqual({ platform: "substack", kind: "newsletter", handle: undefined });
    expect(partnerFromUrl("https://www.linkedin.com/in/ali-writes")).toMatchObject({ platform: "linkedin", kind: "creator" });
    expect(partnerFromUrl("https://www.linkedin.com/company/rampco")).toMatchObject({ platform: "linkedin", kind: "brand" });
    expect(partnerFromUrl("https://podcasts.apple.com/us/podcast/the-close/id1")).toEqual({ platform: "podcast", kind: "podcast" });
  });

  it("leaves ordinary websites alone: they may be companies", () => {
    expect(partnerFromUrl("https://ledgerline.example/pricing")).toBeNull();
    expect(partnerFromUrl("not a url")).toBeNull();
  });

  it("keys a partner found by link the same as one added by hand", () => {
    const found = partnerFromUrl("https://www.tiktok.com/@maya.runs")!;
    expect(partnerKey({ name: "Maya", handle: found.handle, platform: found.platform })).toBe(partnerKey({ name: "maya runs", handle: "@maya.runs", platform: "tiktok" }));
  });
});

describe("partnerCopy", () => {
  it("speaks each market's language over the same list", () => {
    expect(partnerCopy("consumer")).toMatchObject({ title: "Creators and communities", results: { signups: "Signups", orders: "Orders" } });
    expect(partnerCopy("b2b")).toMatchObject({ title: "Partners", results: { signups: "Leads", orders: "Deals" } });
    expect(partnerCopy("b2b").platforms[0]).toBe("linkedin");
    expect(partnerCopy("consumer").platforms[0]).toBe("tiktok");
    // Gifted product is a consumer offer; businesses sponsor and co-market.
    expect(partnerCopy("b2b").offers.gifted).toBeUndefined();
  });
});
