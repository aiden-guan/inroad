import { ActionError, applyAction } from "@/lib/domain/actions";
import { addDays, newId, todayISO } from "@/lib/domain/ids";
import type { Connection, ID, Workspace } from "@/lib/domain/types";
import { askedToBeDeleted, ensureAccount, ensurePerson, normalizeEmail } from "@/lib/hub/records";
import { localDate } from "@/lib/moves/util";
import { REPLY_WINDOW_DAYS } from "@/lib/moves/replies";
import { replyBody, type PasteTarget } from "./sender";

export interface PastedReply {
  personId: ID;
  domain: string;
  activityId: ID;
  /** Touches the founder hadn't marked yet, now marked "replied" (what R in Check replies does). */
  marked: number;
  createdPerson: boolean;
  createdAccount: boolean;
}

/** A plain sentence the palette shows as-is (the API answers it with a 400). */
export class PasteError extends ActionError {}

/** Someone who asked to have their details deleted isn't filed again by pasting their mail: only their address is kept. */
function refuseDeleted(ws: Workspace, email: string | null | undefined, name: string) {
  if (askedToBeDeleted(ws, email)) {
    throw new PasteError(`${name.split(" ")[0] || "They"} asked you to delete their details, so I won't keep their reply. Answer it from your inbox; their address stays on your suppression list.`);
  }
}

/**
 * Logs a pasted reply on a workspace draft, as Check replies' R does: files the sender (a person on file,
 * a LinkedIn connection's person, or a new person at their company), logs `reply_received` with their
 * own words (which cancels the rest of their sequence) and marks their open touches as replied. The draft
 * of the answer is the composer's job (reply mode reads this logged reply). Zero tokens.
 */
export function logPastedReply(ws: Workspace, connections: Connection[], input: { text: string; target: PasteTarget; receivedAt?: string }, now: Date): PastedReply {
  const text = input.text.trim();
  if (text.length < 2) throw new PasteError("Paste their reply first.");
  const at = now.toISOString();
  let createdAccount = false;
  let createdPerson = false;
  let personId: ID;
  const t = input.target;
  if ("personId" in t) {
    if (!ws.people[t.personId]) throw new PasteError("That person is no longer in your workspace.");
    personId = t.personId;
  } else if ("connectionId" in t) {
    const c = connections.find((x) => x.id === t.connectionId);
    if (!c) throw new PasteError("That connection is no longer in your LinkedIn import.");
    if (c.personId && ws.people[c.personId]) personId = c.personId;
    else {
      if (!c.matchedDomain) throw new PasteError(`I don't know ${c.company || "their company"}'s website. Pick the company or add them by hand.`);
      refuseDeleted(ws, normalizeEmail(c.email), c.firstName);
      createdAccount = ensureAccount(ws, { domain: c.matchedDomain, name: c.company || undefined }, { source: "founder_network", sourceDetail: "Replied (pasted reply)", at }).created;
      const r = ensurePerson(ws, { domain: c.matchedDomain, name: `${c.firstName} ${c.lastName}`.trim(), title: c.position, email: normalizeEmail(c.email), linkedinUrl: c.url || null }, { via: "LinkedIn connection", source: "founder_network" });
      createdPerson = r.created;
      personId = r.person.id;
    }
  } else {
    const domain = t.domain.trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new PasteError("That doesn't look like a company website.");
    if (!t.name.trim()) throw new PasteError("Who sent it? Add their name.");
    refuseDeleted(ws, normalizeEmail(t.email), t.name.trim());
    createdAccount = ensureAccount(ws, { domain, name: t.company?.trim() || undefined }, { source: "manual", sourceDetail: "Replied (pasted reply)", at }).created;
    const r = ensurePerson(ws, { domain, name: t.name.trim(), email: normalizeEmail(t.email) }, { via: "their reply", source: "manual" });
    createdPerson = r.created;
    personId = r.person.id;
  }

  const person = ws.people[personId];
  const domain = person.accountDomain;
  const receivedAt = input.receivedAt && Date.parse(input.receivedAt) <= now.getTime() ? new Date(input.receivedAt).toISOString() : at;
  const activityId = newId("act");
  applyAction(ws, {
    type: "activity.log",
    activity: {
      id: activityId,
      at: receivedAt,
      kind: "reply_received",
      personId,
      accountDomain: domain,
      dealId: ws.accounts[domain]?.dealId,
      channel: "email",
      summary: `Reply from ${person.name}`,
      body: replyBody(text).slice(0, 8000),
      source: "founder",
    },
  });
  // Check replies would ask about these touches tomorrow; the founder just answered for them.
  const since = addDays(todayISO(now), -REPLY_WINDOW_DAYS);
  const open = ws.activities.filter((a) => a.kind === "touch_sent" && a.personId === personId && !a.outcome && (!a.channel || a.channel === "email") && localDate(a.at) >= since && a.at <= receivedAt);
  if (open.length) applyAction(ws, { type: "activity.markOutcome", ids: open.map((a) => a.id), outcome: "replied", at });
  return { personId, domain, activityId, marked: open.length, createdPerson, createdAccount };
}
