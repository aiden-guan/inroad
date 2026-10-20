import "server-only";
import { request, splitName } from "./http";
import { fail, ok, type Connector, type ConnectorFactory, type CrmChanges, type ExternalRef, type Pipeline, type PollCursor, type Result } from "./types";

/**
 * HubSpot CRM (Service Key or legacy private app token, Bearer).
 * Date-versioned paths (2026-09) first, v3 as fallback when a portal doesn't route them yet.
 * Search-then-create for companies and contacts because domain upserts aren't documented, and
 * search lags writes by a few seconds, so the caller keeps its own id ledger.
 * Association type ids: contact→company 279, deal→company 341 (HUBSPOT_DEFINED, unlabeled).
 *
 * Polling: Service Keys get no webhooks, so changes are read by searching on the last-modified
 * date (`hs_lastmodifieddate`; contacts use `lastmodifieddate`), oldest first, one page of 100 per
 * object per poll, resuming from the newest date seen. Search allows 5 requests a second, so the
 * calls are spaced 250 ms apart.
 */

const BASE = "https://api.hubapi.com";
const V = "2026-09";
const TOOL = "HubSpot";

// Once a dated path 404s, every later call in this process goes straight to v3.
let preferV3 = false;

type Obj = { id: string; properties?: Record<string, string | null> };
type Search = { total?: number; results: Obj[]; paging?: { next?: { after?: string } } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FIRST_LOOKBACK_MS = 7 * 86_400_000;
const num = (v: string | null | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

export const hubspot: ConnectorFactory = (token, config) => {
  const portalId = config.portalId ? String(config.portalId) : undefined;
  const uiDomain = typeof config.uiDomain === "string" && config.uiDomain ? config.uiDomain : "app.hubspot.com";

  type Opts = { createsRecord?: boolean };
  const call = <T>(method: "GET" | "POST" | "PATCH" | "PUT", path: string, body?: unknown, opts: Opts = {}) =>
    request<T>({ tool: TOOL, method, url: BASE + path, headers: { authorization: `Bearer ${token}` }, body, secrets: [token], ...opts });

  async function versioned<T>(method: "GET" | "POST" | "PATCH" | "PUT", dated: string, v3: string, body?: unknown, opts: Opts = {}): Promise<Result<T>> {
    if (preferV3 || config.apiVersion === "v3") return call<T>(method, v3, body, opts);
    const r = await call<T>(method, dated, body, opts);
    if (r.ok || r.error.code !== "not_found") return r;
    const fallback = await call<T>(method, v3, body, opts);
    if (fallback.ok) preferV3 = true;
    return fallback;
  }

  const url = (objectTypeId: "0-1" | "0-2" | "0-3", id: string) =>
    portalId ? `https://${uiDomain}/contacts/${portalId}/record/${objectTypeId}/${id}` : undefined;
  const ref = (objectTypeId: "0-1" | "0-2" | "0-3", id: string): ExternalRef => ({ externalId: id, url: url(objectTypeId, id) });

  async function searchOne(object: "companies" | "contacts", property: string, value: string) {
    return versioned<Search>("POST", `/crm/objects/${V}/${object}/search`, `/crm/v3/objects/${object}/search`, {
      filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }],
      properties: [property],
      limit: 1,
    });
  }

  async function associateDefault(from: "contacts" | "deals", fromId: string, to: "companies" | "contacts", toId: string) {
    return versioned<unknown>(
      "PUT",
      `/crm/objects/${V}/${from}/${fromId}/associations/default/${to}/${toId}`,
      `/crm/v4/objects/${from}/${fromId}/associations/default/${to}/${toId}`,
    );
  }

  const connector: Connector = {
    id: "hubspot",
    name: TOOL,

    async validate() {
      // Cheap reads in parallel: which portal this is, and that the key can read everything we write.
      const [info, companies, contacts, deals] = await Promise.all([
        call<{ portalId?: number; uiDomain?: string }>("GET", "/account-info/v3/details"),
        call("GET", "/crm/v3/objects/companies?limit=1"),
        call("GET", "/crm/v3/objects/contacts?limit=1"),
        call("GET", "/crm/v3/objects/deals?limit=1"),
      ]);
      for (const [r, what, scope] of [
        [companies, "companies", "crm.objects.companies"],
        [contacts, "contacts", "crm.objects.contacts"],
        [deals, "deals", "crm.objects.deals"],
      ] as const) {
        if (r.ok) continue;
        if (r.error.code === "forbidden") return fail("forbidden", `The key works but can't read ${what}. Add ${scope}.read and ${scope}.write to it.`, 403);
        return r;
      }
      const id = info.ok ? info.value?.portalId : undefined;
      return ok({
        accountLabel: id ? `Portal ${id}` : "HubSpot",
        config: { ...(id ? { portalId: id } : {}), ...(info.ok && info.value?.uiDomain ? { uiDomain: info.value.uiDomain } : {}) },
      });
    },

    crm: {
      async upsertCompany(company, knownId) {
        if (knownId) return ok(ref("0-2", knownId));
        const found = await searchOne("companies", "domain", company.domain);
        if (!found.ok) return found;
        const hit = found.value.results?.[0];
        if (hit) return ok(ref("0-2", hit.id));
        const created = await versioned<Obj>(
          "POST",
          `/crm/objects/${V}/companies`,
          "/crm/v3/objects/companies",
          { properties: { domain: company.domain, ...(company.name ? { name: company.name } : {}), ...(company.city ? { city: company.city } : {}) } },
          { createsRecord: true },
        );
        return created.ok ? ok(ref("0-2", created.value.id)) : created;
      },

      async upsertPerson(person, company, knownId) {
        const warnings: string[] = [];
        let id = knownId;
        if (!id) {
          const found = await searchOne("contacts", "email", person.email.toLowerCase());
          if (!found.ok) return found;
          id = found.value.results?.[0]?.id;
        }
        if (id) {
          if (company) {
            const linked = await associateDefault("contacts", id, "companies", company.externalId);
            if (!linked.ok) warnings.push(`Couldn't link ${person.email} to the company: ${linked.error.message}`);
          }
          return ok(ref("0-1", id), warnings);
        }
        const { first, last } = person.firstName ? { first: person.firstName, last: person.lastName ?? "" } : splitName(person.name);
        const created = await versioned<Obj>(
          "POST",
          `/crm/objects/${V}/contacts`,
          "/crm/v3/objects/contacts",
          {
            properties: {
              email: person.email.toLowerCase(),
              ...(first ? { firstname: first } : {}),
              ...(last ? { lastname: last } : {}),
              ...(person.title ? { jobtitle: person.title } : {}),
            },
            ...(company
              ? { associations: [{ to: { id: company.externalId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 279 }] }] }
              : {}),
          },
          { createsRecord: true },
        );
        return created.ok ? ok(ref("0-1", created.value.id)) : created;
      },

      async upsertDeal(deal, company, people, knownId) {
        const properties: Record<string, string> = { dealname: deal.name };
        if (deal.stageId) properties.dealstage = deal.stageId;
        if (deal.pipelineId) properties.pipeline = deal.pipelineId;
        if (deal.amountUsd !== undefined) properties.amount = String(deal.amountUsd);
        if (deal.closeDate) properties.closedate = deal.closeDate;

        if (knownId) {
          const patched = await versioned<Obj>("PATCH", `/crm/objects/${V}/deals/${knownId}`, `/crm/v3/objects/deals/${knownId}`, { properties });
          if (patched.ok) return ok(ref("0-3", knownId));
          // Deleted on their side: fall through and create it again rather than failing forever.
          if (patched.error.code !== "not_found") return patched;
        }
        if (!properties.dealstage) return fail("validation", "HubSpot needs a deal stage. Map your stages first.");
        const created = await versioned<Obj>(
          "POST",
          `/crm/objects/${V}/deals`,
          "/crm/v3/objects/deals",
          { properties, associations: [{ to: { id: company.externalId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 341 }] }] },
          { createsRecord: true },
        );
        if (!created.ok) return created;
        const warnings: string[] = [];
        for (const p of people.slice(0, 5)) {
          const linked = await associateDefault("deals", created.value.id, "contacts", p.externalId);
          if (!linked.ok) warnings.push(`Couldn't link a contact to the deal: ${linked.error.message}`);
        }
        return ok(ref("0-3", created.value.id), warnings);
      },

      async listPipelines() {
        type P = { id: string; label: string; displayOrder?: number; stages?: { id: string; label: string; displayOrder?: number; metadata?: { isClosed?: string; probability?: string } }[] };
        const r = await versioned<{ results: P[] }>("GET", `/crm/pipelines/${V}/0-3`, "/crm/v3/pipelines/deals");
        if (!r.ok) return r;
        const byOrder = (a: { displayOrder?: number }, b: { displayOrder?: number }) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
        const pipelines: Pipeline[] = [...(r.value.results ?? [])].sort(byOrder).map((p) => ({
          id: p.id,
          label: p.label,
          stages: [...(p.stages ?? [])].sort(byOrder).map((s) => ({
            id: s.id,
            label: s.label,
            closed: s.metadata?.isClosed === "true" ? (s.metadata?.probability === "1.0" || s.metadata?.probability === "1" ? "won" : "lost") : undefined,
          })),
        }));
        return ok(pipelines);
      },

      async pullCompanies(limit) {
        const out: { domain: string; name?: string; city?: string }[] = [];
        let after: string | undefined;
        while (out.length < limit) {
          const r = await versioned<Search>("POST", `/crm/objects/${V}/companies/search`, "/crm/v3/objects/companies/search", {
            filterGroups: [{ filters: [{ propertyName: "domain", operator: "HAS_PROPERTY" }] }],
            sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
            properties: ["name", "domain", "city"],
            limit: Math.min(100, limit - out.length),
            ...(after ? { after } : {}),
          });
          if (!r.ok) return out.length ? ok(out, [r.error.message]) : r;
          for (const c of r.value.results ?? []) {
            const domain = c.properties?.domain;
            if (domain) out.push({ domain, name: c.properties?.name ?? undefined, city: c.properties?.city ?? undefined });
          }
          after = r.value.paging?.next?.after;
          if (!after) break;
        }
        return ok(out);
      },

      async pullChanges(cursor: PollCursor, dealIds: string[]) {
        const fallback = String(Date.now() - FIRST_LOOKBACK_MS);
        const warnings: string[] = [];
        const next: PollCursor = { ...cursor };

        // One page of records modified after the cursor, oldest first. Returns rows and the newest date.
        async function changed(object: "companies" | "contacts" | "deals", modified: string, properties: string[], extra: object[] = []) {
          await sleep(250);
          const since = cursor[object] ?? fallback;
          const r = await versioned<Search>("POST", `/crm/objects/${V}/${object}/search`, `/crm/v3/objects/${object}/search`, {
            filterGroups: [{ filters: [{ propertyName: modified, operator: "GT", value: since }, ...extra] }],
            sorts: [{ propertyName: modified, direction: "ASCENDING" }],
            properties: [...properties, modified],
            limit: 100,
          });
          if (!r.ok) return r;
          let newest = since;
          for (const o of r.value.results ?? []) {
            const t = Date.parse(o.properties?.[modified] ?? "");
            if (Number.isFinite(t) && t > Number(newest)) newest = String(t);
          }
          next[object] = newest;
          return ok(r.value.results ?? []);
        }

        const out: CrmChanges = { companies: [], people: [], deals: [], cursor: next };
        const companies = await changed("companies", "hs_lastmodifieddate", ["name", "domain", "city"]);
        if (!companies.ok) return companies;
        for (const c of companies.value) if (c.properties?.domain) out.companies.push({ domain: c.properties.domain, name: c.properties.name ?? undefined, city: c.properties.city ?? undefined });

        const contacts = await changed("contacts", "lastmodifieddate", ["email", "firstname", "lastname", "jobtitle"]);
        if (contacts.ok) {
          for (const c of contacts.value) {
            const p = c.properties ?? {};
            if (!p.email) continue;
            const name = [p.firstname, p.lastname].filter(Boolean).join(" ");
            out.people.push({ email: p.email, ...(name ? { name } : {}), ...(p.jobtitle ? { title: p.jobtitle } : {}) });
          }
        } else warnings.push(contacts.error.message);

        // Only the deals we mirror; a portal's other deals aren't ours to read.
        if (dealIds.length) {
          const deals = await changed("deals", "hs_lastmodifieddate", ["dealname", "dealstage", "pipeline", "amount", "closedate"], [{ propertyName: "hs_object_id", operator: "IN", values: dealIds.slice(0, 100) }]);
          if (deals.ok) {
            for (const d of deals.value) {
              const p = d.properties ?? {};
              out.deals.push({
                externalId: d.id,
                ...(p.dealname ? { name: p.dealname } : {}),
                ...(p.dealstage ? { stageId: p.dealstage } : {}),
                ...(num(p.amount) !== undefined ? { amountUsd: num(p.amount) } : {}),
                ...(p.closedate ? { closeDate: p.closedate.slice(0, 10) } : {}),
              });
            }
          } else warnings.push(deals.error.message);
        }
        if (warnings.length) out.warnings = warnings;
        return ok(out);
      },
    },
  };
  return connector;
};
