import type { Deal, Meeting, Person, QualificationCard, ReplyIntent, Stage, Workspace } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";
import { containsText, hashKey, sameText, terms, words } from "./text";
import type { VoiceConversation, VoiceSnippet } from "./types";

/**
 * Everything buyers said that the workspace holds, as snippets with their receipts: debrief quotes (verbatim only
 * from transcripts; the founder's notes stay paraphrase), the debrief's one-line read of each new objection
 * (a summary, labeled so), the buyer's own email replies, and a consumer founder's notes from user conversations.
 * The founder's own lines in a transcript are left out: this is what buyers said, not what we said to them.
 */

const CARD_FIELDS: (keyof QualificationCard)[] = ["pain", "spend", "criticalEvent", "champion", "economicBuyer", "fit", "decisionProcess"];

/** Where the deal stood at a moment: the last stage entered at or before it (the first stage for earlier moments). */
export function stageAt(deal: Deal | undefined, iso: string): Stage | undefined {
  if (!deal) return undefined;
  const history = deal.stageHistory ?? [];
  let stage: Stage | undefined = history[0]?.stage;
  for (const h of history) if (h.at <= iso) stage = h.stage;
  return stage ?? deal.stage;
}

const firstName = (name: string) => words(name)[0] ?? "";

/** The founder's own lines: their name, first name, the sender's name, or a "me/you" label. */
export function isFounderSpeaker(ws: Pick<Workspace, "founder" | "sender">, speaker: string | undefined): boolean {
  if (!speaker) return false;
  if (/^(me|you|founder|seller|host|interviewer)$/i.test(speaker.trim())) return true;
  return [ws.founder.name, ws.sender?.name].some((n) => !!n?.trim() && (sameText(n, speaker) || (words(speaker).length === 1 && firstName(n) === firstName(speaker))));
}

/** The person behind a speaker label on a call: full name first, then a first name that only one attendee has. */
function personFor(ws: Workspace, meeting: Meeting, deal: Deal | undefined, speaker: string | undefined): { person?: Person; title?: string; name?: string } {
  if (!speaker) return {};
  const attendees = meeting.attendees ?? [];
  const ids = new Set<string>([...attendees.map((a) => a.personId ?? ""), ...(deal?.contacts?.map((c) => c.personId) ?? [])].filter(Boolean));
  const domain = deal?.accountDomain;
  const pool = Object.values(ws.people).filter((p) => ids.has(p.id) || (!!domain && p.accountDomain === domain));
  const full = pool.find((p) => sameText(p.name, speaker));
  const attendee = attendees.find((a) => sameText(a.name, speaker));
  if (full) return { person: full, title: full.title || attendee?.title, name: full.name };
  if (attendee) return { title: attendee.title, name: attendee.name };
  if (words(speaker).length === 1) {
    const byFirst = pool.filter((p) => firstName(p.name) === firstName(speaker));
    if (byFirst.length === 1) return { person: byFirst[0], title: byFirst[0].title, name: byFirst[0].name };
    const named = attendees.filter((a) => firstName(a.name) === firstName(speaker));
    if (named.length === 1) return { title: named[0].title, name: named[0].name };
  }
  return { name: speaker };
}

/** Card fields whose quotes include this one ("Ethan: five days…" on the card matches "Five days…" from the call). */
function fieldsCiting(card: QualificationCard | undefined, text: string): (keyof QualificationCard)[] {
  if (!card) return [];
  return CARD_FIELDS.filter((f) => card[f]?.quotes?.some((q) => sameText(q.replace(/^\(notes\)\s*/i, "").replace(/^[A-Z][a-z]+:\s*/, ""), text) || containsText(q, text) || containsText(text, q)));
}

/** The deal a reply belongs to: its own, else the company's deal while it was open (a "yes" often comes before the deal). */
function dealForReply(ws: Workspace, dealId: string | undefined, domain: string | undefined): Deal | undefined {
  if (dealId && ws.deals[dealId]) return ws.deals[dealId];
  const id = domain ? ws.accounts[domain]?.dealId : undefined;
  return id ? ws.deals[id] : undefined;
}

export interface Corpus {
  snippets: VoiceSnippet[];
  conversations: VoiceConversation[];
  /** Verbatim customer phrases each call's debrief kept, by meeting id. */
  customerWords: Map<string, string[]>;
}

