import { describe, expect, it } from "vitest";
import { TODAY, at, consumerWorkspace, day, makeCompany, makePartner, makeWorkspace } from "@/test/factories";
import { retentionBar } from "./benchmarks";
import { isConsumer, marketOf, readMarket } from "./market";
import { interviewInvite, partnerKey, partnerNext, partnerResults, referralAsk } from "./partners";
import { ACTIVE_MOTIONS, consumerChannelPlan, consumerCommercial, consumerGoal, growthDefaults } from "./plan";

describe("market", () => {
  it("reads business by default, so older workspaces don't change", () => {
    expect(marketOf(makeWorkspace())).toBe("b2b");
    expect(isConsumer(makeWorkspace({ company: makeCompany() }))).toBe(false);
    expect(isConsumer(consumerWorkspace())).toBe(true);
  });

  it("reads store links and carts as consumer, demos and seats as business", () => {
    const app = readMarket('<a href="https://apps.apple.com/us/app/pacely/id123">App Store</a>', "Download the app. Free for 7 days.");
    expect(app).toMatchObject({ market: "consumer", model: "app" });
    expect(app.hints).toContain("App Store link");
    const shop = readMarket('<script src="https://cdn.shopify.com/s/files/theme.js"></script>', "Add to cart. Free shipping over $40.");
    expect(shop).toMatchObject({ market: "consumer", model: "dtc", confidence: "high" });
    const market = readMarket("", "Become a host and list your space. For buyers and sellers.");
    expect(market).toMatchObject({ market: "consumer", model: "marketplace" });
    const b2b = readMarket('<a href="https://calendly.com/acme">Book</a>', "Book a demo. $20 per seat per month. SOC 2 Type II.");
    expect(b2b).toMatchObject({ market: "b2b", model: null });
  });
});

describe("retention bars", () => {
  it("holds each model to its category's 6-month bar", () => {
    expect(retentionBar("social", false)).toMatchObject({ metric: "w4", target: 25, good: 45 });
    expect(retentionBar("marketplace", false)).toMatchObject({ target: 30, good: 50 });
    expect(retentionBar("app", true)).toMatchObject({ target: 40, good: 70 });
    expect(retentionBar("app", false)).toMatchObject({ target: 25 });
    expect(retentionBar("prosumer", false)).toMatchObject({ target: 40 });
    expect(retentionBar("dtc", true)).toMatchObject({ metric: "m3_repeat", target: 12 });
  });

  it("always fills the bar in code, even over a saved growth model", () => {
    const ws = consumerWorkspace();
    ws.foundation!.growth = { ...growthDefaults(ws), retention: { metric: "w4", target: 5, good: 10, source: "made up" } };
    expect(growthDefaults(ws).retention.target).toBe(40);
  });
});

describe("consumer plan", () => {
  it("sets a goal that counts users or customers", () => {
    expect(consumerGoal("app")).toMatchObject({ metric: "active_users", target: 100 });
    expect(consumerGoal("dtc")).toMatchObject({ metric: "paying", targetLabel: "customers" });
  });

  it("ranks early channels by model, paid last", () => {
    const app = consumerChannelPlan(consumerWorkspace()).motions.map((m) => m.motion);
    expect(app.slice(0, 2)).toEqual(["user_conversations", "hand_recruiting"]);
    expect(app.at(-1)).toBe("paid_social");
    const market = consumerChannelPlan(consumerWorkspace({}, "marketplace")).motions.map((m) => m.motion);
    expect(market[0]).toBe("supply_seeding");
    const social = consumerChannelPlan(consumerWorkspace({}, "social")).motions.map((m) => m.motion);
    expect(social[0]).toBe("ambassadors");
    expect(ACTIVE_MOTIONS).toBe(3);
  });

  it("starts with the waitlist before launch and drops paid", () => {
    const ws = consumerWorkspace();
    ws.company!.stage = "pre_launch";
    const motions = consumerChannelPlan(ws).motions.map((m) => m.motion);
    expect(motions[0]).toBe("waitlist");
    expect(motions).not.toContain("paid_social");
  });

  it("does the retention-first math", () => {
    const ws = consumerWorkspace();
    ws.goal.byDate = day(70); // 10 weeks
    // 100 weekly active users at a 40% bar takes 250 signups, 25 a week.
    expect(consumerChannelPlan(ws, { today: TODAY }).funnel.consumer).toEqual({ signupsNeeded: 250, signupsPerWeek: 25, retentionTarget: 40, weeks: 10 });
  });

  it("picks how a consumer pays by model", () => {
    expect(consumerCommercial(makeCompany({ market: "consumer", consumerModel: "app" })).structure).toBe("free_trial");
    expect(consumerCommercial(makeCompany({ market: "consumer", consumerModel: "app", howYouCharge: { model: "freemium", isPublic: true, summary: null } })).structure).toBe("freemium");
    expect(consumerCommercial(makeCompany({ market: "consumer", consumerModel: "dtc" })).structure).toBe("direct_purchase");
    expect(consumerCommercial(makeCompany({ market: "consumer", consumerModel: "marketplace" })).structure).toBe("take_rate");
    const trial = consumerCommercial(makeCompany({ market: "consumer", consumerModel: "app" }));
    expect(trial.terms).toContain("how to cancel");
  });
});

