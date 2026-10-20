import "server-only";
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  NO_PITCH,
  candidateKey,
  composeRoom,
  computeTimeline,
  defaultBudget,
  defaultCadence,
  defaultRunOfShow,
  defaultSeatingRules,
  eventDateTime,
  eventDay,
  formatEventDate,
  monthLabel,
  proposeDate,
  scoreCandidates,
  type EventGoal,
  type EventKind,
  type ScoredCandidate,
} from "@/components/events/plan-math";
import { AgentError, defineTool } from "@/lib/ai/engine";
import { EMBER_CORE, companyContext, taskHeader } from "@/lib/ai/prompts/core";
import { daysBetween, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { DinnerPlan, GtmEvent, Guest, ISODate, SignalType, Workspace } from "@/lib/domain/types";
import { DATA_DIR } from "@/lib/store/settings";
import { defineWorkflow, type WorkflowContext } from "./types";

/**
 * W11 · Rooms: virtual roundtables first, co-hosted dinners when someone else's brand or a customer
 * can host. Code does the planning (guest scoring, composition, invite math, dates, timeline,
 * theme mining); one Sonnet call writes the words. Venue search only for dinners, capped at 4.
 * A second mode turns the founder's post-event voice notes into next-morning notes (one call, all guests).
 */

const GOAL = z.enum(["accelerate_deals", "create_pipeline", "expand_customers", "market_intel"]);

const planArgs = z.object({
  mode: z.literal("plan").optional(),
  eventId: z.string().optional(),
  kind: z.enum(["dinner", "roundtable"]).optional(),
  city: z.string().trim().max(80).optional(),
  /** `YYYY-MM` */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  goal: GOAL.optional(),
  budgetUsd: z.number().nonnegative().max(1_000_000).optional(),
  coHost: z.string().trim().max(120).optional(),
});

const debriefArgs = z.object({
  mode: z.literal("debrief"),
  eventId: z.string(),
  guestIds: z.array(z.string()).max(40).optional(),
});

const args = z.union([planArgs, debriefArgs]).transform((a) =>
  a.mode === "debrief"
    ? { ...a, mode: "debrief" as const }
    : { ...a, mode: "plan" as const, eventId: a.eventId ?? newId("evt"), kind: (a.kind ?? (a.city ? "dinner" : "roundtable")) as EventKind },
);
type Args = z.infer<typeof args>;
type PlanArgs = Extract<Args, { mode: "plan" }>;
type DebriefArgs = Extract<Args, { mode: "debrief" }>;

/* ─────────────────────────────── Prompt rules ─────────────────────────────── */

const ROOM_RULES = `ROOM RULES (virtual roundtables and executive dinners)
Purpose: turn a small room into pipeline. You plan and write; the founder approves the guest list, sends every invite
personally, books the venue and approves every note. The product comes up only if a guest asks.

- Start virtual: a 60-minute roundtable of 6–8 peers is the cheap rehearsal and needs no customers. A dinner borrows a
  co-host's brand and list (a VC platform team, a non-competing company selling to the same buyer, a community) or a
  customer who hosts. Dinner: 8–10 at the table, a private room, peers by seniority, no direct competitors.
- One primary goal per room. The theme is a specific, live question a peer would want answered this quarter
  ("How platform leads are actually measuring AI ROI"), never "the future of X", never the founder's product category.
  Ground every theme in the numbered seeds and state the count plainly ("7 of 25 target accounts are hiring their first
  platform lead"). Never name a company, a person or a deal from the seeds in a theme, prompt or invite.
- Prompts make peers compare real decisions: "What's one X you killed this year, and what told you to kill it?",
  "What would you need to see before Y?", "What did your board ask about Z that you couldn't answer?", "What's a vendor
  promise you'll never believe again?". 2–3 main prompts and 3–4 reserves per theme, each ≤25 words. No yes/no
  questions, nothing that steers toward the founder's product.
- Guests are peers by seniority. The cut test: would the founder be happy if this person were the only one who showed up?
- Personal line per guest (≤25 words): why THIS person, using only the facts listed for them (signal, pain, stage, role).
  Plain and specific. No flattery, no "I came across", no "congrats", no invented specifics. Thin facts → write about
  their role's stake in the question instead.
- Wants per guest (≤15 words): what they'd want from the room, inferred from their facts, written as a noun phrase that
  reads naturally after "You mentioned" ("hiring your first platform lead without losing on-call coverage").
- Seat-next-to: pair each prospect with a guest (ideally a customer, the anchor, or someone further along) who faced the
  same problem; reason ≤15 words. Use guest keys. Null if no sensible pair.
- Invite (≤120 words, from the founder): lead with the guest's business challenge and who they'll meet ({peer}, and the
  anchor/framer by name when one is given), not the venue or food. Include the date with {date}. Contains the exact
  sentence "${NO_PITCH}" One question as the call to action ("Would you like to join?"). No links, no product
  description. Subject ≤10 words, names the question, not the brand.
- Host invite (≤80 words): the co-host or customer host writing to a peer: they're co-hosting a small {dinner or
  roundtable} for a few people in the guest's role wrestling with the problem, they've found these useful, any interest,
  and they'll seat them next to {peer}.
- 48-hour reminder (≤60 words) from the original inviter: names what THIS guest wants ({wants}) and who they'll sit
  with ({peer}); the time ({time}) and, for a dinner, the place ({venue}) and dietary needs, or for a roundtable the
  video link as {link}. This is the single biggest attendance lever.
- Day-of text (≤30 words): time and where to go ({venue} for a dinner, {link} for a roundtable).
- Decline reply (≤40 words): thanks, no guilt, and "Is there a colleague who should be there instead?"
- Run of show: keep the skeleton's times and segments; write notes specific to the chosen theme (who frames, which
  prompt opens, when to draw in quiet guests).
- Seating rules (dinner) or facilitation rules (roundtable): up to 6, specific to these guests where you can (use their
  names), plus the norms: off the record, no recording, no pitch.
- Follow-up: group email template (≤180 words) with 3–5 themes as bracketed placeholders, promised intros, Chatham
  House (no names, no attribution); no-show note (≤50 words): sorry we missed you, first dibs on the next one. Never
  suggest no-show fees. At most 5 human touches in 90 days.
- Venues (dinner only; only if web_search is available; at most 4 searches; queries contain only the city and venue
  terms): private dining rooms with good acoustics (separate floor, carpets or curtains, not concrete), a round table,
  3–4 courses not a tasting menu, near where guests work. List only venues that appear in your search results, with
  that result's exact URL and a ≤20-word quote from it. Zero ideas is fine; never invent a venue or a detail.
- Conflicts: pairs of guest keys whose companies compete directly (same product for the same buyer). Only when the
  facts make it clear or it is widely known; otherwise none.

TOKENS: templates use these literally and code fills them per guest: {first_name} {personal_line} {peer} {wants}
{date} {time} {venue} {link}. Start invites with "{first_name} —" replaced by "{first_name}," (no dashes). Never write a
real guest name inside a template.

BANNED in all copy: exclusive, curated, intimate gathering, thought leaders, synergy, "I hope this finds you well",
"quick question", game-changer, revolutionize, leverage, unlock, "excited to", exclamation marks, emoji, em dashes.`;

const AFTER_RULES = `AFTER THE ROOM
Input: the founder's 30-second voice notes, one per guest (founder paraphrase, not quotes).
- For each guest extract: biggest challenge (≤20 words), what they wish a product did (≤20 words), peers they named
  (names as written, up to 5), the next step if one came up (≤15 words, else null), and fit: pursue (pain and timing),
  nurture (pain, no timing), none (no pain).
- Next-morning note (≤90 words, from the founder, plain text, uses the guest's real first name): one short clause of
  thanks; reference ONE specific thing they said in the note; propose ONE concrete next step (a 20-minute call on that
  exact problem, an intro to a peer from the room, or something the founder promised). If fit is none, keep it to a
  warm "stay in touch". No pitch, no links, no attachments, no "great to meet you" opener.
- Group email (≤180 words, to all attendees in BCC): thanks; 3–5 themes heard, Chatham House (no names, no companies,
  no attribution); promised intros come in separate emails; one line on what's next.
- Never invent anything that isn't in the notes. If a note is too thin, say so in the challenge field ("Not captured").
BANNED: exclamation marks, emoji, em dashes, "synergy", "leverage", "circle back", "touch base".`;

/* ─────────────────────────────── Schemas ─────────────────────────────── */

const subjectBody = z.object({
  subject: z.string().describe("≤10 words"),
  body: z.string().describe("Plain text with {tokens}; length limit in the rules"),
});

/** Personal lines are written for the fixed roles and the best invitees only; the schema and the prompt share this cap. */
const MAX_LINED = 45;

const submitPlan = z.object({
  themes: z
    .array(
      z.object({
        title: z.string().describe("≤8 words"),
        question: z.string().describe("The live question, ≤20 words, ends with ?"),
        whyNow: z.string().describe("≤30 words; states the count from the seeds"),
        seedIds: z.array(z.string()).max(4).describe("Ids of the seeds this theme rests on, e.g. s2"),
        prompts: z.array(z.string()).max(3).describe("2–3 open prompts, each ≤25 words"),
        reservePrompts: z.array(z.string()).max(4).describe("3–4 reserve prompts, each ≤25 words"),
      }),
    )
    .max(3)
    .describe("Up to 3 themes, best first; never pad"),
  guests: z
    .array(
      z.object({
        key: z.string().describe("Guest key from the list, e.g. g4"),
        personalLine: z.string().describe("≤25 words, grounded only in that guest's facts"),
        wants: z.string().describe("≤15 words"),
        seatNextTo: z.string().nullable().describe("Another guest key, or null"),
        seatWhy: z.string().nullable().describe("≤15 words, or null"),
        evidenceIds: z.array(z.string()).max(3).describe("Evidence ids from that guest's facts that the line rests on"),
      }),
    )
    .max(MAX_LINED),
  conflicts: z.array(z.object({ a: z.string(), b: z.string(), why: z.string().describe("≤12 words") })).max(6),
  coHost: z
    .object({
      optionId: z.string().describe("Id from the co-host options"),
      kind: z.enum(["vc_platform", "non_competing_startup", "community", "customer"]),
      why: z.string().describe("≤25 words"),
    })
    .nullable(),
  anchorBrief: z.string().describe("≤40 words: what the anchor or framer covers in 5–10 minutes; empty if no anchor"),
  copy: z.object({
    invite: subjectBody.describe("Founder invite, body ≤120 words"),
    hostInvite: subjectBody.describe("Co-host or customer-host invite, body ≤80 words"),
    reminder48h: z.string().describe("≤60 words"),
    dayOf: z.string().describe("≤30 words"),
    declineReply: z.string().describe("≤40 words"),
  }),
  runOfShow: z.array(z.object({ time: z.string(), segment: z.string().describe("≤6 words"), notes: z.string().describe("≤30 words") })).max(9),
  seatingRules: z.array(z.string().describe("≤25 words")).max(6),
  followUp: z.object({
    groupEmail: z.string().describe("≤180 words"),
    noShow: z.string().describe("≤50 words"),
  }),
  venues: z
    .array(z.object({ name: z.string(), why: z.string().describe("≤20 words"), url: z.string(), quote: z.string().describe("≤20 words from the result") }))
    .max(4)
    .describe("Dinner only, from search results only; empty is fine"),
});
type PlanOut = z.infer<typeof submitPlan>;

const submitDebrief = z.object({
  guests: z
    .array(
      z.object({
        key: z.string(),
        challenge: z.string().describe("≤20 words"),
        wishes: z.string().describe("≤20 words"),
        peersNamed: z.array(z.string()).max(5),
        nextStep: z.string().nullable().describe("≤15 words or null"),
        fit: z.enum(["pursue", "nurture", "none"]),
        nextMorningNote: z.string().describe("≤90 words, plain text, signed with the founder's first name"),
      }),
    )
    .max(40),
  themes: z.array(z.string().describe("≤15 words")).max(5),
  groupEmail: subjectBody.describe("Body ≤180 words"),
});
type DebriefOut = z.infer<typeof submitDebrief>;

/* ─────────────────────────────── Code-first gathering ─────────────────────────────── */

/** LinkedIn connections by matched company domain. Read-only; the file belongs to the network import. */
function connectedByDomain(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "connections.json"), "utf8")) as unknown;
    const rows: unknown[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? Array.isArray((raw as { rows?: unknown[] }).rows)
          ? (raw as { rows: unknown[] }).rows
          : Array.isArray((raw as { connections?: unknown[] }).connections)
            ? (raw as { connections: unknown[] }).connections
            : Object.values(raw as Record<string, unknown>)
        : [];
    for (const r of rows) {
      const c = r as { matchedDomain?: string; firstName?: string; lastName?: string };
      if (!c?.matchedDomain) continue;
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      out.set(c.matchedDomain, [...(out.get(c.matchedDomain) ?? []), name || "a connection"]);
    }
  } catch {
    // No import yet.
  }
  return out;
}

