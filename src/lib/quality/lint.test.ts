/** Lint regression checks: good emails pass, each template tell fails with its code. */
import { describe, expect, it } from "vitest";
import type { LintCode } from "@/lib/domain/types";
import { LIMITS, countWords, limitsFor, lintDraft, mergeLint, worstIssue, type LintInput } from "./lint";

const base: Omit<LintInput, "body" | "subject"> = { frame: "4t", step: 1, kind: "email", sourcedText: "", thread: "new" };
const codes = (input: Partial<LintInput> & { body: string }) => {
  const r = lintDraft({ ...base, subject: "ledger handoff", ...input });
  return { r, errors: r.violations.filter((v) => v.severity === "error").map((v) => v.code), warns: r.violations.filter((v) => v.severity === "warn").map((v) => v.code) };
};
const has = (list: LintCode[], code: LintCode) => expect(list).toContain(code);
const lacks = (list: LintCode[], code: LintCode) => expect(list).not.toContain(code);

const GOOD_ADVICE = `Dana, Northwind's founding platform role lists "own ledger reconciliation" as a first-90-days goal. From 30 calls with platform leads, the reconciliation script usually outlives the person who wrote it, and the second hire inherits a black box. I'm building ledger tooling after five years on Stripe's billing infra. Is reconciliation part of the platform role at Northwind, or does finance own it?`;

const GOOD_4T = `Ana, your pricing page moved to usage tiers in June. When usage events and invoices live in two systems, month-end close tends to become a spreadsheet only one analyst understands. The fix most teams try first, a BI dashboard, shows the gap but doesn't close it. Is invoicing straight from usage data on your list this quarter, or is it a next-year problem?`;

const SLOP = `Hi Dana,

I hope this email finds you well! I came across Northwind and wanted to reach out. Our AI-powered platform helps teams like yours streamline reconciliation and cut close time by 40%. Would you be open to a quick call? Here's my calendar: https://calendly.com/priya/30min 🚀`;

