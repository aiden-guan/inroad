import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { writeSettings } from "@/lib/store/settings";
import { emptyWorkspace, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { useTape, type Tape } from "@/test/anthropic-tape";
import { freshRun } from "@/test/deterministic";
import { discoveryRoutes } from "@/test/discovery-fixtures";
import { NOW, TODAY } from "@/test/factories";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { runWorkflow, waitForRun } from "@/test/run-workflow";
import { expectHealthyRun } from "@/test/tape-checks";
import foundation from "./foundation";

/**
 * W1 + W3f, the first run end to end on recorded Anthropic exchanges: read the founder's site, show what
 * was learned, write the bet section by section, and, once the ICP lands, find the first companies to
 * talk to (YC directory and job boards from saved responses). This is the path a new founder takes.
 */

vi.mock("@/lib/domain/ids", async (actual) => (await import("@/test/deterministic")).deterministicIds(await actual()));
vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const SITE = {
  "https://acme.com": { url: "https://www.acme.com/", body: fixture("acme-home.html") },
  "https://www.acme.com/pricing": fixture("acme-pricing.html"),
  "https://www.acme.com/about-us": fixture("acme-about.html"),
  "https://www.acme.com/careers": fixture("acme-careers.html"),
  "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": fixture("greenhouse-jobs.json"),
};

let tape: Tape;

beforeEach(async () => {
  freshRun(NOW);
  resetCompat();
  writeSettings({ newsSource: "off" });
  const r = routeFetches({ ...SITE, ...discoveryRoutes() });
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  await replaceWorkspace(emptyWorkspace());
});

afterEach(async () => {
  await tape?.close();
  writeSettings({ newsSource: undefined });
  vi.useRealTimers();
});

describe("the first run", () => {
  it("reads the site, writes the bet section by section, and finds the first three companies", async () => {
    tape = await useTape("foundation-first-run");
    const { summary } = await runWorkflow(foundation, { url: "acme.com", founderName: "Priya" });
    const ws0 = readWorkspace();
    expect(ws0.onboarding.discoveryRunId).toBeTruthy();
    const found = await waitForRun(ws0.onboarding.discoveryRunId!);
    await expectHealthyRun([summary, found], tape, { submits: ["share_learning", "submit_snapshot", "submit_section", "finish_bet", "submit_screen"] });

    const ws = readWorkspace();
    // What I learned: chips that quote the site.
    expect(ws.company?.chips.length).toBeGreaterThan(0);
    for (const chip of ws.company!.chips) for (const id of chip.evidenceIds) expect(ws.evidence[id]?.url).toMatch(/^https:\/\/www\.acme\.com\//);
    // The bet: every required section saved, with provenance, and the offer screen next.
    expect(ws.onboarding.status).toBe("offer");
    for (const k of ["positioning", "icp", "personas", "messaging"] as const) expect(ws.onboarding.sections?.[k], k).toBeTruthy();
    const f = ws.foundation!;
    expect(f.icp.hypothesis.sentence.length).toBeGreaterThan(20);
    expect(f.icp.criteria.length).toBeGreaterThan(0);
    expect(f.personas.length).toBeGreaterThan(0);
    expect(f.messaging.oneLiner.length).toBeGreaterThan(10);
    // A competitor link only survives if it was seen this run.
    for (const a of f.positioning.alternatives) if (a.sourceUrl) expect(tape.messages().some((m) => JSON.stringify(m.content).includes(a.sourceUrl!))).toBe(true);

    // The first three: fit and a dated reason to talk this month, from the job boards.
    const accounts = Object.values(ws.accounts);
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.length).toBeLessThanOrEqual(3);
    for (const a of accounts) {
      expect(a.fitScore).toBeGreaterThanOrEqual(70);
      expect(a.signals.some((s) => s.date <= TODAY && s.strength >= 1)).toBe(true);
      expect(a.whyNow).toBeTruthy();
    }
    // Screening batches share a prefix, so they're cached for an hour.
    const screens = tape.exchanges().filter((e) => e.request.tools.includes("submit_screen"));
    expect(screens.length).toBeGreaterThan(0);
    for (const s of screens) expect(s.request.cacheTtl).toBe("1h");
  });
});
