import { daysBetween, todayISO } from "@/lib/domain/ids";
import type { ChannelPlan, CommercialDefault, CompanySnapshot, ConsumerModel, Goal, GrowthModel, Motion, Workspace } from "@/lib/domain/types";
import { APP_STORE, FIRST_USERS, PAID_SOCIAL, SUBSCRIPTION_APPS, retentionBar } from "./benchmarks";

/**
 * The consumer playbook's code-filled parts: the goal, the channel plan, the pricing default and the growth model's
 * fallbacks. Pure and isomorphic. The rules come from docs/research/10-consumer-gtm.md; weekly targets marked as Inroad
 * defaults are starting points the founder's own numbers replace.
 */

/** At most this many motions are "now". No startup in Lenny Rachitsky's first-1,000-users study succeeded with more than three. */
export const ACTIVE_MOTIONS = FIRST_USERS.maxChannels.value;
export const USER_TALKS_PER_WEEK = 5;
export const CREATOR_ASKS_PER_WEEK = 5;

type MotionCopy = Omit<ChannelPlan["motions"][number], "rank" | "motion">;

/** Consumer goal defaults: the first 100 people who keep coming back (or buying). */
export function consumerGoal(model: ConsumerModel): Pick<Goal, "metric" | "target" | "targetLabel" | "userTalksPerWeek"> {
  return model === "dtc"
    ? { metric: "paying", target: 100, targetLabel: "customers", userTalksPerWeek: USER_TALKS_PER_WEEK }
    : { metric: "active_users", target: 100, targetLabel: "weekly active users", userTalksPerWeek: USER_TALKS_PER_WEEK };
}

function charges(company: CompanySnapshot | null): boolean {
  const m = company?.howYouCharge.model;
  return !!m && m !== "unknown" && m !== "freemium";
}

