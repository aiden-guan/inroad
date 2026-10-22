import "server-only";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { EMBER_CORE, companyContext, taskHeader } from "@/lib/ai/prompts/core";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Asset, Deal, Workspace } from "@/lib/domain/types";
import {
  ASSET_KINDS,
  BAND_LABELS,
  ROLE_LABELS,
  assetGate,
  computedNumbers,
  contentRunTitle,
  isContentKind,
  debriefCount,
  parts,
  placeholders,
  priceBand,
  proofCounts,
  sourcedText,
  themeNeedsProof,
  unsourcedNumbers,
} from "@/components/playbook/model";
import { contentNotes } from "@/lib/quality/content";
import { defineWorkflow } from "./types";

/**
 * W10 Documents. Sonnet at medium effort, no web: everything it needs is already in the workspace.
 * Code gathers the inputs, computes every price and length, gates the kinds that need data
 * (insight memos need 10 debriefs, case studies an approved customer claim) and checks the result:
 * placeholders become gaps, numbers without a source get flagged. Nothing is approved here.
 */

const KINDS = ["one_pager", "demo_script", "security", "design_partner_terms", "pilot_proposal", "insight", "case_study", "other", "post", "community_answer", "launch"] as const;
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

FOUNDER CONTENT (post, community_answer, launch). The founder posts these by hand under their own name; you never post,
  schedule or plan a calendar. Facts come ONLY from the FOUNDER MATERIAL block (and, for a launch, the company context).
  No customer, company or person names from calls; anonymize ("a 40-person fintech"). First person, plain, specific.
post (120–250 words, no heading): the first line is the hook, at most 12 words, a claim or an observation, never a
  question bait. Then one story from the material and the one insight it taught; end on what the reader can try, or a
  genuine question. No pitch and no link to the product. At most 2 hashtags at the end, or none. title is the hook.
community_answer (≤200 words, no heading): answer the QUESTION in the founder's note as the most useful reply in the
  thread: the direct answer first, then how the founder has seen it done (from the material), then one caveat. No
  pitch, no link, no call to action. Mention the founder's product only if it's the honest answer, and then say "I
  built {name}, so I'm biased" in the same sentence. title is the question, shortened.
launch (≤350 words): a Show HN post. H1 is the title: "Show HN: {name} – {what it does in plain words}", at most 80
  characters, no superlatives. Then: what it is in one line; why the founder built it (from the material); how it
  works in 3–5 plain sentences, including the tradeoffs; what isn't done yet; how to try it without talking to anyone
  ([[link where people can try it]] if none is given); one line asking for honest feedback. Never ask for upvotes.

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
  /** Client-generated id for the new asset, so the UI can follow this run and open the result. */
  assetId: z.string().max(40).optional(),
  /** Founder content: one debriefed call, or one insight memo, to build the draft from first. */
  meetingId: z.string().max(40).optional(),
  fromAssetId: z.string().max(40).optional(),
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

function taskMessage(ws: Workspace, a: Args, deal: Deal | undefined): string {
  const meta = ASSET_KINDS[a.kind];
  const f = parts(ws.foundation!);
  const { band, assumed } = priceBand(ws);
  const out = [taskHeader(), "", `Write ${meta.noun} (kind: ${a.kind}).`];
  if (a.title) out.push(`Working title: ${clip(a.title, 120)}`);
  if (a.brief) out.push(`Founder's note: ${clip(a.brief, 1500)}`);
  out.push("", "<numbers>", `Buyer size: ${BAND_LABELS[band]} employees${assumed ? " (assumed)" : ""}.`, computedNumbers(ws), "</numbers>");

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
  if (isContentKind(a.kind)) out.push("", founderMaterialBlock(ws, a));
  out.push("", "Write it now and submit it with submit_asset.");
  return out.join("\n");
}

/**
 * What a post, an answer or a launch post may be built from: the founder's points of view and answers, what they
 * noted on calls (coaching), the buyer's words, and approved insight memos. `meetingId` or `fromAssetId` puts one call or
 * one memo first, for "turn this into a post".
 */
