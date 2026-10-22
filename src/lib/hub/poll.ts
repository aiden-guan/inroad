import "server-only";
import { createHash } from "node:crypto";
import { connectorFor } from "@/lib/connectors";
import { BOOKING_IDS, CONNECTORS, CRM_IDS, SEQUENCER_IDS, isBooking, type BookingId, type CrmId, type SequencerId } from "@/lib/connectors/catalog";
import type { ConnectorConfig, ConnectorError, CrmChanges, PollCursor } from "@/lib/connectors/types";
import { closeDatePushed } from "@/lib/deals/rules";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Stage, type Workspace } from "@/lib/domain/types";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { receivePolled } from "./inbound";
import { companyDomainOf, ensureAccount, ensurePerson, normalizeDomain } from "./records";
import { mutateHub, readHub, type HubState } from "./store";

/**
 * Polling fallback for a local app that no webhook can reach. Zero tokens: plain HTTP reads, then
 * the same code paths a webhook takes.
 *
 * - Sequencers (Instantly, Smartlead, lemlist): replies with the vendor's interest labels, bounces and
 *   unsubscribes, shaped like the vendor's webhook payload and handed to the inbound parser, so a
 *   reply becomes the same activity, reply move, suppression and Slack alert, deduplicated on the
 *   same external ids. Polled when there's no public URL, or when the tool hasn't delivered a
 *   webhook in a day (a quick-tunnel URL changes on every restart, so registered webhooks go stale).
 * - Booking tools connected with a key (Calendly, Cal.com): new, moved and canceled bookings, shaped
 *   like their webhook payloads, on the same rule as sequencers (no public URL, or webhooks gone quiet).
 *   Calendly sends webhooks only on paid plans, so for most founders this is how bookings arrive.
 * - CRMs (HubSpot, Attio): always polled, since HubSpot Service Keys get no webhooks. Ownership rule
 *   (research 07): the CRM owns contacts and deals. So people at companies already here get empty
 *   fields filled; new CRM companies are noted as known, never made prospects; a mirrored deal takes
 *   the CRM's amount and close date; a stage that differs becomes a question for the founder,
 *   because Inroad never changes a stage by itself.
 *
 * Runs while the app is open (client timer, POST /api/integrations/poll) and before Today prepares.
 * Each connector keeps its own cursor and cadence in hub.json; one poll runs at a time.
 */

type PolledId = SequencerId | CrmId | BookingId;

/** Minimum gap between polls, from the rate limits in research 06. */
const EVERY_MS: Record<PolledId, number> = {
  // /emails allows 20 requests a minute; a poll makes 2–4 calls.
  instantly: 2 * 60_000,
  // 60 requests a minute on Standard; a poll makes up to ~20 calls spaced a second apart.
  smartlead: 5 * 60_000,
  // 20 requests per 2 seconds; a poll makes 7–14 calls.
  lemlist: 3 * 60_000,
  // Search allows 5 a second; a poll makes 3 searches. Research 07: every 5–15 minutes.
  hubspot: 5 * 60_000,
  attio: 5 * 60_000,
  // A poll makes 1–21 calls (Calendly reads each changed booking's invitees); Cal.com allows 120 a minute.
  calendly: 5 * 60_000,
  calcom: 5 * 60_000,
};
const BACKOFF_MS: Partial<Record<ConnectorError["code"], number>> = { rate_limited: 10 * 60_000, auth: 30 * 60_000, forbidden: 30 * 60_000, plan: 6 * 60 * 60_000 };
const DEFAULT_BACKOFF_MS = 5 * 60_000;
const WEBHOOK_FRESH_MS = 24 * 60 * 60_000;
const CRM_STAGE_RULE = "poll.crm_stage";

export interface PollResult {
  id: PolledId;
  ok: boolean;
  /** Something new reached the workspace. */
  changed: boolean;
  summary?: string;
}

type PollEntry = NonNullable<HubState["poll"]>[string];

function publicUrl(ws: Workspace): string {
  const v = ws.integrations.webhook_in?.config.publicUrl;
  return typeof v === "string" ? v : "";
}

