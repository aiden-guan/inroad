import "server-only";
import { request, splitName } from "./http";
import { fail, ok, type Campaign, type Connector, type ConnectorFactory } from "./types";

/**
 * Instantly API v2 (Bearer, paid plan; 402 otherwise). Leads go in with `skip_if_in_workspace`
 * so a lead is never added twice. Lead keys are a closed set, so the draft travels in
 * `personalization` and `custom_variables` ({{inroad_subject}}, {{inroad_body}}, …).
 * `GET /workspaces/current` (for the label) is UNVERIFIED and optional.
 */

const BASE = "https://api.instantly.ai/api/v2";
const TOOL = "Instantly";

const STATUS: Record<number, Campaign["status"]> = { 0: "draft", 1: "active", 2: "paused", 3: "completed", 4: "active" };

// Only what the inbound parser uses. `all_events` would POST every send, open and click too.
const REPLY_EVENTS = [
  "reply_received",
  "lead_interested",
  "lead_not_interested",
  "lead_meeting_booked",
  "lead_out_of_office",
  "lead_wrong_person",
  "email_bounced",
  "lead_unsubscribed",
] as const;

export const instantly: ConnectorFactory = (key) => {
  const call = <T>(method: "GET" | "POST", path: string, body?: unknown) =>
    request<T>({ tool: TOOL, method, url: BASE + path, headers: { authorization: `Bearer ${key}` }, body, secrets: [key] });

  const connector: Connector = {
    id: "instantly",
    name: TOOL,

    async validate() {
      const [campaigns, workspace] = await Promise.all([
        call<{ items?: unknown[] }>("GET", "/campaigns?limit=1"),
        call<{ name?: string }>("GET", "/workspaces/current"),
      ]);
      if (!campaigns.ok) {
        if (campaigns.error.code === "forbidden") return fail("forbidden", "The key works but can't read campaigns. Give it campaigns:read and leads:create (or all:all).", 403);
        return campaigns;
      }
      return ok({ accountLabel: (workspace.ok && workspace.value?.name) || "Instantly workspace" });
    },

    sequencer: {
      async listCampaigns() {
        const out: Campaign[] = [];
        let after: string | undefined;
        for (let page = 0; page < 5; page++) {
          const r = await call<{ items?: { id: string; name: string; status: number }[]; next_starting_after?: string }>(
            "GET",
            `/campaigns?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`,
          );
          if (!r.ok) return page ? ok(out) : r;
          for (const c of r.value.items ?? []) out.push({ id: c.id, name: c.name, status: STATUS[c.status] ?? "other" });
          after = r.value.next_starting_after;
          if (!after) break;
        }
        return ok(out);
      },

      async pushLead(campaignId, lead) {
        const { first, last } = lead.firstName ? { first: lead.firstName, last: lead.lastName ?? "" } : splitName(lead.name);
        const r = await call<{
          leads_uploaded?: number;
          in_blocklist?: number;
          duplicated_leads?: number;
          skipped_count?: number;
          invalid_email_count?: number;
          created_leads?: { index: number; id: string }[];
        }>("POST", "/leads/add", {
          campaign_id: campaignId,
          skip_if_in_workspace: true,
          verify_leads_on_import: false,
          leads: [
            {
              email: lead.email,
              ...(first ? { first_name: first } : {}),
              ...(last ? { last_name: last } : {}),
              ...(lead.companyName ? { company_name: lead.companyName } : {}),
              ...(lead.title ? { job_title: lead.title } : {}),
              ...(lead.website ? { website: lead.website } : {}),
              ...(lead.firstLine ? { personalization: lead.firstLine } : {}),
              custom_variables: lead.vars,
            },
          ],
        });
        if (!r.ok) return r;
        const v = r.value ?? {};
        const created = v.created_leads?.[0]?.id;
        if (created || (v.leads_uploaded ?? 0) > 0) return ok({ externalId: created });
        if (v.in_blocklist) return fail("conflict", `${lead.email} is on your Instantly blocklist, so it wasn't added.`, 409);
        if (v.invalid_email_count) return fail("validation", `Instantly says ${lead.email} isn't a valid email.`, 400);
        return fail("conflict", `${lead.email} is already a lead in your Instantly workspace, so I didn't add it twice.`, 409);
      },

      async registerReplyWebhook(url) {
        // One webhook per event type, for every campaign (campaign: null).
        let first: string | undefined;
        for (const event_type of REPLY_EVENTS) {
          const r = await call<{ id: string }>("POST", "/webhooks", { target_hook_url: url, event_type, campaign: null });
          if (!r.ok) return r;
          first ??= r.value.id;
        }
        return ok({ webhookId: first! });
      },
    },
  };
  return connector;
};
