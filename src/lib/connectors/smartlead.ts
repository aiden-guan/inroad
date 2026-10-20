import "server-only";
import { request, splitName } from "./http";
import { fail, ok, type Campaign, type Connector, type ConnectorFactory } from "./types";

/**
 * Smartlead (API key in the query string, so every message is redacted).
 * Campaign list comes back as a bare array or `{ campaigns }` depending on the doc you read; we parse both.
 * Template tokens are case-sensitive: {{inroad_subject}}, {{inroad_body}}, {{inroad_first_line}}.
 */

const BASE = "https://server.smartlead.ai/api/v1";
const TOOL = "Smartlead";

type RawCampaign = { id: number | string; name: string; status?: string };

const STATUS: Record<string, Campaign["status"]> = { ACTIVE: "active", PAUSED: "paused", STOPPED: "completed", ARCHIVED: "completed", DRAFTED: "draft", COMPLETED: "completed" };

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
    },
  };
  return connector;
};
