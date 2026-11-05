import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { intentProfile } from "./profile";
import {
  aggregateRadar,
  capPeople,
  parseDiscussions,
  parseForks,
  parseRepoComments,
  parseRepoInput,
  parseRepoIssues,
  peopleFrom,
  radarLine,
  radarSummary,
  shortQuote,
  starsInWindow,
} from "./radar-model";

const read = (name: string, repo = "acme/meter") =>
  JSON.parse(fs.readFileSync(new URL(`../../test/fixtures/signals/intent/${name}`, import.meta.url), "utf8").replaceAll("{{repo}}", repo).replaceAll("{{owner}}", repo.split("/")[0]).replaceAll("{{name}}", repo.split("/")[1]));
const anchor = Date.parse("2026-11-05T09:00:00Z");
const since = anchor - 30 * 86_400_000;

describe("parseRepoInput", () => {
  it("takes links, owner/name pairs, commas and new lines, at most five, without duplicates", () => {
    expect(parseRepoInput("https://github.com/getlago/lago, openmeterio/openmeter\nhttps://github.com/getlago/lago/issues/12 getlago/lago.git")).toEqual(["getlago/lago", "openmeterio/openmeter"]);
    expect(parseRepoInput("a/b c/d e/f g/h i/j k/l")).toHaveLength(5);
    expect(parseRepoInput("not a repo ../.. -bad/x")).toEqual([]);
  });
});

describe("GitHub activity parsers", () => {
  it("reads forks in the window, an organization's fork included", () => {
    const forks = parseForks(read("gh-forks.json"), "acme/meter", since);
    expect(forks.map((f) => [f.login, f.kind, f.org ?? false])).toEqual([
      ["fixture-tbaird", "fork", false],
      ["fixture-jfrost", "fork", false],
      ["fixture-wliu", "fork", false],
      ["fixture-hollowpine", "fork", true],
    ]);
    expect(forks[0].url).toBe("https://github.com/fixture-tbaird/meter");
  });

  it("reads issues and pull requests without bots, the maintainers or anything older than the window", () => {
    const issues = parseRepoIssues(read("gh-issues.json"), "acme/meter", since);
    expect(issues.map((i) => [i.login, i.kind])).toEqual([
      ["fixture-kbello", "pull"],
      ["fixture-rkapoor", "issue"],
      ["fixture-aamaro", "issue"],
    ]);
    expect(issues[1].title).toBe("Late usage events after the invoice run are dropped silently");
    expect(issues[1].url).toBe("https://github.com/acme/meter/issues/412");
    const comments = parseRepoComments(read("gh-comments.json"), "acme/meter", since);
    expect(comments.map((c) => c.login)).toEqual(["fixture-squreshi", "fixture-wliu"]);
    const discussions = parseDiscussions(read("gh-discussions.json"), "acme/meter", since);
    expect(discussions.map((d) => [d.login, d.kind, d.title])).toEqual([["fixture-aamaro", "discussion", "How do you reconcile usage that arrives after the invoice run?"]]);
    expect(parseForks({ message: "Not Found" }, "x/y", since)).toEqual([]);
  });

  it("counts stars from GitHub's weekly history, the only star data it still shares", () => {
    const weeks = read("gh-stars-history.json");
    const total = starsInWindow(weeks, anchor, 30)!;
    // Day by day: every day of every week that falls inside the 30 days.
    const days = (weeks as { week: number; days: number[] }[]).flatMap((w) => w.days.map((count, i) => ({ at: w.week + i * 86_400, count })));
    expect(total).toBe(days.filter((d) => d.at >= since / 1000).reduce((n, d) => n + d.count, 0));
    expect(total).toBeGreaterThan(0);
    expect(starsInWindow({ message: "x" }, anchor)).toBeUndefined();
  });
});