function founderMaterialBlock(ws: Workspace, a: Args): string {
  const lines = ["<founder_material>", "The only allowed basis for founder content. Anonymize every company and person from calls."];
  const meeting = a.meetingId ? ws.meetings[a.meetingId] : undefined;
  const memo = a.fromAssetId ? ws.assets.find((x) => x.id === a.fromAssetId && x.kind === "insight") : undefined;
  const call = (m: NonNullable<typeof meeting>) => {
    const d = m.debrief!;
    const bits = [
      d.card.pain.value && `pain: ${clip(d.card.pain.value, 200)}`,
      ...d.coaching.slice(0, 3).map((c) => `founder's note: ${clip(c, 200)}`),
      d.customerWords.length ? `their words: ${d.customerWords.slice(0, 4).map((w) => `"${clip(w, 60)}"`).join(", ")}` : null,
      d.newObjections.length ? `objections: ${d.newObjections.slice(0, 2).map((o) => clip(o, 100)).join(" | ")}` : null,
    ].filter(Boolean);
    return `- Call (${m.startsAt.slice(0, 10)}): ${bits.join(" · ")}`;
  };
  if (meeting?.debrief) lines.push("Start from this call:", call(meeting));
  if (memo) lines.push(`Start from this insight memo, "${clip(memo.title, 80)}":`, clip(memo.body, 2400));
  for (const p of ws.povs.slice(0, 6)) lines.push(`- [${p.id}] Point of view: ${clip(p.text, 240)} (${clip(p.evidence, 120)})`);
  for (const q of (ws.foundation?.founderQuestions ?? []).filter((x) => x.answer).slice(0, 4)) lines.push(`- Founder answer: ${clip(q.question, 120)} → ${clip(q.answer, 240)}`);
  const calls = Object.values(ws.meetings)
    .filter((m) => m.debrief && m.id !== meeting?.id)
    .sort((x, y) => y.startsAt.localeCompare(x.startsAt))
    .slice(0, 6);
  for (const m of calls) lines.push(call(m));
  if (a.kind !== "post") for (const x of ws.assets.filter((x) => x.kind === "insight" && x.approved && x.id !== memo?.id).slice(0, 1)) lines.push(`- Insight memo "${clip(x.title, 80)}": ${clip(x.body, 600)}`);
  if (lines.length === 2) lines.push("(none yet)");
  lines.push("</founder_material>");
  return lines.join("\n");
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
    if (isContentKind(a.kind)) return contentRunTitle(a.kind);
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
    if (isContentKind(a.kind)) ctx.emit({ type: "action", text: "Using only what you said, noted or heard on calls" });

    const run = await ctx.agent<Submit>({
      tier: "operator",
      system: [EMBER_CORE, ASSET_RULES, companyContext(ws)],
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
    // Founder content may use numbers from the material it was given (a call note, a memo).
    const sourced = isContentKind(a.kind) ? `${sourcedText(latest, a.dealId)}\n${founderMaterialBlock(latest, a)}` : sourcedText(latest, a.dealId);
    const unsourced = unsourcedNumbers(body, sourced);
    const notes = contentNotes(latest, a.kind, body);
    const gaps = dedupe([...placeholders(body), ...out.gaps.filter((g) => !/^\s*$/.test(g)), ...unsourced.map((n) => `Check “${n}”: no approved source`), ...notes]).slice(0, 12);
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
        gaps,
        claimIds,
        povIds,
        kit: existing?.kit,
        origin: "agent",
        runId: ctx.runId,
        brief: isContentKind(a.kind) ? a.brief || existing?.brief : undefined,
      };
      const i = w.assets.findIndex((x) => x.id === id);
      if (i === -1) w.assets.push(asset);
      else w.assets[i] = asset;
      // The company sheet reads the deal's copy; the Playbook keeps the editable asset.
      const deal = a.kind === "pilot_proposal" && a.dealId ? w.deals[a.dealId] : undefined;
      if (deal) deal.proposal = { body, generatedAt: at };
    });
    return { assetId: id, title, gaps: gaps.length };
  },
});