function motionCopy(ws: Workspace): Record<ConsumerMotion, MotionCopy> {
  const talks = ws.goal.userTalksPerWeek ?? USER_TALKS_PER_WEEK;
  return {
    user_conversations: {
      why: "Until retention holds, the fastest learning is a 15-minute call with someone who just signed up, or just left.",
      weeklyTarget: `${talks} user conversations (new, active and churned users)`,
      firstActions: ["Invite your last 10 signups to a 15-minute call", "Ask what they did right before they found you", "Call 2 people who stopped using it"],
    },
    hand_recruiting: {
      why: "Do things that don't scale: recruit the first users one by one, where a very specific audience already gathers. Over half of startups in Lenny Rachitsky's 100+ startup study started this way.",
      weeklyTarget: "10 users recruited by hand from one place",
      firstActions: ["Name the one place your first 100 users already gather", "Set the first 10 up yourself, in person or on a call", "Write down what each one did in their first session"],
    },
    communities: {
      why: "Your users ask for help in public. A useful answer beats a pitch, and each community's own rules decide what self-promotion is allowed.",
      weeklyTarget: "3 useful replies where your users ask, no link unless the rules allow it",
      firstActions: ["Read the rules of the 2 communities where your users ask for help", "Answer one question this week without a link"],
    },
    creators: {
      why: "Creators already hold your audience's attention. Small creators with the right audience beat big ones with a general audience: judge median recent views and fit, not followers.",
      weeklyTarget: `${CREATOR_ASKS_PER_WEEK} creator outreach messages, one follow-up each after a week`,
      firstActions: ["List 10 creators your best users already watch", "Offer the product plus a clear fee or commission, with payment terms", "Write the brief before anyone posts, disclosure included"],
    },
    short_video: {
      why: "Short video is where consumer attention is. Test hooks, not polish: one platform, one format, many first lines.",
      weeklyTarget: "3 short videos on one platform (Inroad default)",
      firstActions: ["Pick one platform your users watch daily", "Write 10 first lines from what users told you", "Post 3 this week and keep the one that holds viewers past 3 seconds"],
    },
    referral_loop: {
      why: "Referrals amplify word of mouth; they don't create it. Where they work they bring 15–50% of new users, and fewer than 10% of users ever refer.",
      weeklyTarget: "Ask 10 activated users for one invite",
      firstActions: ["Put the invite ask right after the first win, not at signup", "Reward a real action (a friend who activates), double-sided, with a yearly cap", "Never reward reviews or ratings"],
    },
    waitlist: {
      why: "Before launch, a list of people who asked for it is the asset. Use the signup to learn who they are; scarcity alone fades fast.",
      weeklyTarget: "50 new people on the list, each asked one question",
      firstActions: ["Ask every signup one question: what they use today", "Invite the best-fit 10 first and talk to each"],
    },
    app_store: {
      why: "The store page is a landing page with search. Apple gives 30 characters of name, 30 of subtitle and 100 of keywords, and only the first screenshots show in search.",
      weeklyTarget: "One store-page change at a time, measured",
      firstActions: [
        `Fill the ${APP_STORE.keywordChars}-character keyword field (commas, no spaces)`,
        `Nominate the launch for featuring at least ${APP_STORE.featuringLeadWeeks} weeks ahead in App Store Connect`,
        `Ask for ratings with the system prompt after a completed action (Apple allows ${APP_STORE.ratingPromptsPerYear} a year)`,
      ],
    },
    seo: {
      why: "Search compounds once you know the questions people ask before they need you. It's slow: start once you know your users' words.",
      weeklyTarget: "2 pages answering a search your users make",
      firstActions: ["Collect 20 questions users asked before they found you", "Write the page for the most common one"],
    },
    paid_social: {
      why: `Paid buys learning about messages, not growth, until retention holds. An ad set needs about ${PAID_SOCIAL.eventsToLeaveLearning.value} conversions in 7 days to leave Meta's learning phase (third-party figure).`,
      weeklyTarget: `One test, budget about ${PAID_SOCIAL.eventsToLeaveLearning.value} × your target cost per signup, only after week-4 retention clears the bar`,
      firstActions: ["Turn your best 3 creator or user videos into ads", "Decide the cost per signup you can afford before spending"],
    },
    press: {
      why: "Press is a spike. It works when there's a story beyond the launch: a number, a trend, a founder with a reason.",
      weeklyTarget: "1 pitch to a reporter who covered your space recently",
      firstActions: ["Find 5 reporters who wrote about your alternative this year", "Write the story in one sentence without the product name"],
    },
    ambassadors: {
      why: "Social products need density: everyone in one campus or group, not a few people everywhere. Ambassadors make the first group dense.",
      weeklyTarget: "1 ambassador recruited for the next group",
      firstActions: ["Pick one campus or group to fill first", "Reward ambassadors for friends who activate, never for downloads or reviews"],
    },
    supply_seeding: {
      why: "Most marketplaces start with supply (14 of 17 in Lenny Rachitsky's study) and constrain to one city or category first. Bring the hard side on by hand.",
      weeklyTarget: "5 suppliers onboarded by hand in one city or category",
      firstActions: ["Pick the one city or category to make liquid first", "List the first 20 suppliers yourself", "Make the first sale happen for each, even by hand"],
    },
    pop_ups: {
      why: "Physical products sell when people can touch and taste them. In-person sampling also gives you customer words and emails, with consent.",
      weeklyTarget: "1 in-person sampling event a month",
      firstActions: ["Find one market, gym, campus or shop where your customer already is", "Collect emails with an explicit opt-in"],
    },
  };
}

