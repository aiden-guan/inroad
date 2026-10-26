import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentError, defineTool, type AgentTool, type RunResult } from "@/lib/ai/engine";
import type { ModelTier } from "@/lib/ai/models";
import { companyContext, coreFor, taskHeader } from "@/lib/ai/prompts/core";
import { isConsumer } from "@/lib/consumer/market";
import { daysBetween, newId, nowISO, todayISO } from "@/lib/domain/ids";
import {
  OPEN_STAGES,
  STAGE_LABELS,
  type AskCitation,
  type AskProposal,
  type AskTurn,
  type Deal,
  type EntityRef,
  type Stage,
  type Workspace,
} from "@/lib/domain/types";
import { computeScoreboard, dealsMissingNextStep } from "@/lib/moves/scoreboard";
import { localDate } from "@/lib/moves/util";
import { toDomain } from "@/lib/signals/http";
import { estimateTokens, getThread, putTurn, refKey, withThread, type StoredThread } from "@/lib/store/threads";
import { defineWorkflow } from "./types";

/**
 * W12 · Ask: the founder's conversation window.
 *
 * Cost shape (≈$0.01 a turn on Sonnet low):
 *  - Short list questions ("deals missing a next step") are answered in code by `instantAnswer`, no model call.
 *  - system = [core, ASK_RULES, playbook] and the tool list are byte-stable, so they stay cached; the growing
 *    thread is cached up to the new question by a breakpoint on it.
 *  - The record the founder is looking at is digested in code and sent once per thread (again only if it
 *    changed), inside an appended `role: "system"` message with today's date. History is never edited.
 *  - Web search is off unless the founder turns it on for a message (max 2). "Think harder" switches to Opus.
 *  - Writes are proposals rendered as chips; full jobs are start_workflow proposals. Nothing applies itself.
 */

/* ─────────────────────────────── Rules (cached) ─────────────────────────────── */

const ASK_RULES = `ASK RULES (the founder's conversation window: workspace tools, and web search only when the founder turns it on)

SHAPE OF AN ANSWER
- Answer first: the direct answer or recommendation in at most 3 sentences, plain words, absolute dates. Then stop,
  unless the founder asked for steps, a list or a draft: then at most 5 bullets of at most 20 words each. No headings,
  no preamble, no restating the question, no sign-off. Expand only when asked.
- Do every lookup and every proposal first, then write the answer as your final message. Never write the answer
  before a tool call: only the text after your last tool call is shown.
- The app prints the receipt (records used, web sources, time, cost) under your answer. Don't list sources yourself.
- Cite workspace evidence inline by id in square brackets right after the sentence it supports, e.g. "They raised a
  $12M Series A on 2026-08-14 [ev_3f9k2m1x0q]." Use only ids that appear in tool results or the context record.
  Web results are cited automatically. A fact without a source is a guess: say "my guess", or leave it out.
- Anything the founder would send (email, DM, intro ask, forwardable blurb, talk track) goes in a fenced block that
  opens with \`\`\`draft and closes with \`\`\`. Founder's voice, 40-90 words, one ask, no calendar link, no hype, only
  approved claims. Never open with "I hope", "Saw", "Noticed" or "Congrats". Never use: "worth a chat", "open to",
  "curious if", "teams like yours", "no worries if not", "hope this helps", "quick question", "just following up",
  "circle back", "touch base", "leverage", "synergy", "game-changer".
- Full outbound drafts with evidence and lint come from the composer: for "write to <person>", propose
  start_workflow compose instead of drafting the whole email here.

WORKSPACE FIRST
- Look things up before answering: workspace_search for names, get_company for an account (dossier, people, deal,
  signals), get_deal for stage, qualification, MAP and next step, list_moves for today's queue, pipeline_summary for
  the weekly numbers. The context record in the latest system message is already loaded: don't fetch it again.
- If the answer depends on facts you don't have, ask at most 2 short questions, or answer with your assumptions
  stated in one line.
- Web search is off unless the latest system message says it's on. When off and outside facts are needed, say what
  you'd look up and suggest turning on "Search the web". When on: at most 2 searches, 2025-2026 sources, public
  professional information only, and never the founder's private deal details, notes or contacts in a query.

WRITES ARE PROPOSALS
- You change nothing yourself. Every write is a propose call the founder applies with one click; full jobs are
  start_workflow proposals. Never say you did something; say "I've proposed …" only if you did.
- Propose only what follows directly from this conversation, at most 3 per answer, and never what the workspace
  already shows (an account already tracked, a deal that exists, the same next step).
- A next step is a concrete action, a date and whether the buyer agreed. A deal starts at the first real conversation
  (stage talking), not at a cold touch. Don't propose a stage change without its exit criteria: qualified = card score
  8/12 or more and a dated next step; pilot = paid, with written success criteria; proposal = pilot criteria met or a
  priced proposal requested.
- Add a person only if the founder named them or a tool result shows them. Never invent names, titles or emails.
- A dossier younger than 7 days is reused, not redone, unless the founder asks or a strong new signal arrived. Every
  start_workflow costs money: propose the one job that answers the question, not a bundle.

COACHING (use the frameworks; name one only when it helps)
- Positioning (Dunford): competitive alternatives → unique capabilities → value with proof → best-fit customers →
  market category. If the product isn't different from the alternatives, say positioning can't fix that.
- ICP as a falsifiable bet: company group + role + obstacle (and its cause) + improvement, one segment at a time.
  Judge a segment after 25 cold first touches on positive replies; below 20 sends, rates are anecdotes.
- Outbound: trust order first (network, users, investor intros, then signal-based cold). No signal, no send: signal →
  interpretation → pressure → founder POV → proof → one interest-based question. Cold email 40-80 words (cap 100),
  1-4 word subject, no link or calendar on touch 1, 3-5 touches with a new angle each, then switch channel; recycle
  after 60-90 days. Caps: 25 cold first touches a week, never more than 20 a day; intro asks, LinkedIn and replies
  don't count. Low replies → fix the ICP or the angle, never the volume.
- Discovery (SPICED-lite): situation, pain, quantified impact, critical event, decision (process, economic buyer,
  paper). Qualification card: pain, spend, critical event, champion, economic buyer, fit, 0-2 each; qualified at
  8/12. A call that ends without a dated, buyer-agreed next step failed; 14 days without a next step → nurture or
  close. Disqualifying early is a good outcome.
- Pilots: paid, 7-14 days (never past 45), fee within the champion's approval limit (often $10-20K), success metric
  and ROI equation in writing, minimal integration, check-ins every 2-3 days, ROI review booked at kickoff, fee
  credited to the annual contract. Success criteria: "By [date], using [product] on [scope], [customer] moves [metric]
  from [baseline] to [target], measured by [owner]. If met, [customer] moves to [plan] at [price] from [date]."
  Paid design partners: 10-20% of contract value up front, 2-6 months, written conversion date and price, weekly
  30-minute standups, exec sponsor + technical + business contacts. Free only for the first 1-2 with no product yet,
  capped at 60-90 days.
- Mutual action plan: work back from the buyer's go-live date; 5-8 milestones for SMB and mid-market, 8-12 for
  enterprise; one owner and date per line; review it with the champion rather than sending it finished. Start
  security and paperwork the week the deal qualifies.
- Pricing: anchor on quantified annual value (about 10-20% of it), 1-3 options, no published price before ~10 deals,
  log every quote against its outcome. A win rate above 50% after 10 deals means underpriced. First enterprise deals
  anchor at $75-150K; under ~$2K ACV needs self-serve. Give-get: discount only in exchange for something (case study,
  logo, multi-year, prepayment, signature by a date), never a bare discount.
- Objections: acknowledge → clarify and isolate ("is that the only thing in the way?") → evidence or reframe →
  confirm → advance. "Too early / no logos": paid pilot with an opt-out, founder SLA, design-partner terms. "No
  budget": is the problem costing money now? If not, nurture. "We'll build it": engineers × months + upkeep against a
  faster pilot. "We use X": credit X, ask about the known gap, never badmouth. "Send info": ask whether the problem is
  live this quarter. "Security review": send the packet now and offer a minimal-data pilot.
- Rooms: start with a 60-minute virtual roundtable of 6-8 peers. Dinners seat 10-12, one goal, a live question as the
  theme (never the product category), peers matched by seniority, no competitors. Senior acceptance runs 15-25%:
  50-80 invites, confirm ~15 to seat 12, a personal reminder from the inviter 1-2 days out. Next-morning note, then at
  most 5 human touches in 90 days. Target attendee→meeting rate 35% or more.
- Warm intros: one forwardable email per target, double opt-in, at most 20 named targets per connector, close the
  loop. Customer referrals at a win moment: ask for two named peers.
- Hiring: the founder sells the first 10-20 deals and writes the playbook down. Hire after ~10 customers and once
  selling takes more than 20% of founder time; hire two pathfinder founding AEs, not a VP of Sales, so you can
  compare them.
- Weekly: only qualified deals count as pipeline; coverage = 1 / win rate; one experiment a week; diagnose at the
  earliest broken stage.

BOUNDARIES
- Legal questions (GDPR, CASL, CAN-SPAM, contracts, DPAs): general guidance only, then "Confirm with counsel."
- No investment, tax or personal financial advice. Pricing the founder's own product is fine.
- Push back once, with numbers, only when the founder wants to exceed the cold caps or blast a list, put an
  unapproved claim, customer or logo in outbound, run a free pilot or keep an unpaid engagement past 30 days, or
  contact someone suppressed. Otherwise just help.
- Speak in first person and never name yourself. Don't praise the question, don't apologize, don't end by offering
  more help.`;

/**
 * Consumer companies keep the shape, workspace and proposal rules and swap the coaching and pushback for consumer GTM
 * (docs/research/10-consumer-gtm.md). Built once at load, so it is byte-stable and caches like ASK_RULES.
 */