/** Did this tool push a webhook to us recently? Then its webhooks work and polling would only repeat them. */
function webhooksArrive(hub: HubState, source: string, now: number): boolean {
  return hub.inbound.some((e) => e.source === source && !e.via && now - Date.parse(e.at) < WEBHOOK_FRESH_MS);
}

/** Which connectors are due now. `force` ignores the cadence but never a back-off. */
export function dueConnectors(ws: Workspace, hub: HubState, now: number, force = false): PolledId[] {
  const out: PolledId[] = [];
  const due = (id: PolledId) => {
    const st = hub.poll?.[id];
    if (st?.nextAt && Date.parse(st.nextAt) > now) return false;
    return force || !st?.lastAt || now - Date.parse(st.lastAt) >= EVERY_MS[id];
  };
  for (const id of [...SEQUENCER_IDS, ...BOOKING_IDS]) {
    if (!ws.integrations[id]?.enabled || EVERY_MS[id] === Infinity) continue;
    if (publicUrl(ws) && webhooksArrive(hub, id, now)) continue;
    if (due(id)) out.push(id);
  }
  for (const id of CRM_IDS) if (ws.integrations[id]?.enabled && due(id)) out.push(id);
  return out;
}

let running: Promise<PollResult[]> | null = null;

/** Polls every connector that's due. Concurrent callers share the one run in flight. */
export function pollConnectors(opts: { force?: boolean } = {}): Promise<PollResult[]> {
  running ??= pollDue(opts).finally(() => {
    running = null;
  });
  return running;
}

async function pollDue({ force = false }: { force?: boolean }): Promise<PollResult[]> {
  const ws = readWorkspace();
  if (ws.sample) return [];
  const ids = dueConnectors(ws, readHub(), Date.now(), force);
  const out: PollResult[] = [];
  for (const id of ids) {
    try {
      out.push(CRM_IDS.includes(id as CrmId) ? await pollCrm(id as CrmId) : await pollSequencer(id as SequencerId | BookingId));
    } catch (err) {
      console.error("[poll]", id, err);
      await record(id, { ok: false, message: err instanceof Error ? err.message : "Polling failed." });
      out.push({ id, ok: false, changed: false });
    }
  }
  return out;
}

async function record(id: PolledId, r: { ok: true; cursor: PollCursor; summary?: string } | { ok: false; message: string; code?: ConnectorError["code"] }) {
  const at = nowISO();
  await mutateHub((hub) => {
    const prev: PollEntry = hub.poll?.[id] ?? { cursor: {} };
    hub.poll = {
      ...hub.poll,
      [id]: r.ok
        ? { cursor: r.cursor, lastAt: at, ...(r.summary ? { lastSummary: r.summary } : prev.lastSummary ? { lastSummary: prev.lastSummary } : {}) }
        : { ...prev, lastAt: at, lastError: r.message, nextAt: new Date(Date.now() + (BACKOFF_MS[r.code ?? "upstream"] ?? DEFAULT_BACKOFF_MS)).toISOString() },
    };
  });
  // A key that stopped working needs the founder; a rate limit or an outage doesn't.
  if (!r.ok && (r.code === "auth" || r.code === "forbidden" || r.code === "plan")) {
    await mutateWorkspace((ws) => {
      const st = ws.integrations[id];
      if (st) st.lastError = { at, message: r.message };
    });
  }
}

const batchKey = (events: unknown[]) => `poll:${createHash("sha256").update(JSON.stringify(events)).digest("hex").slice(0, 32)}`;

/** Sequencers and booking tools: their own change feed, through the webhook parser. */
async function pollSequencer(id: SequencerId | BookingId): Promise<PollResult> {
  const c = connectorFor(id);
  const poll = isBooking(id) ? c?.booking?.pollEvents : c?.sequencer?.pollEvents;
  if (!poll) return { id, ok: true, changed: false };
  const r = await poll(readHub().poll?.[id]?.cursor ?? {});
  if (!r.ok) {
    await record(id, { ok: false, message: r.error.message, code: r.error.code });
    return { id, ok: false, changed: false, summary: r.error.message };
  }
  const entry = r.value.events.length ? await receivePolled(id, r.value.events, batchKey(r.value.events)) : null;
  await record(id, { ok: true, cursor: r.value.cursor, summary: entry?.summary });
  if (r.value.warnings?.length) console.warn(`[poll] ${id}:`, r.value.warnings.join(" "));
  return { id, ok: true, changed: Boolean(entry), summary: entry?.summary };
}

