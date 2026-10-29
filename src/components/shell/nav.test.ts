import { describe, expect, it } from "vitest";
import { consumerWorkspace, makeWorkspace } from "@/test/factories";
import { SECONDARY, goKeys, landingAfterSwitch, navFor, shellMarket } from "./nav";

const hrefs = (market: "b2b" | "consumer") => navFor(market).map((p) => p.href);

describe("navFor", () => {
  it("gives businesses the deal desk and consumer companies the number, creators and research", () => {
    expect(hrefs("b2b")).toEqual(["/today", "/revenue", "/companies", "/plays", "/research", "/intros", "/partners", "/events", "/playbook", "/studio"]);
    expect(hrefs("consumer")).toEqual(["/today", "/growth", "/partners", "/research", "/playbook", "/studio"]);
    // The same list under each market's name for it.
    expect(navFor("b2b").find((p) => p.href === "/partners")?.label).toBe("Partners");
    expect(navFor("consumer").find((p) => p.href === "/partners")?.label).toBe("Creators");
  });

  it("reads a workspace still loading as business, like marketOf", () => {
    expect(shellMarket(null)).toBe("b2b");
    expect(shellMarket(makeWorkspace())).toBe("b2b");
    expect(shellMarket(consumerWorkspace())).toBe("consumer");
  });

  it("never gives two pages one key, in either market", () => {
    for (const market of ["b2b", "consumer"] as const) {
      const keys = [...navFor(market), ...SECONDARY].map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("goKeys", () => {
  it("only goes to pages the market shows", () => {
    expect(goKeys("b2b")).toMatchObject({ t: "/today", v: "/revenue", c: "/companies", r: "/partners", s: "/settings" });
    expect(goKeys("b2b").w).toBeUndefined();
    expect(goKeys("consumer")).toMatchObject({ t: "/today", w: "/growth", r: "/partners", f: "/research", i: "/integrations" });
    for (const k of ["v", "c", "y", "n", "e"]) expect(goKeys("consumer")[k]).toBeUndefined();
  });
});

describe("landingAfterSwitch", () => {
  it("swaps Revenue and Growth, and sends other pages the market doesn't use to Today", () => {
    expect(landingAfterSwitch("/revenue", "consumer")).toBe("/growth");
    expect(landingAfterSwitch("/growth", "b2b")).toBe("/revenue");
    expect(landingAfterSwitch("/companies", "consumer")).toBe("/today");
    expect(landingAfterSwitch("/events/evt_1", "consumer")).toBe("/today");
  });

  it("stays on pages both markets use, and anywhere outside the shell", () => {
    for (const path of ["/today", "/partners", "/research", "/playbook", "/studio", "/settings", "/integrations"]) {
      expect(landingAfterSwitch(path, "consumer")).toBeNull();
      expect(landingAfterSwitch(path, "b2b")).toBeNull();
    }
    expect(landingAfterSwitch("/companies", "b2b")).toBeNull();
    expect(landingAfterSwitch("/welcome", "consumer")).toBeNull();
  });
});