const CONSUMER_COACHING = `COACHING FOR A CONSUMER COMPANY (use the frameworks; name one only when it helps)
- Retention before acquisition: the product works when a signup cohort's retention curve flattens instead of falling to
  zero. Week-4 retention must clear the 6-month "good" bar for the category (consumer social 25%, transactional 30%,
  subscription 40%; great 45/50/70; Lenny Rachitsky and Casey Winters). Below it, the work is the first session and
  the reason to come back, not more users. Never recommend scaling paid spend before then.
- Activation: one countable first-win event within days of signup. The median across 500+ products is about 25%
  (average 34%). Compare week-4 retention of users who hit it against those who didn't.
- Product-market fit survey (Sean Ellis): "How would you feel if you could no longer use it?" 40%+ "very
  disappointed" among people who used it twice in two weeks; read it only with 40+ answers. Superhuman moved from 22%
  to about a third by narrowing to the segment that loved it most before changing the product.
- First users: do things that don't scale. Over half of consumer startups found their first users where a
  super-specific audience already gathered; none in that study succeeded with more than three channels. Pick one to
  three, judge each on what it brings in two to four weeks, park the rest.
- Creators: judge by median recent views and audience fit, not followers; engagement-rate benchmarks differ by method,
  so compare like with like. Outreach under 200 words with the offer, deliverables, usage rights, timeline and when
  you pay; one follow-up after about a week, then let it go. Seeding (free product) gets a post from roughly 20-40%
  of creators; paid deals averaged about $200 per deal in one 2025 marketplace dataset; affiliate 10-25% for DTC
  (all vendor data, treat as ranges). Every paid or gifted post carries "#ad" up front; the brand checks.
- Communities: each has its own self-promotion rules. Answer questions usefully, ask moderators before sharing, never
  post the same thing in many places or from several accounts.
- Referrals amplify word of mouth, they don't create it: where they work they bring 15-50% of new users, and fewer
  than 10% of users refer. Double-sided, in the product's own currency, tied to the friend activating, capped yearly.
  Never reward reviews or ratings; app stores and the FTC ban it.
- Virality: K = invites per user x invite conversion. With K below 1, each user from any channel brings 1/(1-K) in
  total; cycle time matters as much as K.
- Marketplaces: start with the hard side, usually supply, in one city or category (14 of 17 in Lenny Rachitsky's
  study), make the first transactions happen by hand, and measure match rate before demand spend.
- Social products: density first, one campus or group at a time, through ambassadors rewarded for friends who
  activate. Invites follow store rules: no "select all" on contacts, the user sees the message before it's sent.
- Subscription apps (RevenueCat 2026, vendor): hard paywalls convert about 10.7% of downloads by day 35 vs 2.1% for
  freemium; 17-32-day trials convert 42.5% vs 25.5% under 4 days; about 27% of annual subscribers renew. State the
  renewal price, date and how to cancel before checkout (ROSCA and state auto-renewal laws).
- DTC: contribution margin after product, shipping and payment fees (CM2) has to pay for acquisition; break-even
  marketing efficiency (revenue / marketing) is 1 / CM2%. Typical repeat purchase is about 12% within 90 days and
  19% within a year (vendor data).
- Experiments: ICE to rank, one a week. Users per variant for 80% power is about 16 x p(1-p) / (change)^2; below
  that, ship to everyone and compare before and after with an end date. Never declare a winner from a small test.
- Weekly: log the numbers Monday, then a 60-minute growth meeting: numbers (15), last week's tests (10), learnings
  (15), next tests by ICE (15), the idea list (5).
- Talk to users every week: new, active and churned. Ask about what they did, never "would you use / would you pay".

BOUNDARIES
- Legal questions (FTC disclosures, reviews rules, COPPA, CAN-SPAM, TCPA texting consent and 8am-9pm quiet hours,
  GDPR/PECR opt-in, auto-renewal laws): general guidance only, then "Confirm with counsel."
- No investment, tax or personal financial advice. Pricing the founder's own product is fine.
- Push back once, with numbers, only when the founder wants to scale paid spend before retention clears the bar, buy
  or fake followers, reviews or upvotes, reward ratings, run a sponsorship without "#ad", make a health, earnings or
  green claim they can't prove, mass-DM or cross-post, or market to children under 13. Otherwise just help.
- Speak in first person and never name yourself. Don't praise the question, don't apologize, don't end by offering
  more help.`;

const ASK_RULES_CONSUMER = `${ASK_RULES.split("\nCOACHING (")[0]}\n${CONSUMER_COACHING}`;

/* ─────────────────────────────── Small helpers ─────────────────────────────── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function clip(text: string | null | undefined, n: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** The founder's local calendar day, like `today` (ISO datetimes are UTC). */
function day(iso: string | undefined): string {
  return localDate(iso);
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The full name as a whole phrase, any case or spacing. Not `\b`: it breaks on names like "José". */
function nameRe(name: string): RegExp {
  const tokens = name.trim().split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])${tokens.join("\\s+")}(?![\\p{L}\\p{N}])`, "iu");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function isOpenDeal(d: Deal | undefined): d is Deal {
  return !!d && OPEN_STAGES.includes(d.stage);
}

function openDealFor(ws: Workspace, domain: string): Deal | undefined {
  const acc = ws.accounts[domain];
  const byId = acc?.dealId ? ws.deals[acc.dealId] : undefined;
  if (isOpenDeal(byId)) return byId;
  return Object.values(ws.deals).find((d) => d.accountDomain === domain && isOpenDeal(d));
}

function companyHref(domain: string): string {
  return `/companies?c=${encodeURIComponent(domain)}`;
}

function stageSince(deal: Deal): string {
  return day(deal.stageHistory.findLast((h) => h.stage === deal.stage)?.at ?? deal.createdAt);
}

function nextStepText(deal: Deal, today: string): string {
  const ns = deal.nextStep;
  if (!ns?.date) return "no next step";
  const overdue = ns.date < today ? `, overdue ${daysBetween(ns.date, today)}d` : "";
  return `next step "${clip(ns.what, 80)}" by ${ns.date}${ns.buyerAgreed ? " (buyer agreed)" : " (not agreed with buyer)"}${overdue}`;
}

function dealLine(deal: Deal, today: string): string {
  const q = deal.qualification;
  return [
    `${deal.id} "${deal.name}"`,
    `${STAGE_LABELS[deal.stage]} since ${stageSince(deal)}`,
    nextStepText(deal, today),
    `last activity ${day(deal.lastActivityAt)}`,
    q ? `qualification ${q.total}/12${q.qualified ? " (qualified)" : ""}` : "not scored",
  ].join(" · ");
}

/* ─────────────────────────────── Digests: code gathers, the model reads ─────────────────────────────── */

function companyDigest(ws: Workspace, domain: string, today: string): string | null {
  const a = ws.accounts[domain];
  if (!a) return null;
  const L: string[] = [`<company domain="${a.domain}">`];
  L.push(`${a.name} (${a.domain}) · ${a.status}${a.watch ? ", watched" : ""} · tier ${a.tier} · fit ${a.fitScore}/100 · source ${a.source}${a.sourceDetail ? ` (${clip(a.sourceDetail, 40)})` : ""}`);
  if (a.oneLiner) L.push(`What they do: ${clip(a.oneLiner, 200)}`);
  if (a.whyNow) L.push(`Why now (${a.whyNowScore}/4): ${clip(a.whyNow, 220)}`);
  if (a.disqualified) L.push(`Disqualified ${day(a.disqualified.at)}: ${a.disqualified.reason}${a.disqualified.note ? ` (${clip(a.disqualified.note, 80)})` : ""}`);
  if (a.suggestedTitle) L.push(`Talk to first (title): ${a.suggestedTitle}`);
  const signals = [...a.signals].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 5);
  if (signals.length) {
    L.push("Signals:");
    for (const s of signals) L.push(`- ${s.date} ${s.type} (strength ${s.strength}/3): ${clip(s.headline, 110)} → ${clip(s.implication, 120)} ${s.evidenceId ? `[${s.evidenceId}]` : `<${s.url}>`}`);
  }
  const d = a.dossier;
  if (d) {
    const snap = d.snapshot;
    L.push(`Dossier ${day(d.generatedAt)} (fresh until ${d.staleAfter}${d.staleAfter < today ? ", stale" : ""}): ${clip(snap.plainDescription, 240)}`);
    const bits = [
      snap.stage && `stage ${snap.stage}`,
      snap.funding && `${snap.funding.round}${snap.funding.amountUsd ? ` $${Math.round(snap.funding.amountUsd / 1e6)}M` : ""} on ${snap.funding.date}${snap.funding.evidenceId ? ` [${snap.funding.evidenceId}]` : ""}`,
      snap.headcount && `headcount ${snap.headcount.value} (${snap.headcount.method})`,
      snap.hq && `HQ ${snap.hq}`,
      `jurisdiction ${snap.jurisdiction}`,
    ].filter(Boolean);
    L.push(bits.join(" · "));
    for (const f of d.facts.slice(0, 8)) L.push(`- fact: ${clip(f.text, 160)} ${f.evidenceIds.map((e) => `[${e}]`).join(" ")}`);
    for (const p of d.painHypotheses.slice(0, 4)) L.push(`- pain (${p.confidence}): ${clip(p.pain, 140)} ${p.evidenceIds.map((e) => `[${e}]`).join(" ")}`);
    for (const c of d.committee.slice(0, 5)) {
      const names = c.personIds.map((id) => ws.people[id]?.name).filter(Boolean);
      L.push(`- committee ${c.role}: ${c.likelyTitles.slice(0, 3).join(", ")}${names.length ? ` (${names.join(", ")})` : ""}`);
    }
    for (const g of d.angles.slice(0, 3)) L.push(`- angle ${g.id} "${clip(g.title, 60)}" for ${g.bestFor}, strength ${g.strength}/5: ${clip(g.pov, 120)}`);
    L.push(`Recommendation: ${d.recommendation.move} — ${clip(d.recommendation.why, 160)}`);
    if (d.risks.length) L.push(`Risks: ${d.risks.slice(0, 3).map((r) => clip(r, 90)).join("; ")}`);
    if (d.unknowns.length) L.push(`Unknowns: ${d.unknowns.slice(0, 4).map((u) => clip(u, 90)).join("; ")}`);
  } else if (a.enrichment) {
    const e = a.enrichment;
    L.push(`No dossier yet. Free lookup ${day(e.crawledAt)}: ${e.openRoles} open roles${e.rolesByTeam.length ? ` (${e.rolesByTeam.slice(0, 3).map((t) => `${t.team} ${t.count}`).join(", ")})` : ""}${e.tech.length ? ` · tech ${e.tech.slice(0, 6).join(", ")}` : ""}`);
    for (const n of e.news.filter((x) => x.signal).slice(0, 3)) L.push(`- news ${n.publishedAt ? day(n.publishedAt) : "undated"}: ${clip(n.title, 110)} <${n.url}>`);
  } else {
    L.push("No dossier or lookup yet.");
  }
  const people = a.peopleIds.map((id) => ws.people[id]).filter(Boolean).slice(0, 8);
  for (const p of people) {
    const flags = [
      p.role && `${p.role}${p.champion ? `/${p.champion}` : ""}`,
      p.email && "email on file",
      p.linkedinUrl && "LinkedIn",
      p.mayHaveLeft && "may have left",
      p.doNotContact && "DO NOT CONTACT",
    ].filter(Boolean);
    L.push(`- person ${p.id} ${p.name}, ${clip(p.title, 60)}${flags.length ? ` (${flags.join(", ")})` : ""}`);
  }
  if (a.warmPathCount) L.push(`Warm paths in the founder's network: ${a.warmPathCount}`);
  const deal = openDealFor(ws, domain);
  if (deal) L.push(`Open deal: ${dealLine(deal, today)} (get_deal for the card, MAP and meetings)`);
  else {
    const closed = Object.values(ws.deals).find((x) => x.accountDomain === domain);
    if (closed) L.push(`Past deal: ${closed.id} ${STAGE_LABELS[closed.stage]}${closed.lossReason ? ` (${closed.lossReason})` : ""}${closed.nurtureUntil ? ` until ${closed.nurtureUntil}` : ""}`);
  }
  const acts = ws.activities.filter((x) => x.accountDomain === domain).slice(-5);
  for (const x of acts) L.push(`- ${day(x.at)} ${x.kind}${x.sentiment ? ` (${x.sentiment})` : ""}: ${clip(x.summary, 100)}`);
  const drafts = Object.values(ws.outreach).filter((o) => o.accountDomain === domain && o.steps.some((s) => s.status === "draft")).length;
  if (drafts) L.push(`Unsent drafts: ${drafts}`);
  L.push("</company>");
  return L.join("\n");
}

