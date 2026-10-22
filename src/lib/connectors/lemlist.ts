import "server-only";
import { request, splitName } from "./http";
import { fail, ok, type Campaign, type Connector, type ConnectorFactory, type PollCursor, type SequencerPoll } from "./types";

/**
 * lemlist (HTTP Basic, empty username, key as password). One lead per call, 20 requests / 2 s.
 * Extra body keys become text custom variables, so {{inroad_subject}} etc. work in templates;
 * `icebreaker` carries the first line. `GET /team` (for the label) is UNVERIFIED and optional.
 *
 * Polling (no public URL, or webhooks gone stale): `GET /activities?version=v2&type=…` for each reply,
 * label, bounce and unsubscribe type, newest first, up to 2 pages of 100 per type, keeping what's
 * newer than the cursor. lemlist's webhooks deliver these same activity objects, so they go through
 * the webhook parser unchanged and dedupe on `_id`. The query parameters and the newest-first order
 * are UNVERIFIED; a type the API refuses (the unsubscribe types were renamed on 2026-03-30) becomes a
 * warning, not a failed poll.
 */

const BASE = "https://api.lemlist.com/api";
const TOOL = "lemlist";

type RawCampaign = { _id: string; name: string; status?: string };
type RawActivity = { _id?: string; type?: string; createdAt?: string } & Record<string, unknown>;

// The activity types the inbound parser turns into replies, labels, bounces and unsubscribes.
const POLL_TYPES = ["emailsReplied", "linkedinReplied", "emailsInterested", "emailsNotInterested", "emailsBounced", "emailsUnsubscribed", "entityUnsubscribed"] as const;
const POLL_PAGES = 2;
const FIRST_LOOKBACK_MS = 2 * 86_400_000;
const STATUS: Record<string, Campaign["status"]> = { running: "active", paused: "paused", draft: "draft", ended: "completed", archived: "completed" };

export const lemlist: ConnectorFactory = (key) => {
  const auth = `Basic ${Buffer.from(`:${key}`).toString("base64")}`;
  const call = <T>(method: "GET" | "POST", path: string, body?: unknown) =>
    request<T>({ tool: TOOL, method, url: BASE + path, headers: { authorization: auth }, body, secrets: [key, auth.slice(6)] });

  const connector: Connector = {
    id: "lemlist",
    name: TOOL,

    async validate() {
      const team = await call<{ name?: string }>("GET", "/team");
      if (team.ok) return ok({ accountLabel: team.value?.name || "lemlist team" });
      if (team.error.code === "auth") return team;
      const campaigns = await call("GET", "/campaigns?version=v2&limit=1");
      return campaigns.ok ? ok({ accountLabel: "lemlist team" }) : campaigns;
    },

    sequencer: {
      async listCampaigns() {
        const out: Campaign[] = [];
        for (let offset = 0; offset < 500; offset += 100) {
          const r = await call<RawCampaign[] | { campaigns?: RawCampaign[] }>(
            "GET",
            `/campaigns?version=v2&limit=100&offset=${offset}&sortBy=createdAt&sortOrder=desc`,
          );
          if (!r.ok) return offset ? ok(out) : r;
          const page = Array.isArray(r.value) ? r.value : (r.value?.campaigns ?? []);
          for (const c of page) out.push({ id: c._id, name: c.name, status: STATUS[c.status ?? ""] ?? "other" });
          if (page.length < 100) break;
        }
        return ok(out);
      },

      async pushLead(campaignId, lead) {
        const { first, last } = lead.firstName ? { first: lead.firstName, last: lead.lastName ?? "" } : splitName(lead.name);
        const r = await call<{ _id?: string }>(
          "POST",
          `/campaigns/${encodeURIComponent(campaignId)}/leads/?deduplicate=true&updateStrategy=fillEmptyOnly`,
          {
            email: lead.email,
            ...(first ? { firstName: first } : {}),
            ...(last ? { lastName: last } : {}),
            ...(lead.companyName ? { companyName: lead.companyName } : {}),
            ...(lead.companyDomain ? { companyDomain: lead.companyDomain } : {}),
            ...(lead.title ? { jobTitle: lead.title } : {}),
            ...(lead.linkedinUrl ? { linkedinUrl: lead.linkedinUrl } : {}),
            ...(lead.firstLine ? { icebreaker: lead.firstLine } : {}),
            ...lead.vars,
          },
        );
        if (r.ok) return ok({ externalId: r.value?._id });
        if (r.error.status === 400 && /ALREADY/i.test(r.error.message)) return fail("conflict", `${lead.email} is already in that lemlist campaign.`, 409);
        if (r.error.status === 409) return fail("conflict", `${lead.email} is already in another lemlist campaign, so it wasn't added twice.`, 409);
        return r;
      },

      async pollEvents(cursor: PollCursor) {
        const since = cursor.since ?? new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString();
        const events: SequencerPoll["events"] = [];
        const warnings: string[] = [];
        let newest = since;
        let read = 0;
        for (const type of POLL_TYPES) {
          for (let page = 0; page < POLL_PAGES; page++) {
            const q = new URLSearchParams({ version: "v2", type, limit: "100", offset: String(page * 100) });
            const r = await call<RawActivity[] | { activities?: RawActivity[] }>("GET", `/activities?${q}`);
            if (!r.ok) {
              if (r.error.code === "auth" || r.error.code === "rate_limited") return r;
              warnings.push(`${type}: ${r.error.message}`);
              break;
            }
            read++;
            const items = Array.isArray(r.value) ? r.value : (r.value?.activities ?? []);
            let older = false;
            for (const a of items) {
              const at = typeof a.createdAt === "string" ? a.createdAt : undefined;
              if (!at || at <= since) {
                older = true;
                continue;
              }
              if (at > newest) newest = at;
              events.push({ ...a, type: a.type ?? type });
            }
            // Newest first: a page that reaches the cursor (or a short page) is the last one needed.
            if (older || items.length < 100) break;
          }
        }
        if (!read) return fail("upstream", warnings[0] ?? "lemlist didn't return any activity.");
        return ok({ events, cursor: { since: newest }, ...(warnings.length ? { warnings } : {}) });
      },
    },
  };
  return connector;
};
