import "server-only";
import { request, splitName } from "./http";
import { fail, ok, type Campaign, type Connector, type ConnectorFactory, type PollCursor, type SequencerPoll } from "./types";

/**
 * Instantly API v2 (Bearer, paid plan; 402 otherwise). Leads go in with `skip_if_in_workspace`
 * so a lead is never added twice. Lead keys are a closed set, so the draft travels in
 * `personalization` and `custom_variables` ({{inroad_subject}}, {{inroad_body}}, …).
 * `GET /workspaces/current` (for the label) is UNVERIFIED and optional.
 *
 * Polling (no public URL): `GET /emails?email_type=received` is limited to 20 requests a minute,
 * so one poll reads at most 2 pages of 100, oldest first, and resumes from the newest
 * `timestamp_created`. `POST /leads/list` with a `lead-status-change` query catches bounces,
 * unsubscribes and interest labels set after the reply; that query's coverage of label changes
 * is UNVERIFIED, so the reply's own `i_status` is read too.
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

// `lt_interest_status` / `i_status` → the webhook event that carries the same label.
const INTEREST_EVENT: Record<number, string> = {
  1: "lead_interested",
  2: "lead_meeting_booked",
  0: "lead_out_of_office",
  [-1]: "lead_not_interested",
  [-2]: "lead_wrong_person",
};
// Lead `status`: -1 bounced, -2 unsubscribed.
const STATUS_EVENT: Record<number, string> = { [-1]: "email_bounced", [-2]: "lead_unsubscribed" };

const EMAIL_PAGES = 2;
const LEAD_PAGES = 2;
const FIRST_LOOKBACK_MS = 2 * 86_400_000;

type RawEmail = {
  id: string;
  timestamp_created?: string;
  timestamp_email?: string;
  subject?: string | null;
  lead?: string | null;
  from_address_email?: string | null;
  eaccount?: string | null;
  body?: { text?: string | null } | null;
  content_preview?: string | null;
  is_auto_reply?: number | boolean | null;
  i_status?: number | null;
};
type RawLead = { id: string; email?: string | null; status?: number | null; lt_interest_status?: number | null; timestamp_updated?: string; first_name?: string | null; last_name?: string | null };

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

      async pollEvents(cursor: PollCursor) {
        const since = cursor.emailsSince ?? new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString();
        const events: SequencerPoll["events"] = [];
        const warnings: string[] = [];
        // Labels already read off a reply in this batch, so the lead listing doesn't apply them twice.
        const labeled = new Set<string>();
        let newest = since;
        let after: string | undefined;
        for (let page = 0; page < EMAIL_PAGES; page++) {
          const q = new URLSearchParams({ email_type: "received", sort_order: "asc", limit: "100", min_timestamp_created: since });
          if (after) q.set("starting_after", after);
          const r = await call<{ items?: RawEmail[]; next_starting_after?: string }>("GET", `/emails?${q}`);
          if (!r.ok) {
            if (!page) return r;
            warnings.push(r.error.message);
            break;
          }
          for (const e of r.value?.items ?? []) {
            if (e.timestamp_created && e.timestamp_created > newest) newest = e.timestamp_created;
            const from = e.from_address_email && e.from_address_email !== e.eaccount ? e.from_address_email : undefined;
            const leadEmail = e.lead ?? from;
            if (!leadEmail) continue;
            const at = e.timestamp_email ?? e.timestamp_created;
            events.push({ event_type: "reply_received", email_id: e.id, lead_email: leadEmail, reply_text: e.body?.text ?? e.content_preview ?? undefined, reply_subject: e.subject ?? undefined, timestamp: at });
            // The vendor's own label on that reply, applied after it like the webhook's label event.
            const label = e.is_auto_reply ? "lead_out_of_office" : typeof e.i_status === "number" ? INTEREST_EVENT[e.i_status] : undefined;
            if (label) {
              events.push({ event_type: label, email_id: `${e.id}:${label}`, lead_email: leadEmail, timestamp: at });
              labeled.add(`${leadEmail.toLowerCase()}|${label}`);
            }
          }
          after = r.value?.next_starting_after;
          if (!after) break;
        }

        // Status changes since the last poll, in whole days (the query's unit), at least one.
        const days = Math.min(7, Math.max(1, Math.ceil((Date.now() - Date.parse(cursor.leadsSince ?? since)) / 86_400_000)));
        let leadAfter: string | undefined;
        for (let page = 0; page < LEAD_PAGES; page++) {
          const r = await call<{ items?: RawLead[]; next_starting_after?: string }>("POST", "/leads/list", {
            limit: 100,
            queries: [{ actionType: "lead-status-change", values: { "occurrence-days": days } }],
            ...(leadAfter ? { starting_after: leadAfter } : {}),
          });
          if (!r.ok) {
            warnings.push(r.error.message);
            break;
          }
          for (const l of r.value?.items ?? []) {
            if (!l.email) continue;
            const base = { lead_email: l.email, first_name: l.first_name ?? undefined, last_name: l.last_name ?? undefined, timestamp: l.timestamp_updated };
            const st = typeof l.status === "number" ? STATUS_EVENT[l.status] : undefined;
            if (st) events.push({ ...base, event_type: st, email_id: `lead:${l.id}:${st}` });
            const label = typeof l.lt_interest_status === "number" ? INTEREST_EVENT[l.lt_interest_status] : undefined;
            if (label && !labeled.has(`${l.email.toLowerCase()}|${label}`)) events.push({ ...base, event_type: label, email_id: `lead:${l.id}:${label}` });
          }
          leadAfter = r.value?.next_starting_after;
          if (!leadAfter) break;
        }

        return ok({ events, cursor: { emailsSince: newest, leadsSince: new Date().toISOString() }, ...(warnings.length ? { warnings } : {}) });
      },
    },
  };
  return connector;
};
