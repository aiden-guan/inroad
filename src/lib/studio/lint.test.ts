import { describe, expect, it } from "vitest";
import { weightedLength } from "./formats";
import { concreteness, lintStudio, rhythm, type StudioLintInput } from "./lint";

const errors = (input: StudioLintInput) => lintStudio(input).violations.filter((v) => v.severity === "error");
const codes = (input: StudioLintInput) => errors(input).map((v) => v.code);
const line = (text: string, extra: Partial<StudioLintInput> = {}): StudioLintInput => ({ format: "one_liner", parts: { line: text }, ...extra });

/**
 * Calibration. Lines that worked for real companies (docs/research/10-marketing-copy.md) must pass;
 * the lines every AI writer produces must fail. If a word-list change breaks either side, the
 * list is wrong, not the test.
 */
describe("calibration: human lines pass", () => {
  it.each([
    "Don't type, just speak",
    "The issue tracking tool you'll enjoy using",
    "Supabase is an open source Firebase alternative.",
    "Build in a weekend. Scale to millions.",
    "Develop. Preview. Ship.",
    "Time is money. Save both.",
    "The AI notepad for people in back-to-back meetings",
    "4x faster than typing",
    "Ads are coming to AI. But not to Claude.",
    "I'll never leave dirty dishes in the sink",
  ])("%s", (text) => {
    expect(errors(line(text))).toEqual([]);
  });
});

describe("calibration: AI marketing lines fail", () => {
  it.each([
    ["Unlock the power of effortless meetings", "AI_TELL"],
    ["Supercharge your workflow with smarter insights", "HYPE_WORD"],
    ["In today's fast-paced world, teams need a better way", "AI_TELL"],
    ["It's not just a tool, it's a revolution", "NEGATIVE_PARALLEL"],
    ["Say goodbye to busywork and hello to growth", "AI_TELL"],
    ["Elevate your team's potential with cutting-edge AI", "HYPE_WORD"],
    ["Imagine a world where meetings run themselves", "RHETORICAL_OPENER"],
    ["We're thrilled to announce our next chapter", "ANNOUNCE_OPENER"],
    ["Boost productivity and drive better results", "VAGUE"],
    ["Seamless collaboration — reimagined", "EM_DASH"],
    ["Delve into a smarter inbox", "AI_VOCAB"],
  ])("%s → %s", (text, code) => {
    expect(codes(line(text))).toContain(code);
  });
});

describe("social posts", () => {
  const post = (hook: string, body: string) => ({ format: "linkedin_post" as const, parts: { hook, body } });

  it("fails one-sentence-per-line broetry with a dramatic closer", () => {
    const body = ["We shipped.", "It took 9 months.", "Nobody believed us.", "We kept going.", "Now we have users.", "Let that sink in."].join("\n");
    const c = lintStudio(post("We launched today after 9 months of building in the dark.", body));
    expect(c.violations.map((v) => v.code)).toEqual(expect.arrayContaining(["BROETRY", "AI_TELL"]));
    expect(c.passed).toBe(false);
  });

  it("passes a plain post with a real story and varied rhythm", () => {
    const body =
      "Last March a controller showed me her close. Usage export on the left, invoice export on the right, a VLOOKUP on customer ID in the middle. It took her the first week of every month, and the variance she couldn't explain went into an adjustment line nobody questioned.\n\nWe built Ledgerline to match each usage event to its invoice line instead. She closed in 6 hours last month.\n\nIf your close still starts with two exports, I'd like to hear how long it takes.";
    const c = lintStudio({ ...post("A controller's close took a week. Last month it took 6 hours.", body), sourced: "She closed in 6 hours last month." });
    expect(c.violations.filter((v) => v.severity === "error")).toEqual([]);
  });

  it("counts the whole post against LinkedIn's 3,000-character limit", () => {
    const body = "Ledgerline matched the usage file to invoices again today, line by line. ".repeat(42);
    expect(codes(post("A short opening line about invoices.", body))).toContain("OVER_LIMIT");
  });

  it("flags engagement bait and hashtag walls", () => {
    const c = lintStudio(post("We cut our close from 4 days to 6 hours.", "Here's what changed in the process, and what we'd do again. Agree?\n\n#finance #saas #startups #ai"));
    expect(c.violations.map((v) => v.code)).toEqual(expect.arrayContaining(["AI_TELL", "HASHTAGS"]));
  });
});

