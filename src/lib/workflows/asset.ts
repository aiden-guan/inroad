import "server-only";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { companyContext, coreFor, taskHeader } from "@/lib/ai/prompts/core";
import { APP_STORE, CREATOR_RATES, REFERRALS } from "@/lib/consumer/benchmarks";
import { consumerChecks } from "@/lib/consumer/compliance";
import { growthDefaults } from "@/lib/consumer/plan";
import { INTERVIEW_QUESTIONS, PARTNER_KIND_LABELS } from "@/lib/consumer/partners";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Asset, Deal, Partner, Workspace } from "@/lib/domain/types";
import {
  ASSET_KINDS,
  BAND_LABELS,
  ROLE_LABELS,
  assetGate,
  computedNumbers,
  debriefCount,
  parts,
  placeholders,
  priceBand,
  proofCounts,
  sourcedText,
  themeNeedsProof,
  unsourcedNumbers,
} from "@/components/playbook/model";
import { defineWorkflow } from "./types";

/**
 * W10 Documents. Sonnet at medium effort, no web: everything it needs is already in the workspace.
 * Code gathers the inputs, computes every price and length, gates the kinds that need data
 * (insight memos need 10 debriefs, case studies an approved customer claim) and checks the result:
 * placeholders become gaps, numbers without a source get flagged. Nothing is approved here.
 */

const KINDS = [
  "one_pager",
  "demo_script",
  "security",
  "design_partner_terms",
  "pilot_proposal",
  "insight",
  "case_study",
  "other",
  "creator_brief",
  "launch_plan",
  "referral_program",
  "interview_guide",
] as const;
const CONSUMER_ASSETS = new Set<string>(["creator_brief", "launch_plan", "referral_program", "interview_guide"]);
const DISCLAIMER = "_Draft. Not legal advice. Have counsel review before signing._";