const SIGNAL_THEME: Partial<Record<SignalType, string>> = {
  first_hire: "are making a first hire for the problem you solve",
  jd_names_pain: "have job posts that name the pain",
  new_leader: "have a new leader in the buying seat",
  funding: "raised in the last six months",
  stack_change: "are changing their stack",
  launch: "just launched something new",
  compliance_deadline: "face a compliance deadline",
  persona_post: "have buyers posting publicly about the problem",
  community_request: "asked peers for help with it in a community",
  public_pain: "described the pain in public",
  hiring: "are hiring in the team you sell to",
  champion_job_change: "have a past champion who just changed jobs",
};

interface Seed {
  id: string;
  text: string;
  evidenceIds: string[];
  sources: { url: string; label: string; date?: ISODate }[];
}

/** Theme seeds: counts across target accounts from signals, dossiers, calls and objections. */
function mineSeeds(ws: Workspace, cands: ScoredCandidate[], today: ISODate): Seed[] {
  const domains = [...new Set(cands.map((c) => c.accountDomain).filter(Boolean))];
  const accounts = domains.map((d) => ws.accounts[d]).filter(Boolean);
  const n = accounts.length;
  const seeds: Omit<Seed, "id">[] = [];

  const bySignal = new Map<SignalType, { acc: string; headline: string; date: string; url: string; evidenceId?: string }[]>();
  for (const acc of accounts) {
    const seen = new Set<SignalType>();
    for (const s of acc.signals) {
      if (seen.has(s.type) || !SIGNAL_THEME[s.type] || daysBetween(s.date, today) > 180) continue;
      seen.add(s.type);
      bySignal.set(s.type, [...(bySignal.get(s.type) ?? []), { acc: acc.name, headline: s.headline, date: s.date, url: s.url, evidenceId: s.evidenceId }]);
    }
  }
  for (const [type, list] of [...bySignal.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 2 && n > 6) continue;
    const examples = list.slice(0, 3).map((x) => `"${x.headline}" (${x.date})`);
    seeds.push({
      text: `${list.length} of ${n} target accounts ${SIGNAL_THEME[type]}. Examples: ${examples.join("; ")}`,
      evidenceIds: list.map((x) => x.evidenceId).filter((x): x is string => Boolean(x && ws.evidence[x])).slice(0, 4),
      sources: list.filter((x) => !x.evidenceId).slice(0, 3).map((x) => ({ url: x.url, label: x.headline, date: x.date })),
    });
  }

  const byTeam = new Map<string, { count: number; titles: string[] }>();
  for (const acc of accounts) {
    for (const t of acc.enrichment?.rolesByTeam ?? []) {
      if (!t.team || t.team === "Other") continue;
      const cur = byTeam.get(t.team) ?? { count: 0, titles: [] };
      byTeam.set(t.team, { count: cur.count + 1, titles: [...cur.titles, ...t.titles.slice(0, 2)] });
    }
  }
  const team = [...byTeam.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (team && team[1].count >= 2) {
    seeds.push({ text: `${team[1].count} of ${n} target accounts are hiring in ${team[0]} (e.g. ${[...new Set(team[1].titles)].slice(0, 3).join(", ")})`, evidenceIds: [], sources: [] });
  }

  const byValue = new Map<string, { pains: string[]; ev: string[] }>();
  for (const acc of accounts) {
    const p = acc.dossier?.painHypotheses[0];
    if (!p) continue;
    const key = p.valueThemeId ?? p.pain.slice(0, 40);
    const cur = byValue.get(key) ?? { pains: [], ev: [] };
    byValue.set(key, { pains: [...cur.pains, p.pain], ev: [...cur.ev, ...p.evidenceIds] });
  }
  for (const [, v] of [...byValue.entries()].sort((a, b) => b[1].pains.length - a[1].pains.length).slice(0, 2)) {
    seeds.push({
      text: `${v.pains.length} of ${n} dossiers point to the same pain: "${v.pains[0]}"`,
      evidenceIds: [...new Set(v.ev.filter((x) => ws.evidence[x]))].slice(0, 4),
      sources: [],
    });
  }

  const callPains: string[] = [];
  for (const m of Object.values(ws.meetings)) {
    const pain = m.debrief?.card.pain;
    if (pain?.value && pain.status !== "not_covered") callPains.push(pain.value);
  }
  for (const d of Object.values(ws.deals)) if (d.card?.pain.value && !callPains.includes(d.card.pain.value)) callPains.push(d.card.pain.value);
  if (callPains.length) {
    seeds.push({ text: `From ${callPains.length} of your own calls, buyers described: ${callPains.slice(0, 4).map((p) => `"${p}"`).join("; ")}`, evidenceIds: [], sources: [] });
  }

  for (const o of [...ws.objections].sort((a, b) => b.timesHeard - a.timesHeard).slice(0, 2)) {
    if (o.timesHeard >= 2) seeds.push({ text: `Buyers keep raising: "${o.objection}" (heard ${o.timesHeard} times)`, evidenceIds: [], sources: [] });
  }

  const f = ws.foundation;
  if (f) {
    seeds.push({ text: `The obstacle your ICP bet names: ${f.icp.hypothesis.obstacle} (cause: ${f.icp.hypothesis.cause})`, evidenceIds: [], sources: [] });
    const buyer = f.personas.find((p) => p.role === "economic_buyer") ?? f.personas[0];
    if (buyer?.pains.length) seeds.push({ text: `Your ${buyer.titles[0] ?? buyer.role} persona's pains: ${buyer.pains.slice(0, 3).join("; ")}`, evidenceIds: [], sources: [] });
  }
  return seeds.slice(0, 10).map((s, i) => ({ ...s, id: `s${i + 1}` }));
}

interface CoHostOption {
  id: string;
  name: string;
  kind: NonNullable<DinnerPlan["coHost"]>["kind"];
  note: string;
}

function coHostOptions(ws: Workspace, named: string | undefined, customers: ScoredCandidate[]): CoHostOption[] {
  const out: CoHostOption[] = [];
  if (named) out.push({ id: "c0", name: named, kind: "non_competing_startup", note: "named by the founder; pick the kind that fits" });
  for (const c of ws.connectors.filter((x) => x.relationship === "investor" || x.relationship === "angel").slice(0, 3)) {
    out.push({ id: `c${out.length}`, name: `${c.name}'s platform team`, kind: "vc_platform", note: `your ${c.relationship}` });
  }
  for (const c of customers.slice(0, 2)) out.push({ id: `c${out.length}`, name: c.company, kind: "customer", note: "a customer who could host" });
  for (const h of (ws.foundation?.personas ?? []).flatMap((p) => p.wateringHoles).filter((w) => w.kind === "community").slice(0, 2)) {
    out.push({ id: `c${out.length}`, name: h.name, kind: "community", note: "a community your buyers use" });
  }
  return out;
}

/* ─────────────────────────────── Helpers ─────────────────────────────── */

function wordsMax(text: string, max: number): string {
  const w = text.trim().split(/\s+/);
  return w.length <= max ? text.trim() : `${w.slice(0, max).join(" ")}…`;
}

/** House style for outbound: no em dashes, no exclamation marks. */
function clean(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/!/g, ".")
    .replace(/,\s*,/g, ",")
    .trim();
}

