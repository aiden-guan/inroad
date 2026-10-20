import "server-only";
import { connectorFor } from "@/lib/connectors";
import { CONNECTORS, CRM_IDS, type CrmId } from "@/lib/connectors/catalog";
import { fail, ok, type ConnectorConfig, type CrmAdapter, type ExternalRef, type Result } from "@/lib/connectors/types";
import { newId, nowISO } from "@/lib/domain/ids";
import { OPEN_STAGES, STAGE_LABELS, type Deal, type Stage, type Workspace } from "@/lib/domain/types";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { normalizeDomain } from "./records";
import { suggestStageMap } from "./stage-map";
import { mutateHub, readHub, refKey } from "./store";

/**
 * CRM write-back. Ownership rule (research 07): the CRM owns contacts and deals; we own ICP,
 * playbook, drafts and next actions. So we only ever create or update the deal, its company and
 * its contacts, and only when the founder turned write-back on. Never deletes. Zero tokens.
 */

export interface SyncOutcome {
  integrationId: CrmId;
  ok: boolean;
  message: string;
  externalId?: string;
}

// Deal syncs run one at a time so "create" then "move stage" in one batch can't create two deals.
// A sync reads the latest deal when it starts, so a second request queued behind it is redundant.
let queue: Promise<unknown> = Promise.resolve();
const waiting = new Map<string, Promise<SyncOutcome[]>>();

export function queueDealSync(dealId: string, opts: { force?: boolean; only?: CrmId } = {}): Promise<SyncOutcome[]> {
  const key = `${dealId}|${opts.only ?? "*"}|${opts.force ? 1 : 0}`;
  const queued = waiting.get(key);
  if (queued) return queued;
  const run = queue.then(() => {
    waiting.delete(key);
    return syncDeal(dealId, opts);
  });
  waiting.set(key, run);
  queue = run.catch(() => undefined);
  return run;
}

async function logSync(integrationId: string, okFlag: boolean, message: string) {
  await mutateHub((hub) => {
    hub.sync.unshift({ id: newId("syn"), integrationId, at: nowISO(), ok: okFlag, message });
  });
}

async function markIntegration(id: CrmId, outcome: { ok: boolean; message: string; pushed?: number; pulled?: number }) {
  await mutateWorkspace((ws) => {
    const st = ws.integrations[id];
    if (!st) return;
    const at = nowISO();
    if (outcome.ok) {
      st.lastSyncAt = at;
      delete st.lastError;
      st.stats = { pushed: (st.stats?.pushed ?? 0) + (outcome.pushed ?? 0), pulled: (st.stats?.pulled ?? 0) + (outcome.pulled ?? 0) };
    } else {
      st.lastError = { at, message: outcome.message };
    }
  });
}

async function resolveStage(crm: CrmAdapter, cfg: ConnectorConfig, stage: Stage): Promise<Result<{ stageId?: string; pipelineId?: string }>> {
  const key = stage === "nurture" && !cfg.stage_nurture ? "stage_lost" : `stage_${stage}`;
  const pipelineId = typeof cfg.pipelineId === "string" && cfg.pipelineId ? cfg.pipelineId : undefined;
  const mapped = cfg[key];
  if (typeof mapped === "string" && mapped) return ok({ stageId: mapped, pipelineId });
  const pipes = await crm.listPipelines();
  if (!pipes.ok) return pipes;
  const pipeline = pipes.value.find((p) => p.id === pipelineId) ?? pipes.value[0];
  if (!pipeline) return ok({});
  return ok({ stageId: suggestStageMap(pipeline)[stage], pipelineId: pipeline.id === "deals" ? undefined : pipeline.id });
}

function contactsFor(ws: Workspace, deal: Deal) {
  const ids = deal.contacts.map((c) => c.personId);
  // A deal often starts before contacts are attached; fall back to known people at the account.
  const fallback = ws.accounts[deal.accountDomain]?.peopleIds ?? [];
  return [...new Set([...ids, ...fallback])]
    .map((id) => ws.people[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.email && !p.doNotContact))
    .slice(0, deal.contacts.length ? 5 : 2);
}