const ASSET_RULES = `ASSET RULES
You write sales documents a technical founder sends under their own name: one-pagers, demo scripts, security pages,
design-partner terms, one-page pilot proposals, insight memos and case studies. Write for the buyer who will read it.

SOURCES (hard rules)
- Facts about the founder's company come ONLY from: approved claims (list the ids you used in claimIds), the founder's
  points of view (povIds), founder answers and the company snapshot in the context, and the NUMBERS block in the task,
  which code computed.
- Facts about the buyer come ONLY from the DEAL block: qualification card, quotes, pilot criteria, next step, people.
  If the DEAL source is founder_notes, those are the founder's paraphrase: write "Our understanding:" and never put them
  in quotation marks or attribute them to the buyer. Verbatim quotes only from a transcript.
- Never invent customers, logos, metrics, testimonials, certifications, integrations, dates, prices, names or headcounts.
  A value theme marked "needs proof" is written as an outcome "we're validating with design partners", never as a result.
- Every number in the body must appear in the task (an approved claim, a DEAL quote or field, or NUMBERS). NUMBERS are
  prices, fees and lengths only; never use them as an outcome, saving or result. Otherwise write a gap. Don't publish a fixed price in a one-pager or demo script.

GAPS
- When a needed fact is missing, put a short placeholder in double square brackets where it belongs, e.g. [[pilot fee]],
  [[results review date]], [[security contact]], and list each one in gaps. Never fill a gap with a plausible guess.
- A short document with honest gaps beats a long one with filler.

STYLE
- Markdown. One H1. H2 sections. Short paragraphs; bullets where they help scanning; tables only for timelines,
  checklists and the order form.
- Plain words, reading grade 9 or below, active voice. "You" is the buyer, "we" is the founder's company.
- Banned: AI-powered, leverage, seamless, unlock, empower, streamline, robust, best-in-class, world-class, cutting-edge,
  game-changer, revolutionize, supercharge, transformative, innovative, next level, synergy, solution(s), delve,
  landscape, crucial, pivotal, "teams like yours", "not just X but Y". No exclamation marks, no emoji, no FOMO.

KINDS
one_pager (≤350 words): H1 is the company name, then the plain one-liner in bold. "The problem": in the buyer's words
  (customer words if given), else the ICP obstacle said plainly. "What changes": the 2–3 value themes as outcomes, each
  with an approved claim as proof or "We're validating this with design partners." "How it works": 3 numbered steps.
  "What a pilot looks like": paid, the pilot length from NUMBERS, success criteria in writing before kickoff, results
  review booked at kickoff, fee credited to the annual contract; no price. "Security": one line from an approved
  security claim, else "Security details on request." "Contact": the founder's name and title.
demo_script (≤450 words): a 2-minute demo where the buyer is the protagonist, on data like theirs. First, one question
  that confirms the problem still matters (if not, no demo). Then a table Time | Say | Show: their situation in their
  words · the insight (what changed in their world) · today's alternative and its cost · 2–3 value themes shown as
  outcomes, one screen each, never a feature tour · proof (approved claims only) · one specific ask. "About us" under
  30 seconds. End with 3 questions to ask if they go quiet.
security (≤300 words): a table Item | Status covering SOC 2, data retention, hosting region, encryption in transit and at
  rest, SSO/SAML, subprocessors, penetration test, DPA. Status only from approved security claims or founder answers;
  everything else exactly "Ask us". Never imply a certification or audit you weren't given. End with who to contact.
design_partner_terms (≤450 words): First Round's Sierra model. What we ask: an upfront fee of 10–20% of first-year
  contract value (the exact figure is a gap; NUMBERS gives the anchor), an executive sponsor, a technical lead with
  system access and a business lead, a 60–90 minute kickoff agreeing 3–4 core problems, a weekly 30-minute standup with
  candid feedback, a real launch date. What they get: a first version in about 2 weeks, founder access, roadmap
  influence, today's price held through conversion. Term: about 3 months, never more than 6, a written end date, a
  written conversion date and annual price with the fee credited. End with the disclaimer line.
pilot_proposal (≤600 words, one page). Sections in order: Context (their words if transcript; "Our understanding:" if
  notes) · What it costs today (only the card's pain/impact, else a gap) · Success criteria, in exactly this shape: "By
  {date}, using {product} on {scope}, {customer} will move {metric} from {baseline} to {target}, measured by {method and
  owner}. If met, {customer} moves to {plan} at {price} starting {date}." (use the DEAL's pilot criteria if given; gaps for
  unknown parts) · Scope: in, out, and minimal integration to start (a CSV export or a sample) · Timeline: the pilot
  length from NUMBERS; check-ins every 2–3 days for pilots of 14 days or less, weekly otherwise; the results review
  booked at kickoff · Fee: within the champion's own sign-off limit, credited in full to the annual contract · After
  the pilot: an annual contract with a 30- or 60-day opt-out · Owners on both sides (buyer names only from the DEAL)
  · Next step to sign, with a date. Then "## Order form" as a two-column table: Customer, Provider, Pilot term, Start
  date, Pilot fee, Success criteria, Conversion plan and price, Opt-out window, Payment terms; then an "Agreed by" line
  for each side with name, title and date left blank. End with exactly this line: ${DISCLAIMER}
insight (≤600 words): title "What we learned from {N} calls with {persona}s" using the exact N given. Only patterns seen
  in 3 or more calls, each with its count ("in 7 of 12 calls") and at most one anonymized verbatim line from a
  transcript. Anonymize everything: no company or person names. End with what it means for the reader and one question.
case_study (≤400 words): only from approved customer and metric claims, quoted exactly. Name the customer only if the
  claim's permission is public, else "a {segment} company". Situation · problem · what they did · results · a quote only
  if one is given. Gaps for anything missing.
other: follow the founder's note; same sourcing rules.

CONSUMER KINDS (for a company that sells to people; facts about a creator come ONLY from the PARTNER block)
creator_brief (≤450 words): H1 "Brief for {name}". "Why you": their audience fit, from the PARTNER block only. "The
  product in one line". "What we'd love": format, platform, number of posts and length, from the founder's note or the
  offer, else gaps. "Hooks to try": 3–6 optional first lines from the playbook's hooks and customer words; say they can
  write their own. "Key points": 3–5 outcomes in users' words, approved claims only. "Please don't": no claims we can't
  prove (cures, treats, guaranteed, clinically proven, earnings), no fake urgency, don't call it free if it renews.
  "Disclosure (required)": "#ad" or "Ad" at the start of the caption, said and shown in videos, plus the platform's
  paid-partnership label; "#sp", "#collab" or a bio line don't count; we check the post before it counts. "Your honest
  take": say what you actually think; no script. "What you get": the offer from the PARTNER block (fee, commission or
  product), when we pay, usage rights (organic posting only unless agreed; paid usage or whitelisting priced
  separately), else gaps. "Timeline" and "How we count results" (their unique code or link; we share the numbers back).
launch_plan (≤600 words): one dated launch. Goal: one number from the growth model. "Who hears first": the waitlist,
  current users, the communities and creators in the context (with "check each community's rules"). A table Date | Task |
  Owner counting back from launch day (dates as gaps when none given): creators get the product 2–3 weeks ahead (posts
  carry #ad); for apps, the App Store featuring nomination at least ${APP_STORE.featuringLeadWeeks} weeks ahead in App
  Store Connect; a press pitch 1–2 weeks ahead to reporters who covered the alternatives; on Product Hunt, ask people to
  try it and share honest feedback, never ask outright for upvotes. Launch day hour by hour. The week after: thank
  everyone, answer every comment, log the numbers, talk to 5 of the new users.
referral_program (≤450 words): who gets what (double-sided by default, in the product's own currency where possible:
  credit, free months, storage); the qualifying action (the friend activates, not just signs up); when the ask appears
  (right after the first win, never at signup); a yearly cap per user; abuse limits (no self-referral, one reward per
  person or payment method); contacts: the user picks each person, never "select all", and sees the message before it's
  sent; NEVER reward reviews or ratings. "How we'll know": share of new users from referrals (where programs work, about
  ${REFERRALS.shareWhereItWorksLow.value}–${REFERRALS.shareWhereItWorksHigh.value}%; expect fewer than ${REFERRALS.referrersShare.value}% of users to
  refer). Reward amounts and dates are gaps unless the founder gave them.
interview_guide (≤450 words): goal; who (new users in their first week, active users, people who stopped); how to invite
  (15 minutes, a short note; a thank-you gift is optional and never depends on what they say); questions about past
  behavior, never "would you use / would you pay"; start from: ${INTERVIEW_QUESTIONS.map((q) => `"${q}"`).join(" ")}
  After each call: their words, the moment before they looked, what they used before, the first win. Once 40+ users are
  active: the Sean Ellis question ("How would you feel if you could no longer use it?" very / somewhat / not
  disappointed), asked only of people who used it at least twice in the last two weeks.

OUTPUT: call submit_asset once. title ≤80 characters. claimIds and povIds only use ids from the context. gaps lists
every [[placeholder]] in the body (up to 8, each ≤80 characters).`;