/* ───────────── CRMs ───────────── */

/** Our stage → the CRM stage id the founder mapped (same fallback as write-back: nurture → lost). */
function mappedStage(cfg: ConnectorConfig, stage: Stage): string | undefined {
  const v = cfg[stage === "nurture" && !cfg.stage_nurture ? "stage_lost" : `stage_${stage}`];
  return typeof v === "string" && v ? v : undefined;
}

const STAGE_ORDER: Stage[] = ["talking", "qualified", "pilot", "proposal", "won", "lost", "nurture"];

/** The CRM's external deal id → our deal id, from the write-back ledger and the deal itself. */
function mirroredDeals(id: CrmId, ws: Workspace, hub: HubState): Map<string, string> {
  const out = new Map<string, string>();
  const prefix = `${id}:deal:`;
  for (const [key, ref] of Object.entries(hub.refs)) {
    if (!key.startsWith(prefix) || ref.id.startsWith("note:")) continue;
    const ours = Object.values(ws.deals).find((d) => d.id.toLowerCase() === key.slice(prefix.length));
    if (ours) out.set(ref.id, ours.id);
  }
  for (const d of Object.values(ws.deals)) {
    const ext = d.external?.find((e) => e.integrationId === id)?.externalId;
    if (ext && !ext.startsWith("note:")) out.set(ext, d.id);
  }
  return out;
}

interface CrmApplied {
  people: number;
  companies: number;
  deals: number;
  questions: number;
  known: string[];
  seen: string[];
}

function applyCrm(ws: Workspace, id: CrmId, ch: CrmChanges, mirrored: Map<string, string>, seen: Record<string, string>, at: string): CrmApplied {
  const name = CONNECTORS[id].name;
  const out: CrmApplied = { people: 0, companies: 0, deals: 0, questions: 0, known: [], seen: [] };
  const meta = { source: "integration" as const, sourceDetail: `${name} sync`, at };

  for (const c of ch.companies) {
    const domain = normalizeDomain(c.domain);
    if (!domain) continue;
    const acc = ws.accounts[domain];
    if (!acc) {
      // Customers, partners and lost deals as often as prospects: noted, never suggested.
      out.known.push(domain);
      continue;
    }
    const before = `${acc.name}|${acc.hqCity ?? ""}`;
    ensureAccount(ws, { domain, name: c.name, city: c.city }, meta);
    if (`${acc.name}|${acc.hqCity ?? ""}` !== before) out.companies++;
  }

  for (const p of ch.people) {
    const email = p.email.trim().toLowerCase();
    const domain = companyDomainOf(email);
    // Only people at companies the founder already has; the CRM's whole contact list isn't a lead list.
    if (!domain || !ws.accounts[domain]) continue;
    const existing = Object.values(ws.people).find((x) => x.email?.toLowerCase() === email);
    const before = existing ? JSON.stringify([existing.name, existing.title, existing.email, existing.contactPaths.length]) : null;
    const { person, created } = ensurePerson(ws, { domain, email, name: p.name, title: p.title }, { via: name, source: "integration" });
    if (created || JSON.stringify([person.name, person.title, person.email, person.contactPaths.length]) !== before) out.people++;
  }

  const cfg = ws.integrations[id]?.config ?? {};
  for (const d of ch.deals) {
    const ourId = mirrored.get(d.externalId);
    const deal = ourId ? ws.deals[ourId] : undefined;
    if (!deal) continue;
    let touched = false;
    if (d.amountUsd !== undefined && d.amountUsd !== deal.amountUsd) {
      deal.amountUsd = d.amountUsd;
      touched = true;
    }
    if (d.closeDate && d.closeDate !== deal.closeDate) {
      if (closeDatePushed(deal.closeDate, d.closeDate)) deal.closeDatePushes = (deal.closeDatePushes ?? 0) + 1;
      deal.closeDate = d.closeDate;
      touched = true;
    }
    if (touched) {
      deal.updatedAt = at;
      out.deals++;
    }

    if (!d.stageId || mappedStage(cfg, deal.stage) === d.stageId) continue;
    const theirs = STAGE_ORDER.find((s) => mappedStage(cfg, s) === d.stageId);
    if (!theirs) continue;
    // Asked once per CRM stage: a skipped question doesn't come back every poll.
    const key = `crmstage:${id}:${d.externalId}:${d.stageId}`;
    if (seen[key]) continue;
    out.seen.push(key);
    const open = Object.values(ws.moves).find((m) => m.status === "open" && m.rule === CRM_STAGE_RULE && m.ref?.kind === "deal" && m.ref.id === deal.id);
    const title = `Move ${deal.name} to ${STAGE_LABELS[theirs]}?`;
    const why = `${name} has it at ${STAGE_LABELS[theirs]}; here it's still ${STAGE_LABELS[deal.stage]}`;
    if (open) Object.assign(open, { title, why });
    else {
      const moveId = newId("mov");
      ws.moves[moveId] = {
        id: moveId,
        createdAt: at,
        dueOn: todayISO(),
        kind: "question",
        title,
        why,
        minutes: 1,
        ref: { kind: "deal", id: deal.id },
        evidenceIds: [],
        priority: 70,
        rule: CRM_STAGE_RULE,
        status: "open",
        href: `/companies?c=${encodeURIComponent(deal.accountDomain)}`,
      };
    }
    out.questions++;
  }
  return out;
}