function ensureNoPitch(body: string): string {
  if (body.toLowerCase().includes("no slides, no pitch")) return body;
  const paras = body.split(/\n{2,}/);
  if (paras.length >= 2) paras.splice(paras.length - 1, 0, NO_PITCH);
  else paras.push(NO_PITCH);
  return paras.join("\n\n");
}

const normUrl = (u: string) =>
  u
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

/** URLs Claude actually saw this run (search results and fetched pages). Venues must come from these. */
function seenUrls(messages: Anthropic.Beta.BetaMessageParam[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const block of m.content as unknown as { type: string; content?: unknown }[]) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content as { url?: string }[]) if (r.url) out.add(normUrl(r.url));
      } else if (block.type === "web_fetch_tool_result") {
        const url = (block.content as { url?: string } | undefined)?.url;
        if (url) out.add(normUrl(url));
      }
    }
  }
  return out;
}

function personaPlural(ws: Workspace): string {
  const p = ws.foundation?.personas.find((x) => x.role === "economic_buyer") ?? ws.foundation?.personas[0];
  const t = p?.titles[0];
  return t ? `people in roles like ${t}` : "peers";
}

/** Research 02 §2.5 templates, used when Claude can't be reached so the free work still lands. */
function templateCopy(ws: Workspace, kind: EventKind, question: string, anchorName: string | undefined): PlanOut["copy"] & { followUp: PlanOut["followUp"] & { nextMorningNote: string } } {
  const noun = kind === "dinner" ? "dinner" : "60-minute virtual roundtable";
  const sign = ws.founder.name.split(" ")[0] || ws.founder.name || "";
  return {
    invite: {
      subject: `Small ${kind === "dinner" ? "dinner" : "roundtable"} on ${question.replace(/\?$/, "").toLowerCase()}`.slice(0, 80),
      body: `{first_name}, I'm hosting a small ${noun} on {date} for ${personaPlural(ws)} to compare notes on one question: ${question}\n\n{personal_line}\n\n{peer} is coming, and I think you two would get a lot from each other.${anchorName ? ` ${anchorName} will open with ten minutes on what they've seen.` : ""}\n\n${NO_PITCH} Would you like to join?\n\n${sign}`,
    },
    hostInvite: {
      subject: `${kind === "dinner" ? "Dinner" : "Roundtable"} on ${question.replace(/\?$/, "").toLowerCase()}`.slice(0, 80),
      body: `{first_name}, I'm co-hosting a small ${kind === "dinner" ? "dinner" : "roundtable"} on {date} for a few people wrestling with ${question.replace(/\?$/, "").toLowerCase()}. I've found these genuinely useful. Any interest? I'll make sure you're next to {peer}.`,
    },
    reminder48h: `{first_name}, looking forward to {date}. You mentioned {wants}; {peer} has dealt with exactly that, so I've put you together. ${kind === "dinner" ? "{time} at {venue}. Any dietary needs?" : "{time}, here: {link}"}`,
    dayOf: kind === "dinner" ? "See you at {time}, private room at {venue}." : "See you at {time}: {link}",
    declineReply: "Thanks for letting me know. Is there a colleague who should be there instead? Happy to save them a seat.",
    followUp: {
      nextMorningNote: `{first_name}, thanks for coming last night. You said {what_they_said}, and it stuck with me. {next_step}\n\n${sign}`,
      groupEmail: `Thank you all for a candid ${kind === "dinner" ? "evening" : "hour"}. A few themes I heard, without attribution:\n\n- [theme 1]\n- [theme 2]\n- [theme 3]\n\nI'll make the intros I promised in separate emails. If you'd like to do this again next quarter, reply and I'll keep you posted.\n\n${sign}`,
      noShow: `{first_name}, sorry we missed you. The conversation was good and I'd like you at the next one; you'll get first pick of the date.\n\n${sign}`,
    },
  };
}

