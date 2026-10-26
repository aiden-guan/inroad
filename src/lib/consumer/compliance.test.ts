import { describe, expect, it } from "vitest";
import { lintDraft } from "@/lib/quality/lint";
import { consumerChecks } from "./compliance";

const codes = (text: string, opts: Omit<Parameters<typeof consumerChecks>[0], "text"> = {}) => consumerChecks({ text, ...opts }).map((v) => v.code);

describe("disclosure", () => {
  it("requires #ad up front on paid or gifted posts", () => {
    expect(codes("Loving my new running plan from @pacely", { sponsored: true, where: "post" })).toContain("DISCLOSURE_MISSING");
    expect(codes("#ad Loving my new running plan from @pacely", { sponsored: true, where: "post" })).toEqual([]);
    expect(codes("Ad · My first 5K plan, with @pacely", { sponsored: true, where: "post" })).toEqual([]);
  });

  it("doesn't accept weak tags or a disclosure below the fold", () => {
    const weak = consumerChecks({ text: "My first 5K plan #sp #collab", sponsored: true, where: "post" });
    expect(weak[0].detail).toContain("“#sp” doesn't count");
    const late = `${"I ran every day this month and here is what I learned about pacing, hills and rest days. ".repeat(2)}#ad`;
    expect(codes(late, { sponsored: true, where: "post" })).toContain("DISCLOSURE_MISSING");
  });

  it("requires a brief to tell the creator to disclose", () => {
    expect(codes("Make one video about your first week.", { sponsored: true, where: "brief" })).toContain("DISCLOSURE_MISSING");
    expect(codes("Make one video. Start the caption with #ad.", { sponsored: true, where: "brief" })).toEqual([]);
  });

  it("leaves unpaid posts alone", () => {
    expect(codes("Loving my new running plan", { where: "post" })).toEqual([]);
  });
});

describe("reviews and social proof", () => {
  it("blocks steering or rewarding reviews", () => {
    expect(codes("If you like it, leave us a 5-star review!")).toContain("REVIEW_INCENTIVE");
    expect(codes("Rate us on the App Store and get 20% off your next month.")).toContain("REVIEW_INCENTIVE");
    expect(codes("We'd love a positive review on Amazon.")).toContain("REVIEW_INCENTIVE");
  });

  it("allows an honest review ask with no reward", () => {
    expect(codes("If it helped, an honest review on the App Store helps other runners find it.")).toEqual([]);
  });

  it("blocks fake proof and upvote asks", () => {
    expect(codes("We could buy followers to look bigger.")).toContain("FAKE_SOCIAL_PROOF");
    expect(codes("Please upvote us on Product Hunt today.")).toContain("FAKE_SOCIAL_PROOF");
    expect(codes("Post it from several accounts so it trends.")).toContain("FAKE_SOCIAL_PROOF");
  });
});

describe("claims", () => {
  it("flags health and earnings claims", () => {
    expect(codes("Our serum cures acne in a week.")).toContain("HEALTH_CLAIM");
    expect(codes("Clinically proven to help you sleep.")).toContain("HEALTH_CLAIM");
    expect(codes("Lose 10 lbs before summer.")).toContain("HEALTH_CLAIM");
    expect(codes("Creators make $5,000 a month with our tool.")).toContain("EARNINGS_CLAIM");
  });

  it("reads a do-not list as a rule, not a claim", () => {
    expect(codes("Please don't say it cures acne or that it's clinically proven.", { where: "brief" })).toEqual([]);
  });

  it("warns on guarantees, fake urgency, green claims and free trials without terms", () => {
    const v = consumerChecks({ text: "Risk-free. Only 3 left! Our eco-friendly bottle. Start your free trial today." });
    expect(v.map((x) => x.code).sort()).toEqual(["ENV_CLAIM", "FALSE_URGENCY", "FREE_TERMS", "GUARANTEE_CLAIM"]);
    expect(v.every((x) => x.severity === "warn")).toBe(true);
    expect(codes("Start your free trial: 14 days, then $9.99 a month. Cancel anytime.")).not.toContain("FREE_TERMS");
  });

  it("warns when a brief scripts the opinion", () => {
    expect(codes("Read this script word for word and say you love it. #ad", { sponsored: true, where: "brief" })).toContain("SCRIPTED_OPINION");
  });
});

describe("partner outreach", () => {
  it("asks what the creator gets", () => {
    expect(codes("Your week-one videos are exactly what our users watch. Want to try it?", { partnerOutreach: true })).toContain("OFFER_MISSING");
    expect(codes("Your week-one videos fit our users. We'd pay $300 for one video.", { partnerOutreach: true })).not.toContain("OFFER_MISSING");
  });

  it("runs inside the linter for consumer kinds, with consumer writing rules", () => {
    const dm = lintDraft({
      subject: null,
      body: "Your couch-to-5K series is what our first users watch. I'm Maya, I built Pacely, a plan for first-time runners. Would you try it for a month? We pay $250 for one video, within 7 days of posting. Paid posts carry #ad.",
      frame: "founder_card",
      step: 1,
      kind: "partner_dm",
    });
    expect(dm.violations.filter((v) => v.severity === "error")).toEqual([]);
    const bad = lintDraft({ subject: null, body: "Leave us a 5-star review and we'll send you a free month 🎉", frame: "founder_card", step: 1, kind: "partner_dm" });
    expect(bad.passed).toBe(false);
    expect(bad.violations[0].code).toBe("REVIEW_INCENTIVE");
    // Emoji is a warning in consumer outreach, not an error.
    expect(bad.violations.find((v) => v.code === "EMOJI")?.severity).toBe("warn");
  });

  it("leaves business email lint unchanged", () => {
    const email = lintDraft({ subject: "close timing", body: "Your team cut close from 9 days to 6 days. Our customers say it's guaranteed. Worth comparing notes?", frame: "4t", step: 2, kind: "email" });
    expect(email.violations.some((v) => v.code === "GUARANTEE_CLAIM")).toBe(false);
  });
});