export function buyerCorpus(ws: Workspace): Corpus {
  const snippets: VoiceSnippet[] = [];
  const conversations: VoiceConversation[] = [];
  const customerWords = new Map<string, string[]>();

  for (const m of Object.values(ws.meetings)) {
    const d = m.debrief;
    if (!d) continue;
    const deal = ws.deals[m.dealId];
    const domain = deal?.accountDomain;
    const company = (domain && ws.accounts[domain]?.name) || deal?.name;
    const date = localDate(m.startsAt);
    const stage = stageAt(deal, m.startsAt);
    const transcript = d.source === "transcript";
    conversations.push({ id: m.id, kind: "call", date, dealId: deal?.id, domain, stage });
    if (transcript && d.customerWords?.length) customerWords.set(m.id, d.customerWords);
    const base = { conv: m.id, convKind: "call" as const, date, at: m.startsAt, domain, company, dealId: deal?.id, meetingId: m.id, stage };

    for (const q of d.quotes ?? []) {
      const text = (q.text ?? "").trim();
      if (words(text).length < 3) continue;
      const speaker = q.speaker && q.speaker !== "Your notes" ? q.speaker : undefined;
      if (transcript && isFounderSpeaker(ws, speaker)) continue;
      const verbatim = transcript && q.kind !== "note";
      const who = verbatim ? personFor(ws, m, deal, speaker) : {};
      snippets.push({
        ...base,
        id: `${m.id}:${q.id}`,
        text,
        verbatim,
        source: verbatim ? "transcript" : "notes",
        speaker: who.name,
        title: who.title,
        personId: who.person?.id,
        fields: fieldsCiting(d.card, text),
        terms: terms(text),
      });
    }
    (d.newObjections ?? []).forEach((o, i) => {
      const text = o.trim();
      if (words(text).length < 3) return;
      snippets.push({ ...base, id: `${m.id}:obj${i}`, text, verbatim: false, source: "summary", fields: [], terms: terms(text) });
    });
  }

  // How each reply was read when the founder answered it (the reply package keeps the text and the intent).
  const intents = new Map<string, ReplyIntent>();
  for (const pkg of Object.values(ws.outreach)) if (pkg.reply?.text) intents.set(words(pkg.reply.text).join(" "), pkg.reply.intent);

  for (const a of ws.activities) {
    if (a.kind === "reply_received") {
      const body = a.body?.trim();
      if (!body || a.sentiment === "ooo" || a.sentiment === "unsubscribe" || words(body).length < 4) continue;
      const deal = dealForReply(ws, a.dealId, a.accountDomain);
      const domain = a.accountDomain ?? deal?.accountDomain;
      const person = a.personId ? ws.people[a.personId] : undefined;
      const date = localDate(a.at);
      const stage = stageAt(deal, a.at);
      conversations.push({ id: a.id, kind: "reply", date, dealId: deal?.id, domain, stage });
      snippets.push({
        id: `reply:${a.id}`,
        text: body.slice(0, 600),
        verbatim: true,
        source: "email",
        conv: a.id,
        convKind: "reply",
        date,
        at: a.at,
        speaker: person?.name,
        title: person?.title,
        personId: person?.id,
        domain,
        company: (domain && ws.accounts[domain]?.name) || undefined,
        dealId: deal?.id,
        activityId: a.id,
        stage,
        fields: [],
        sentiment: a.sentiment,
        intent: intents.get(words(body).join(" ")),
        terms: terms(body),
      });
    } else if (a.kind === "user_conversation" && a.body?.trim()) {
      // Consumer: the founder's notes from a user conversation. Paraphrase, never shown as the user's words.
      const date = localDate(a.at);
      conversations.push({ id: a.id, kind: "talk", date });
      snippets.push({
        id: `talk:${a.id}`,
        text: a.body.trim().slice(0, 600),
        verbatim: false,
        source: "talk",
        conv: a.id,
        convKind: "talk",
        date,
        at: a.at,
        speaker: a.summary.replace(/^Talked to\s+/i, "").trim() || undefined,
        activityId: a.id,
        fields: [],
        terms: terms(a.body),
      });
    }
  }

  snippets.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  conversations.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { snippets, conversations, customerWords };
}

/** The debriefs a naming pass read, hashed: a new or re-run debrief changes it. */
export function voiceFingerprint(ws: Workspace): string {
  const joined = Object.values(ws.meetings)
    .filter((m) => m.debrief)
    .map((m) => `${m.id}@${m.debrief!.generatedAt}`)
    .sort()
    .join("|");
  return hashKey(joined);
}

export function debriefedCalls(ws: Workspace): number {
  return Object.values(ws.meetings).filter((m) => m.debrief).length;
}