const submitAsset = defineTool({
  name: "submit_asset",
  description: "Submit the finished document. Call exactly once.",
  terminal: true,
  schema: z.object({
    title: z.string().max(80).describe("Document title, ≤80 characters, sentence case"),
    body: z.string().max(9000).describe("The full document in Markdown, within the word limit for its kind (≤9000 characters)"),
    claimIds: z.array(z.string()).max(12).describe("Ids of approved claims the body uses; up to 12, may be empty"),
    povIds: z.array(z.string()).max(3).describe("Ids of founder points of view the body uses; up to 3, may be empty"),
    gaps: z.array(z.string().max(80)).max(8).describe("One entry per [[placeholder]] in the body: the fact the founder must supply; up to 8, each ≤80 characters"),
  }),
});

type Submit = { title: string; body: string; claimIds: string[]; povIds: string[]; gaps: string[] };

const args = z.object({
  kind: z.enum(KINDS),
  title: z.string().max(120).optional(),
  brief: z.string().max(2000).optional(),
  dealId: z.string().optional(),
  /** creator_brief: the creator it's for. */
  partnerId: z.string().max(80).optional(),
  /** Client-generated id for the new asset, so the UI can follow this run and open the result. */
  assetId: z.string().max(40).optional(),
});
type Args = z.infer<typeof args>;