/** Business motions that also make sense for consumer founders, with consumer wording. */
function sharedCopy(model: ConsumerModel): Pick<Record<Motion, MotionCopy>, "founder_content" | "launches"> {
  return {
    founder_content: {
      why: "Writing in public about what you learn from users makes every later ask warmer, and it's the cheapest content you'll ever make.",
      weeklyTarget: "2 posts on what your users taught you",
      firstActions: ["Post one thing you learned from your last 5 user conversations"],
    },
    launches: {
      why:
        model === "app" || model === "social"
          ? "A launch is a spike, not a channel. Line up the store nomination and the people who'll try it on day one before the date."
          : "A launch is a spike, not a channel. Launch when people can try it without talking to you.",
      weeklyTarget: "One launch, when there's something to try",
      firstActions: ["Line up 20 people who'll try it on launch day", "On Product Hunt, never ask outright for upvotes"],
    },
  };
}

/** Motions only the business plan uses, plus the two shared ones written separately below. */
type B2BMotion = "warm_network" | "signal_cold" | "investor_intros" | "exec_dinners" | "design_partner_program" | "founder_content" | "launches";
type ConsumerMotion = Exclude<Motion, B2BMotion>;

const ORDER: Record<ConsumerModel, { early: Motion[]; later: Motion[] }> = {
  app: {
    early: ["user_conversations", "hand_recruiting", "communities", "creators", "short_video", "launches", "referral_loop", "app_store", "paid_social"],
    later: ["referral_loop", "creators", "short_video", "app_store", "seo", "paid_social", "press", "user_conversations"],
  },
  dtc: {
    early: ["hand_recruiting", "user_conversations", "creators", "short_video", "pop_ups", "communities", "launches", "paid_social"],
    later: ["creators", "paid_social", "referral_loop", "short_video", "press", "seo", "pop_ups", "user_conversations"],
  },
  marketplace: {
    early: ["supply_seeding", "hand_recruiting", "user_conversations", "communities", "referral_loop", "seo", "paid_social"],
    later: ["seo", "referral_loop", "supply_seeding", "paid_social", "press", "user_conversations"],
  },
  social: {
    early: ["ambassadors", "hand_recruiting", "user_conversations", "referral_loop", "short_video", "launches", "creators"],
    later: ["referral_loop", "ambassadors", "short_video", "creators", "press", "user_conversations"],
  },
  prosumer: {
    early: ["user_conversations", "communities", "founder_content", "short_video", "creators", "launches", "referral_loop", "seo"],
    later: ["seo", "referral_loop", "founder_content", "creators", "launches", "paid_social", "user_conversations"],
  },
};

/** Pre-PMF until the growth log shows week-4 retention at the bar (see growth.ts); the stage the site shows is a first guess. */
export function isEarly(stage: CompanySnapshot["stage"], retentionHolds: boolean): boolean {
  if (retentionHolds) return false;
  return stage !== "scaling";
}

/**
 * The consumer channel plan. Code ranks; the top ACTIVE_MOTIONS are "now". Paid sits last until retention holds.
 * The funnel math is retention-first: active users needed ÷ the retention bar = signups needed.
 */
export function consumerChannelPlan(ws: Workspace, opts: { retentionHolds?: boolean; today?: string } = {}): ChannelPlan {
  const model = ws.company?.consumerModel ?? "app";
  const stage = ws.company?.stage ?? "unknown";
  const early = isEarly(stage, !!opts.retentionHolds);
  let order = early ? ORDER[model].early : ORDER[model].later;
  if (stage === "pre_launch") order = ["waitlist", ...order.filter((m) => m !== "waitlist" && m !== "paid_social")];
  const copy: Partial<Record<Motion, MotionCopy>> = { ...motionCopy(ws), ...sharedCopy(model) };

  const weeks = Math.max(4, Math.round(daysBetween(opts.today ?? todayISO(), ws.goal.byDate) / 7) || 12);
  const bar = growthDefaults(ws).retention;
  const retained = Math.max(0.05, bar.target / 100);
  const target = ws.goal.metric === "deals" ? 100 : ws.goal.target;
  const signupsNeeded = Math.ceil(target / retained);
  const signupsPerWeek = Math.ceil(signupsNeeded / weeks);
  const talks = ws.goal.userTalksPerWeek ?? USER_TALKS_PER_WEEK;
  const warning =
    signupsPerWeek > 150
      ? `At a ${bar.target}% retention bar, ${target} ${ws.goal.targetLabel} by ${ws.goal.byDate} takes about ${signupsPerWeek} signups a week. Raise retention first: every point of retention cuts the signups you need.`
      : undefined;

  return {
    funnel: {
      qualifiedNeeded: 0,
      discoveryCallsNeeded: 0,
      coldContactsNeeded: 0,
      perWeek: { conversations: talks, firstTouches: CREATOR_ASKS_PER_WEEK, introAsks: 0, meetings: 0 },
      warning,
      consumer: { signupsNeeded, signupsPerWeek, retentionTarget: bar.target, weeks },
    },
    motions: order.flatMap((motion, i) => (copy[motion] ? [{ motion, rank: i + 1, ...copy[motion] }] : [])),
  };
}