describe("honesty", () => {
  it("requires every number to come from a receipt", () => {
    expect(codes(line("Cut close time by 80%", { sourced: "" }))).toContain("NUMBER_UNSOURCED");
    expect(codes(line("Cut close time by 80%", { sourced: "A design partner cut close time by 80 percent." }))).toEqual([]);
  });

  it("keeps “up to” and “on average” apart", () => {
    const sourced = "Customers save up to 5% on card spend.";
    expect(codes(line("Save 5% on average", { sourced }))).toContain("NUMBER_UNSOURCED");
    expect(codes(line("Save up to 5% on card spend", { sourced }))).toEqual([]);
  });

  it("requires proof for superlatives and “first/only” claims", () => {
    expect(codes(line("The fastest way to close the books", { sourced: "" }))).toContain("SUPERLATIVE_UNSOURCED");
    expect(codes(line("The world's first robot lawyer", { sourced: "" }))).toContain("SUPERLATIVE_UNSOURCED");
    expect(codes(line("The fastest way to close the books", { sourced: "Benchmarked as the fastest close in a 2026 audit." }))).toEqual([]);
    // "the first time" in a story and "unmatched usage" in reconciliation are not claims.
    expect(codes(line("The first time I closed in a day", { sourced: "" }))).toEqual([]);
    expect(codes(line("See your unmatched usage", { sourced: "" }))).toEqual([]);
    expect(codes(line("Accuracy is unmatched", { sourced: "" }))).toContain("SUPERLATIVE_UNSOURCED");
  });

  it("warns when a competitor is named and blocks never-say words", () => {
    const c = lintStudio(line("Cheaper than Meterbook for usage close", { competitors: ["Meterbook"], neverSay: ["cheaper"] }));
    expect(c.violations.map((v) => v.code)).toEqual(expect.arrayContaining(["COMPETITOR_CLAIM", "NEVER_SAY"]));
  });

  it("blocks unfilled gaps and chatbot leftovers", () => {
    expect(codes(line("Pilots start at [[pilot fee]]"))).toContain("PLACEHOLDER");
    expect(codes({ format: "linkedin_post", parts: { hook: "Here's a polished version of your post.", body: "I hope this helps! The launch went well and we learned a lot along the way from our first users." } })).toContain("AI_TELL");
  });

  it("leaves a customer's quoted words alone", () => {
    expect(codes(line('"The seamless part is the late events," a controller told us'))).toEqual([]);
  });

  it("exempts the founder's vocabulary", () => {
    expect(codes(line("Built for the platform team that owns billing", { allowWords: ["platform team"] }))).toEqual([]);
  });
});

describe("platform limits and rules", () => {
  it("fails a Product Hunt tagline over 60 characters and any upvote ask", () => {
    const parts = { tagline: "Match every usage event to its invoice line, even the ones that are late", description: "For controllers.", first_comment: "Please upvote us today if you like it." };
    const c = codes({ format: "product_hunt", parts });
    expect(c).toContain("OVER_LIMIT");
    expect(c).toContain("PLATFORM_RULE");
  });

  it("requires the Show HN prefix and a plain title", () => {
    expect(codes({ format: "show_hn", parts: { title: "Ledgerline – usage-to-invoice matching", body: "x ".repeat(90) } })).toContain("PLATFORM_RULE");
    expect(codes({ format: "show_hn", parts: { title: "Show HN: The BEST reconciliation tool!", body: "x ".repeat(90) } })).toEqual(expect.arrayContaining(["PLATFORM_RULE", "ALL_CAPS"]));
  });

  it("counts X posts the way X does: each link is 23", () => {
    expect(weightedLength("see https://example.com/a/very/long/path/that/goes/on")).toBe(4 + 23);
    const long = "a".repeat(270);
    expect(codes({ format: "x_post", parts: { posts: `${long} https://example.com/a` } })).toContain("OVER_LIMIT");
    expect(codes({ format: "x_post", parts: { posts: `First post about invoices.\n---\nSecond post with the 6 hours.` } })).not.toContain("OVER_LIMIT");
  });

  it("checks list parts item by item and by count", () => {
    const headlines = ["Usage close in 6 hours", "Match every usage event", "Built for controllers", "This headline is far too long for Google Ads"].join("\n");
    const c = lintStudio({ format: "search_ad", parts: { headlines, descriptions: "One line only." } });
    const msgs = c.violations.filter((v) => v.severity === "error").map((v) => v.detail);
    expect(msgs.some((m) => m.startsWith("Headlines 4"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("Descriptions: 1 of at least 2"))).toBe(true);
  });

  it("flags stock visual clichés but not the product", () => {
    const parts = { headline: "Close in 6 hours", visual: "A glowing brain over a futuristic city", alt: "Illustration" };
    expect(lintStudio({ format: "image", parts }).violations.map((v) => v.code)).toContain("VISUAL_CLICHE");
    const real = { headline: "Close in 6 hours", visual: "Screenshot of the unmatched-usage list with three late events highlighted", alt: "List of usage events" };
    expect(lintStudio({ format: "image", parts: real }).violations.map((v) => v.code)).not.toContain("VISUAL_CLICHE");
  });
});

describe("a set of options", () => {
  it("warns when two options open the same way", () => {
    const siblings = [{ line: "Close the books in six hours" }];
    expect(lintStudio(line("Close the books in a day", { siblings })).violations.map((v) => v.code)).toContain("SAME_SHAPE");
    expect(lintStudio(line("Your controller gets a week back", { siblings })).violations.map((v) => v.code)).not.toContain("SAME_SHAPE");
  });
});

describe("helpers", () => {
  it("counts concrete markers", () => {
    expect(concreteness("Close in 6 hours with Ledgerline").concrete).toBeGreaterThanOrEqual(2);
    expect(concreteness("Better results and smarter workflows").concrete).toBe(0);
  });

  it("measures sentence-length variation", () => {
    expect(rhythm("One two three four. Five six seven eight. Nine ten eleven twelve. One two three four. Five six seven eight.")).toBe(0);
    expect(rhythm("Short.")).toBeNull();
  });
});