function dealDigest(ws: Workspace, deal: Deal, today: string): string {
  const L: string[] = [`<deal id="${deal.id}">`];
  L.push(`${deal.name} · ${deal.accountDomain} · ${STAGE_LABELS[deal.stage]} since ${stageSince(deal)} · source ${deal.source}`);
  L.push(`History: ${deal.stageHistory.map((h) => `${h.stage} ${day(h.at)}`).join(" → ")}`);
  L.push(`Next step: ${nextStepText(deal, today)} · last activity ${day(deal.lastActivityAt)}`);
  if (deal.priceQuotes?.length) L.push(`Price quotes: ${deal.priceQuotes.map((p) => `$${p.amountUsd} on ${p.at}${p.outcome ? ` (${p.outcome})` : ""}`).join(", ")}`);
  if (deal.closeDate) L.push(`Close date: ${deal.closeDate}`);
  const q = deal.qualification;
  if (q) L.push(`Qualification ${q.total}/12${q.qualified ? " qualified" : ""}: pain ${q.pain}, spend ${q.spend}, critical event ${q.criticalEvent}, champion ${q.champion}, economic buyer ${q.economicBuyer}, fit ${q.icpFit}`);
  const c = deal.card;
  if (c) {
    const field = (label: string, f: { value: string | null; status: string } | undefined, extra = "") => f && f.value && L.push(`- ${label} (${f.status}): ${clip(f.value, 140)}${extra}`);
    field("pain", c.pain, c.pain.impact ? ` · impact ${clip(c.pain.impact, 60)}` : "");
    field("spend", c.spend);
    field("critical event", c.criticalEvent, c.criticalEvent.date ? ` · ${c.criticalEvent.date}` : "");
    field("champion", c.champion, c.champion.name ? ` · ${c.champion.name} (${c.champion.championStatus ?? "untested"})` : "");
    field("economic buyer", c.economicBuyer, c.economicBuyer.name ? ` · ${c.economicBuyer.name}${c.economicBuyer.engaged ? " (engaged)" : ""}` : "");
    field("fit", c.fit);
    field("decision process", c.decisionProcess);
  }
  if (deal.map) {
    L.push(`MAP to ${deal.map.targetDate}: ${clip(deal.map.goal, 100)}`);
    for (const m of deal.map.milestones.slice(0, 12)) L.push(`- ${m.status} ${m.due} ${m.ownerSide}${m.ownerName ? ` (${m.ownerName})` : ""}: ${clip(m.step, 80)}`);
  }
  if (deal.pilot) L.push(`Pilot: ${deal.pilot.paid ? "paid" : "UNPAID"}${deal.pilot.feeUsd ? ` $${deal.pilot.feeUsd}` : ""}${deal.pilot.startedOn ? ` from ${deal.pilot.startedOn}` : ""}${deal.pilot.endsOn ? ` to ${deal.pilot.endsOn}` : ""} · criteria: ${clip(deal.pilot.criteria, 200)}`);
  const tasks = (deal.tasks ?? []).filter((t) => !t.done).slice(0, 6);
  for (const t of tasks) L.push(`- task (${t.owner})${t.due ? ` due ${t.due}` : ""}: ${clip(t.what, 90)}`);
  for (const ct of deal.contacts.slice(0, 6)) {
    const p = ws.people[ct.personId];
    if (p) L.push(`- contact ${p.id} ${p.name}, ${clip(p.title, 60)}${ct.role ? ` (${ct.role})` : ""}`);
  }
  const meetings = deal.meetingIds.map((id) => ws.meetings[id]).filter(Boolean).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const m of meetings.slice(-4)) {
    const ns = m.debrief?.nextStep;
    L.push(`- meeting ${m.id} ${day(m.startsAt)} "${clip(m.title, 60)}"${m.brief ? " · brief ready" : ""}${m.debrief ? ` · debriefed${ns ? `, next: ${clip(ns.what, 60)}` : ", no next step"}` : ""}`);
  }
  if (deal.lossReason) L.push(`Loss reason: ${deal.lossReason}`);
  if (deal.nurtureUntil) L.push(`Nurture until: ${deal.nurtureUntil}`);
  if (deal.notes) L.push(`Founder notes: ${clip(deal.notes, 300)}`);
  L.push("</deal>");
  return L.join("\n");
}

const PLAYBOOK_LABELS: Record<string, string> = {
  foundation: "Playbook",
  positioning: "Positioning",
  icp: "ICP",
  personas: "Personas",
  messaging: "Messaging",
  questions: "Open questions",
  plan: "Plan",
  channel: "Plan",
  commercial: "Commercial terms",
  competitors: "Competitors",
  voice: "Voice",
  assets: "Assets",
};

function playbookDigest(ws: Workspace, section: string): string | null {
  const f = ws.foundation;
  if (!f) return null;
  const pick: Record<string, unknown> = {
    positioning: { differentiators: f.positioning.differentiators, bestFit: f.positioning.bestFit, warning: f.positioning.warning },
    icp: { testSlices: f.icp.testSlices, triggers: f.icp.triggers, confirmIf: f.icp.confirmIf, killIf: f.icp.killIf, employeeBand: f.icp.employeeBand, bets: f.icp.betHistory },
    messaging: { themes: f.messaging.themes, byPersona: f.messaging.byPersona, bannedWords: f.messaging.bannedWords },
    plan: f.channelPlan,
    channel: f.channelPlan,
    commercial: f.commercial,
    competitors: f.competitors,
    questions: f.founderQuestions.filter((q) => !q.answer).map((q) => ({ question: q.question, why: q.whyItMatters })),
  };
  const data = pick[section];
  if (data === undefined) return null;
  return `<playbook section="${section}">\n${clip(JSON.stringify(data), 3000)}\n</playbook>`;
}

interface ContextInfo {
  key: string;
  label: string;
  /** One line, sent every turn. */
  line: string;
  /** The full record, sent when it's new to the thread or changed. */
  digest: string | null;
  record?: { ref: EntityRef; label: string; domain?: string };
}

export function contextInfo(ws: Workspace, ref: EntityRef, today: string): ContextInfo | null {
  const key = refKey(ref);
  switch (ref.kind) {
    case "account": {
      const domain = toDomain(ref.id) ?? ref.id;
      const a = ws.accounts[domain];
      if (!a) return { key, label: domain, line: `${domain} (not in the workspace yet)`, digest: null };
      const deal = openDealFor(ws, domain);
      return {
        key,
        label: a.name,
        line: `${a.name} (company · ${a.domain} · ${a.status}${deal ? ` · deal ${STAGE_LABELS[deal.stage]}, ${nextStepText(deal, today)}` : ""})`,
        digest: companyDigest(ws, domain, today),
        record: { ref: { kind: "account", id: domain }, label: a.name, domain },
      };
    }
    case "deal": {
      const d = ws.deals[ref.id];
      if (!d) return null;
      return {
        key,
        label: d.name,
        line: `the ${d.name} deal (${STAGE_LABELS[d.stage]}, ${nextStepText(d, today)})`,
        digest: `${dealDigest(ws, d, today)}\n${companyDigest(ws, d.accountDomain, today) ?? ""}`.trim(),
        record: { ref, label: d.name, domain: d.accountDomain },
      };
    }
    case "person": {
      const p = ws.people[ref.id];
      if (!p) return null;
      const acc = ws.accounts[p.accountDomain];
      return {
        key,
        label: p.name,
        line: `${p.name}, ${p.title} at ${acc?.name ?? p.accountDomain} (person ${p.id})`,
        digest: companyDigest(ws, p.accountDomain, today),
        record: { ref, label: p.name, domain: p.accountDomain },
      };
    }
    case "meeting": {
      const m = ws.meetings[ref.id];
      if (!m) return null;
      const d = ws.deals[m.dealId];
      return {
        key,
        label: m.title,
        line: `the meeting "${m.title}" on ${day(m.startsAt)}${d ? ` (${d.name}, ${STAGE_LABELS[d.stage]})` : ""}`,
        digest: d ? dealDigest(ws, d, today) : null,
        record: d ? { ref: { kind: "deal", id: d.id }, label: d.name, domain: d.accountDomain } : undefined,
      };
    }
    case "event": {
      const e = ws.events[ref.id];
      if (!e) return null;
      const guests = Object.values(e.guests);
      const count = (s: string) => guests.filter((g) => g.status === s).length;
      const theme = e.plan?.themes[e.chosenThemeIdx ?? 0];
      const digest = [
        `<event id="${e.id}">`,
        `${e.title} · ${e.kind} · ${e.status}${e.date ? ` · ${day(e.date)}` : ""}${e.plan?.city ? ` · ${e.plan.city}` : ""}${e.venue ? ` · ${e.venue.name}` : ""}`,
        e.plan ? `Goal ${e.plan.goal} · invites ${e.plan.inviteMath.invites} → confirms ${e.plan.inviteMath.confirmsTarget} → seats ${e.plan.inviteMath.seats}` : "No plan yet.",
        theme ? `Theme: ${theme.title} — ${clip(theme.question, 140)}` : "",
        `Guests: ${guests.length} (${count("invited")} invited, ${count("accepted") + count("confirmed")} accepted or confirmed, ${count("declined")} declined, ${count("attended")} attended)`,
        e.plan ? `Open tasks: ${e.plan.timeline.filter((t) => !t.done).slice(0, 5).map((t) => `${t.due} ${clip(t.task, 60)}`).join("; ") || "none"}` : "",
        "</event>",
      ].filter(Boolean);
      return { key, label: e.title, line: `the ${e.kind} "${e.title}" (${e.status})`, digest: digest.join("\n"), record: { ref, label: e.title } };
    }
    case "playbook": {
      const label = PLAYBOOK_LABELS[ref.id] ?? (ref.id.startsWith("asset") ? "Assets" : "Playbook");
      return { key, label, line: `the ${label} section of the playbook (summarized in company_context)`, digest: playbookDigest(ws, ref.id) };
    }
    default:
      return null;
  }
}