describe("lintDraft", () => {
  it("spec advice_ask example passes (founder_card, sourced number)", () => {
    const { r, errors } = codes({
      body: GOOD_ADVICE,
      subject: "reconciliation after the first hire",
      frame: "founder_card",
      sourcedText: "From 30 calls with platform leads, Jun–Oct 2026",
      requirePov: true,
      povId: "pov_1",
      spans: [{ text: `Northwind's founding platform role lists "own ledger reconciliation"`, support: "Own ledger reconciliation in your first 90 days jobs.ashbyhq.com October 2026" }],
      knownNames: ["Northwind"],
    });
    expect(errors).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.stats.words).toBeGreaterThanOrEqual(40);
    expect(r.stats.words).toBeLessThanOrEqual(90);
  });

  it("4t example passes and reports stats", () => {
    const { r, errors } = codes({ body: GOOD_4T, requirePov: true, credentialId: "clm_1" });
    expect(errors).toEqual([]);
    expect(r.stats.questionMarks).toBe(1);
    expect(r.stats.you).toBeGreaterThanOrEqual(r.stats.iWe);
  });

  it("AI-SDR slop fails on every tell", () => {
    const { r, errors } = codes({ body: SLOP, requirePov: true });
    expect(r.passed).toBe(false);
    for (const c of ["BANNED_PHRASE", "HYPE_WORD", "EXCLAMATION", "EMOJI", "CALENDAR_LINK", "NUMBER_UNSOURCED", "I_OPENER", "POV_MISSING"] as LintCode[]) has(errors, c);
  });

  it("line 1 'saw' after a greeting is banned; congrats-on-the-raise has its own code", () => {
    has(codes({ body: "Dana, saw the platform role went up last week. Who owns reconciliation once the hire starts, finance or the new engineer on your team?" }).errors, "BANNED_PHRASE");
    has(codes({ body: "Congrats on the raise, Dana. Your plan says the money goes to enterprise, so who on your team owns security reviews when those deals show up?" }).errors, "CONGRATS_OPENER");
  });

  it("2025–26 template tells fail", () => {
    has(codes({ body: `${GOOD_4T} Worth a look?` }).errors, "BANNED_PHRASE");
    has(codes({ body: GOOD_4T.replace("Is invoicing", "Curious if invoicing") }).errors, "BANNED_PHRASE");
    has(codes({ body: GOOD_4T.replace("The fix", "Usually that means the fix") }).errors, "BANNED_PHRASE");
  });

  it("fake Re: on a new thread fails; on a reply thread it's honest", () => {
    has(codes({ body: GOOD_4T, subject: "Re: usage tiers" }).errors, "FAKE_REPLY_SUBJECT");
    lacks(codes({ body: "Ana, one more thought on usage tiers: who signs off on invoices when usage spikes mid-month, finance or your billing engineer?", subject: "Re: usage tiers", step: 2, thread: "reply" }).errors, "FAKE_REPLY_SUBJECT");
  });

  it("placeholders fail", () => {
    has(codes({ body: GOOD_4T.replace("Ana,", "{first_name},") }).errors, "PLACEHOLDER");
    has(codes({ body: GOOD_4T.replace("Ana,", "[Name],") }).errors, "PLACEHOLDER");
  });

  it("platform: 'first platform hire' passes, 'our platform' fails, allowlist masks ICP vocabulary", () => {
    lacks(codes({ body: GOOD_ADVICE, frame: "founder_card", sourcedText: "30 calls" }).errors, "HYPE_WORD");
    has(codes({ body: GOOD_4T.replace("a BI dashboard", "our platform") }).errors, "HYPE_WORD");
    lacks(codes({ body: GOOD_4T.replace("a BI dashboard", "a data platform"), allowWords: ["data platform"] }).errors, "HYPE_WORD");
  });

  it("AI vocabulary fails", () => {
    has(codes({ body: GOOD_4T.replace("tends to become", "becomes a crucial") }).errors, "AI_VOCAB");
  });

  it("I-opener and you-ratio fail outside advice frames, pass in founder_card", () => {
    const meFirst = "I'm building billing tools and we think our approach to usage data is better than what we see elsewhere. We built it after years at Stripe and we know the space. Is invoicing from usage on your list this quarter?";
    const r = codes({ body: meFirst });
    has(r.errors, "I_OPENER");
    has(r.errors, "YOU_RATIO");
    const fc = codes({ body: meFirst, frame: "founder_card" });
    lacks(fc.errors, "I_OPENER");
    lacks(fc.errors, "YOU_RATIO");
  });

  it("one ask: two questions fail, a P.S. question is allowed", () => {
    has(codes({ body: `${GOOD_4T} Want to compare how you handle it?` }).errors, "MULTI_CTA");
    lacks(codes({ body: `${GOOD_4T}\n\nP.S. If this isn't yours, who owns it?` }).errors, "MULTI_CTA");
  });

  it("links: none in touch 1; reply frame may share a scheduling link", () => {
    has(codes({ body: `${GOOD_4T} More at https://ledgerline.dev/usage` }).errors, "LINK_T1");
    const reply = codes({ body: "Thanks, Ana. Tuesday Oct 27 at 10:00 PT or Wednesday Oct 28 at 2:00 PT both work. If neither fits, grab any slot at https://calendly.com/priya/30min.", frame: "reply", step: 1, thread: "reply", subject: null });
    lacks(reply.errors, "CALENDAR_LINK");
    lacks(reply.errors, "LINK_T1");
  });

  it("claim numbers need a source; scheduling numbers don't", () => {
    has(codes({ body: GOOD_4T.replace("tends to become", "takes 40% longer and becomes") }).errors, "NUMBER_UNSOURCED");
    lacks(codes({ body: GOOD_4T.replace("takes", "x").replace("Is invoicing", "Could we take 20 minutes Tuesday on whether invoicing"), sourcedText: "" }).errors, "NUMBER_UNSOURCED");
    lacks(codes({ body: GOOD_4T.replace("tends to become", "takes 40% longer and becomes"), sourcedText: "Close takes 40 percent longer" }).errors, "NUMBER_UNSOURCED");
    const close = "Dana, sounds like the timing is off for you, so this is my last note. Is reconciliation worth checking back in 6 months?";
    lacks(codes({ body: close, step: 3, frame: "permission_to_close", thread: "reply", subject: null, sourcedText: "" }).errors, "NUMBER_UNSOURCED");
    has(codes({ body: GOOD_4T.replace("tends to become", "could cut close by 10 days instead of becoming"), sourcedText: "" }).errors, "NUMBER_UNSOURCED");
  });

  it("resource offers need an asset", () => {
    const offer = GOOD_4T.replace(/Is invoicing.*$/, "Want the one-pager on how two teams fixed it?");
    has(codes({ body: offer }).errors, "ASSET_MISSING");
    lacks(codes({ body: offer, assetId: "ast_1" }).errors, "ASSET_MISSING");
    has(codes({ body: GOOD_4T.replace("The fix", "I have a quick teardown. The fix") }).errors, "BANNED_PHRASE");
    lacks(codes({ body: GOOD_4T.replace("Is invoicing", "Does invoicing report to finance, or is invoicing") }).errors, "ASSET_MISSING");
  });

  it("length: >100 fails, 91–100 warns, under 40 warns", () => {
    const long = `${GOOD_4T} ${GOOD_4T.split(" ").slice(0, 40).join(" ")}`;
    has(codes({ body: long }).errors, "LEN_OVER");
    const r95 = codes({ body: `${GOOD_4T} ${"really ".repeat(95 - 63).trim()}.` });
    expect(r95.r.stats.words).toBeGreaterThan(90);
    expect(r95.r.stats.words).toBeLessThanOrEqual(100);
    has(r95.warns, "LEN_OVER");
    has(codes({ body: "Ana, is invoicing from usage data on your list this quarter, or later?" }).warns, "LEN_UNDER");
  });

  it("final touch caps at 45 words", () => {
    has(codes({ body: `${GOOD_4T}`, step: 3, frame: "permission_to_close", thread: "reply", subject: null }).errors, "LEN_OVER");
  });

  it("formatting: em dashes and caps warn only", () => {
    const r = codes({ body: GOOD_4T.replace("two systems,", "two systems — finance and billing —").replace("BI dashboard", "DASHBOARD") });
    has(r.warns, "EM_DASH");
    has(r.warns, "ALL_CAPS");
    expect(r.r.passed).toBe(true);
  });

  it("not-just-but structure fails", () => {
    has(codes({ body: GOOD_4T.replace("The fix most teams try first", "It's not just a tooling gap, but an ownership gap. The fix most teams try first") }).errors, "NOT_JUST_BUT");
  });

  it("LinkedIn: notes over 200 chars and messages over 300 fail", () => {
    const note = "Enjoyed your KubeCon talk on cost alerts arriving a sprint too late. I'm working on per-service spend before merge and would value comparing notes with someone who has clearly thought about it this much.";
    has(lintDraft({ ...base, kind: "linkedin_note", frame: "mouse_trap", subject: null, body: `${note} ${note}` }).violations.map((v) => v.code), "LI_CHARS");
    expect(lintDraft({ ...base, kind: "linkedin_note", frame: "mouse_trap", subject: null, body: "Your KubeCon point on cost alerts arriving a sprint late matched what I hear from platform leads. Would be glad to connect." }).passed).toBe(true);
  });

  it("spans: names and numbers must be in the quote", () => {
    const body = "Dana, Northwind raised $40M in March to expand to EMEA. Who owns invoicing when the first EU customer signs, finance or your billing engineer on the platform team?";
    const bad = codes({ body, spans: [{ text: "Northwind raised $40M in March to expand to EMEA", support: "Northwind raised a $12M Series A to grow its team techcrunch.com March 2026" }], knownNames: ["Northwind"] });
    has(bad.errors, "SPAN_UNSUPPORTED");
    const good = codes({ body, spans: [{ text: "Northwind raised $40M in March to expand to EMEA", support: "raised $40M to expand into EMEA techcrunch.com March 2026" }], knownNames: ["Northwind"], sourcedText: "$40M" });
    lacks(good.errors, "SPAN_UNSUPPORTED");
    has(codes({ body, spans: [{ text: "Northwind raised $40M", support: null }] }).errors, "SPAN_UNSUPPORTED");
  });

  it("POV required on cold first touches", () => {
    has(codes({ body: GOOD_4T, requirePov: true }).errors, "POV_MISSING");
    lacks(codes({ body: GOOD_4T, requirePov: true, povId: "pov_1" }).errors, "POV_MISSING");
  });

  it("convergence: near-duplicate to another company and repeated openers fail", () => {
    const twin = GOOD_4T.replace("Ana", "Raj").replace("June", "July");
    has(codes({ body: GOOD_4T, recent: [{ body: twin, sameAccount: false, ageDays: 3, label: "your draft to Lumen" }] }).errors, "NEAR_DUPLICATE");
    const sameOpen = Array.from({ length: 6 }, (_, i) => ({
      body: `Mo, your pricing page moved ${["north", "south", "east", "west", "up", "on"][i]} to something else entirely and the rest differs ${i}. Who owns it?`,
      sameAccount: false,
      ageDays: 2,
    }));
    has(codes({ body: GOOD_4T, recent: sameOpen }).errors, "SKELETON_REPEAT");
    lacks(codes({ body: GOOD_ADVICE, frame: "founder_card", sourcedText: "30 calls", recent: sameOpen }).errors, "SKELETON_REPEAT");
  });
});