describe("aggregateRadar", () => {
  const profile = intentProfile(sampleWorkspace(NOW))!;
  const raw = [
    ...parseForks(read("gh-forks.json"), "acme/meter", since),
    ...parseRepoIssues(read("gh-issues.json"), "acme/meter", since),
    ...parseRepoComments(read("gh-comments.json"), "acme/meter", since),
  ];
  // Where each profile places them (githubPerson does this against the live API).
  const PLACE: Record<string, { domain: string; company?: string }> = {
    "fixture-rkapoor": { domain: "fernwick.example", company: "fixture-fernwick" },
    "fixture-tbaird": { domain: "fernwick.example", company: "Fernwick" },
    "fixture-squreshi": { domain: "fernwick.example" },
    "fixture-wliu": { domain: "driftglass.example" },
    "fixture-aamaro": { domain: "pebblecart.example" },
    "fixture-hollowpine": { domain: "hollowpine.example" },
  };
  const people = peopleFrom(raw, profile).map((p) => ({ ...p, ...(PLACE[p.login] ?? {}) }));

  it("rolls people up to companies, strongest first, with the issue that names the pain as the quote", () => {
    const rows = aggregateRadar(people, { windowDays: 30, profile, exclude: ["meterbook.example"], names: { "fernwick.example": "Fernwick" } });
    expect(rows.map((r) => [r.domain, r.logins.length])).toEqual([
      ["fernwick.example", 3],
      ["pebblecart.example", 1],
      ["driftglass.example", 1],
      ["hollowpine.example", 1],
    ]);
    const fernwick = rows[0];
    expect(fernwick.counts).toEqual({ fork: 1, issue: 1, comment: 1 });
    // The issue is the written need, so it's the quote; "late" alone is too little to call it a playbook pain.
    expect(fernwick.quote).toMatchObject({ kind: "issue", url: "https://github.com/acme/meter/issues/412" });
    expect(fernwick.quote!.pain).toBeUndefined();
    expect(fernwick.line).toBe("3 people at Fernwick engaged with acme/meter in the last 30 days: 1 fork, 1 issue, 1 comment.");
    const painful = aggregateRadar(
      [{ login: "x", url: "u", domain: "acme.example", activity: [{ kind: "issue", repo: "a/b", url: "https://github.com/a/b/issues/1", at: "2026-11-01T00:00:00Z", title: "Metered usage never reaches the invoice", quote: "We tie metered usage to invoices by hand at month-end." }] }],
      { windowDays: 30, profile, exclude: [] },
    )[0];
    expect(painful.line).toBe("1 person at Acme engaged with a/b in the last 30 days: 1 issue about tying metered usage to invoices at month-end.");
  });

  it("leaves out the maintainers' own company and people it couldn't place", () => {
    const rows = aggregateRadar(people, { windowDays: 30, profile, exclude: ["meterbook.example", "fernwick.example"] });
    expect(rows.some((r) => r.domain === "fernwick.example" || r.domain === "meterbook.example")).toBe(false);
    expect(capPeople(people, 3).every((p) => p.domain)).toBe(true);
  });

  it("says what it found in one line, counted in code", () => {
    const rows = aggregateRadar(people, { windowDays: 30, profile, exclude: [] });
    expect(radarSummary({ totals: { engaged: 8, placed: 6, profilesRead: 8, rateLimited: false, withToken: false }, companies: rows, windowDays: 30 }, 2)).toBe(
      "8 people engaged in the last 30 days. I could place 6 of them at 4 companies; 2 are in Companies already.",
    );
    expect(radarSummary({ totals: { engaged: 0, placed: 0, profilesRead: 0, rateLimited: false, withToken: false }, companies: [], windowDays: 30 })).toMatch(/^Nobody outside the maintainers/);
    expect(radarLine({ name: "Acme", logins: ["a"], counts: { fork: 2 }, repos: ["x/y", "z/w"] }, 7)).toBe("1 person at Acme engaged with x/y and z/w in the last 7 days: 2 forks.");
    expect(shortQuote("One two three four five six. Seven eight.", ["seven"], 3)).toBe("Seven eight.");
  });
});
