import "server-only";
import { request, splitName } from "./http";
import { fail, ok, type Campaign, type Connector, type ConnectorFactory, type PollCursor, type SequencerPoll } from "./types";

/**
 * Smartlead (API key in the query string, so every message is redacted).
 * Campaign list comes back as a bare array or `{ campaigns }` depending on the doc you read; we parse both.
 * Template tokens are case-sensitive: {{inroad_subject}}, {{inroad_body}}, {{inroad_first_line}}.
 *
 * Polling (no public URL): `GET /campaigns/{id}/leads` filtered by `emailStatus` and `event_time_gt`
 * returns the leads that replied, bounced or unsubscribed since the last poll, with their category
 * id; `GET /leads/fetch-categories` names the ids. The lead listing has no reply text or reply id,
 * so a polled reply is one per lead per campaign. Standard plans allow 60 requests a minute, so a
 * poll spaces its calls a second apart and reads at most a few campaigns.
 */

const BASE = "https://server.smartlead.ai/api/v1";
const TOOL = "Smartlead";

type RawCampaign = { id: number | string; name: string; status?: string };

const STATUS: Record<string, Campaign["status"]> = { ACTIVE: "active", PAUSED: "paused", STOPPED: "completed", ARCHIVED: "completed", DRAFTED: "draft", COMPLETED: "completed" };

type RawLead = {
  campaign_lead_map_id?: number | string;
  lead_category_id?: number | null;
  lead?: { id?: number | string; first_name?: string | null; last_name?: string | null; email?: string | null; is_unsubscribed?: boolean | null };
};

const POLL_CAMPAIGNS = 6;
const POLL_PAGES = 2;
const SPACING_MS = 1100;
const FIRST_LOOKBACK_MS = 2 * 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const smartlead: ConnectorFactory = (key) => {
  const withKey = (path: string) => `${BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`;
  const call = <T>(method: "GET" | "POST", path: string, body?: unknown) => request<T>({ tool: TOOL, method, url: withKey(path), body, secrets: [key] });

  async function campaigns() {
    const r = await call<RawCampaign[] | { campaigns?: RawCampaign[] }>("GET", "/campaigns/?include_tags=false");
    if (!r.ok) return r;
    const list = Array.isArray(r.value) ? r.value : (r.value?.campaigns ?? []);
    return ok(list.map((c): Campaign => ({ id: String(c.id), name: c.name, status: STATUS[(c.status ?? "").toUpperCase()] ?? "other" })));
  }

  const connector: Connector = {
    id: "smartlead",
    name: TOOL,

    async validate() {
      const r = await campaigns();
      if (!r.ok) return r;
      const n = r.value.length;
      return ok({ accountLabel: `${n} campaign${n === 1 ? "" : "s"}` });
    },

    sequencer: {
      listCampaigns: campaigns,

      async pushLead(campaignId, lead) {
        const { first, last } = lead.firstName ? { first: lead.firstName, last: lead.lastName ?? "" } : splitName(lead.name);
        const r = await call<{ added_count?: number; skipped_count?: number; skipped_leads?: unknown[] }>("POST", `/campaigns/${encodeURIComponent(campaignId)}/leads`, {
          lead_list: [
            {
              email: lead.email,
              ...(first ? { first_name: first } : {}),
              ...(last ? { last_name: last } : {}),
              ...(lead.companyName ? { company_name: lead.companyName } : {}),
              ...(lead.website ? { website: lead.website } : {}),
              ...(lead.linkedinUrl ? { linkedin_profile: lead.linkedinUrl } : {}),
              custom_fields: { ...lead.vars, ...(lead.firstLine ? { first_line: lead.firstLine } : {}) },
            },
          ],
          settings: {
            ignore_global_block_list: false,
            ignore_unsubscribe_list: false,
            ignore_duplicate_leads_in_other_campaign: false,
            ignore_community_bounce_list: false,
          },
        });
        if (!r.ok) return r;
        if ((r.value?.added_count ?? 0) > 0) return ok({});
        return fail("conflict", `Smartlead skipped ${lead.email}: it's already in a campaign, unsubscribed or on a block list.`, 409);
      },

      async pollEvents(cursor: PollCursor) {
        const startedAt = new Date().toISOString();
        const since = cursor.since ?? new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString();
        const warnings: string[] = [];
        const events: SequencerPoll["events"] = [];

        const cats = await call<{ id: number; name: string }[]>("GET", "/leads/fetch-categories");
        if (!cats.ok) return cats;
        const catName = new Map((Array.isArray(cats.value) ? cats.value : []).map((c) => [c.id, c.name]));
        const list = await campaigns();
        if (!list.ok) return list;
        const rank = { active: 0, paused: 1, completed: 2, other: 3, draft: 4 } as const;
        const live = list.value.filter((c) => c.status !== "draft").sort((a, b) => rank[a.status] - rank[b.status]);
        const picked = live.slice(0, POLL_CAMPAIGNS);
        if (live.length > picked.length) warnings.push(`Read the ${picked.length} most active of ${live.length} campaigns.`);

        const leads = async (campaignId: string, emailStatus: string) => {
          const out: RawLead[] = [];
          for (let page = 0; page < POLL_PAGES; page++) {
            await sleep(SPACING_MS);
            const q = new URLSearchParams({ limit: "100", offset: String(page * 100), emailStatus, event_time_gt: since });
            const r = await call<{ data?: RawLead[] }>("GET", `/campaigns/${encodeURIComponent(campaignId)}/leads?${q}`);
            if (!r.ok) return page ? ok(out) : r;
            const data = r.value?.data ?? [];
            out.push(...data);
            if (data.length < 100) break;
          }
          return ok(out);
        };

        for (const c of picked) {
          for (const status of ["is_replied", "is_bounced", "is_unsubscribed"] as const) {
            const r = await leads(c.id, status);
            if (!r.ok) {
              if (r.error.code === "auth") return r;
              warnings.push(`${c.name}: ${r.error.message}`);
              continue;
            }
            for (const row of r.value) {
              const l = row.lead ?? {};
              if (!l.email) continue;
              const key = String(row.campaign_lead_map_id ?? `${c.id}:${l.id}`);
              const base = { lead_email: l.email, lead: { first_name: l.first_name ?? undefined, last_name: l.last_name ?? undefined, email: l.email } };
              const category = row.lead_category_id ? catName.get(row.lead_category_id) : undefined;
              const bounced = status === "is_bounced" || (category !== undefined && /bounce/i.test(category));
              if (bounced) {
                events.push({ ...base, event_type: "EMAIL_BOUNCE", id: `bounce:${key}` });
                continue;
              }
              if (status === "is_replied") {
                events.push({ ...base, event_type: "EMAIL_REPLY", id: `reply:${key}` });
                // Categories change after the reply, so each one is its own label event.
                if (category) events.push({ ...base, event_type: "LEAD_CATEGORY_UPDATED", lead_category: { new_name: category }, id: `cat:${key}:${row.lead_category_id}` });
              }
              if (status === "is_unsubscribed" || l.is_unsubscribed) events.push({ ...base, event_type: "LEAD_UNSUBSCRIBED", id: `unsub:${l.id ?? key}` });
            }
          }
        }
        // Overlap a few minutes: event times are recorded as the send/reply happens, not when it's listed.
        const next = new Date(Date.parse(startedAt) - 5 * 60_000).toISOString();
        return ok({ events, cursor: { since: next > since ? next : since }, ...(warnings.length ? { warnings } : {}) });
      },
    },
  };
  return connector;
};
