import type { LintCode } from "@/lib/domain/types";

/**
 * Consumer marketing rules the linter enforces on drafts, briefs and posts. Deterministic, no model calls.
 * Each rule names the rule-maker so the founder can check it (docs/research/10-consumer-gtm.md, compliance section).
 * This is a safety net, not legal advice: it catches the common mistakes, it can't certify a claim.
 *
 * Sources: FTC Endorsement Guides (16 CFR 255) and "Disclosures 101 for Social Media Influencers"; FTC Trade
 * Regulation Rule on Consumer Reviews and Testimonials (16 CFR 465, in force Oct 21, 2024); FTC Green Guides
 * (16 CFR 260, 2012 version); Apple App Store Review Guidelines 5.6.1; Google Play ratings policy; Product Hunt
 * community guidelines; UK CMA/ASA influencer guidance.
 */

export interface ConsumerCheckInput {
  text: string;
  /** Paid, gifted or affiliate content (a creator brief or a sponsored post): a clear disclosure is required. */
  sponsored?: boolean;
  /** "post": the disclosure must sit at the start. "brief": the brief must tell the creator to disclose. */
  where?: "post" | "brief" | "message";
  /** Outreach to a creator or partner: say what they get. */
  partnerOutreach?: boolean;
}

export interface ConsumerViolation {
  code: LintCode;
  detail: string;
  severity: "error" | "warn";
}