/** How a consumer pays, by model. Numbers are cited; the price itself is the founder's to test. */
export function consumerCommercial(company: CompanySnapshot | null): CommercialDefault {
  const model = company?.consumerModel ?? "app";
  const freemium = company?.howYouCharge.model === "freemium";
  const subscriptionTerms = `Show the paywall in onboarding, right after the first win. RevenueCat's 2026 data (vendor): hard paywalls reach ${SUBSCRIPTION_APPS.hardPaywallDay35.value}% download-to-paid by day 35 vs ${SUBSCRIPTION_APPS.freemiumDay35.value}% for freemium; 17–32-day trials convert ${SUBSCRIPTION_APPS.longTrialToPaid.value}% vs ${SUBSCRIPTION_APPS.shortTrialToPaid.value}% under 4 days. Offer annual and monthly; most annual subscribers churn in year one (${SUBSCRIPTION_APPS.annualYearOneRetention.value}% renew).`;
  const renewalRule =
    "Auto-renewal: state the price, the renewal date and how to cancel before checkout, and make cancelling as easy as signing up (US ROSCA and state auto-renewal laws such as California's, updated July 2025, still apply after the FTC click-to-cancel rule was vacated).";
  switch (model) {
    case "dtc":
      return {
        structure: "direct_purchase",
        terms: "One price at checkout. Contribution margin after product, shipping and payment fees (CM2) has to pay for acquisition: break-even marketing efficiency (revenue ÷ marketing spend) is 1 ÷ CM2%. Subscribe-and-save only for things people run out of.",
        priceAnchor: "Price against what people pay for the alternative today, then check CM2: if 1 ÷ CM2% is a marketing efficiency you can't reach, paid acquisition can't pay back at that price.",
        discountRule: "Discount for a first order or a bundle, never with a fake deadline or a countdown that resets.",
      };
    case "marketplace":
      return {
        structure: "take_rate",
        terms: "Revenue = transaction value × take rate. Charge the side that gets the most value, at the moment the value lands. Keep the hard side's cost near zero until it is reliably earning.",
        priceAnchor: "Etsy's 6.5% transaction fee vs its 24.2% all-in take rate shows the range: start with the transaction fee and add paid services later.",
        discountRule: "Waive fees for a supplier's first sales instead of discounting the buyer.",
      };
    case "social":
      return {
        structure: "freemium",
        terms: "Free until the network is dense. Charging before retention holds shrinks the network you need. Paid features later: for power users, never for the basics that make the network work.",
        priceAnchor: "No price yet. Revisit when week-4 retention clears the bar.",
        discountRule: "No paid growth tricks: never pay for reviews, ratings or followers.",
      };
    case "prosumer":
      return {
        structure: freemium ? "freemium" : "free_trial",
        terms: freemium
          ? `Free for the job's basics, paid for what power users need. Consumer freemium converts low: RevenueCat's freemium day-35 median is ${SUBSCRIPTION_APPS.freemiumDay35.value}% (vendor). ${renewalRule}`
          : `${subscriptionTerms} ${renewalRule}`,
        priceAnchor: "Price against the time or money the job costs them today, not your cost. Test one higher price on new users only.",
        discountRule: "Discount the annual plan, not the monthly one. Never a fake deadline.",
      };
    default:
      return {
        structure: freemium || !charges(company) ? "freemium" : "free_trial",
        terms: freemium || !charges(company) ? `Free first; paid for what power users need. A paywall early converts better than a late one: ${SUBSCRIPTION_APPS.hardPaywallDay35.value}% vs ${SUBSCRIPTION_APPS.freemiumDay35.value}% by day 35 (RevenueCat 2026, vendor). ${renewalRule}` : `${subscriptionTerms} ${renewalRule}`,
        priceAnchor: "Start near what the closest alternative charges and test one higher price on new users only. Never change an existing subscriber's price without notice.",
        discountRule: "Discount the annual plan, not the monthly one. Never a fake deadline or a countdown that resets.",
      };
  }
}