function crmSummary(name: string, a: CrmApplied): string | undefined {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (a.people) parts.push(plural(a.people, "person", "people"));
  if (a.companies) parts.push(plural(a.companies, "company", "companies"));
  if (a.deals) parts.push(plural(a.deals, "deal amount or date", "deal amounts or dates"));
  if (a.questions) parts.push(plural(a.questions, "stage to confirm", "stages to confirm"));
  if (a.known.length) parts.push(`${plural(a.known.length, "company", "companies")} noted as known`);
  return parts.length ? `Read from ${name}: ${parts.join(", ")}.` : undefined;
}

async function pollCrm(id: CrmId): Promise<PollResult> {
  const pull = connectorFor(id)?.crm?.pullChanges;
  if (!pull) return { id, ok: true, changed: false };
  const hub = readHub();
  const mirrored = mirroredDeals(id, readWorkspace(), hub);
  const r = await pull(hub.poll?.[id]?.cursor ?? {}, [...mirrored.keys()]);
  if (!r.ok) {
    await record(id, { ok: false, message: r.error.message, code: r.error.code });
    return { id, ok: false, changed: false, summary: r.error.message };
  }
  const at = nowISO();
  const { value: applied } = await mutateWorkspace((ws) => {
    const a = applyCrm(ws, id, r.value, mirrored, hub.seen, at);
    const st = ws.integrations[id];
    const pulled = a.people + a.companies + a.deals;
    if (st) {
      st.lastSyncAt = at;
      if (pulled) st.stats = { pushed: st.stats?.pushed ?? 0, pulled: (st.stats?.pulled ?? 0) + pulled };
    }
    return a;
  });
  const summary = crmSummary(CONNECTORS[id].name, applied);
  await mutateHub((h) => {
    for (const k of applied.seen) h.seen[k] = at;
    const fresh = applied.known.filter((d) => !h.known?.[d]);
    if (fresh.length) h.known = { ...(h.known ?? {}), ...Object.fromEntries(fresh.map((d) => [d, id])) };
    if (summary) h.sync.unshift({ id: newId("syn"), integrationId: id, at, ok: true, message: summary });
  });
  await record(id, { ok: true, cursor: r.value.cursor, summary });
  if (r.value.warnings?.length) console.warn(`[poll] ${id}:`, r.value.warnings.join(" "));
  const changed = Boolean(applied.people || applied.companies || applied.deals || applied.questions);
  return { id, ok: true, changed, summary };
}
