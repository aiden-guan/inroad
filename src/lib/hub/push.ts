import "server-only";
import { connectorFor } from "@/lib/connectors";
import { CONNECTORS, SEQUENCER_IDS, type SequencerId } from "@/lib/connectors/catalog";
import type { Campaign, Result } from "@/lib/connectors/types";
import { ActionError } from "@/lib/domain/actions";
import { newId, nowISO } from "@/lib/domain/ids";
import type { DraftStep, Workspace } from "@/lib/domain/types";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { isSuppressed } from "./records";
import { mutateHub } from "./store";

/**
 * Pushes an approved draft into the founder's own sequencer campaign: the lead plus the copy as
 * custom variables. The sequencer sends; we never do. Zero tokens: the draft was written once.
 */

export class PushError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* Campaign lists change rarely; a short cache keeps the composer's picker instant. */
const campaignCache = new Map<SequencerId, { at: number; campaigns: Campaign[] }>();
const CAMPAIGN_TTL = 2 * 60_000;

export async function listCampaigns(id: SequencerId, fresh = false): Promise<Result<Campaign[]>> {
  const hit = campaignCache.get(id);
  if (!fresh && hit && Date.now() - hit.at < CAMPAIGN_TTL) return { ok: true, value: hit.campaigns };
  const seq = connectorFor(id)?.sequencer;
  if (!seq) return { ok: false, error: { code: "auth", message: `${CONNECTORS[id].name} isn't connected.` } };
  const r = await seq.listCampaigns();
  if (r.ok) campaignCache.set(id, { at: Date.now(), campaigns: r.value });
  return r;
}

/** After a key change or disconnect the cached list may belong to another workspace. */
export function forgetCampaigns(id: string) {
  campaignCache.delete(id as SequencerId);
}

export function connectedSequencers(ws: Workspace): SequencerId[] {
  return SEQUENCER_IDS.filter((id) => ws.integrations[id]?.enabled);
}

