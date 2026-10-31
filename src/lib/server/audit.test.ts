import { describe, expect, it } from "vitest";
// Plain JS, run by CI before the build (the "Dependency security audit" step).
import { advisories, auditFailures } from "../../../scripts/audit.mjs";

/**
 * The dependency audit: moderate or worse fails, an exemption covers only the dev tree and only until its
 * date, and anything in production fails whatever the list says.
 */

const advisory = (id: string, severity = "moderate") => ({
  source: 1,
  title: `${id} title`,
  severity,
  url: `https://github.com/advisories/${id}`,
});
const report = (...vias: object[]) => ({
  vulnerabilities: {
    pkg: { severity: "moderate", via: vias },
    parent: { severity: "moderate", via: ["pkg"] },
  },
});
const CLEAN = { vulnerabilities: {} };
const EXEMPT = [{ id: "GHSA-aaaa-bbbb-cccc", why: "dev only", until: "2026-12-31" }];

describe("the dependency audit", () => {
  it("reads each advisory once, moderate and up, skipping the packages that only depend on it", () => {
    const r = report(advisory("GHSA-aaaa-bbbb-cccc"), advisory("GHSA-low0-0000-0000", "low"));
    expect(advisories(r)).toEqual([{ id: "GHSA-aaaa-bbbb-cccc", title: "GHSA-aaaa-bbbb-cccc title", severity: "moderate" }]);
  });

  it("passes when the only advisory is exempt and stays out of production", () => {
    expect(auditFailures(report(advisory("GHSA-aaaa-bbbb-cccc")), CLEAN, EXEMPT, "2026-10-30")).toEqual([]);
  });

  it("fails on an advisory that isn't exempt", () => {
    const failures = auditFailures(report(advisory("GHSA-new0-0000-0000", "high")), CLEAN, EXEMPT, "2026-10-30");
    expect(failures).toEqual(["GHSA-new0-0000-0000 (high): GHSA-new0-0000-0000 title"]);
  });

  it("fails when an exempt advisory reaches production", () => {
    const r = report(advisory("GHSA-aaaa-bbbb-cccc"));
    expect(auditFailures(r, r, EXEMPT, "2026-10-30")).toEqual([
      "GHSA-aaaa-bbbb-cccc (moderate) in production dependencies: GHSA-aaaa-bbbb-cccc title",
    ]);
  });

  it("fails once the exemption expires", () => {
    expect(auditFailures(report(advisory("GHSA-aaaa-bbbb-cccc")), CLEAN, EXEMPT, "2027-01-01")).toEqual([
      "GHSA-aaaa-bbbb-cccc: exemption expired on 2026-12-31; look at it again",
      "GHSA-aaaa-bbbb-cccc (moderate): GHSA-aaaa-bbbb-cccc title",
    ]);
  });
});