const NORTH_STAR: Record<ConsumerModel, string> = {
  app: "Weekly active users who complete the core action",
  dtc: "Customers who order a second time",
  marketplace: "Completed transactions a week",
  social: "Weekly active users who post, reply or invite",
  prosumer: "Weekly active users who finish the job they came for",
};

const CADENCE: Record<ConsumerModel, GrowthModel["cadence"]> = { app: "weekly", dtc: "occasional", marketplace: "monthly", social: "daily", prosumer: "weekly" };
const LOOP: Record<ConsumerModel, GrowthModel["primaryLoop"]> = {
  app: { kind: "word_of_mouth", how: "Users who get the value tell a friend; an invite ask right after the first win makes it easy." },
  dtc: { kind: "creator", how: "Creators show the product in use; their best videos become ads once repeat purchase holds." },
  marketplace: { kind: "marketplace", how: "More supply means better matches, which brings more demand, which brings more supply, one city or category at a time." },
  social: { kind: "viral", how: "Each user invites the people they want there; the product is only good once their friends are on it." },
  prosumer: { kind: "content", how: "What users make or learn with the product is public, and it brings the next users." },
};
const FIRST_HUNDRED: Record<ConsumerModel, string[]> = {
  app: ["The one community or place your users already gather", "Friends of your first 10 users, asked one by one", "Set each of the first 10 up yourself"],
  dtc: ["Friends, family and their friends: the first 50 orders", "One market, gym or shop where your customer already is", "10 small creators who already use something like it"],
  marketplace: ["The first 20 suppliers, listed by hand in one city or category", "Buyers where those suppliers already have customers", "Make the first transactions happen by hand"],
  social: ["Everyone in one campus, school or group, through ambassadors", "Invites from the first users to their closest friends", "Launch day inside that one group"],
  prosumer: ["The communities where people doing this job ask for help", "Founder posts about the job, not the product", "Set each of the first 10 up yourself"],
};

/** What the growth model is before the strategist (or the founder) writes the product-specific parts. */
export function growthDefaults(ws: Pick<Workspace, "company" | "foundation">): GrowthModel {
  const model = ws.company?.consumerModel ?? "app";
  const structure = ws.foundation?.commercial.structure;
  const pays = structure === "free_trial" || structure === "direct_purchase" || charges(ws.company);
  const saved = ws.foundation?.growth;
  return {
    model,
    northStar: saved?.northStar ?? { metric: NORTH_STAR[model], why: "It counts people getting the value, not people arriving." },
    activation: saved?.activation ?? { event: "Completes the core action once", withinDays: 7, status: "hypothesis", howToTest: "Compare week-4 retention of users who did it in week 1 with those who didn't." },
    cadence: saved?.cadence ?? CADENCE[model],
    primaryLoop: saved?.primaryLoop ?? LOOP[model],
    // The bar always follows the model and pricing in code, even when the strategist wrote the rest.
    retention: retentionBar(model, pays),
    firstHundred: saved?.firstHundred?.length ? saved.firstHundred : FIRST_HUNDRED[model],
  };
}