describe("lint helpers", () => {
  it("picks word limits by kind, frame and step", () => {
    expect(limitsFor({ kind: "email", frame: "4t", step: 1 })).toBe(LIMITS.cold1);
    expect(limitsFor({ kind: "email", frame: "mouse_trap", step: 1 })).toBe(LIMITS.shortQuestion);
    expect(limitsFor({ kind: "email", frame: "4t", step: 2 })).toBe(LIMITS.followUp);
    expect(limitsFor({ kind: "email", frame: "4t", step: 3 })).toBe(LIMITS.final);
    expect(limitsFor({ kind: "email", frame: "permission_to_close", step: 2 })).toBe(LIMITS.final);
    expect(limitsFor({ kind: "email", frame: "reply", step: 3 })).toBe(LIMITS.reply);
    expect(limitsFor({ kind: "linkedin_note", frame: "mouse_trap", step: 1 })).toBeNull();
  });

  it("counts words, not punctuation", () => {
    expect(countWords("Ana, is invoicing — or close — on your list? 3 teams")).toBe(10);
    expect(countWords("   ")).toBe(0);
  });

  it("merges results: errors first, and one error fails the whole", () => {
    const note = lintDraft({ ...base, kind: "linkedin_note", frame: "mouse_trap", subject: null, body: "Great talk!" });
    const dm = lintDraft({ ...base, kind: "linkedin_dm", frame: "mouse_trap", subject: null, body: "Your KubeCon point on cost alerts arriving a sprint late matched what I hear. Do your teams see spend per service before merge?" });
    const merged = mergeLint([dm, note]);
    expect(merged.passed).toBe(false);
    expect(merged.stats).toEqual(dm.stats);
    expect(merged.violations.map((v) => v.severity)).toEqual([...merged.violations.map((v) => v.severity)].sort());
    expect(worstIssue(merged)?.code).toBe("EXCLAMATION");
    expect(worstIssue(dm)).toBeNull();
  });
});