/** Which sequencer to use when the caller didn't say: the only one, else the one with a default campaign, else the latest connected. */
function pickSequencer(ws: Workspace, requested?: string): SequencerId {
  const connected = connectedSequencers(ws);
  if (requested) {
    const id = connected.find((x) => x === requested);
    if (!id) throw new PushError(`${CONNECTORS[requested as SequencerId]?.name ?? requested} isn't connected. Connect it on the Integrations page.`, 412);
    return id;
  }
  if (!connected.length) throw new PushError("No sequencer is connected. Connect Instantly, Smartlead or lemlist on the Integrations page.", 412);
  const withDefault = connected.filter((id) => ws.integrations[id]?.config.defaultCampaignId);
  const pool = withDefault.length ? withDefault : connected;
  return [...pool].sort((a, b) => (ws.integrations[b]?.connectedAt ?? "").localeCompare(ws.integrations[a]?.connectedAt ?? ""))[0];
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Sequencer editors are HTML; plain newlines collapse, so bodies travel as escaped text with <br>.
const asHtml = (s: string) => escapeHtml(s.trim()).replace(/\r?\n/g, "<br>");

function firstLine(body: string): string {
  const line = body.trim().split(/\n+/).find((l) => l.trim() && !/^(hi|hey|hello)\b[^.!?]*,?$/i.test(l.trim())) ?? "";
  const sentence = line.match(/^.*?[.!?](\s|$)/)?.[0] ?? line;
  return sentence.trim().slice(0, 300);
}

// Only the pushed step travels. Follow-ups are drafted here when due and approved one by one, and
// a lead's variables are never refreshed after the push, so per-step variables would go out empty.
export function templateVars(step: DraftStep): Record<string, string> {
  return {
    inroad_subject: step.subject ?? "",
    inroad_body: asHtml(step.body),
    inroad_first_line: firstLine(step.body),
  };
}

export interface PushInput {
  packageId: string;
  step: number;
  integrationId?: string;
  campaignId?: string;
}

export async function pushDraft(input: PushInput): Promise<{ integrationId: SequencerId; campaignId: string; campaignName?: string; externalId?: string }> {
  const ws = readWorkspace();
  const pkg = ws.outreach[input.packageId];
  if (!pkg) throw new ActionError("That draft no longer exists.");
  const step = pkg.steps.find((s) => s.step === input.step);
  if (!step) throw new ActionError(`Step ${input.step} isn't part of that draft.`);
  if (step.status === "skipped" || step.status === "cancelled_by_reply") throw new PushError("That step was skipped or cancelled by a reply, so I won't push it.", 409);
  if (pkg.mode === "linkedin") throw new PushError("LinkedIn drafts can't go into an email sequencer.", 400);

  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  if (!person) throw new PushError("This draft has no person attached. Sequencers need someone to send to.", 400);
  const email = person.email ?? person.contactPaths.find((c) => !c.bounced && /@/.test(c.value))?.value;
  if (!email) throw new PushError(`I don't have an email for ${person.name}. Add one on the company sheet, then push again.`, 400);
  if (person.doNotContact || isSuppressed(ws, email, pkg.accountDomain)) throw new PushError(`${person.name} is on your do-not-contact list, so I won't push them.`, 409);

  const integrationId = pickSequencer(ws, input.integrationId);
  const state = ws.integrations[integrationId]!;
  const campaignId = input.campaignId ?? (typeof state.config.defaultCampaignId === "string" ? state.config.defaultCampaignId : undefined);
  if (!campaignId) throw new PushError(`Choose which ${CONNECTORS[integrationId].name} campaign approved drafts go to (Integrations → ${CONNECTORS[integrationId].name}).`, 400);

  const seq = connectorFor(integrationId, ws)?.sequencer;
  if (!seq) throw new PushError(`${CONNECTORS[integrationId].name} isn't connected.`, 412);

  const account = ws.accounts[pkg.accountDomain];
  const r = await seq.pushLead(campaignId, {
    email,
    name: person.name,
    title: person.title || undefined,
    linkedinUrl: person.linkedinUrl,
    companyName: account?.name,
    companyDomain: pkg.accountDomain,
    website: `https://${pkg.accountDomain}`,
    firstLine: firstLine(step.body),
    vars: templateVars(step),
  });

  const at = nowISO();
  const name = CONNECTORS[integrationId].name;
  const campaignName =
    campaignCache.get(integrationId)?.campaigns.find((c) => c.id === campaignId)?.name ??
    (state.config.defaultCampaignId === campaignId && typeof state.config.defaultCampaignName === "string" ? state.config.defaultCampaignName : undefined);

  if (!r.ok) {
    await mutateWorkspace((w) => {
      const st = w.integrations[integrationId];
      if (st && r.error.code !== "conflict") st.lastError = { at, message: r.error.message };
    });
    await mutateHub((hub) => {
      hub.sync.unshift({ id: newId("syn"), integrationId, at, ok: false, message: r.error.message });
    });
    throw new PushError(r.error.message, r.error.code === "conflict" ? 409 : r.error.code === "auth" || r.error.code === "forbidden" ? 412 : 502);
  }

  await mutateWorkspace((w) => {
    const p = w.outreach[pkg.id];
    if (p) {
      p.pushedTo = [...(p.pushedTo ?? []), { integrationId, at, ...(r.value.externalId ? { externalId: r.value.externalId } : {}) }];
      // Handed to an outside sender (same as the CSV export): it leaves the approve queue on Today.
      const handed = p.steps.find((x) => x.step === step.step);
      if (handed?.status === "draft") {
        handed.status = "approved";
        handed.sentAt ??= at;
      }
    }
    w.activities.push({
      id: newId("act"),
      at,
      kind: "pushed",
      personId: person.id,
      accountDomain: pkg.accountDomain,
      dealId: w.accounts[pkg.accountDomain]?.dealId,
      channel: "integration",
      draftRef: { packageId: pkg.id, step: step.step },
      angleId: pkg.angleId,
      summary: `Pushed ${step.step === 1 ? "first touch" : `step ${step.step}`} for ${person.name} to ${name}${campaignName ? ` · ${campaignName}` : ""}`,
      source: integrationId,
    });
    const st = w.integrations[integrationId];
    if (st) {
      st.lastSyncAt = at;
      delete st.lastError;
      st.stats = { pushed: (st.stats?.pushed ?? 0) + 1, pulled: st.stats?.pulled ?? 0 };
    }
  });
  await mutateHub((hub) => {
    hub.sync.unshift({ id: newId("syn"), integrationId, at, ok: true, message: `Pushed ${person.name} to ${campaignName ?? "your campaign"}.` });
  });
  return { integrationId, campaignId, campaignName, externalId: r.value.externalId };
}