describe("partners", () => {
  it("dedupes the same creator however it was written", () => {
    expect(partnerKey({ name: "Maya", handle: "maya.runs", platform: "tiktok" })).toBe(partnerKey({ name: "Maya R", handle: "@Maya.Runs", platform: "tiktok" }));
    expect(partnerKey({ name: "x", url: "https://www.reddit.com/r/C25K/" })).toBe(partnerKey({ name: "y", url: "http://reddit.com/r/c25k" }));
  });

  it("knows whose move it is: one note, one follow-up a week later, then let go", () => {
    const fresh = makePartner("ptn_a");
    expect(partnerNext(fresh, TODAY).action).toBe("draft");
    const drafted = makePartner("ptn_a", { outreach: { channel: "dm", subject: null, body: "Hi", draftedAt: at(-1) } });
    expect(partnerNext(drafted, TODAY).action).toBe("send");
    const sent = makePartner("ptn_a", { stage: "contacted", outreach: { channel: "dm", subject: null, body: "Hi", draftedAt: at(-9), sentOn: day(-3) } });
    expect(partnerNext(sent, TODAY)).toMatchObject({ action: null, dueOn: day(4) });
    expect(partnerNext({ ...sent, outreach: { ...sent.outreach!, sentOn: day(-7) } }, TODAY).action).toBe("follow_up");
    const followed = { ...sent, outreach: { ...sent.outreach!, sentOn: day(-21), followedUpOn: day(-14) } };
    expect(partnerNext(followed, TODAY).action).toBe("let_go");
  });

  it("asks for a brief, a disclosure check and results in order", () => {
    expect(partnerNext(makePartner("ptn_a", { stage: "agreed" }), TODAY).action).toBe("brief");
    expect(partnerNext(makePartner("ptn_a", { stage: "agreed", briefAssetId: "ast_1" }), TODAY).action).toBe("go_live");
    const live = makePartner("ptn_a", { stage: "live", offer: { type: "flat_fee", amountUsd: 300 }, stageHistory: [{ stage: "live", at: at(-8) }] });
    expect(partnerNext(live, TODAY).action).toBe("check_disclosure");
    expect(partnerNext({ ...live, disclosure: "confirmed" }, TODAY).action).toBe("log_results");
    const logged = { ...live, disclosure: "confirmed" as const, results: [{ at: at(0), signups: 30 }] };
    expect(partnerNext(logged, TODAY).action).toBeNull();
    expect(partnerResults(logged)).toEqual({ costUsd: 300, signups: 30, orders: 0, costPer: 10 });
  });

  it("writes the interview invite and referral ask in code", () => {
    const invite = interviewInvite({ founderName: "Maya Chen", product: "Pacely" });
    expect(invite.subject).toBe("15 minutes about Pacely?");
    expect(invite.body).toContain("No pitch");
    expect(referralAsk({ founderName: "Maya Chen", product: "Pacely" })).not.toMatch(/review|rating/i);
  });
});