/* ─────────────────────────────── Plan ─────────────────────────────── */

async function runPlan(ctx: WorkflowContext<Args>, a: PlanArgs) {
  const today = todayISO();
  const ws0 = ctx.read();
  const kind = a.kind;
  const won = Object.values(ws0.deals).filter((d) => d.stage === "won").length;
  const open = Object.values(ws0.deals).filter((d) => ["talking", "qualified", "pilot", "proposal"].includes(d.stage)).length;
  const goal: EventGoal = a.goal ?? (open >= 3 ? "accelerate_deals" : "create_pipeline");
  const existing = ws0.events[a.eventId];
  // A re-plan keeps the start time the founder set (invites already name it); a new kind gets its default.
  const keepTime = existing?.kind === kind && existing.date && existing.date.length >= 16 ? existing.date.slice(11, 16) : undefined;
  const city = kind === "dinner" ? (a.city ?? existing?.request?.city ?? existing?.plan?.city) : undefined;
  const picked = a.date ? { date: a.date, moved: false } : proposeDate(kind, a.month, today);
  const date = picked.date;
  const month = a.month ?? date.slice(0, 7);
  const title = kind === "dinner" ? `${city ? `${city} dinner` : "Dinner"} · ${monthLabel(month)}` : `Virtual roundtable · ${monthLabel(month)}`;

  // The event exists from the first second, so its page can show this run's live log.
  await ctx.mutate((ws) => {
    const ev: GtmEvent = ws.events[a.eventId] ?? { id: a.eventId, kind, title, status: "planning", guests: {}, createdAt: nowISO() };
    ev.kind = kind;
    if (!ev.plan) ev.title = title;
    ev.runId = ctx.runId;
    ev.date = eventDateTime(kind, date, keepTime);
    ev.request = { city, month, date: a.date, goal, budgetUsd: a.budgetUsd, coHost: a.coHost };
    ws.events[a.eventId] = ev;
  });

  ctx.emit({ type: "status", text: "Reading your accounts, deals and network" });
  const connected = connectedByDomain();
  const ws = ctx.read();
  const { candidates, excluded } = scoreCandidates(ws, { kind, city, goal, connected, today });
  const customers = candidates.filter((c) => c.category === "customer");
  const options = coHostOptions(ws, a.coHost, customers);
  const room = composeRoom(candidates, ws, { kind, hasCoHost: Boolean(a.coHost) });
  ctx.emit({
    type: "action",
    text: `Scored ${candidates.length} ${candidates.length === 1 ? "person" : "people"} across ${new Set(candidates.map((c) => c.accountDomain)).size} accounts${connected.size ? " and your LinkedIn network" : ""}`,
  });
  if (excluded.length) ctx.emit({ type: "action", text: `Left out ${excluded.length} competitor${excluded.length === 1 ? "" : "s"}` });

  const seeds = mineSeeds(ws, candidates, today);
  ctx.emit({ type: "action", text: `Found ${seeds.length} theme seed${seeds.length === 1 ? "" : "s"} in signals, dossiers and calls` });

  // Everyone who gets a seat or an invite, in a stable order with short keys for the prompt.
  const roster: { c: ScoredCandidate; status: Guest["status"] }[] = [
    ...(room.anchor ? [{ c: room.anchor, status: "candidate" as const }] : []),
    ...room.customerHosts.map((c) => ({ c, status: "candidate" as const })),
    ...(room.connector ? [{ c: room.connector, status: "candidate" as const }] : []),
    ...room.invitees.map((c) => ({ c, status: "candidate" as const })),
    ...room.waitlist.map((c) => ({ c, status: "waitlist" as const })),
  ];
  const keyed = roster.map((r, i) => ({ ...r, key: `g${i + 1}` }));
  const byKey = new Map(keyed.map((r) => [r.key, r]));
  // Lines only for guests likely to get an invite: fixed roles first, then invitees best first. Waitlist
  // guests and the long tail keep an empty line the founder fills if they ever invite them.
  const lined = keyed.filter((r) => r.status !== "waitlist").slice(0, MAX_LINED);

  const budgetUsd = defaultBudget(kind, a.budgetUsd);
  const notes: string[] = [];
  if (picked.moved && a.month) {
    notes.push(`${monthLabel(a.month)} is too soon to fill a ${kind === "dinner" ? "dinner (about 6 weeks)" : "roundtable (about 3 weeks)"}. I set ${formatEventDate({ date: eventDateTime(kind, date, keepTime) })}, the earliest good Tue–Thu.`);
  } else if (a.date && daysBetween(today, a.date) < (kind === "dinner" ? 35 : 18)) {
    notes.push(`That date leaves ${Math.max(0, daysBetween(today, a.date))} days. I compressed the timeline; expect fewer acceptances.`);
  }
  if (kind === "dinner" && !won && !a.coHost) {
    const investor = ws.connectors.find((c) => c.relationship === "investor" || c.relationship === "angel");
    notes.push(
      `Dinners fill when someone else's brand is on the invite. With no customer to host, ask ${investor ? `${investor.name}'s platform team` : "a VC platform team"} or a non-competing startup that sells to the same buyer to co-host. A virtual roundtable is the cheaper first step.`,
    );
  }
  if (!room.anchor) {
    notes.push(
      kind === "dinner"
        ? room.customerHosts.length
          ? `No separate anchor. Ask ${room.customerHosts[0].name ?? `your contact at ${room.customerHosts[0].company}`} to open with 5–10 minutes on what they've seen, or ask an investor for a portfolio exec who has lived this problem.`
          : "No anchor yet. A senior customer is ideal; otherwise ask an investor for a portfolio exec who has lived this problem to open with 5–10 minutes."
        : "No framer yet. Ask a design partner, an advisor or a respected operator to open with 5 minutes on what they've seen.",
    );
  }
  const pool = room.invitees.length;
  const needed = room.inviteMath.invites - room.composition.anchor - room.composition.customers - room.composition.connector;
  if (pool < needed) {
    notes.push(`You need about ${room.inviteMath.invites} invites to seat ${room.inviteMath.seats}; I found ${pool} prospects who fit. Import your LinkedIn connections or ask a co-host to add names from their list.`);
  }
  const cold = room.inviteMath.coldInvites ?? 0;
  if (cold > 0) {
    const cap = ws.caps.firstTouchesPerWeek;
    notes.push(`${cold} invite${cold === 1 ? " is" : "s are"} cold and count against your cap of ${cap} cold first touches a week${cold > cap / 2 ? `; spread them over ${Math.ceil(cold / (cap / 2))} weeks` : ""}.`);
  }
  const unnamed = room.invitees.filter((c) => room.mustAttendKeys.has(candidateKey(c)) && !c.name).length;
  if (unnamed) notes.push(`${unnamed} must-attend account${unnamed === 1 ? " has" : "s have"} no named person yet. Find them from the company sheet before invites go out.`);
  if (excluded.length) notes.push(`Left out ${excluded.map((e) => e.name).slice(0, 4).join(", ")}: they compete with you.`);
  notes.push("If 5 or more must-attend guests decline, move the date rather than fill seats with weaker fits.");

  /* ── One Sonnet call writes the words ── */
  const fmtCand = (r: (typeof keyed)[number]) => {
    const c = r.c;
    const bits = [
      r.key,
      c.name ?? "(no named person yet)",
      c.title,
      c.accountDomain ? `${c.company} (${c.accountDomain})` : c.company,
      kind === "dinner" ? (c.city ?? "city unknown") : null,
      c.dealStage ? `deal: ${c.dealStage}` : c.category === "customer" ? "customer" : null,
      // Third-party connection names stay out of the prompt; the UI still shows them.
      c.warmPath?.startsWith("You know") ? "warm: 1st-degree LinkedIn connection" : c.warmPath ? `warm: ${c.warmPath}` : "cold",
      c.signal ? `signal ${c.signal.date}: "${c.signal.headline}"${c.signal.evidenceId ? ` [${c.signal.evidenceId}]` : ""}` : null,
      c.pain ? `pain: "${c.pain.text}"${c.pain.evidenceIds.length ? ` [${c.pain.evidenceIds.slice(0, 2).join(", ")}]` : ""}` : null,
      `role: ${c.role}`,
      room.mustAttendKeys.has(candidateKey(c)) ? "must-attend" : null,
      `score ${c.score}`,
    ];
    return `- ${bits.filter(Boolean).join(" · ")}`;
  };

  const anchorName = room.anchor?.name;
  const skeleton = defaultRunOfShow(kind)
    .map((s) => `${s.time} ${s.segment}`)
    .join("; ");
  const message = [
    taskHeader(),
    `Plan a ${kind === "dinner" ? `co-hosted executive dinner in ${city ?? "the founder's city"}` : "60-minute virtual roundtable"} on ${formatEventDate({ date: eventDateTime(kind, date, keepTime) }, { time: true })}.`,
    `Goal: ${goal}. Seats: ${room.composition.seats} guests${kind === "dinner" ? " + 2 hosts (founder and co-host)" : " + the founder as host"}. Anchor/${kind === "dinner" ? "anchor" : "framer"}: ${room.anchor ? `${room.anchor.name ?? room.anchor.title} (${room.anchor.company})` : "none yet"}.`,
    `Budget: $${budgetUsd.low}–${budgetUsd.high}.${a.coHost ? ` The founder wants ${a.coHost} as co-host.` : ""}`,
    "",
    "<theme_seeds>",
    ...(seeds.length ? seeds.map((s) => `${s.id}: ${s.text}`) : ["(none: the founder has little data yet; frame themes from the company context and say the evidence is thin)"]),
    "</theme_seeds>",
    "",
    `<guests count="${lined.length}">`,
    ...lined.map(fmtCand),
    "</guests>",
    "",
    "<co_host_options>",
    ...(options.length ? options.map((o) => `${o.id}: ${o.name} (${o.kind}; ${o.note})`) : ["(none)"]),
    "</co_host_options>",
    "",
    `Run-of-show skeleton (keep times and segments): ${skeleton}`,
    kind === "dinner" && city
      ? `Search for up to 4 venues: private dining rooms in ${city} that suit ${room.composition.seats + 2} people. Query only the city and venue terms.`
      : "No venue search: this is virtual.",
    "",
    "Write a personal line, wants and a seat partner for every guest listed. Then call submit_room_plan.",
  ].join("\n");

  let out: PlanOut | undefined;
  let seen = new Set<string>();
  let failure: unknown = null;
  try {
    const res = await ctx.agent<PlanOut>({
      tier: "operator",
      effort: "medium",
      system: [EMBER_CORE, ROOM_RULES, companyContext(ws)],
      messages: [{ role: "user", content: message }],
      tools: [
        defineTool({
          name: "submit_room_plan",
          description: "Submit the room plan: themes, per-guest lines, copy templates, run of show, seating rules, follow-up templates and venue ideas.",
          schema: submitPlan,
          terminal: true,
        }),
      ],
      webSearch: kind === "dinner" && city ? 4 : 0,
      webFetch: kind === "dinner" && city ? 2 : 0,
      requireTerminal: true,
      maxTokens: 16000,
    });
    out = res.result;
    seen = seenUrls(res.messages);
    if (!out) failure = new AgentError("I couldn't finish writing the plan. Try again.", "unknown");
  } catch (err) {
    if (err instanceof AgentError && err.code === "stopped") throw err;
    failure = err;
  }
  // Template copy only stands in on a first plan. A failed re-plan leaves the plan and guests as they were.
  if (failure && existing?.plan) {
    const message = `${failure instanceof Error ? failure.message : "I couldn't re-plan this time."} Your previous plan is unchanged.`;
    throw failure instanceof AgentError ? new AgentError(message, failure.code) : new Error(message);
  }

  /* ── Assemble in code: validate every id, key and URL the model returned ── */
  ctx.emit({ type: "status", text: "Putting the plan together" });
  const themes: DinnerPlan["themes"] = (out?.themes ?? [])
    .filter((t) => t.question.trim())
    .map((t) => {
      const used = seeds.filter((s) => t.seedIds.includes(s.id));
      return {
        title: wordsMax(t.title, 10),
        question: t.question.trim(),
        whyNow: t.whyNow.trim(),
        prompts: t.prompts.map((p) => p.trim()).filter(Boolean),
        reservePrompts: t.reservePrompts.map((p) => p.trim()).filter(Boolean),
        evidenceIds: [...new Set(used.flatMap((s) => s.evidenceIds))].slice(0, 4),
        sources: used.flatMap((s) => s.sources).slice(0, 4),
      };
    });
  if (!themes.length) {
    const q = ws.foundation ? `What actually breaks first when ${ws.foundation.icp.hypothesis.obstacle.replace(/\.$/, "").toLowerCase()}?` : "What did you try this year that didn't work, and what told you?";
    themes.push({
      title: "Write the question",
      question: q,
      whyNow: seeds[0] ? seeds[0].text.slice(0, 160) : "Thin evidence so far. Sharpen this after your next five calls.",
      prompts: [],
      reservePrompts: [],
      evidenceIds: seeds[0]?.evidenceIds ?? [],
      sources: seeds[0]?.sources ?? [],
    });
  }

  const lineFor = new Map((out?.guests ?? []).filter((g) => byKey.has(g.key)).map((g) => [g.key, g]));
  const ids = new Map(keyed.map((r) => [r.key, newId("gst")]));
  const conflictOf = new Map<string, string>();
  for (const c of out?.conflicts ?? []) {
    const A = byKey.get(c.a);
    const B = byKey.get(c.b);
    if (!A || !B || A.c.accountDomain === B.c.accountDomain) continue;
    const [lo, hi] = A.c.score >= B.c.score ? [B, A] : [A, B];
    conflictOf.set(lo.key, `Competes with ${hi.c.company}: ${c.why}`);
  }

  const fresh: Guest[] = keyed.map((r) => {
    const o = lineFor.get(r.key);
    const allowedEv = new Set(r.c.evidenceIds ?? []);
    const partner = o?.seatNextTo && o.seatNextTo !== r.key ? ids.get(o.seatNextTo) : undefined;
    const conflict = conflictOf.get(r.key) ?? null;
    return {
      id: ids.get(r.key)!,
      status: conflict ? "waitlist" : r.status,
      personId: r.c.personId,
      name: r.c.name,
      title: r.c.title,
      accountDomain: r.c.accountDomain,
      role: r.c.role,
      score: r.c.score,
      dealId: r.c.dealId,
      personalLine: o ? clean(wordsMax(o.personalLine, 30)) : "",
      warmPath: r.c.warmPath,
      scoreParts: r.c.scoreParts,
      evidenceIds: o?.evidenceIds.filter((e) => allowedEv.has(e)).length ? o.evidenceIds.filter((e) => allowedEv.has(e)) : (r.c.evidenceIds ?? []).slice(0, 2),
      competitorConflict: conflict,
      wants: o?.wants ? clean(wordsMax(o.wants, 18)) : undefined,
      seatNextTo: partner ? { guestId: partner, why: clean(o?.seatWhy ?? "Faced the same problem") } : undefined,
      mustAttend: room.mustAttendKeys.has(candidateKey(r.c)) && !conflict ? true : undefined,
    };
  });

  // Only the founder's pick is a co-host. The model's pick is a suggestion until the founder says they agreed.
  const option = out?.coHost ? options.find((o) => o.id === out!.coHost!.optionId) : undefined;
  const namedOption = option && (option.id === "c0" || option.name.toLowerCase() === a.coHost?.toLowerCase()) ? option : undefined;
  const coHost: DinnerPlan["coHost"] = a.coHost
    ? {
        name: a.coHost,
        kind: namedOption ? (namedOption.id === "c0" ? out!.coHost!.kind : namedOption.kind) : "non_competing_startup",
        why: namedOption?.id === "c0" ? clean(out!.coHost!.why) : "Your pick: their brand and list carry the invite.",
      }
    : null;
  const suggestedCoHost: DinnerPlan["suggestedCoHost"] = !a.coHost && option ? { name: option.name, kind: option.kind, why: clean(out!.coHost!.why) } : undefined;

  const chosenQuestion = themes[0].question;
  const tpl = templateCopy(ws, kind, chosenQuestion, anchorName);
  const copy: DinnerPlan["copy"] = out
    ? {
        inviteFounder: { subject: clean(out.copy.invite.subject), body: ensureNoPitch(clean(out.copy.invite.body)) },
        inviteCustomerHost: { subject: clean(out.copy.hostInvite.subject), body: clean(out.copy.hostInvite.body) },
        reminder48h: clean(out.copy.reminder48h),
        dayOfText: clean(out.copy.dayOf),
        declineReply: clean(out.copy.declineReply),
      }
    : { inviteFounder: tpl.invite, inviteCustomerHost: tpl.hostInvite, reminder48h: tpl.reminder48h, dayOfText: tpl.dayOf, declineReply: tpl.declineReply };

  const venueIdeas: DinnerPlan["venueIdeas"] =
    kind === "dinner"
      ? (out?.venues ?? [])
          .filter((v) => v.name.trim() && seen.has(normUrl(v.url)))
          .map((v) => ({ name: v.name.trim(), why: clean(v.why), url: v.url.trim(), quote: v.quote.trim() || undefined }))
      : [];
  if (kind === "dinner" && out && (out.venues?.length ?? 0) > venueIdeas.length) {
    ctx.emit({ type: "action", text: `Dropped ${(out.venues?.length ?? 0) - venueIdeas.length} venue idea${(out.venues?.length ?? 0) - venueIdeas.length === 1 ? "" : "s"} I couldn't tie to a source` });
  }

  const runOfShow = out?.runOfShow.length ? out.runOfShow.map((s) => ({ time: s.time, segment: s.segment, notes: clean(s.notes) })) : defaultRunOfShow(kind);
  const seatingRules = out?.seatingRules.length ? out.seatingRules.map(clean) : defaultSeatingRules(kind);
  if (failure) {
    notes.unshift(
      `The copy below is from templates: I couldn't write custom copy this time (${failure instanceof Error ? failure.message : "unknown error"}). The guest list and timeline are complete. Re-plan to try again.`,
    );
  }

  const latest = ctx.read().events[a.eventId];
  const plan: DinnerPlan = {
    goal,
    city: kind === "dinner" ? (city ?? "") : "Virtual",
    targetDate: date,
    budgetUsd,
    coHostSuggestion: suggestedCoHost ? `${suggestedCoHost.name}: ${suggestedCoHost.why}` : undefined,
    suggestedCoHost,
    coHost,
    themes,
    inviteMath: room.inviteMath,
    composition: room.composition,
    anchorBrief: out?.anchorBrief ? clean(out.anchorBrief) : undefined,
    notes,
    generatedAt: nowISO(),
    timeline: computeTimeline(kind, date, { coHost: Boolean(coHost), today, prev: latest?.plan?.timeline }),
    venueCriteria:
      kind === "dinner"
        ? [
            "Private room, ideally on a different floor",
            "Soft surfaces (carpet, curtains); no all-concrete rooms",
            "One round table for 10; two rounds above that",
            "3–4 courses, not a tasting menu",
            `Close to where guests work${city ? ` in ${city}` : ""}`,
            "Visit at peak hours to test the noise; premium rooms open about 30 days out",
          ]
        : ["A video link with a waiting room; cameras on", "60 minutes, 8 guests at most", "No recording (Chatham House rule)", "Mid-day in the guests' main time zone, Tue–Thu"],
    venueIdeas,
    copy,
    runOfShow,
    seatingRules,
    followUp: {
      nextMorningNote: tpl.followUp.nextMorningNote,
      groupEmail: out ? clean(out.followUp.groupEmail) : tpl.followUp.groupEmail,
      cadence: defaultCadence(),
      noShow: out ? clean(out.followUp.noShow) : tpl.followUp.noShow,
    },
  };

  const result = await ctx.mutate((w) => {
    const ev = w.events[a.eventId];
    if (!ev) return { guests: 0 };
    // Re-plans keep everyone the founder already acted on (invited, accepted…), added by hand or edited,
    // and never bring back a guest the founder cut.
    const kept = Object.values(ev.guests).filter((g) => g.manual || g.edited || !["candidate", "waitlist"].includes(g.status));
    const keptKeys = new Set(kept.map(candidateKey));
    const cut = new Set(ev.cut ?? []);
    const guests: Record<string, Guest> = {};
    for (const g of kept) guests[g.id] = g;
    for (const g of fresh) if (!keptKeys.has(candidateKey(g)) && !cut.has(candidateKey(g))) guests[g.id] = g;
    // Seat partners that were dropped as duplicates point nowhere; clear them.
    for (const g of Object.values(guests)) if (g.seatNextTo && !guests[g.seatNextTo.guestId]) delete g.seatNextTo;
    ev.guests = guests;
    ev.plan = plan;
    ev.kind = kind;
    ev.date = eventDateTime(kind, date, keepTime);
    ev.chosenThemeIdx = Math.min(ev.chosenThemeIdx ?? 0, themes.length - 1);
    return { guests: Object.keys(guests).length };
  });

  ctx.emit({ type: "action", text: `Planned ${result.guests} guests, ${themes.length} theme${themes.length === 1 ? "" : "s"} and ${plan.timeline.length} dated tasks` });
  if (failure) throw failure instanceof Error ? failure : new Error("I couldn't finish writing the plan.");
  return { eventId: a.eventId, guests: result.guests, themes: themes.length };
}

