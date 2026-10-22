import "server-only";
import { ActionError } from "@/lib/domain/actions";
import { newId } from "@/lib/domain/ids";
import type { Connection, Connector, RelationshipTag, Workspace } from "@/lib/domain/types";
import { findPerson } from "@/lib/hub/records";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { linkedinKey, normalizeCompany } from "./csv";
import { USER_ACCOUNT_TAGS, fullName } from "./import";
import { readConnections, updateConnections } from "./store";
import { isRelationshipTag } from "./tags";

/**
 * Who knows the founder, one click per person (SPEC W2 approval point). A tag lives on the LinkedIn
 * connection (connections.json, where the re-import diff reads it) and on the Person when there is one,
 * so a job change by a design partner, past user or ex-colleague becomes a champion_job_change. Tagging
 * someone an investor or connector also lists them in Intros as someone who introduces the founder.
 */

export interface TaggablePerson {
  connectionId?: string;
  personId?: string;
  name: string;
  position?: string;
  company?: string;
  linkedinUrl?: string;
  tags: RelationshipTag[];
}

const clean = (tags: unknown[]): RelationshipTag[] => [...new Set(tags.filter(isRelationshipTag))];

function asTaggable(ws: Workspace, c: Connection): TaggablePerson {
  const person = (c.personId && ws.people[c.personId]) || undefined;
  return {
    connectionId: c.id,
    ...(person ? { personId: person.id } : {}),
    name: fullName(c),
    ...(c.position ? { position: c.position } : {}),
    ...(c.company ? { company: c.company } : {}),
    ...(c.url ? { linkedinUrl: c.url } : {}),
    tags: clean([...(c.tags ?? []), ...(person?.tags ?? [])]),
  };
}

/** Sets one person's tags (replacing what was there) on their connection and their Person record. */
export async function setRelationshipTags(input: { connectionId?: string; personId?: string; tags: string[] }): Promise<{ tags: RelationshipTag[] }> {
  if (!input.connectionId && !input.personId) throw new ActionError("Who should I tag? Pick a person first.");
  const tags = clean(input.tags);
  const ws0 = readWorkspace();
  const person0 = input.personId ? ws0.people[input.personId] : undefined;
  if (input.personId && !person0) throw new ActionError("That person isn't in your workspace anymore.");

  // The connection: by id, or the person's own LinkedIn connection (same profile URL or email).
  const conn = await updateConnections((rows) => {
    const c = input.connectionId
      ? rows.find((r) => r.id === input.connectionId)
      : rows.find((r) => (person0?.linkedinUrl && r.url && linkedinKey(r.url) === linkedinKey(person0.linkedinUrl)) || (person0?.email && r.email?.toLowerCase() === person0.email.toLowerCase()));
    if (input.connectionId && !c) throw new ActionError("That connection isn't in your import anymore. Re-import your connections and try again.");
    if (!c) return undefined;
    if (tags.length) c.tags = tags;
    else delete c.tags;
    return { ...c };
  });

  await mutateWorkspace((ws) => {
    const person = (input.personId && ws.people[input.personId]) || (conn && ((conn.personId && ws.people[conn.personId]) || findPerson(ws, { linkedinUrl: conn.url || null, email: conn.email ?? null })));
    if (person) {
      if (tags.length) person.tags = tags;
      else delete person.tags;
    }
    // Investors and connectors are people who introduce the founder: list them in Intros once.
    const name = conn ? fullName(conn) : person?.name;
    const url = conn?.url || person?.linkedinUrl;
    const company = conn?.company || (person ? ws.accounts[person.accountDomain]?.name : undefined);
    // A connector is someone the founder says introduces people: an introducer like an advisor, never a plain
    // LinkedIn "connection" (which the intro rules leave out of asks).
    const relationship: Connector["relationship"] | null = tags.includes("investor") ? "investor" : tags.includes("connector") ? (tags.includes("ex_colleague") ? "ex_colleague" : "friend") : null;
    if (relationship && name) {
      const listed = ws.connectors.find((c) => (url && c.linkedinUrl && linkedinKey(c.linkedinUrl) === linkedinKey(url)) || c.name.toLowerCase() === name.toLowerCase());
      if (listed) {
        if (listed.relationship === "connection") listed.relationship = relationship;
      } else {
        ws.connectors.push({ id: newId("con"), name, relationship, ...(url ? { linkedinUrl: url } : {}), ...(company ? { company } : {}), introsMade: 0 });
      }
    }
  });
  return { tags };
}

/** Connections whose name, company or title matches the query, for tagging. Never more than `limit`. */
export function searchConnections(q: string, limit = 8): TaggablePerson[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  if (!words.length) return [];
  const ws = readWorkspace();
  const out: TaggablePerson[] = [];
  for (const c of readConnections()) {
    const hay = `${c.firstName} ${c.lastName} ${c.company} ${c.position}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push(asTaggable(ws, c));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * What the tagging list starts with: everyone already tagged, then people the founder probably knows
 * through their product (connections at customers and at the companies named as their users).
 */
export function taggingStart(limit = 12): { tagged: TaggablePerson[]; suggested: TaggablePerson[] } {
  const ws = readWorkspace();
  const rows = readConnections();
  const users = new Set(
    Object.values(ws.accounts)
      .filter((a) => a.status === "customer" || (a.tags ?? []).some((t) => USER_ACCOUNT_TAGS.includes(t)))
      .flatMap((a) => [normalizeCompany(a.name), a.domain]),
  );
  const tagged: TaggablePerson[] = [];
  const suggested: TaggablePerson[] = [];
  for (const c of rows) {
    const t = asTaggable(ws, c);
    if (t.tags.length) tagged.push(t);
    else if (users.has(c.companyNorm) || (c.matchedDomain && users.has(c.matchedDomain))) suggested.push(t);
  }
  return { tagged: tagged.slice(0, 50), suggested: suggested.slice(0, limit) };
}
