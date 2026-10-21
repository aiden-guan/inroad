import "server-only";
import { request } from "./http";
import { fail, ok, type Connector, type ConnectorFactory, type CrmChanges, type ExternalRef, type PollCursor, type Result } from "./types";

/**
 * Attio (workspace access token, Bearer). Assert-by-domain / assert-by-email gives natural
 * idempotency. We only send attributes we own: on assert Attio replaces multiselects other than
 * the matching one, so companies get just their domain (Attio enriches the rest).
 * Deals use the standard Deals object when the workspace has it enabled; otherwise we fall back
 * to a note on the company so the stage change is still visible.
 * UNVERIFIED against research 06: `GET /v2/self`, the Deals object attribute slugs, and the
 * statuses listing; each has a graceful fallback.
 *
 * Polling: records have no documented last-modified attribute, so a poll reads companies and
 * people created since the cursor (`created_at` filter and sort: UNVERIFIED) and re-reads each
 * deal we mirror by id (at most 20 a poll; reads allow 100 a second).
 */

const BASE = "https://api.attio.com/v2";
const TOOL = "Attio";

type RecordRes = { data: { id: { record_id: string }; web_url?: string; values?: Record<string, { value?: unknown; domain?: string }[]> } };

type Values = Record<string, Record<string, unknown>[] | undefined>;
const FIRST_LOOKBACK_MS = 7 * 86_400_000;
const first = (values: Values | undefined, attr: string, key: string): unknown => values?.[attr]?.[0]?.[key];
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const attio: ConnectorFactory = (token) => {
  const call = <T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown, opts: { createsRecord?: boolean } = {}) =>
    request<T>({ tool: TOOL, method, url: BASE + path, headers: { authorization: `Bearer ${token}` }, body, secrets: [token], ...opts });

  const toRef = (r: RecordRes): ExternalRef => ({ externalId: r.data.id.record_id, url: r.data.web_url });

  async function note(parentObject: "companies" | "deals", parentId: string, title: string, content: string): Promise<Result<ExternalRef>> {
    const r = await call<{ data: { id: { note_id: string } } }>(
      "POST",
      "/notes",
      { data: { parent_object: parentObject, parent_record_id: parentId, title: title.slice(0, 200), format: "markdown", content } },
      { createsRecord: true },
    );
    return r.ok ? ok({ externalId: r.value.data.id.note_id }) : r;
  }

  // The standard Deals object requires an owner on create: the member who made the token. Looked up once.
  let ownerId: string | null | undefined;
  async function tokenOwner(): Promise<string | null> {
    if (ownerId === undefined) {
      const s = await call<{ authorized_by_workspace_member_id?: string }>("GET", "/self");
      ownerId = s.ok ? (s.value?.authorized_by_workspace_member_id ?? null) : null;
    }
    return ownerId;
  }

  const connector: Connector = {
    id: "attio",
    name: TOOL,

    async validate() {
      const self = await call<{ active?: boolean; workspace_name?: string }>("GET", "/self");
      if (self.ok) {
        if (self.value?.active === false) return fail("auth", "Attio says this token is no longer active. Create a new one.", 401);
        return ok({ accountLabel: self.value?.workspace_name || "Attio workspace" });
      }
      if (self.error.code !== "not_found") return self;
      const objects = await call("GET", "/objects");
      return objects.ok ? ok({ accountLabel: "Attio workspace" }) : objects;
    },

    crm: {
      async upsertCompany(company, knownId) {
        if (knownId) return ok({ externalId: knownId });
        const r = await call<RecordRes>("PUT", "/objects/companies/records?matching_attribute=domains", {
          data: { values: { domains: [{ domain: company.domain }] } },
        });
        return r.ok ? ok(toRef(r.value)) : r;
      },

      async upsertPerson(person, company) {
        const name = person.name || [person.firstName, person.lastName].filter(Boolean).join(" ");
        const r = await call<RecordRes>("PUT", "/objects/people/records?matching_attribute=email_addresses", {
          data: {
            values: {
              email_addresses: [person.email.toLowerCase()],
              ...(name ? { name } : {}),
              ...(person.title ? { job_title: person.title } : {}),
              ...(company ? { company: [{ target_object: "companies", target_record_id: company.externalId }] } : {}),
            },
          },
        });
        return r.ok ? ok(toRef(r.value)) : r;
      },

      async upsertDeal(deal, company, people, knownId) {
        const values: Record<string, unknown> = { name: deal.name };
        if (deal.stageId) values.stage = deal.stageId;
        if (deal.amountUsd !== undefined) values.value = deal.amountUsd;
        values.associated_company = [{ target_object: "companies", target_record_id: company.externalId }];
        if (people.length) values.associated_people = people.slice(0, 5).map((p) => ({ target_object: "people", target_record_id: p.externalId }));

        // The CRM owns an existing deal's owner, so it's only set on create.
        if (!knownId) {
          const owner = await tokenOwner();
          if (owner) values.owner = [{ referenced_actor_type: "workspace-member", referenced_actor_id: owner }];
        }

        const r = knownId
          ? await call<RecordRes>("PATCH", `/objects/deals/records/${knownId}`, { data: { values } })
          : await call<RecordRes>("POST", "/objects/deals/records", { data: { values } }, { createsRecord: true });
        if (r.ok) return ok(toRef(r.value));
        if (knownId && r.error.code === "not_found") return connector.crm!.upsertDeal(deal, company, people);
        // No Deals object in this workspace (404): keep the history visible as a note on the company.
        // A 400 means the object exists but rejected a value; Attio's own message says which.
        if (r.error.code === "not_found") {
          const n = await note("companies", company.externalId, `Deal: ${deal.name}`, `Stage: **${deal.stageId ?? "updated"}**${deal.amountUsd ? `\n\nAmount: $${deal.amountUsd}` : ""}\n\nFrom Inroad.`);
          return n.ok ? ok({ externalId: `note:${n.value.externalId}` }, ["Attio has no Deals object here, so I added a note to the company instead."]) : n;
        }
        return r;
      },

      async addNote(parent, title, markdown) {
        return note("companies", parent.externalId, title, markdown);
      },

      async listPipelines() {
        type S = { id?: { status_id?: string }; title: string; is_archived?: boolean };
        const r = await call<{ data: S[] }>("GET", "/objects/deals/attributes/stage/statuses");
        if (!r.ok) {
          if (r.error.code === "not_found") return ok([]);
          return r;
        }
        const stages = (r.value.data ?? [])
          .filter((s) => !s.is_archived)
          .map((s) => ({ id: s.title, label: s.title, closed: /won/i.test(s.title) ? ("won" as const) : /lost/i.test(s.title) ? ("lost" as const) : undefined }));
        return ok([{ id: "deals", label: "Deals", stages }]);
      },

      async pullCompanies(limit) {
        const r = await call<{ data: RecordRes["data"][] }>("POST", "/objects/companies/records/query", { limit: Math.min(500, limit) });
        if (!r.ok) return r;
        const out: { domain: string; name?: string }[] = [];
        for (const rec of r.value.data ?? []) {
          const domain = rec.values?.domains?.[0]?.domain;
          const name = rec.values?.name?.[0]?.value;
          if (typeof domain === "string" && domain) out.push({ domain, name: typeof name === "string" ? name : undefined });
        }
        return ok(out.slice(0, limit));
      },

      async pullChanges(cursor: PollCursor, dealIds: string[]) {
        const fallback = new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString();
        const next: PollCursor = { ...cursor };
        const warnings: string[] = [];

        async function created(object: "companies" | "people") {
          const since = cursor[object] ?? fallback;
          const r = await call<{ data?: { values?: Values; created_at?: string }[] }>("POST", `/objects/${object}/records/query`, {
            filter: { created_at: { $gt: since } },
            sorts: [{ attribute: "created_at", direction: "asc" }],
            limit: 100,
          });
          if (!r.ok) return r;
          let newest = since;
          for (const rec of r.value?.data ?? []) {
            const at = text(first(rec.values, "created_at", "value")) ?? rec.created_at;
            if (at && at > newest) newest = at;
          }
          next[object] = newest;
          return ok(r.value?.data ?? []);
        }

        const out: CrmChanges = { companies: [], people: [], deals: [], cursor: next };
        const companies = await created("companies");
        if (!companies.ok) return companies;
        for (const rec of companies.value) {
          const domain = text(first(rec.values, "domains", "domain"));
          if (domain) out.companies.push({ domain, name: text(first(rec.values, "name", "value")) });
        }
        const people = await created("people");
        if (people.ok) {
          for (const rec of people.value) {
            const email = text(first(rec.values, "email_addresses", "email_address"));
            if (!email) continue;
            const name = text(first(rec.values, "name", "full_name"));
            const title = text(first(rec.values, "job_title", "value"));
            out.people.push({ email, ...(name ? { name } : {}), ...(title ? { title } : {}) });
          }
        } else warnings.push(people.error.message);

        for (const id of dealIds.slice(0, 20)) {
          const r = await call<{ data?: { values?: Values } }>("GET", `/objects/deals/records/${encodeURIComponent(id)}`);
          if (!r.ok) {
            if (r.error.code !== "not_found") warnings.push(r.error.message);
            continue;
          }
          const v = r.value?.data?.values;
          const status = first(v, "stage", "status") as { title?: string } | undefined;
          const amount = first(v, "value", "currency_value");
          out.deals.push({
            externalId: id,
            ...(text(first(v, "name", "value")) ? { name: text(first(v, "name", "value")) } : {}),
            ...(status?.title ? { stageId: status.title } : {}),
            ...(typeof amount === "number" ? { amountUsd: amount } : {}),
          });
        }
        if (warnings.length) out.warnings = warnings;
        return ok(out);
      },
    },
  };
  return connector;
};
