import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { aboutCompany, isPersonalDomain, matchAccount, nameFromDomain, normalizeCompany } from "./resolve";

const users = JSON.parse(fs.readFileSync(new URL("../../test/fixtures/signals/intent/hn-users.json", import.meta.url), "utf8"));

describe("aboutCompany", () => {
  it("places a Hacker News author from a role next to a site, or a work email", () => {
    expect(aboutCompany(users.fixture_jlindgren.about)).toEqual({
      name: "Quayside",
      domain: "quayside.example",
      basis: "profile_site",
      evidence: "Hacker News profile: “Controller at https://quayside.example”",
    });
    expect(aboutCompany(users.fixture_nkoval.about)).toMatchObject({ domain: "pebblecart.example", basis: "profile_site" });
    expect(aboutCompany("Reach me at dana@fernwick.example")).toMatchObject({ domain: "fernwick.example", basis: "profile_email" });
  });

  it("stays unknown for personal sites, free mail and profiles that name no employer", () => {
    expect(aboutCompany(users.fixture_mkessler.about)).toBeUndefined();
    expect(aboutCompany("Engineer. Blog at https://dana.github.io, mail dana@gmail.com")).toBeUndefined();
    expect(aboutCompany("I like https://example-news.com and cats")).toBeUndefined();
    expect(aboutCompany("")).toBeUndefined();
    expect(isPersonalDomain("substack.com")).toBe(true);
    expect(isPersonalDomain("fernwick.example")).toBe(false);
  });
});

describe("matchAccount", () => {
  const accounts = {
    "fernwick.example": { domain: "fernwick.example", name: "Fernwick", status: "tracked" as const },
    "quayside.example": { domain: "quayside.example", name: "Quayside Maps, Inc.", status: "new" as const },
  };
  it("matches by domain, subdomain or exact company name", () => {
    expect(matchAccount(accounts, { domain: "https://www.fernwick.example/about" })).toBe("fernwick.example");
    expect(matchAccount(accounts, { domain: "eng.fernwick.example" })).toBe("fernwick.example");
    expect(matchAccount(accounts, { name: "Quayside Maps" })).toBe("quayside.example");
    expect(matchAccount(accounts, { name: "Quay" })).toBeUndefined();
    expect(matchAccount(accounts, { domain: "pebblecart.example" })).toBeUndefined();
    expect(nameFromDomain("pebblecart.example")).toBe("Pebblecart");
    expect(normalizeCompany("The Acme Labs, Inc.")).toBe("acme");
  });
});