/* ─────────────────────────────── Read tools ─────────────────────────────── */

const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "to", "in", "at", "on", "with", "my", "our", "is", "are", "who", "what", "which"]);

type SearchKind = "company" | "person" | "deal" | "meeting" | "move" | "event";

export function workspaceSearch(ws: Workspace, query: string, kinds: SearchKind[] | undefined, limit: number, today: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9.@'-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
  if (!tokens.length) return "Give me a name, domain, title or keyword to search for.";
  const want = (k: SearchKind) => !kinds?.length || kinds.includes(k);
  const hits: { score: number; line: string; at: string }[] = [];
  const score = (name: string, hay: string) => {
    const n = name.toLowerCase();
    const h = `${n} ${hay.toLowerCase()}`;
    let s = 0;
    for (const t of tokens) if (h.includes(t)) s += n.includes(t) ? 2 : 1;
    return s >= Math.max(1, Math.ceil(tokens.length / 2)) ? s : 0;
  };
  if (want("company")) {
    for (const a of Object.values(ws.accounts)) {
      const s = score(`${a.name} ${a.domain}`, [a.oneLiner, a.whyNow, a.hqCity, a.suggestedTitle, a.status, `tier ${a.tier}`, ...(a.tags ?? [])].join(" "));
      if (s) hits.push({ score: s, at: a.addedAt, line: `company ${a.domain} · ${a.name} · ${a.status} · tier ${a.tier} · fit ${a.fitScore}${a.whyNow ? ` · why now: ${clip(a.whyNow, 90)}` : ""}` });
    }
  }
  if (want("person")) {
    for (const p of Object.values(ws.people)) {
      const acc = ws.accounts[p.accountDomain];
      const s = score(p.name, [p.title, p.accountDomain, acc?.name, p.role, p.notes].join(" "));
      if (s) hits.push({ score: s, at: p.lastSeen ?? "", line: `person ${p.id} · ${p.name}, ${clip(p.title, 50)} @ ${acc?.name ?? p.accountDomain} (${p.accountDomain})${p.role ? ` · ${p.role}` : ""}${p.doNotContact ? " · do not contact" : ""}` });
    }
  }
  if (want("deal")) {
    for (const d of Object.values(ws.deals)) {
      const s = score(d.name, [d.accountDomain, ws.accounts[d.accountDomain]?.name, d.stage, d.nextStep?.what, d.notes].join(" "));
      if (s) hits.push({ score: s, at: d.lastActivityAt, line: `deal ${dealLine(d, today)}` });
    }
  }
  if (want("meeting")) {
    for (const m of Object.values(ws.meetings)) {
      const s = score(m.title, [ws.deals[m.dealId]?.name, ...m.attendees.map((x) => x.name)].join(" "));
      if (s) hits.push({ score: s, at: m.startsAt, line: `meeting ${m.id} · ${day(m.startsAt)} "${clip(m.title, 60)}" · deal ${m.dealId}${m.brief ? " · brief ready" : ""}${m.debrief ? " · debriefed" : ""}` });
    }
  }
  if (want("move")) {
    for (const mv of Object.values(ws.moves)) {
      if (mv.status !== "open") continue;
      const s = score(mv.title, mv.why);
      if (s) hits.push({ score: s, at: mv.createdAt, line: `move ${mv.id} · ${mv.kind} · due ${mv.dueOn} · ${clip(mv.title, 70)} — ${clip(mv.why, 80)}` });
    }
  }
  if (want("event")) {
    for (const e of Object.values(ws.events)) {
      const s = score(e.title, [e.kind, e.plan?.city, e.status].join(" "));
      if (s) hits.push({ score: s, at: e.createdAt, line: `event ${e.id} · ${e.kind} "${clip(e.title, 60)}" · ${e.status}${e.date ? ` · ${day(e.date)}` : ""}` });
    }
  }
  if (!hits.length) return `No matches for "${query}". Try one distinctive word, a domain or a person's last name.`;
  const rank = (line: string) => ["company", "deal", "person", "meeting", "move", "event"].indexOf(line.split(" ")[0]);
  hits.sort((a, b) => b.score - a.score || rank(a.line) - rank(b.line) || b.at.localeCompare(a.at));
  return hits
    .slice(0, limit)
    .map((h) => h.line)
    .join("\n");
}

function movesPrepared(ws: Workspace, today: string): boolean {
  return Object.values(ws.moves).some((m) => m.status === "open" || day(m.createdAt) === today);
}

function listMoves(ws: Workspace, today: string): string {
  const open = Object.values(ws.moves)
    .filter((m) => m.status === "open" && m.dueOn <= today)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12);
  if (!movesPrepared(ws, today)) return "Today's moves haven't been prepared yet; they're built when the founder opens Today. Use pipeline_summary and the deals instead.";
  if (!open.length) return "No open moves due today.";
  return open.map((m) => `${m.id} · ${m.kind} · ${m.minutes} min · ${clip(m.title, 70)} — ${clip(m.why, 90)}${m.overdueDays ? ` · ${m.overdueDays}d overdue` : ""}${m.ref ? ` · ${m.ref.kind} ${m.ref.id}` : ""}`).join("\n");
}

function pipelineSummary(ws: Workspace, now: Date): string {
  const today = todayISO(now);
  const sb = computeScoreboard(ws, now);
  const open = Object.values(ws.deals).filter(isOpenDeal);
  const byStage = OPEN_STAGES.map((s) => `${STAGE_LABELS[s]} ${open.filter((d) => d.stage === s).length}`).join(", ");
  const missing = dealsMissingNextStep(ws, today).map((id) => ws.deals[id]);
  const stale = open.filter((d) => daysBetween(day(d.lastActivityAt), today) >= 14);
  const unpaid = open.filter((d) => d.pilot && !d.pilot.paid);
  const quotes = Object.values(ws.deals).flatMap((d) => d.priceQuotes ?? []);
  const L = [
    `Week of ${sb.weekOf}: conversations ${sb.conversations[0]}/${sb.conversations[1]}, cold first touches ${sb.firstTouches[0]}/${sb.firstTouches[1]}, intro asks ${sb.introAsks?.[0] ?? 0}/${sb.introAsks?.[1] ?? 4}, replies ${sb.replies} (${sb.positiveReplies ?? 0} positive), meetings booked ${sb.meetingsBooked}.`,
    sb.replyRate ? `Reply rate (28 days): ${Math.round(sb.replyRate.value * 100)}% of ${sb.replyRate.n}.` : "Reply rate hidden: fewer than 20 cold first touches in 28 days.",
    `Open deals ${open.length}: ${byStage}. Qualified ${sb.qualifiedDeals}.${sb.qualifiedPipelineUsd !== undefined ? ` Qualified pipeline $${Math.round(sb.qualifiedPipelineUsd)}.` : " No price quoted yet, so no dollar pipeline."}`,
    `Goal: ${sb.goalProgress[0]}/${sb.goalProgress[1]} ${ws.goal.targetLabel} by ${ws.goal.byDate}.`,
    `Missing a dated next step: ${missing.length ? missing.map((d) => `${d.id} ${d.name}`).join(", ") : "none"}.`,
    `No activity for 14+ days: ${stale.length ? stale.map((d) => `${d.id} ${d.name} (${day(d.lastActivityAt)})`).join(", ") : "none"}.`,
  ];
  if (unpaid.length) L.push(`Unpaid pilots: ${unpaid.map((d) => `${d.id} ${d.name}${d.pilot?.startedOn ? ` since ${d.pilot.startedOn}` : ""}`).join(", ")}.`);
  if (quotes.length) L.push(`Price quotes logged: ${quotes.length} (${quotes.filter((q) => q.outcome === "accepted").length} accepted, ${quotes.filter((q) => q.outcome === "pushback").length} pushback).`);
  return L.join("\n");
}

/* ─────────────────────────────── Instant answers: code, no model ─────────────────────────────── */

type InstantRow = NonNullable<AskTurn["instant"]>["rows"][number];
export interface InstantAnswer {
  title: string;
  rows: InstantRow[];
  /** The same answer as plain text, appended to the model history so follow-ups have it. */
  text: string;
}

function dealRow(d: Deal, detail: string): InstantRow {
  return { label: d.name, detail, ref: { kind: "deal", id: d.id }, domain: d.accountDomain, href: companyHref(d.accountDomain) };
}

function finish(title: string, rows: InstantRow[]): InstantAnswer {
  return { title, rows, text: [title, ...rows.map((r) => `- ${r.label}${r.detail ? ` — ${r.detail}` : ""}`)].join("\n") };
}