/* ─────────────────────────────── After: voice notes → next-morning notes ─────────────────────────────── */

async function runDebrief(ctx: WorkflowContext<Args>, a: DebriefArgs) {
  const ws = ctx.read();
  const ev = ws.events[a.eventId];
  if (!ev) throw new Error("That event no longer exists.");
  const wanted = a.guestIds?.length ? new Set(a.guestIds) : null;
  // Notes are written only for the guests asked for; the themes and the group email draw on every voice note,
  // so a second batch doesn't shrink the group email to that batch.
  const all = Object.values(ev.guests).filter((g) => g.voiceNote?.trim() && g.status === "attended");
  const guests = all.filter((g) => !wanted || wanted.has(g.id));
  if (!guests.length) throw new Error("Paste a voice note for at least one guest first.");

  ctx.emit({ type: "status", text: `Reading ${all.length} voice note${all.length === 1 ? "" : "s"}` });
  const keyed = all.map((g, i) => ({ g, key: `g${i + 1}` }));
  const theme = ev.plan?.themes[ev.chosenThemeIdx ?? 0];
  const day = eventDay(ev);
  const message = [
    taskHeader(),
    `The founder hosted a ${ev.kind === "dinner" ? "dinner" : "virtual roundtable"}${day ? ` on ${day}` : ""}${theme ? ` on the question "${theme.question}"` : ""}.`,
    `Founder's first name for sign-offs: ${ws.founder.name.split(" ")[0] || ws.founder.name || "(unknown)"}.`,
    "",
    "<voice_notes>",
    ...keyed.map(({ g, key }) => {
      const company = ws.accounts[g.accountDomain]?.name ?? g.accountDomain;
      const deal = g.dealId ? ws.deals[g.dealId] : undefined;
      const write = !wanted || wanted.has(g.id) ? "yes" : "no";
      return `<guest key="${key}" name="${g.name ?? g.title}" title="${g.title}" company="${company}"${deal ? ` deal_stage="${deal.stage}"` : ""} write_note="${write}">\n${g.voiceNote!.trim().slice(0, 1500)}\n</guest>`;
    }),
    "</voice_notes>",
    "",
    'Write per-guest debriefs and next-morning notes only for guests with write_note="yes". Draw the themes and the group email from ALL voice notes. Then call submit_room_debrief.',
  ].join("\n");

  const res = await ctx.agent<DebriefOut>({
    tier: "operator",
    effort: "low",
    system: [EMBER_CORE, AFTER_RULES, companyContext(ws)],
    messages: [{ role: "user", content: message }],
    tools: [defineTool({ name: "submit_room_debrief", description: "Submit per-guest debriefs, next-morning notes and the group email.", schema: submitDebrief, terminal: true })],
    requireTerminal: true,
    maxTokens: 8000,
  });
  const out = res.result;
  if (!out) throw new AgentError("I couldn't finish the notes. Try again.", "unknown");

  const byKey = new Map(keyed.map((k) => [k.key, k.g.id]));
  const at = nowISO();
  const written = await ctx.mutate((w) => {
    const live = w.events[a.eventId];
    if (!live) return 0;
    let n = 0;
    for (const d of out.guests) {
      const id = byKey.get(d.key);
      // Debriefs and sent notes for guests outside this batch stay as they are.
      if (!id || (wanted && !wanted.has(id))) continue;
      const g = live.guests[id];
      if (!g) continue;
      g.debrief = {
        challenge: clean(d.challenge),
        wishes: clean(d.wishes),
        peersNamed: d.peersNamed.map((p) => p.trim()).filter(Boolean),
        nextStep: d.nextStep ? clean(d.nextStep) : null,
        fit: d.fit,
        nextMorningNote: clean(d.nextMorningNote),
        generatedAt: at,
      };
      n++;
    }
    live.after = { themes: out.themes.map(clean), groupEmail: { subject: clean(out.groupEmail.subject), body: clean(out.groupEmail.body) }, generatedAt: at, runId: ctx.runId };
    return n;
  });
  ctx.emit({ type: "action", text: `Wrote ${written} next-morning note${written === 1 ? "" : "s"} and the group email` });
  return { eventId: a.eventId, notes: written, drafts: written + 1 };
}

export default defineWorkflow({
  id: "dinner_plan",
  args,
  title: (a) =>
    a.mode === "debrief" ? "Writing next-morning notes" : a.kind === "dinner" ? `Planning a dinner${a.city ? ` in ${a.city}` : ""}` : "Planning a virtual roundtable",
  ref: (a) => ({ kind: "event", id: a.eventId }),
  heavy: true,
  run: async (ctx) => (ctx.args.mode === "debrief" ? runDebrief(ctx, ctx.args) : runPlan(ctx, ctx.args)),
});
