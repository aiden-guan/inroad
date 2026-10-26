import type { ReplyIntent } from "@/lib/domain/types";

/**
 * A frozen, hand-labeled bench of prospect replies for the reply classifier (SPEC §4.0 engine extension 9: the classify
 * eval). The reply read decides whether a "yes" opens a deal, a "stop" suppresses an address and a "not now" gets a
 * dated check-in, so the cheap tier only takes over if it agrees with these labels. Written for invented people; the
 * hard cases (a yes inside an auto-reply, a "not now" that's really a referral) are the point.
 */

export interface LabeledReply {
  id: string;
  intent: ReplyIntent;
  text: string;
}

/**
 * Agreement with the labels at least 95%, and at most 3% of live replies (yes, info, referral) read as something that
 * drops the lead (negative, unsubscribe, out of office).
 */
export const CLASSIFY_GATE = { agreement: 0.95, droppedLive: 0.03 } as const;

const r = (id: string, intent: ReplyIntent, text: string): LabeledReply => ({ id, intent, text });

export const REPLY_SET: LabeledReply[] = [
  r("p01", "positive", "Timing's decent. Our close has been rough since reserved capacity launched. Next week works."),
  r("p02", "positive", "Yes, let's talk. Thursday afternoon is best for me."),
  r("p03", "positive", "This is exactly what we've been arguing about internally. Can you do 30 minutes on Monday?"),
  r("p04", "positive", "Sure, send me a couple of times."),
  r("p05", "positive", "Happy to chat. I'm out until Wednesday but grab anything after that on my calendar."),
  r("p06", "positive", "Funny timing, we were about to start building this ourselves. Open to a call before we commit."),
  r("i01", "info_request", "Can you send pricing? I'd want to see that before taking a call."),
  r("i02", "info_request", "Do you have anything written I could share with my team first?"),
  r("i03", "info_request", "How does this work with Snowflake? We don't use dbt."),
  r("i04", "info_request", "What would a pilot cost and how long does setup take?"),
  r("f01", "referral", "I'm not the right person, but Priya Shah runs billing ops. priya@kestrel.example"),
  r("f02", "referral", "You want our controller for this, Marcus. I'll forward this to him."),
  r("f03", "referral", "Not me anymore, I moved to the data team. Try Leo Marchetti, he owns close now."),
  r("f04", "referral", "Talk to Ava on our finance team, she has been asking for exactly this."),
  r("n01", "not_now", "Not this quarter. We're mid-migration. Try me in January."),
  r("n02", "not_now", "Interesting, but we just signed a renewal with our current vendor. Maybe next year."),
  r("n03", "not_now", "Busy with the audit until end of March. Ping me after that."),
  r("n04", "not_now", "We're hiring a head of finance first, so this waits until they start."),
  r("o01", "objection", "We built something in-house for this already, so I doubt we need it."),
  r("o02", "objection", "Our security team won't approve another vendor touching billing data."),
  r("o03", "objection", "Looks expensive for a team our size. What makes it worth it?"),
  r("o04", "objection", "We already use Stripe Billing for this. What would you do differently?"),
  r("g01", "negative", "Not interested, thanks."),
  r("g02", "negative", "We're all set here. Please don't follow up."),
  r("g03", "negative", "No thank you."),
  r("g04", "negative", "This isn't a problem for us."),
  r("u01", "unsubscribe", "Unsubscribe"),
  r("u02", "unsubscribe", "Please remove me from your list."),
  r("u03", "unsubscribe", "Stop emailing me."),
  r("u04", "unsubscribe", "remove"),
  r("u05", "unsubscribe", "Take me off your mailing list. I never signed up for this."),
  r("x01", "ooo", "Automatic reply: I'm out of the office until Monday with limited access to email."),
  r("x02", "ooo", "Thanks for your message. I'm on parental leave and will respond when I return in March."),
  r("x03", "ooo", "Auto-reply: I am travelling this week. For urgent matters contact finance@acme.example."),
  r("h01", "positive", "Automatic reply: I'm away until Thursday. Actually yes, this is relevant, let's talk next week."),
  r("h02", "referral", "Not now for me, but my colleague Dana Okafor is evaluating tools for this right now."),
  r("h03", "info_request", "Before I stop you: is this SOC 2 compliant? If so, send details."),
  r("h04", "negative", "Please stop with the AI-written emails. Not interested."),
  r("h05", "positive", "Remove the sales pitch and I'm in. Can we talk Friday?"),
  r("h06", "not_now", "Can you follow up after our Series B closes, probably in Q2?"),
];

/** Agreement with the labels, and how often a live reply was read as something that drops the lead. */
export function scoreClassify(results: { id: string; expected: ReplyIntent; got: ReplyIntent | null }[]) {
  const LIVE: ReplyIntent[] = ["positive", "info_request", "referral"];
  const DROPS: ReplyIntent[] = ["negative", "unsubscribe", "ooo"];
  const answered = results.filter((x) => x.got !== null);
  const live = results.filter((x) => LIVE.includes(x.expected));
  const agreement = results.length ? answered.filter((x) => x.got === x.expected).length / results.length : 0;
  const droppedLive = live.length ? live.filter((x) => x.got !== null && DROPS.includes(x.got)).length / live.length : 0;
  return {
    n: results.length,
    agreement,
    droppedLive,
    passed: results.length > 0 && agreement >= CLASSIFY_GATE.agreement && droppedLive <= CLASSIFY_GATE.droppedLive,
    misses: results.filter((x) => x.got !== x.expected).map((x) => `${x.id}: ${x.expected} → ${x.got ?? "none"}`),
  };
}