/**
 * Short list-and-filter questions are answered from the workspace in code (zero tokens). Anything that asks for
 * judgment ("why", "should I", "how do I", "draft", "plan") goes to the model.
 */
export function instantAnswer(ws: Workspace, question: string, now: Date): InstantAnswer | null {
  const q = question
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[?!.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q || q.split(" ").length > 9) return null;
  if (/\b(why|should|could|would|help|advice|advise|think|write|draft|plan|explain|compare|recommend|best way|how (do|can|to)|what if)\b/.test(q)) return null;
  const today = todayISO(now);
  const open = Object.values(ws.deals).filter(isOpenDeal);
  const lastTouch = (d: Deal) => {
    const n = daysBetween(day(d.lastActivityAt), today);
    return n <= 0 ? "touched today" : `last touch ${n}d ago`;
  };

  // List-shaped questions only: "Is Rowanstack's next step overdue?" is about one record and goes to the model.
  if (/\b(no|missing|without|overdue|lacking)\b.*\bnext ?steps?\b|\bnext ?steps?\b.*\b(missing|overdue)\b/.test(q) && /\b(deals|pipeline|accounts|next steps)\b/.test(q)) {
    const missing = dealsMissingNextStep(ws, today).map((id) => ws.deals[id]);
    const rows = missing.map((d) => dealRow(d, `${STAGE_LABELS[d.stage]} · ${d.nextStep?.date ? `next step was due ${d.nextStep.date}` : "no next step"} · ${lastTouch(d)}`));
    if (!open.length) return finish("You have no open deals yet.", []);
    return finish(rows.length ? `${plural(rows.length, "open deal")} ${rows.length === 1 ? "has" : "have"} no dated next step.` : "Every open deal has a dated next step.", rows);
  }

  if (/\b(stuck|stale|stalled|quiet|gone dark|went dark|at risk|neglected)\b/.test(q) && /\b(deals|pipeline|accounts|companies)\b/.test(q)) {
    const stale = open.filter((d) => daysBetween(day(d.lastActivityAt), today) >= 14).sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt));
    const rows = stale.map((d) => dealRow(d, `${STAGE_LABELS[d.stage]} · ${lastTouch(d)} · ${d.nextStep?.date ? `next step ${d.nextStep.date}` : "no next step"}`));
    return finish(rows.length ? `${plural(rows.length, "open deal")} ${rows.length === 1 ? "has" : "have"} had no activity for 14 days or more.` : "No open deal has gone 14 days without activity.", rows);
  }

  const stageMatch = q.match(/\b(?:in|at) (talking|qualified|pilot|proposal|nurture)\b/) ?? q.match(/^(?:my |open |active |current )?(pilots|proposals)$/);
  if (stageMatch) {
    const stage = stageMatch[1].replace(/s$/, "") as Stage;
    const list = Object.values(ws.deals).filter((d) => d.stage === stage);
    const rows = list.map((d) => dealRow(d, `since ${stageSince(d)} · ${nextStepText(d, today)}`));
    return finish(rows.length ? `${plural(rows.length, "deal")} in ${STAGE_LABELS[stage]}.` : `No deals in ${STAGE_LABELS[stage]}.`, rows);
  }

  if (/^(?:show (?:me )?|list |what'?s in |where'?s )?(?:my |the )?(?:pipeline|open deals|active deals|deals)(?: status| right now| now| at a glance)?$/.test(q)) {
    if (!open.length) return finish("No open deals yet. A deal starts at the first real conversation.", []);
    const counts = OPEN_STAGES.map((s) => [s, open.filter((d) => d.stage === s).length] as const).filter(([, n]) => n);
    const rows = [...open]
      .sort((a, b) => OPEN_STAGES.indexOf(b.stage) - OPEN_STAGES.indexOf(a.stage) || b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((d) => dealRow(d, `${STAGE_LABELS[d.stage]} · ${nextStepText(d, today)}`));
    return finish(`${plural(open.length, "open deal")}: ${counts.map(([s, n]) => `${n} ${STAGE_LABELS[s].toLowerCase()}`).join(", ")}.`, rows);
  }

  if (/^(?:what'?s |whats )?(?:on )?(?:my )?(?:moves|plate|queue|to-?dos?|todo list|agenda)(?: today| for today)?$|^what'?s (?:due|on) today$/.test(q)) {
    const moves = Object.values(ws.moves)
      .filter((m) => m.status === "open" && m.dueOn <= today)
      .sort((a, b) => b.priority - a.priority);
    const rows = moves.slice(0, 10).map((m) => ({ label: m.title, detail: `${m.minutes} min · ${clip(m.why, 80)}`, ref: m.ref, href: m.href ?? "/today" }));
    const minutes = moves.reduce((s, m) => s + m.minutes, 0);
    if (!movesPrepared(ws, today)) return finish("Today's moves aren't prepared yet. They're ready the moment you open Today.", [{ label: "Open Today", href: "/today" }]);
    return finish(moves.length ? `${plural(moves.length, "move")} due today, about ${minutes} minutes.` : "Nothing is due today.", rows);
  }

  // Anchored to AI-cost phrasing: "usage" alone is a customer's word too ("Fernwick's usage variance").
  const spendQ =
    /^(?:how much )?(?:have i |did i |i'?ve )?(?:spent|spend)(?: on ai| so far| this month)?$|^(?:my |this month'?s )?(?:ai )?(?:usage|spend|budget left)(?: this month| so far)?$|\b(?:ai|inroad|claude|model|token) (?:spend|usage|costs?|budget)\b|\btokens? (?:used|spent)\b/;
  if (spendQ.test(q) && !/\b(pilot|dinner|event|price|pricing|charge|customer|deal|marketing)\b/.test(q)) {
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const u = ws.usage[key];
    const budget = ws.caps.monthlyBudgetUsd;
    const spent = u?.costUsd ?? 0;
    const rows = Object.entries(u?.byWorkflow ?? {})
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 6)
      .map(([wf, cost]) => ({ label: wf.replace(/_/g, " "), detail: `$${(cost ?? 0).toFixed(2)}`, href: "/settings#usage" }));
    if (u?.freeSignals) rows.push({ label: "free lookups (no tokens)", detail: String(u.freeSignals), href: "/settings#usage" });
    return finish(`$${spent.toFixed(2)} of AI spend this month${budget > 0 ? ` against a $${budget} budget` : ""}, across ${plural(u?.runs ?? 0, "run")}.`, rows);
  }

  if (/^(?:how am i doing|how'?s (?:my |the )?(?:week|pipeline) going|am i on track|(?:my )?(?:scoreboard|progress|numbers|stats))(?: this week| so far)?$/.test(q)) {
    const sb = computeScoreboard(ws, now);
    const rows: InstantRow[] = [
      { label: "Conversations held", detail: `${sb.conversations[0]} of ${sb.conversations[1]} this week` },
      { label: "Cold first touches", detail: `${sb.firstTouches[0]} of ${sb.firstTouches[1]} cap` },
      { label: "Replies", detail: `${sb.replies}${sb.positiveReplies ? `, ${sb.positiveReplies} positive` : ""}` },
      { label: "Qualified deals", detail: String(sb.qualifiedDeals) },
      { label: "Missing a next step", detail: String(sb.dealsMissingNextStep) },
      { label: "Goal", detail: `${sb.goalProgress[0]} of ${sb.goalProgress[1]} ${ws.goal.targetLabel} by ${ws.goal.byDate}` },
    ];
    const behind = sb.conversations[0] < sb.conversations[1];
    return finish(`${sb.conversations[0]} of ${sb.conversations[1]} conversations this week${behind ? "" : ", on pace"}.`, rows.map((r) => ({ ...r, href: "/today" })));
  }

  if (/^(?:my )?(?:top|best|hottest|strongest|tier a) (?:prospects|accounts|companies|targets)$/.test(q)) {
    const list = Object.values(ws.accounts)
      .filter((a) => a.status !== "disqualified" && a.status !== "customer" && !openDealFor(ws, a.domain))
      .sort((a, b) => b.fitScore + b.whyNowScore * 10 - (a.fitScore + a.whyNowScore * 10))
      .slice(0, 8);
    const rows = list.map((a) => ({ label: a.name, detail: `tier ${a.tier} · fit ${a.fitScore}${a.whyNow ? ` · ${clip(a.whyNow, 70)}` : ""}`, ref: { kind: "account" as const, id: a.domain }, domain: a.domain, href: companyHref(a.domain) }));
    return finish(rows.length ? `Your ${plural(rows.length, "strongest prospect")} by fit and why-now.` : "No prospects yet. Find companies from Companies.", rows);
  }

  // A bare company or person name: show the record.
  const name = q.replace(/^(?:open|find|show(?: me)?|go to|look ?up|pull up|where'?s)\s+/, "").trim();
  if (name.length >= 3) {
    const acc = Object.values(ws.accounts).find((a) => a.name.toLowerCase() === name || a.domain === name || a.domain.split(".")[0] === name);
    if (acc) {
      const deal = openDealFor(ws, acc.domain);
      return finish(`${acc.name}`, [
        {
          label: acc.name,
          detail: [acc.status.replace("_", " "), deal ? `${STAGE_LABELS[deal.stage]} · ${nextStepText(deal, today)}` : `tier ${acc.tier}`, acc.whyNow ? clip(acc.whyNow, 60) : ""].filter(Boolean).join(" · "),
          ref: { kind: "account", id: acc.domain },
          domain: acc.domain,
          href: companyHref(acc.domain),
        },
      ]);
    }
    const person = Object.values(ws.people).find((p) => p.name.toLowerCase() === name);
    if (person) {
      const a = ws.accounts[person.accountDomain];
      return finish(person.name, [{ label: person.name, detail: `${person.title} at ${a?.name ?? person.accountDomain}`, ref: { kind: "person", id: person.id }, domain: person.accountDomain, href: companyHref(person.accountDomain) }]);
    }
  }
  return null;
}

/* ─────────────────────────────── Proposals ─────────────────────────────── */

const DEAL_SOURCES = ["warm_intro", "signal_cold", "investor_intro", "community", "content", "dinner", "event", "inbound", "network", "referral"] as const;
const LOSS = ["no_pain", "no_budget", "timing", "competitor", "build", "price", "product_gap", "went_dark", "not_icp"] as const;
const ROLES = ["economic_buyer", "champion", "technical_approver", "user", "blocker"] as const;
const CLAIM_KINDS = ["metric", "customer", "logo", "credential", "capability", "security"] as const;
const OBJECTION_CATEGORIES = ["timing", "budget", "status_quo", "build", "competitor", "startup_risk", "security", "priority", "info_request", "team"] as const;

const ProposeInput = z.object({
  kind: z.enum(["track_account", "create_deal", "set_next_step", "change_stage", "add_task", "add_person", "add_pov", "add_claim", "add_objection", "suppress"]),
  summary: z.string().min(3).max(100).describe("≤12 words, what applying does, e.g. 'Set Northwind's next step: send the MAP by Oct 24'."),
  reason: z.string().min(3).max(260).describe("≤30 words: why, grounded in this conversation."),
  domain: z.string().max(253).optional().describe("track_account, create_deal, add_person, suppress (a whole company)."),
  dealId: z.string().max(40).optional().describe("set_next_step, change_stage, add_task. Use ids from tool results."),
  name: z.string().max(80).optional().describe("track_account: company name; create_deal: deal name; add_person: full name."),
  title: z.string().max(100).optional().describe("add_person: job title."),
  role: z.enum(ROLES).optional().describe("add_person: buying-committee role, if known."),
  email: z.string().max(200).optional().describe("add_person or suppress: only an address the founder gave you."),
  linkedinUrl: z.string().max(300).optional().describe("add_person: only a URL the founder gave you or a tool returned."),
  what: z.string().max(140).optional().describe("set_next_step, add_task: the concrete action, ≤15 words."),
  date: z.string().optional().describe("YYYY-MM-DD. set_next_step: required; add_task: due date; change_stage to nurture: check back on."),
  buyerAgreed: z.boolean().optional().describe("set_next_step: did the buyer agree to it?"),
  owner: z.enum(["founder", "buyer"]).optional().describe("add_task."),
  stage: z.enum(["talking", "qualified", "pilot", "proposal", "won", "lost", "nurture"]).optional().describe("change_stage: the new stage. create_deal: talking (default) or qualified."),
  lossReason: z.enum(LOSS).optional().describe("change_stage to lost: required."),
  source: z.enum(DEAL_SOURCES).optional().describe("create_deal: where the conversation came from."),
  text: z.string().max(300).optional().describe("add_pov: the founder's opinion; add_claim: the fact about us; add_objection: the objection as the buyer said it."),
  basis: z.string().max(200).optional().describe("add_pov: what it rests on ('30 calls with platform leads'); add_claim: where it comes from."),
  claimKind: z.enum(CLAIM_KINDS).optional().describe("add_claim."),
  category: z.enum(OBJECTION_CATEGORIES).optional().describe("add_objection."),
  response: z.string().max(500).optional().describe("add_objection: the suggested response, ≤60 words."),
  suppressReason: z.enum(["unsubscribe", "requested_delete", "customer", "competitor", "manual"]).optional().describe("suppress."),
});
type ProposeInput = z.infer<typeof ProposeInput>;

const START_WORKFLOWS = ["discovery", "dossier", "compose", "prep", "debrief", "dinner_plan", "asset", "review"] as const;

const StartInput = z.object({
  workflow: z.enum(START_WORKFLOWS),
  args: z.record(z.string(), z.unknown()).describe("Arguments for the workflow, exactly as listed in the tool description."),
  summary: z.string().min(3).max(100).describe("≤12 words, the job as a button would say it, e.g. 'Research Northwind'."),
  reason: z.string().min(3).max(260).describe("≤30 words: why this job, now."),
});

export interface TurnState {
  ws: Workspace;
  today: string;
  /** What the model has seen this turn and the founder has said in this thread; people must appear in it. */
  grounding: string[];
  proposals: AskProposal[];
  records: Map<string, { ref: EntityRef; label: string; domain?: string }>;
  founderMessage: string;
  web: boolean;
}

function requireDeal(ws: Workspace, id: string | undefined): Deal {
  const deal = id ? ws.deals[id] : undefined;
  if (!deal) throw new Error(`No deal with id "${id ?? ""}". Look it up with get_deal or workspace_search first.`);
  return deal;
}

function requireDate(date: string | undefined, what: string, today: string, futureOnly = true): string {
  if (!date || !DATE.test(date)) throw new Error(`${what} needs a date as YYYY-MM-DD.`);
  if (futureOnly && date < today) throw new Error(`${what} date ${date} is in the past (today is ${today}).`);
  return date;
}

/** Validates a proposal against the workspace and returns the payload the client will apply. */
function checkProposal(p: ProposeInput, s: TurnState): Record<string, unknown> {
  const { ws, today } = s;
  const domainOf = (raw: string | undefined) => {
    const d = raw ? toDomain(raw) : null;
    if (!d) throw new Error(`"${raw ?? ""}" isn't a company domain (like northwind.com).`);
    return d;
  };
  switch (p.kind) {
    case "track_account": {
      const domain = domainOf(p.domain);
      const acc = ws.accounts[domain];
      if (acc?.watch) throw new Error(`${acc.name} is already tracked.`);
      if (acc?.status === "disqualified") throw new Error(`${acc.name} was disqualified; the founder can restore it from its page.`);
      return { domain, name: acc?.name ?? p.name };
    }
    case "create_deal": {
      const domain = domainOf(p.domain);
      const existing = openDealFor(ws, domain);
      if (existing) throw new Error(`${existing.name} is already an open deal (${existing.id}, ${STAGE_LABELS[existing.stage]}).`);
      const stage = p.stage === "qualified" ? "qualified" : "talking";
      return { domain, name: p.name ?? ws.accounts[domain]?.name ?? domain, stage, source: p.source ?? "network" };
    }
    case "set_next_step": {
      const deal = requireDeal(ws, p.dealId);
      if (!OPEN_STAGES.includes(deal.stage)) throw new Error(`${deal.name} is ${STAGE_LABELS[deal.stage]}; next steps are for open deals.`);
      if (!p.what?.trim()) throw new Error("A next step needs the concrete action in `what`.");
      const date = requireDate(p.date, "A next step", today);
      if (deal.nextStep?.what === p.what && deal.nextStep.date === date) throw new Error("That next step is already set.");
      return { dealId: deal.id, what: p.what.trim(), date, buyerAgreed: p.buyerAgreed ?? false };
    }
    case "change_stage": {
      const deal = requireDeal(ws, p.dealId);
      if (!p.stage) throw new Error("change_stage needs `stage`.");
      if (deal.stage === p.stage) throw new Error(`${deal.name} is already ${STAGE_LABELS[p.stage]}.`);
      if (p.stage === "lost" && !p.lossReason) throw new Error("Moving to lost needs `lossReason`.");
      const nurtureUntil = p.stage === "nurture" && p.date ? requireDate(p.date, "Nurture", today) : undefined;
      return { dealId: deal.id, stage: p.stage, lossReason: p.stage === "lost" ? p.lossReason : undefined, nurtureUntil };
    }
    case "add_task": {
      const deal = requireDeal(ws, p.dealId);
      if (!p.what?.trim()) throw new Error("A task needs `what`.");
      const due = p.date ? requireDate(p.date, "A task", today) : undefined;
      return { dealId: deal.id, what: p.what.trim(), due, owner: p.owner ?? "founder" };
    }
    case "add_person": {
      const domain = domainOf(p.domain);
      const name = p.name?.trim();
      if (!name || !p.title?.trim()) throw new Error("add_person needs `name` and `title`.");
      const known = Object.values(ws.people).find((x) => x.accountDomain === domain && x.name.toLowerCase() === name.toLowerCase());
      if (known) throw new Error(`${name} is already on file (${known.id}).`);
      const re = nameRe(name);
      const grounded = s.grounding.some((t) => re.test(t));
      // With web search on, an unsourced name is checked against the search results after the run.
      if (!grounded && !s.web) throw new Error(`I can't find "${name}" in what the founder said or in any tool result. Only add people you can source.`);
      const email = p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) ? p.email : undefined;
      if (email && !s.grounding.some((t) => t.includes(email))) throw new Error(`The email ${email} didn't come from the founder or a tool result. Leave it out.`);
      const linkedinUrl = p.linkedinUrl && /^https:\/\/(www\.)?linkedin\.com\//.test(p.linkedinUrl) ? p.linkedinUrl : undefined;
      return { domain, name, title: p.title.trim(), role: p.role, email, linkedinUrl, sourced: grounded ? "conversation" : "web" };
    }
    case "add_pov": {
      if (!p.text?.trim() || !p.basis?.trim()) throw new Error("add_pov needs `text` (the opinion) and `basis` (what it rests on).");
      if (ws.povs.some((x) => x.text.toLowerCase() === p.text!.trim().toLowerCase())) throw new Error("That POV is already in the bank.");
      return { text: p.text.trim(), basis: p.basis.trim() };
    }
    case "add_claim": {
      if (!p.text?.trim() || !p.claimKind) throw new Error("add_claim needs `text` and `claimKind`.");
      return { text: p.text.trim(), claimKind: p.claimKind, basis: p.basis?.trim() };
    }
    case "add_objection": {
      if (!p.text?.trim() || !p.category) throw new Error("add_objection needs `text` and `category`.");
      return { objection: p.text.trim(), category: p.category, response: p.response?.trim() ?? "" };
    }
    case "suppress": {
      const email = p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) ? p.email.toLowerCase() : undefined;
      const domain = !email && p.domain ? domainOf(p.domain) : undefined;
      if (!email && !domain) throw new Error("suppress needs an `email` or a `domain`.");
      if (ws.suppression.some((x) => (email && x.email === email) || (domain && x.domain === domain))) throw new Error("Already suppressed.");
      return { email, domain, reason: p.suppressReason ?? "manual" };
    }
  }
}

async function checkStart(input: z.infer<typeof StartInput>, s: TurnState): Promise<Record<string, unknown>> {
  const { ws } = s;
  const args: Record<string, unknown> = { ...input.args };
  switch (input.workflow) {
    case "dossier": {
      const domain = toDomain(String(args.domain ?? ""));
      if (!domain) throw new Error("dossier needs args.domain (like northwind.com).");
      args.domain = domain;
      const d = ws.accounts[domain]?.dossier;
      if (d && d.staleAfter >= s.today && !args.force) throw new Error(`${ws.accounts[domain].name} has a fresh dossier from ${day(d.generatedAt)}. Use it (get_company), or pass force: true only if the founder asked for a refresh.`);
      break;
    }
    case "compose": {
      const domain = toDomain(String(args.domain ?? ""));
      if (!domain || !ws.accounts[domain]) throw new Error("compose needs args.domain of a company in the workspace.");
      args.domain = domain;
      if (args.personId && !ws.people[String(args.personId)]) throw new Error(`No person ${String(args.personId)}.`);
      if (args.mode === "reply") {
        if (s.founderMessage.length < 20) throw new Error("A reply draft needs the prospect's reply pasted into the conversation.");
        args.replyText = s.founderMessage.slice(0, 10_000);
      }
      break;
    }
    case "prep": {
      if (!ws.meetings[String(args.meetingId ?? "")]) throw new Error("prep needs args.meetingId of a scheduled meeting (find it with get_deal).");
      break;
    }
    case "debrief": {
      if (s.founderMessage.length < 60) throw new Error("A debrief needs the call notes or transcript pasted into the conversation.");
      if (!args.meetingId && !args.dealId && !args.domain) throw new Error("debrief needs args.dealId, args.meetingId or args.domain.");
      // The notes are the founder's own message; code fills them so the model never re-types them.
      args.notes = s.founderMessage.slice(0, 200_000);
      break;
    }
    case "dinner_plan": {
      args.eventId = newId("evt");
      delete args.mode;
      break;
    }
    case "discovery":
      args.source ??= "manual";
      break;
    case "asset":
    case "review":
      break;
  }
  const { getWorkflow } = await import("./index");
  const def = getWorkflow(input.workflow);
  const parsed = def?.args.safeParse(args);
  if (!parsed?.success) {
    throw new Error(`Invalid args for ${input.workflow}: ${parsed?.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ") ?? "unknown workflow"}`);
  }
  return { workflow: input.workflow, args };
}

/* ─────────────────────────────── Tools ─────────────────────────────── */

/** Exported for scripts and evals; the workflow builds a fresh set per turn. */
export function buildTools(s: TurnState): AgentTool[] {
  const seen = (out: string) => {
    s.grounding.push(out);
    return out;
  };
  const record = (ref: EntityRef, label: string, domain?: string) => s.records.set(refKey(ref), { ref, label, domain });
  const pushProposal = (p: Omit<AskProposal, "id" | "status">): string => {
    if (s.proposals.length >= 3) throw new Error("Three proposals is the limit for one answer. Pick the most important.");
    const key = JSON.stringify([p.kind, p.payload]);
    if (s.proposals.some((x) => JSON.stringify([x.kind, x.payload]) === key)) throw new Error("You already proposed that.");
    const id = newId("prp");
    s.proposals.push({ ...p, id, status: "proposed" });
    return `Proposed as ${id}. The founder sees it as a chip with Apply and Dismiss. It has not been applied: don't say it's done.`;
  };

  // Sorted by name and byte-stable across turns so the tool block stays cached.
  return [
    defineTool({
      name: "get_company",
      description: "One account by domain: status, signals with evidence ids, dossier (facts, pains, committee, angles, recommendation, risks, unknowns), people with ids, open deal and recent activity.",
      schema: z.object({ domain: z.string().max(253) }),
      label: (i) => `Reading ${s.ws.accounts[toDomain(i.domain) ?? ""]?.name ?? i.domain}`,
      run: (i) => {
        const domain = toDomain(i.domain);
        const a = domain ? s.ws.accounts[domain] : undefined;
        if (!domain || !a) return `No company ${i.domain} in the workspace. workspace_search can find it by name; track_account can add it.`;
        record({ kind: "account", id: domain }, a.name, domain);
        return seen(companyDigest(s.ws, domain, s.today)!);
      },
    }),
    defineTool({
      name: "get_deal",
      description: "One deal by id (or by company domain for its open deal): stage history, next step, qualification card, MAP, pilot terms, tasks, contacts, meetings with ids, notes.",
      schema: z.object({ id: z.string().max(253).describe("Deal id, or a company domain.") }),
      label: (i) => {
        const name = s.ws.deals[i.id]?.name ?? s.ws.accounts[toDomain(i.id) ?? ""]?.name;
        return name ? `Reading the ${name} deal` : "Reading a deal";
      },
      run: (i) => {
        const deal = s.ws.deals[i.id] ?? (toDomain(i.id) ? openDealFor(s.ws, toDomain(i.id)!) : undefined);
        if (!deal) return `No deal ${i.id}. workspace_search with kinds ["deal"] lists deals.`;
        record({ kind: "deal", id: deal.id }, deal.name, deal.accountDomain);
        return seen(dealDigest(s.ws, deal, s.today));
      },
    }),
    defineTool({
      name: "list_moves",
      description: "Today's open moves (the founder's queue), highest priority first, with ids, minutes and why.",
      schema: z.object({}),
      label: () => "Checking today's moves",
      run: () => seen(listMoves(s.ws, s.today)),
    }),
    defineTool({
      name: "pipeline_summary",
      description: "This week's scoreboard and pipeline health, computed in code: conversations, cold touches vs cap, replies, deals by stage, qualified count, goal progress, deals missing a next step, stale deals, unpaid pilots, price quotes.",
      schema: z.object({}),
      label: () => "Checking the pipeline",
      run: () => seen(pipelineSummary(s.ws, new Date())),
    }),
    defineTool({
      name: "propose",
      description:
        "Propose ONE workspace change as an action chip the founder applies or dismisses. Never mutates anything. Kinds and their fields: " +
        "track_account(domain, name?) · create_deal(domain, name?, stage? talking|qualified, source?) · set_next_step(dealId, what, date, buyerAgreed) · " +
        "change_stage(dealId, stage, lossReason? when lost, date? = nurture check-in) · add_task(dealId, what, date?, owner) · " +
        "add_person(domain, name, title, role?, email?, linkedinUrl?) · add_pov(text, basis) · add_claim(text, claimKind, basis?) — saved unapproved; " +
        "add_objection(text, category, response?) · suppress(email or domain, suppressReason).",
      schema: ProposeInput,
      label: (i) => `Proposing: ${clip(i.summary, 60)}`,
      run: (i) => {
        const payload = checkProposal(i, s);
        return pushProposal({ kind: i.kind, summary: i.summary.trim(), reason: i.reason.trim(), payload });
      },
    }),
    defineTool({
      name: "start_workflow",
      description:
        "Propose a full job as a chip; it starts only when the founder clicks it (and costs money then). Workflows and args: " +
        "discovery {count? 1-25, brief? ≤300 chars} find new companies · dossier {domain, force?} research one company · " +
        "compose {domain, personId?, mode? cold|follow_up|linkedin|warm_intro|reply, angleId?, connectorId?} draft outreach (reply: uses the reply the founder pasted) · " +
        "prep {meetingId} call brief · debrief {dealId? | meetingId? | domain?} uses the call notes the founder pasted in this message · " +
        "dinner_plan {kind dinner|roundtable, city? (dinner), month? YYYY-MM, goal? accelerate_deals|create_pipeline|expand_customers|market_intel, budgetUsd?, coHost?} · " +
        "asset {kind one_pager|demo_script|security|design_partner_terms|pilot_proposal|insight|case_study, title?, brief?, dealId?} · review {kind monday|friday}.",
      schema: StartInput,
      label: (i) => `Proposing: ${clip(i.summary, 60)}`,
      run: async (i) => {
        const payload = await checkStart(i, s);
        return pushProposal({ kind: "start_workflow", summary: i.summary.trim(), reason: i.reason.trim(), payload });
      },
    }),
    defineTool({
      name: "workspace_search",
      description: "Find companies, people, deals, meetings, open moves and events in the workspace by name, domain, title or keyword. Returns ids to use with the other tools.",
      schema: z.object({
        query: z.string().min(1).max(80),
        kinds: z.array(z.enum(["company", "person", "deal", "meeting", "move", "event"])).max(6).optional(),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      label: (i) => `Searching your workspace for “${clip(i.query, 40)}”`,
      run: (i) => seen(workspaceSearch(s.ws, i.query, i.kinds, i.limit ?? 8, s.today)),
    }),
  ];
}

/* ─────────────────────────────── Per-turn system note ─────────────────────────────── */

function buildNote(thread: StoredThread | undefined, info: ContextInfo | null, web: boolean, today: string) {
  const noted = thread?.noted ?? {};
  const parts = [taskHeader()];
  parts.push(info ? `The founder is looking at ${info.line}.` : "The founder asked from the command bar; no record is open.");
  parts.push(web ? 'Search the web: ON for this message (at most 2 searches).' : 'Search the web: off for this message.');

  const decided = (thread?.turns ?? []).flatMap((t) => t.proposals ?? []).filter((p) => p.status !== "proposed" && !(noted.decidedIds ?? []).includes(p.id));
  const applied = decided.filter((p) => p.status === "applied").map((p) => `"${p.summary}"`);
  const dismissed = decided.filter((p) => p.status === "dismissed").map((p) => `"${p.summary}"`);
  if (applied.length) parts.push(`Since your last answer the founder applied: ${applied.join(", ")}.`);
  if (dismissed.length) parts.push(`The founder dismissed: ${dismissed.join(", ")}.`);

  const digestHash = info?.digest ? hash(info.digest) : undefined;
  const fresh = !!info?.digest && (noted.contextKey !== info.key || noted.digestHash !== digestHash);
  if (fresh) parts.push(`Context record (already loaded; cite its evidence ids):\n${info!.digest}`);
  return {
    text: parts.join("\n"),
    noted: {
      date: today,
      contextKey: info?.key ?? noted.contextKey,
      digestHash: info?.digest ? digestHash : noted.digestHash,
      decidedIds: [...(noted.decidedIds ?? []), ...decided.map((p) => p.id)].slice(-200),
    },
    includedDigest: fresh,
  };
}

/* ─────────────────────────────── Result extraction ─────────────────────────────── */

type Block = { type: string; [k: string]: unknown };

function blocksOf(messages: Anthropic.Beta.BetaMessageParam[], role: "assistant"): Block[] {
  return messages.filter((m) => m.role === role && Array.isArray(m.content)).flatMap((m) => m.content as unknown as Block[]);
}

function extractWeb(messages: Anthropic.Beta.BetaMessageParam[]): { citations: AskCitation[]; sources: number } {
  const blocks = blocksOf(messages, "assistant");
  const urls = new Set<string>();
  for (const b of blocks) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { type: string; url?: string }[]) if (r.type === "web_search_result" && r.url) urls.add(r.url);
    }
  }
  const citations = new Map<string, AskCitation>();
  for (const b of blocks) {
    if (b.type !== "text" || !Array.isArray(b.citations)) continue;
    for (const c of b.citations as { type: string; url?: string; title?: string | null; cited_text?: string }[]) {
      if (c.type !== "web_search_result_location" || !c.url || citations.has(c.url)) continue;
      citations.set(c.url, { url: c.url, title: c.title ?? undefined, quote: c.cited_text ? clip(c.cited_text, 300) : undefined });
    }
  }
  return { citations: [...citations.values()].slice(0, 8), sources: urls.size };
}

