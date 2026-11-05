import { describe, expect, it } from "vitest";
import { isQuestion, matchScore, rankBy, type Rankable } from "./palette-rank";

type Row = Rankable & { id: string };

const command = (id: string, name: string, keywords = ""): Row => ({ id, name, keywords, kind: "command" });
const page = (id: string, name: string, keywords = ""): Row => ({ id, name, keywords, kind: "page" });
const company = (id: string, name: string, domain: string, keywords = ""): Row => ({ id, name, aliases: [domain], keywords: `${domain} ${keywords}`, kind: "entity" });
const person = (id: string, name: string, title: string, at: string): Row => ({ id, name, keywords: `${title} ${at}`, kind: "entity" });

/** What ⌘K offers on the sample: the commands that used to win on loose matches, pages, companies, people. */
const ROWS: Row[] = [
  command("import-list", "Import a list", "import a list csv companies crm export conference"),
  command("import-linkedin", "Import LinkedIn connections", "import linkedin connections warm network csv"),
  command("write", "Write to…", "write to someone email message person outreach"),
  command("research", "Search the web and research companies", "research search web sources"),
  command("map", "Map of your leads", "map where are my leads nearby location"),
  page("today", "Today", "today daily brief moves"),
  page("revenue", "Revenue", "revenue forecast pipeline commit coverage quota number"),
  company("northwind", "Northwind Metrics", "northwind.io"),
  company("rowanstack", "Rowanstack", "rowanstack.example"),
  company("lumenwire", "Lumenwire", "lumenwire.example"),
  person("tom", "Tom Becker", "Director of Billing Operations", "Rowanstack"),
  person("dana", "Dana Kim", "Controller", "Northwind Metrics"),
];

const ids = (query: string, rows: Row[] = ROWS) => rankBy(query, rows, (r) => r).map((r) => r.id);

describe("rankBy", () => {
  it("puts a company named what you typed above commands that only match loosely", () => {
    const out = ids("rowan");
    expect(out[0]).toBe("rowanstack");
    // Tom works at Rowanstack: found through his company, after it.
    expect(out).toContain("tom");
    expect(out.indexOf("tom")).toBeGreaterThan(out.indexOf("rowanstack"));
    // "Import LinkedIn connections" has r-o-w-a-n strung across it, but no word starts with r: it's not a match.
    expect(out).not.toContain("import-linkedin");
  });

  it("ranks an exact name above a name that starts with it", () => {
    const rows = [company("acme-labs", "Acme Labs", "acmelabs.com"), company("acme", "Acme", "acme.com")];
    expect(ids("acme", rows)).toEqual(["acme", "acme-labs"]);
  });

  it("matches a company by its domain, exactly", () => {
    expect(ids("northwind.io")[0]).toBe("northwind");
    expect(ids("rowanstack.ex")[0]).toBe("rowanstack");
  });

  it("finds people by name before anything else that mentions them", () => {
    expect(ids("dana")[0]).toBe("dana");
    expect(ids("dana kim")).toEqual(["dana"]);
  });

  it("ranks entity prefixes, then word starts, then letters inside a word, then fuzzy", () => {
    const rows: Row[] = [
      command("fuzzy", "Run the weekly learning review", "friday what worked"),
      company("inside", "Pathlumen", "pathlumen.io"),
      command("words", "Find new lumen leads", "discover"),
      company("prefix", "Lumenwire", "lumenwire.example"),
    ];
    expect(matchScore("lumen", rows[3])).toBeGreaterThan(matchScore("lumen", rows[2]));
    expect(matchScore("lumen", rows[2])).toBeGreaterThan(matchScore("lumen", rows[1]));
    expect(ids("lumen", rows)).toEqual(["prefix", "words", "inside"]);
    // Letters in order from a word start: "wkly" → weekly. Strung across the whole label, they don't count.
    expect(ids("wkly", rows)).toEqual(["fuzzy"]);
    expect(ids("rwr", rows)).toEqual([]);
  });

  it("matches the start of each word typed, in order first", () => {
    expect(ids("imp li")[0]).toBe("import-linkedin");
    expect(ids("imp")).toEqual(["import-list", "import-linkedin"]);
    expect(ids("leads map")[0]).toBe("map");
  });

  it("finds a command by its other words", () => {
    expect(ids("csv")).toEqual(["import-list", "import-linkedin"]);
    expect(ids("forecast")).toEqual(["revenue"]);
  });

  it("starts a label match above a match on later words", () => {
    const rows: Row[] = [command("later", "Plan a revenue dinner"), page("revenue", "Revenue")];
    expect(ids("rev", rows)).toEqual(["revenue", "later"]);
  });

  it("ignores case and accents", () => {
    const rows = [person("zoe", "Zoë Ångström", "Founder", "Fjord")];
    expect(ids("ZOE ang", rows)).toEqual(["zoe"]);
  });

  it("keeps the incoming order for ties, and lets a boost win them", () => {
    const rows = [company("a", "Pave", "pave.io"), company("b", "Paveline", "paveline.io"), company("c", "Pavement", "pavement.io")];
    expect(ids("pav", rows)).toEqual(["a", "b", "c"]);
    expect(ids("pav", [rows[0], rows[1], { ...rows[2], boost: 1 }])).toEqual(["c", "a", "b"]);
  });

  it("searches every row, then caps: a company far down the fit order is still found", () => {
    const many = Array.from({ length: 450 }, (_, i) => company(`c${i}`, `Company ${i}`, `company${i}.io`));
    many.push(company("last", "Quillfeather", "quillfeather.example"));
    expect(rankBy("quill", many, (r) => r, 50).map((r) => r.id)).toEqual(["last"]);
    expect(rankBy("company", many, (r) => r, 50)).toHaveLength(50);
  });

  it("lists every row in order when nothing is typed, and nothing for a single stray letter in the middle of words", () => {
    expect(ids("")).toEqual(ROWS.map((r) => r.id));
    expect(ids("x")).toEqual([]);
  });
});

describe("isQuestion", () => {
  it("is a question when it ends with a question mark", () => {
    expect(isQuestion("rowanstack?")).toBe(true);
  });

  it("is a question when it opens with a question word and goes on", () => {
    for (const q of ["who should I email at Rowanstack", "what's slipping", "How do I", "is Lumenwire commit", "Does Dana own budget", "can we close", "should I", "which deals", "when is", "why", "are we"]) {
      expect(isQuestion(q), q).toBe(q !== "why");
    }
  });

  it("isn't yet when the question word stands alone: it may be a name being typed", () => {
    expect(isQuestion("who")).toBe(false);
    expect(isQuestion("Is")).toBe(false);
    expect(isQuestion("whoop")).toBe(false);
  });

  it("is a question at five words or more", () => {
    expect(isQuestion("find five new fintech companies")).toBe(true);
    expect(isQuestion("import linkedin connections now")).toBe(false);
  });

  it("isn't for names, pages and commands", () => {
    for (const q of ["rowan", "Revenue", "imp li", "northwind.io", "", "   "]) expect(isQuestion(q), q).toBe(false);
  });
});
