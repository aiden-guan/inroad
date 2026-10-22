import type { Account, Connector, ID, Workspace } from "@/lib/domain/types";
import { bestPerson, clip, first, topSignal } from "@/lib/moves/util";
import { reachMatch } from "./rules";

/**
 * The connector list (SPEC W5 "warm intro", §5.2 "1 connector list if connectors exist"): many investors keep
 * their network private, so never ask the founder to browse it, and never spend an ask blind. Send up to 20
 * targets for the connector to mark, then write forwardables only for the rows they marked. Pure; zero tokens.
 */

export const LIST_MAX = 20;
/** Fewer than this is just an ask, not a list. */
export const LIST_MIN = 3;
/** A list waits this long for marks before Today stops asking about it. */
export const LIST_WAIT_DAYS = 21;

export interface ListTarget {
  domain: string;
  company: string;
  personId?: ID;
  name?: string;
  title?: string;
  linkedinUrl?: string;
  /** One line on why this company, from a dated signal when there is one. */
  why: string;
}

export function listTarget(ws: Workspace, acc: Account, today: string): ListTarget {
  const p = bestPerson(ws, acc);
  const sig = topSignal(acc, today, 60);
  return {
    domain: acc.domain,
    company: acc.name,
    ...(p ? { personId: p.id, name: p.name, title: p.title, ...(p.linkedinUrl ? { linkedinUrl: p.linkedinUrl } : {}) } : { title: acc.suggestedTitle }),
    why: clip(sig?.headline ?? acc.whyNow ?? acc.oneLiner ?? `${acc.tier}-tier fit`, 90),
  };
}

/** Which entry of a connector's reach names this company: where they work, a domain or name, else a topic. */
export function reachFor(c: Connector, acc: Account): { entry: string; exact: boolean } | null {
  if (c.company && reachMatch(c.company, acc) === "exact") return { entry: c.company, exact: true };
  const entries = c.reach ?? [];
  const exact = entries.find((r) => reachMatch(r, acc) === "exact");
  if (exact) return { entry: exact, exact: true };
  const topic = entries.find((r) => reachMatch(r, acc) === "topic");
  return topic ? { entry: topic, exact: false } : null;
}

/** The note that goes with the list: short, specific, and easy to say no to. */
export function listMessage(ws: Workspace, c: Connector, targets: ListTarget[]): { to?: string; subject: string; body: string } {
  const me = first(ws.founder.name);
  const rows = targets.map((t, i) => {
    const who = t.name ? `${t.name}${t.title ? `, ${t.title}` : ""}` : (t.title ? `the ${t.title}` : "");
    return `${i + 1}. ${t.company} (${t.domain})${who ? ` · ${who}` : ""}${t.linkedinUrl ? ` · ${t.linkedinUrl}` : ""}\n   ${t.why}`;
  });
  const body = [
    `Hi ${first(c.name)},`,
    "",
    `Here are ${targets.length} companies I'd love to meet. Could you mark any where you'd be comfortable making an introduction? No pressure on any of them, and I'll write a note you can forward as is.`,
    "",
    ...rows,
    "",
    "Thank you,",
    me || "",
  ].join("\n").trimEnd();
  return { ...(c.email ? { to: c.email } : {}), subject: `${targets.length} companies I'd love to meet`, body };
}