/** A disclosure the FTC and the CMA accept, written in the content itself. */
const STRONG_DISCLOSURE = /(^|[\s(])#(ad|advertisement|sponsored)\b|\b(advertisement|sponsored|paid partnership)\b|(^|[\s(])ad\b(?=[\s:|·,.)-]|$)/i;
/** Tags that don't count on their own (FTC Disclosures 101; CMA). */
const WEAK_DISCLOSURE = /#(sp|spon|collab|ambassador|partner|thanks|gifted)\b/i;
/** How much of a caption shows before "more": the disclosure has to be in it. */
const ABOVE_THE_FOLD = 125;

/** Words that turn a matched claim into a rule ("never say it cures"), so briefs' do-not lists don't trip the checks. */
const NEGATION = /\b(never|don'?t|do not|avoid|no|not|without|banned|forbidden|can'?t|cannot)\b/i;

const CONDITIONS = "acne|anxiety|depression|insomnia|adhd|cancer|diabetes|eczema|psoriasis|arthritis|pain|disease|illness|infection|covid|flu|obesity|hair loss|ibs|migraines?";
const HEALTH = new RegExp(
  `\\b(cures?|cured|treats?|heals?|prevents?|reverses?)\\s+(your\\s+)?(${CONDITIONS})\\b|\\bclinically[- ](proven|tested)\\b|\\bdoctor[- ]recommended\\b|\\bfda[- ](approved|cleared)\\b|\\bdetox(es|ify|ifies)?\\b|\\bboosts?\\s+(your\\s+)?immun\\w*|\\blose\\s+\\d+\\s?(lbs?|pounds|kg|kilos)\\b|\\bburns?\\s+fat\\b`,
  "i",
);
const EARNINGS =
  /\b(make|earn|making|earning)\s+(up to\s+)?\$\s?\d[\d,.]*\s?k?\s*(a|per|\/|every)\s*(day|week|month|year)\b|\bpassive income\b|\bquit your (day )?job\b|\bget rich\b|\bfinancial freedom\b|\bguaranteed (income|returns?|profits?)\b/i;
const GUARANTEE = /\b(guaranteed?|risk[- ]free|no risk|100% (safe|natural|effective|organic|pure))\b/i;
const URGENCY = /\b(only \d+ left|last chance|ends (tonight|today|soon|at midnight)|hurry|selling out( fast)?|limited time( only)?|act now|while (supplies|stocks) last|before it'?s gone)\b/i;
const GREEN = /\b(eco-?friendly|sustainable|carbon[- ](neutral|negative)|climate[- ](positive|neutral)|biodegradable|compostable|recyclable|plastic[- ]free|non-?toxic|all[- ]natural|chemical[- ]free)\b/i;
const FREE = /\bfree\b/i;
const RECURRING = /\b(trial|subscription|subscribe|membership|per month|\/mo|monthly|annual plan)\b/i;
const FREE_TERMS_STATED = /\b(cancel|renews?|renewal|then \$|after (the|your) (free )?(trial|month)|billed|auto-?renew)/i;

/** Asking for a rating or a review with a reward, or asking for a good one. */
const REVIEW_SENTIMENT = /\b(5|five)[- ]stars?\b|\b(positive|good|great|glowing|favorable|favourable)\s+(review|rating)s?\b/i;
const REVIEW_PLATFORM = /\b(app store|play store|google play|amazon|yelp|trustpilot|google review|rate us|rating|ratings)\b/i;
const REVIEW_WORD = /\breview(s|ed)?\b|\brat(e|ing)\s+us\b/i;
const INCENTIVE = /\b(get|receive|earn|win|unlock|in exchange|and we'?ll|for a|enter|entry|discount|free|gift|credit|code|coupon|reward|\$\s?\d)\b/i;

const FAKE_PROOF =
  /\b(buy|buying|purchase|purchasing)\s+(followers|likes|views|reviews|upvotes|subscribers)\b|\bfake\s+(reviews?|accounts?|followers|testimonials?)\b|\bupvote\s+(us|our|it|this|the)\b|\bvote for us\b|\bsock ?puppets?\b|\b(pretend(ing)?|pose|posing)\s+(to be\s+|as\s+)?(a\s+)?(customer|user|fan)s?\b|\bfrom\s+(a few|multiple|several|different)\s+accounts\b|\bai[- ](written|generated)\s+reviews?\b/i;

const SCRIPTED = /\bword[- ]for[- ]word\b|\bread (this|the|our) script\b|\bmust say\b|\bsay (that )?you love\b|\bsay it'?s the best\b|\bonly (say|post) (positive|good)\b|\bdon'?t mention (any )?(negatives?|downsides?|cons|problems)\b/i;

const OFFER =
  /\$\s?\d|\bfee\b|\bpaid\b|\bpay (you|for)\b|\bcommission\b|\baffiliate\b|\brev(enue)?[- ]share\b|\bgift(ed)?\b|\bsend you\b|\bon us\b|\bcomp(limentary)?\b|\bfree (product|box|month|months|year|access|subscription|account|pro|plan)\b/i;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The first sentence that matches `re` without being a rule against it ("never say it cures"). */
function affirmed(text: string, re: RegExp): string | null {
  for (const s of sentencesOf(text)) {
    const m = s.match(re);
    if (!m) continue;
    const before = s.slice(0, m.index ?? 0);
    if (NEGATION.test(before)) continue;
    return m[0];
  }
  return null;
}

export function consumerChecks(input: ConsumerCheckInput): ConsumerViolation[] {
  const text = input.text ?? "";
  const out: ConsumerViolation[] = [];
  const add = (code: LintCode, detail: string, severity: "error" | "warn") => out.push({ code, detail, severity });

  if (input.sponsored) {
    const weak = text.match(WEAK_DISCLOSURE)?.[0];
    if (input.where === "brief") {
      if (!/#ad\b|\bdisclos|\bpaid partnership\b|\bsponsored\b/i.test(text)) {
        add("DISCLOSURE_MISSING", "The brief doesn't tell the creator to disclose. Require “#ad” (or “Ad”) at the start of the caption, said and shown in videos, plus the platform's paid-partnership label (FTC).", "error");
      }
    } else if (input.where === "post") {
      const head = text.slice(0, ABOVE_THE_FOLD);
      if (!STRONG_DISCLOSURE.test(head)) {
        add(
          "DISCLOSURE_MISSING",
          `${weak ? `“${weak}” doesn't count on its own. ` : ""}Paid, gifted or affiliate posts need “#ad” or “Ad” in the first line, where it can't be missed. The platform's toggle alone isn't enough (FTC; UK CMA).`,
          "error",
        );
      }
    }
  }

  const sentiment = affirmed(text, REVIEW_SENTIMENT);
  if (sentiment && REVIEW_WORD.test(text)) {
    add("REVIEW_INCENTIVE", `Asking for “${sentiment}” steers the review. Ask for an honest one, or none (FTC reviews rule, 16 CFR 465).`, "error");
  } else if (REVIEW_WORD.test(text) && REVIEW_PLATFORM.test(text)) {
    for (const s of sentencesOf(text)) {
      if (REVIEW_WORD.test(s) && INCENTIVE.test(s) && !NEGATION.test(s.slice(0, s.search(INCENTIVE)))) {
        add("REVIEW_INCENTIVE", "A reward for a rating or store review. Google Play bans any reward for a rating, Apple allows only its own prompt, and the FTC bans rewards tied to a sentiment.", "error");
        break;
      }
    }
  }

  const fake = affirmed(text, FAKE_PROOF);
  if (fake) add("FAKE_SOCIAL_PROOF", `“${fake}” is fake social proof. The FTC bans fake reviews and bought followers or views; Product Hunt bans asking for upvotes.`, "error");

  const health = affirmed(text, HEALTH);
  if (health) add("HEALTH_CLAIM", `“${health}” is a health claim. It needs competent scientific evidence (FTC); say what the product does instead.`, "error");

  const earnings = affirmed(text, EARNINGS);
  if (earnings) add("EARNINGS_CLAIM", `“${earnings}” is an earnings claim. The FTC treats these as deceptive unless typical users actually earn it.`, "error");

  const guarantee = affirmed(text, GUARANTEE);
  if (guarantee) add("GUARANTEE_CLAIM", `“${guarantee}”: state the exact terms (what's covered, for how long, how to claim), or drop it.`, "warn");

  if (FREE.test(text) && RECURRING.test(text) && !FREE_TERMS_STATED.test(text)) {
    add("FREE_TERMS", "Says “free” on something that renews. Say the price after the trial, when it renews and how to cancel (US auto-renewal laws).", "warn");
  }

  const urgency = affirmed(text, URGENCY);
  if (urgency) add("FALSE_URGENCY", `“${urgency}”: only if it's true. Fake scarcity and countdowns that reset are deceptive practices.`, "warn");

  const green = affirmed(text, GREEN);
  if (green) add("ENV_CLAIM", `“${green}” needs a specific, provable qualifier (what part, how much), per the FTC Green Guides.`, "warn");

  if (input.where === "brief") {
    const scripted = affirmed(text, SCRIPTED);
    if (scripted) add("SCRIPTED_OPINION", `“${scripted}”: endorsements must be the creator's honest opinion. Give hooks and key points, not a script.`, "warn");
  }

  if (input.partnerOutreach && !OFFER.test(text)) {
    add("OFFER_MISSING", "Doesn't say what they get. Name the product, the fee or commission, and when you pay.", "warn");
  }
  return out;
}

/** For prompts, so the model and the linter agree on what fails. */
export const CONSUMER_RULES_FOR_PROMPT = `CONSUMER MARKETING RULES (code checks every draft; these fail it)
- Paid, gifted or affiliate creator content: "#ad" or "Ad" at the start of the caption, said and shown in videos, plus
  the platform's paid-partnership label. "#sp", "#spon", "#collab", "#ambassador", "thanks to" or a bio line don't count.
  The brand is responsible for checking creators disclose (FTC Endorsement Guides; UK CMA/ASA).
- Reviews: never ask for a positive or 5-star review, never reward a rating or store review, never write, buy or fake
  reviews, followers, views or upvotes (FTC 16 CFR 465; Apple 5.6.1; Google Play; Product Hunt: never ask for upvotes).
- Endorsements are the creator's honest opinion: hooks and key points, never a word-for-word script or "say you love it".
- Claims: no health claims (cures, treats, clinically proven, detox, lose N lbs) and no earnings claims ("make $X a
  month") unless the founder supplied the evidence. "Guaranteed", "risk-free", green claims (eco-friendly, sustainable,
  biodegradable) and urgency ("only 3 left", "ends tonight") only with exact, true terms.
- "Free" on anything that renews: say the price after it, when it renews and how to cancel.
- Outreach to a creator or partner always says what they get (product, fee or commission) and when you pay.`;