/** Text the web returned this turn (result titles, cited passages), to check web-sourced people against. */
function webTexts(messages: Anthropic.Beta.BetaMessageParam[]): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  for (const b of blocksOf(messages, "assistant")) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { type: string; url?: string; title?: string }[]) if (r.type === "web_search_result" && r.url) out.push({ url: r.url, text: r.title ?? "" });
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations as { type: string; url?: string; title?: string | null; cited_text?: string }[]) {
        if (c.type === "web_search_result_location" && c.url) out.push({ url: c.url, text: `${c.title ?? ""} ${c.cited_text ?? ""}` });
      }
    }
  }
  return out;
}

/** The answer is what the model wrote after its last tool result; text before a tool call is working notes. */
function finalAnswer(messages: Anthropic.Beta.BetaMessageParam[]): string {
  const lastToolResult = messages.findLastIndex((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
  // Joined with "": a web-search answer is several cited text blocks in one message.
  return blocksOf(messages.slice(lastToolResult + 1), "assistant")
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("")
    .trim();
}

/** Earlier tool results in the thread: people and emails the model saw there count as sourced. */
function toolResultsIn(messages: Anthropic.Beta.BetaMessageParam[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (b.type === "tool_result" && typeof b.content === "string") out.push(b.content);
  }
  return out;
}

/* ─────────────────────────────── The workflow ─────────────────────────────── */

/** Long enough for a pasted call transcript; the model sees only an excerpt of anything over LONG_MESSAGE. */
export const MAX_MESSAGE = 200_000;
const LONG_MESSAGE = 4000;
const EXCERPT = 3000;

const Ref = z.object({
  kind: z.enum(["account", "person", "deal", "meeting", "event", "guest", "evidence", "claim", "objection", "playbook", "draft"]),
  id: z.string().min(1).max(300),
});

const Args = z.object({
  /** Client-generated so the conversation can render before the run starts. */
  threadId: z.string().min(3).max(40),
  founderTurnId: z.string().min(3).max(40).optional(),
  turnId: z.string().min(3).max(40).optional(),
  message: z.string().trim().min(1, "Type a question first.").max(MAX_MESSAGE, "That's too long for Ask (200,000 characters max)."),
  context: Ref.optional(),
  web: z.boolean().optional(),
  deep: z.boolean().optional(),
  /** Re-answer the last question (after an error or a stop) without adding it again. */
  retry: z.boolean().optional(),
});
type Args = z.infer<typeof Args>;

function threadInit(a: Args, label: string | undefined) {
  const at = nowISO();
  return () => ({ title: clip(a.message, 64), context: a.context, contextLabel: label, createdAt: at, updatedAt: at });
}

function isSystemRoleError(err: unknown): boolean {
  return err instanceof AgentError && err.code === "bad_request" && /system/i.test(err.message) && /role|message/i.test(err.message);
}

export default defineWorkflow<Args>({
  id: "ask",
  args: Args,
  title: (a, ws) => {
    if (a.deep) return "Thinking it through";
    const info = a.context ? contextInfo(ws, a.context, todayISO()) : null;
    return info ? `Answering about ${info.label}` : "Answering your question";
  },
  heavy: false,
  run: async (ctx) => {
    const a = ctx.args;
    const started = Date.now();
    const now = new Date();
    const today = todayISO(now);
    const ws = ctx.read();
    const info = a.context ? contextInfo(ws, a.context, today) : null;
    const message = a.message.trim();
    const founderTurnId = a.founderTurnId ?? newId("turn");
    const turnId = a.turnId ?? newId("turn");

    // 1. The question and a pending answer go into the thread first, so a reload mid-answer still shows them.
    await withThread(a.threadId, threadInit(a, info?.label), (t) => {
      if (!a.retry && !t.turns.some((x) => x.id === founderTurnId)) {
        putTurn(t, { id: founderTurnId, role: "founder", text: message, at: nowISO(), web: a.web || undefined, deep: a.deep || undefined });
      }
      putTurn(t, { id: turnId, role: "agent", text: "", at: nowISO(), runId: ctx.runId, pending: true });
      t.updatedAt = nowISO();
    });
    const thread = getThread(a.threadId);
    const history = thread?.messages ?? [];

    // 2. This turn: the question (cache breakpoint: the whole thread up to here is reused next time),
    //    then a system message with today's date, the open record and what the founder decided since.
    const note = buildNote(thread, info, !!a.web, today);
    const founderText = (thread?.turns ?? []).filter((t) => t.role === "founder").map((t) => t.text);
    const state: TurnState = {
      ws,
      today,
      grounding: [...founderText, message, info?.digest ?? "", ...toolResultsIn(history)],
      proposals: [],
      records: new Map(),
      founderMessage: message,
      web: !!a.web,
    };
    if (info?.record) state.records.set(refKey(info.record.ref), info.record);

    const tier: ModelTier = a.deep ? "strategist" : "operator";
    // A pasted transcript reaches debrief/compose in full through checkStart (founderMessage); the model, now
    // and on every follow-up in this thread, reads only an excerpt.
    const modelText =
      message.length > LONG_MESSAGE
        ? `${message.slice(0, EXCERPT)}\n\n[… ${message.length - EXCERPT} more characters of pasted notes/transcript not shown. If this is call notes or a transcript, start the debrief (or compose reply); code passes the full text.]`
        : message;
    const userBlocks = (extra?: string): Anthropic.Beta.BetaTextBlockParam[] => [{ type: "text", text: modelText }, ...(extra ? [{ type: "text" as const, text: extra }] : [])];
    const withBreakpoint = (blocks: Anthropic.Beta.BetaTextBlockParam[]): Anthropic.Beta.BetaTextBlockParam[] =>
      blocks.map((b, i) => (i === blocks.length - 1 ? { ...b, cache_control: { type: "ephemeral" } } : b));
    const call = (turnMessages: Anthropic.Beta.BetaMessageParam[]) =>
      ctx.agent({
        tier,
        system: [coreFor(ws), isConsumer(ws) ? ASK_RULES_CONSUMER : ASK_RULES, companyContext(ws)],
        messages: [...history, ...turnMessages],
        tools: buildTools(state),
        webSearch: a.web ? 2 : 0,
        effort: a.deep ? "medium" : "low",
        maxTokens: a.deep ? 16_000 : 8_000,
      });

    let appended: Anthropic.Beta.BetaMessageParam[];
    let result: RunResult;
    try {
      const sysMsg: Anthropic.Beta.BetaMessageParam = { role: "system", content: note.text };
      try {
        result = await call([{ role: "user", content: withBreakpoint(userBlocks()) }, sysMsg]);
        appended = [{ role: "user", content: userBlocks() }, sysMsg];
      } catch (err) {
        if (!isSystemRoleError(err)) throw err;
        // Model without mid-conversation system messages: carry the note inside the user turn instead.
        const extra = `<context>\n${note.text}\n</context>`;
        state.proposals.length = 0;
        result = await call([{ role: "user", content: withBreakpoint(userBlocks(extra)) }]);
        appended = [{ role: "user", content: userBlocks(extra) }];
      }
    } catch (err) {
      const code = err instanceof AgentError ? err.code : "unknown";
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      await withThread(a.threadId, threadInit(a, info?.label), (t) => {
        putTurn(t, { id: turnId, role: "agent", text: "", at: nowISO(), runId: ctx.runId, error: { code, message: code === "stopped" ? "Stopped." : msg } });
      });
      throw err;
    }

    const sentCount = history.length + appended.length;
    const fresh = result.messages.slice(sentCount);
    const { citations, sources } = extractWeb(fresh);
    // People the model said it found on the web must appear in what the web returned; keep the source.
    const web = webTexts(fresh);
    state.proposals = state.proposals.filter((p) => {
      if (p.kind !== "add_person" || p.payload.sourced !== "web") return true;
      const re = nameRe(String(p.payload.name ?? ""));
      const hit = web.find((w) => re.test(w.text));
      if (hit) p.payload.sourceUrl = hit.url;
      return !!hit;
    });
    // Fallback: a model that answered in the same message as its last propose call.
    let text = finalAnswer(fresh) || result.text.trim();
    if (!text && state.proposals.length) text = "Here's what I'd do.";
    const empty = !text;

    const turn: AskTurn = {
      id: turnId,
      role: "agent",
      text,
      at: nowISO(),
      runId: ctx.runId,
      citations: citations.length ? citations : undefined,
      proposals: state.proposals.length ? state.proposals : undefined,
      records: state.records.size ? [...state.records.values()].slice(0, 6) : undefined,
      receipt: { durationMs: Date.now() - started, sources, costUsd: result.costUsd, model: tier },
      error: empty ? { code: "empty", message: "No answer came back. Try again." } : undefined,
    };

    await withThread(a.threadId, threadInit(a, info?.label), (t) => {
      // Append-only: earlier messages are never touched.
      t.messages.push(...appended, ...fresh);
      t.noted = note.noted;
      t.approxTokens = estimateTokens(t.messages);
      putTurn(t, turn);
      t.updatedAt = nowISO();
    });

    return { threadId: a.threadId, turnId, proposals: state.proposals.length };
  },
});