function clip(text: string | null | undefined, n: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function dealBlock(ws: Workspace, deal: Deal): string {
  const acc = ws.accounts[deal.accountDomain];
  const lines: string[] = ["<deal>", `Customer: ${deal.name} (${deal.accountDomain})${acc?.oneLiner ? ` — ${clip(acc.oneLiner, 160)}` : ""}`, `Stage: ${deal.stage}`];
  const debriefs = deal.meetingIds
    .map((id) => ws.meetings[id])
    .filter((m) => m?.debrief)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const latest = debriefs.at(-1)?.debrief;
  lines.push(`Source of what follows: ${latest?.source ?? "none (no debriefed call yet)"}`);
  const card = deal.card ?? latest?.card;
  if (card) {
    const f = (label: string, x: { value: string | null; status: string }, extra = "") => lines.push(`${label}: ${x.value ? clip(x.value, 300) : "not covered"} [${x.status}]${extra}`);
    f("Pain", card.pain, card.pain.impact ? ` · impact: ${clip(card.pain.impact, 200)}` : "");
    f("Spend today", card.spend);
    f("Critical event", card.criticalEvent, card.criticalEvent.date ? ` · date: ${card.criticalEvent.date}` : "");
    f("Champion", card.champion, card.champion.name ? ` · name: ${card.champion.name}` : "");
    f("Economic buyer", card.economicBuyer, card.economicBuyer.name ? ` · name: ${card.economicBuyer.name}` : "");
    f("Fit", card.fit);
    f("Decision process", card.decisionProcess);
  }
  if (deal.qualification) lines.push(`Qualification score: ${deal.qualification.total}/12`);
  const criteria = deal.pilot?.criteria || latest?.pilotCriteria;
  if (criteria) lines.push(`Pilot success criteria (agreed or proposed): ${clip(criteria, 500)}`);
  if (deal.pilot?.feeUsd) lines.push(`Pilot fee agreed: $${deal.pilot.feeUsd.toLocaleString("en-US")}`);
  if (deal.nextStep) lines.push(`Next step: ${deal.nextStep.what} on ${deal.nextStep.date}${deal.nextStep.buyerAgreed ? " (buyer agreed)" : ""}`);
  for (const q of deal.priceQuotes ?? []) lines.push(`Price quoted ${q.at}: $${q.amountUsd.toLocaleString("en-US")}${q.outcome ? ` (${q.outcome})` : ""}`);
  const people = deal.contacts.map((c) => ws.people[c.personId]).filter(Boolean);
  if (people.length) lines.push(`People: ${people.map((p) => `${p.name}, ${p.title}${p.role ? ` (${ROLE_LABELS[p.role]})` : ""}`).join("; ")}`);
  const quotes = debriefs.flatMap((m) => m.debrief!.quotes.map((q) => ({ ...q, source: m.debrief!.source }))).slice(-14);
  if (quotes.length) {
    lines.push("Quotes from calls:");
    for (const q of quotes) lines.push(`- [${q.id}] ${q.source === "transcript" ? `${q.speaker ?? "Buyer"} said: "${clip(q.text, 280)}"` : `Founder's note: ${clip(q.text, 280)}`}`);
  }
  lines.push("</deal>");
  return lines.join("\n");
}

function insightBlock(ws: Workspace): string {
  const meetings = Object.values(ws.meetings).filter((m) => m.debrief);
  const lines = [`<calls count="${meetings.length}">`, "Anonymize everything below before using it."];
  for (const m of meetings.slice(-30)) {
    const d = m.debrief!;
    const bits = [
      d.card.pain.value && `pain: ${clip(d.card.pain.value, 160)}`,
      d.card.criticalEvent.value && `critical event: ${clip(d.card.criticalEvent.value, 100)}`,
      d.newObjections.length ? `objections: ${d.newObjections.map((o) => clip(o, 80)).join(" | ")}` : null,
      d.customerWords.length ? `their words: ${d.customerWords.map((w) => `"${clip(w, 60)}"`).join(", ")}` : null,
      d.source === "transcript" && d.quotes[0] ? `verbatim: "${clip(d.quotes[0].text, 160)}"` : null,
    ].filter(Boolean);
    lines.push(`- ${bits.join(" · ")}`);
  }
  lines.push("</calls>");
  return lines.join("\n");
}

function partnerBlock(p: Partner): string {
  const offer = p.offer
    ? `${p.offer.type}${p.offer.amountUsd ? `, $${p.offer.amountUsd}` : ""}${p.offer.commissionPct ? `, ${p.offer.commissionPct}% commission` : ""}${p.offer.terms ? `, ${clip(p.offer.terms, 200)}` : ""}`
    : "not set (gap)";
  return [
    "<partner>",
    `${PARTNER_KIND_LABELS[p.kind]}: ${p.name}${p.handle ? ` (${p.handle})` : ""}${p.platform ? ` on ${p.platform}` : ""}`,
    p.audience ? `Audience: ${p.audience}` : "",
    `Fit: ${p.fit}`,
    p.notes ? `Founder's notes: ${clip(p.notes, 400)}` : "",
    `Offer: ${offer}`,
    p.trackingCode ? `Code or link: ${p.trackingCode}` : "Code or link: not set (gap)",
    "</partner>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What a consumer document may draw on: the growth model, segments, hooks and the creator list. */
function consumerBlock(ws: Workspace, a: Args): string[] {
  const f = ws.foundation!;
  const g = growthDefaults(ws);
  const out = [
    "",
    "<growth>",
    `North star: ${g.northStar.metric}`,
    `Activation: ${g.activation.event} within ${g.activation.withinDays} days`,
    `Primary loop: ${g.primaryLoop.kind} — ${g.primaryLoop.how}`,
    `Pricing: ${f.commercial.structure} — ${clip(f.commercial.terms, 300)}`,
    `Creator deal references (vendor data, Collabstr 2025): about $${CREATOR_RATES.instagramPerDeal.value} per Instagram deal, $${CREATOR_RATES.tiktokPerDeal.value} per TikTok deal.`,
    "</growth>",
  ];
  if (f.messaging.hooks?.length) out.push("", `Hooks: ${f.messaging.hooks.map((h) => `"${h}"`).join(" ")}`);
  if (f.messaging.customerWords.length) out.push(`Customer words: ${f.messaging.customerWords.map((w) => `"${w.phrase}"`).join(", ")}`);
  const partner = a.partnerId ? ws.partners?.[a.partnerId] : undefined;
  if (partner) out.push("", partnerBlock(partner));
  else if (a.kind === "launch_plan") {
    const list = Object.values(ws.partners ?? {}).filter((p) => p.stage !== "passed").slice(0, 12);
    if (list.length) out.push("", "Creators and communities on the list:", ...list.map((p) => `- ${p.name} (${p.kind}, ${p.stage})`));
  }
  return out;
}

function taskMessage(ws: Workspace, a: Args, deal: Deal | undefined): string {
  const meta = ASSET_KINDS[a.kind];
  const f = parts(ws.foundation!);
  const { band, assumed } = priceBand(ws);
  const consumerKind = CONSUMER_ASSETS.has(a.kind);
  const out = [taskHeader(), "", `Write ${meta.noun} (kind: ${a.kind}).`];
  if (a.title) out.push(`Working title: ${clip(a.title, 120)}`);
  if (a.brief) out.push(`Founder's note: ${clip(a.brief, 1500)}`);
  if (consumerKind) out.push(...consumerBlock(ws, a));
  else out.push("", "<numbers>", `Buyer size: ${BAND_LABELS[band]} employees${assumed ? " (assumed)" : ""}.`, computedNumbers(ws), "</numbers>");

  const sender = ws.sender;
  out.push("", `Founder: ${ws.founder.name || "unknown"}, ${ws.founder.title || sender?.title || "Founder"}${sender?.email || ws.founder.email ? ` · ${sender?.email || ws.founder.email}` : ""}`);

  const themes = f.positioning.valueThemes;
  if (themes.length) {
    out.push("", "Value themes with their proof:");
    for (const t of themes) {
      const proof = t.proof
        .filter((p) => proofCounts(ws, p))
        .map((p) => (p.claimId ? `claim ${p.claimId}` : p.text))
        .filter(Boolean);
      out.push(`- [${t.id}] ${t.theme}: ${t.outcome}${themeNeedsProof(ws, t) ? " (NEEDS PROOF)" : ""}${proof.length ? ` · proof: ${proof.join("; ")}` : ""}`);
    }
  }
  const claims = ws.claims.filter((c) => c.approved);
  if (claims.length && (a.kind === "case_study" || a.kind === "security")) {
    out.push("", "Approved claims with kind and permission:");
    for (const c of claims) out.push(`- [${c.id}] (${c.kind}, ${c.permission}) ${c.text}`);
  }
  const answers = f.founderQuestions.filter((q) => q.answer);
  if (answers.length) out.push("", "Founder answers:", ...answers.map((q) => `- ${clip(q.question, 140)} → ${clip(q.answer, 300)}`));
  if (a.kind === "case_study" || a.kind === "insight") out.push("", `Segment: ${f.icp.primarySegment || f.icp.hypothesis.companyGroup}`);
  if (a.kind === "insight") {
    const champion = f.personas.find((p) => p.role === "champion") ?? f.personas[0];
    out.push(`Persona: ${champion?.titles[0] ?? "buyers"}`, "", insightBlock(ws));
  }
  if (deal) out.push("", dealBlock(ws, deal));
  out.push("", "Write it now and submit it with submit_asset.");
  return out.join("\n");
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = x.toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export default defineWorkflow({
  id: "asset",
  args,
  title: (a, ws) => {
    const deal = a.dealId ? ws.deals[a.dealId] : undefined;
    const noun = ASSET_KINDS[a.kind].noun;
    return deal ? `Drafting ${noun} for ${deal.name}` : `Drafting ${a.title ? clip(a.title, 60) : noun}`;
  },
  // A deal's pilot proposal belongs to the deal, so the company sheet can show the run wherever it was started.
  ref: (a) => (a.kind === "pilot_proposal" && a.dealId ? { kind: "deal", id: a.dealId } : { kind: "playbook", id: `asset:${a.assetId ?? a.kind}` }),
  heavy: false,
  run: async (ctx) => {
    const a = ctx.args;
    const ws = ctx.read();
    const blocked = assetGate(ws, a);
    if (blocked) throw new AgentError(blocked, "bad_request");
    const deal = a.dealId ? ws.deals[a.dealId] : undefined;

    ctx.emit({ type: "status", text: "Reading your playbook" });
    const approved = ws.claims.filter((c) => c.approved).length;
    ctx.emit({ type: "action", text: `Using ${approved === 1 ? "1 approved claim" : `${approved} approved claims`} and ${ws.povs.length === 1 ? "1 point of view" : `${ws.povs.length} points of view`}` });
    if (deal) ctx.emit({ type: "action", text: `Reading ${deal.name}'s qualification card` });
    if (a.kind === "insight") ctx.emit({ type: "action", text: `Reading ${debriefCount(ws)} debriefed calls` });

    const run = await ctx.agent<Submit>({
      tier: "operator",
      system: [coreFor(ws), ASSET_RULES, companyContext(ws)],
      messages: [{ role: "user", content: taskMessage(ws, a, deal) }],
      tools: [submitAsset],
      effort: "medium",
      maxTokens: 16000,
      requireTerminal: true,
    });
    const out = run.result;
    if (!out) throw new AgentError("I couldn't finish that document. Try again.", "unknown");

    // Code checks the draft: placeholders are the real gap list; numbers must trace to a source.
    const latest = ctx.read();
    let body = out.body.trim();
    if (a.kind === "pilot_proposal" && !body.includes("Not legal advice")) body = `${body}\n\n${DISCLAIMER}`;
    const unsourced = unsourcedNumbers(body, sourcedText(latest, a.dealId));
    // Consumer documents also go through the marketing rules (disclosure in briefs, no review rewards, no claims).
    const rules = CONSUMER_ASSETS.has(a.kind) ? consumerChecks({ text: body, sponsored: a.kind === "creator_brief", where: a.kind === "creator_brief" ? "brief" : "message" }) : [];
    const gaps = dedupe([
      ...rules.filter((v) => v.severity === "error").map((v) => `Fix: ${clip(v.detail, 140)}`),
      ...placeholders(body),
      ...out.gaps.filter((g) => !/^\s*$/.test(g)),
      ...unsourced.map((n) => `Check “${n}”: no approved source`),
    ]).slice(0, 12);
    const claimIds = out.claimIds.filter((id) => latest.claims.some((c) => c.id === id && c.approved));
    const povIds = out.povIds.filter((id) => latest.povs.some((p) => p.id === id));
    ctx.emit({ type: "action", text: gaps.length ? `Left ${gaps.length === 1 ? "1 gap" : `${gaps.length} gaps`} for you to fill` : "Checked every number against your sources" });

    // A redraft replaces the deal's proposal only while it is the untouched agent draft the sheet shows.
    // Approved, founder-edited or template proposals are never overwritten; the redraft becomes a new asset.
    const proposalDeal = a.kind === "pilot_proposal" ? a.dealId : undefined;
    const prior = proposalDeal
      ? latest.assets.find((x) => x.kind === "pilot_proposal" && x.dealId === proposalDeal && !x.approved && x.origin === "agent" && x.body === latest.deals[proposalDeal]?.proposal?.body)
      : undefined;
    const id = a.assetId ?? prior?.id ?? newId("ast");
    const title = clip(out.title, 80) || ASSET_KINDS[a.kind].label;
    await ctx.mutate((w) => {
      const at = nowISO();
      const existing = w.assets.find((x) => x.id === id);
      const asset: Asset = {
        id,
        kind: a.kind,
        title,
        body,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        approved: false,
        url: existing?.url,
        dealId: a.dealId,
        partnerId: a.kind === "creator_brief" ? a.partnerId : undefined,
        gaps,
        claimIds,
        povIds,
        kit: existing?.kit,
        origin: "agent",
        runId: ctx.runId,
      };
      const i = w.assets.findIndex((x) => x.id === id);
      if (i === -1) w.assets.push(asset);
      else w.assets[i] = asset;
      // The company sheet reads the deal's copy; the Playbook keeps the editable asset.
      const deal = a.kind === "pilot_proposal" && a.dealId ? w.deals[a.dealId] : undefined;
      if (deal) deal.proposal = { body, generatedAt: at };
      const partner = a.kind === "creator_brief" && a.partnerId ? w.partners?.[a.partnerId] : undefined;
      if (partner) partner.briefAssetId = id;
    });
    return { assetId: id, title, gaps: gaps.length };
  },
});