async function syncOne(id: CrmId, crm: CrmAdapter, cfg: ConnectorConfig, ws: Workspace, deal: Deal): Promise<SyncOutcome> {
  const name = CONNECTORS[id].name;
  const hub = readHub();
  const refs: Record<string, ExternalRef> = {};
  const account = ws.accounts[deal.accountDomain];

  const companyKey = refKey(id, "company", deal.accountDomain);
  const company = await crm.upsertCompany({ domain: deal.accountDomain, name: account?.name, city: account?.hqCity }, hub.refs[companyKey]?.id);
  if (!company.ok) return { integrationId: id, ok: false, message: company.error.message };
  refs[companyKey] = company.value;

  const people: ExternalRef[] = [];
  for (const p of contactsFor(ws, deal)) {
    const key = refKey(id, "person", p.email!);
    const r = await crm.upsertPerson({ email: p.email!, name: p.name, title: p.title, linkedinUrl: p.linkedinUrl }, company.value, hub.refs[key]?.id);
    if (r.ok) {
      people.push(r.value);
      refs[key] = r.value;
    }
  }

  const stage = await resolveStage(crm, cfg, deal.stage);
  if (!stage.ok) return { integrationId: id, ok: false, message: stage.error.message };

  const dealKey = refKey(id, "deal", deal.id);
  const known = hub.refs[dealKey]?.id ?? deal.external?.find((e) => e.integrationId === id)?.externalId;
  const r = await crm.upsertDeal(
    { name: deal.name, stageId: stage.value.stageId, pipelineId: stage.value.pipelineId, amountUsd: deal.amountUsd, closeDate: deal.closeDate },
    company.value,
    people,
    known?.startsWith("note:") ? undefined : known,
  );
  if (!r.ok) return { integrationId: id, ok: false, message: r.error.message };
  refs[dealKey] = r.value;

  const at = nowISO();
  await mutateHub((h) => {
    for (const [k, v] of Object.entries(refs)) h.refs[k] = { id: v.externalId, ...(v.url ? { url: v.url } : {}), at };
  });
  await mutateWorkspace((w) => {
    const d = w.deals[deal.id];
    if (!d) return;
    d.external = [...(d.external ?? []).filter((e) => e.integrationId !== id), { integrationId: id, externalId: r.value.externalId }];
  });
  const note = r.warnings?.[0] ? ` ${r.warnings[0]}` : "";
  return { integrationId: id, ok: true, externalId: r.value.externalId, message: `${deal.name} is at ${STAGE_LABELS[deal.stage]} in ${name}.${note}` };
}

async function syncDeal(dealId: string, opts: { force?: boolean; only?: CrmId }): Promise<SyncOutcome[]> {
  const ws = readWorkspace();
  const deal = ws.deals[dealId];
  if (!deal) return [];
  const out: SyncOutcome[] = [];
  for (const id of CRM_IDS) {
    if (opts.only && id !== opts.only) continue;
    const state = ws.integrations[id];
    if (!state?.enabled || (!opts.force && state.config.writeBack !== true)) continue;
    const crm = connectorFor(id, ws)?.crm;
    if (!crm) continue;
    let outcome: SyncOutcome;
    try {
      outcome = await syncOne(id, crm, state.config, ws, deal);
    } catch (err) {
      outcome = { integrationId: id, ok: false, message: err instanceof Error ? err.message : "Sync failed." };
    }
    out.push(outcome);
    await logSync(id, outcome.ok, outcome.message);
    await markIntegration(id, { ok: outcome.ok, message: outcome.message, pushed: outcome.ok ? 1 : 0 });
  }
  return out;
}

/** Deals worth mirroring on first connect: open ones and wins. */
export function syncableDeals(ws: Workspace): Deal[] {
  return Object.values(ws.deals).filter((d) => OPEN_STAGES.includes(d.stage) || d.stage === "won");
}

/** "Push deals now": every open or won deal, one at a time, regardless of the write-back toggle. */
export async function pushOpenDeals(id: CrmId): Promise<{ pushed: number; failed: number; firstError?: string }> {
  const open = syncableDeals(readWorkspace()).slice(0, 100);
  let pushed = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const d of open) {
    const [r] = await queueDealSync(d.id, { force: true, only: id });
    if (!r) continue;
    if (r.ok) pushed++;
    else {
      failed++;
      firstError ??= r.message;
      if (failed >= 3 && pushed === 0) break; // same error every time: stop hammering their API
    }
  }
  return { pushed, failed, firstError };
}

/**
 * Notes the CRM's recently updated companies as known, so discovery never suggests them. They are
 * customers, partners, vendors and lost deals as often as prospects, so they don't become prospect
 * rows (no moves, no scoring, no tokens). Companies already here only get empty fields filled.
 */
export async function importCompanies(id: CrmId): Promise<Result<{ added: number; existing: number; message: string }>> {
  const crm = connectorFor(id)?.crm;
  if (!crm) return fail("auth", `${CONNECTORS[id].name} isn't connected.`);
  const r = await crm.pullCompanies(200);
  if (!r.ok) {
    await logSync(id, false, r.error.message);
    await markIntegration(id, { ok: false, message: r.error.message });
    return r;
  }
  const name = CONNECTORS[id].name;
  const pulled = new Map<string, { name?: string; city?: string }>();
  for (const c of r.value) {
    const domain = normalizeDomain(c.domain);
    if (domain && !pulled.has(domain)) pulled.set(domain, c);
  }
  const { value: fresh } = await mutateWorkspace((ws) => {
    const out: string[] = [];
    for (const [domain, c] of pulled) {
      const acc = ws.accounts[domain];
      if (!acc) {
        out.push(domain);
        continue;
      }
      if (!acc.name && c.name) acc.name = c.name;
      if (!acc.hqCity && c.city) acc.hqCity = c.city;
    }
    return out;
  });
  await mutateHub((h) => {
    h.known = { ...(h.known ?? {}), ...Object.fromEntries(fresh.map((d) => [d, id])) };
  });
  const added = fresh.length;
  const existing = pulled.size - added;
  const message = added
    ? `Noted ${added} compan${added === 1 ? "y" : "ies"} from ${name} so I won't suggest them${existing ? `; ${existing} ${existing === 1 ? "was" : "were"} already here` : ""}.`
    : existing
      ? `All ${existing} ${name} compan${existing === 1 ? "y was" : "ies were"} already here.`
      : `${name} has no companies with a domain yet.`;
  await logSync(id, true, message);
  await markIntegration(id, { ok: true, message, pulled: added });
  return ok({ added, existing, message });
}
