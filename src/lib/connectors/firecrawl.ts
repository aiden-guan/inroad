import "server-only";
import { companyDomainOf, normalizeDomain } from "@/lib/hub/records";
import { redact } from "./http";
import {
  fail,
  ok,
  type Billed,
  type Connector,
  type ConnectorError,
  type ConnectorFactory,
  type FoundEmail,
  type FoundPerson,
  type PersonPreview,
  type Result,
} from "./types";

/**
 * Firecrawl Alexandria: official data providers behind one Firecrawl key, paid in Firecrawl credits.
 * Inroad uses three people capabilities and nothing else:
 *   apollo/people/search          free     who works there, with a masked surname
 *   apollo/people/match           30/hit   full name, LinkedIn, work email (never personal email or phone)
 *   fullenrich/contacts/work-email 20/hit  a work email for someone already on file
 * Every call carries an x-request-id; retries reuse it, so a retried call is never billed twice.
 * Contract: POST /v2/scrape { alexandria: [{ provider, capability, options }] } (Firecrawl JS SDK 4.50).
 */

const TOOL = "Firecrawl";
/** Read per call, so a test or a self-hosted Firecrawl can point it elsewhere after start. */
const api = () => (process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev").replace(/\/+$/, "");
const PROVIDER_NAME: Record<string, string> = { apollo: "Apollo", fullenrich: "FullEnrich" };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Firecrawl's error body → one plain sentence, with the fix link when a provider's terms need accepting. */
function describe(status: number | undefined, body: Json, provider: string | undefined, key: string): ConnectorError {
  const code = str(body.code);
  const detail = redact(str(body.error) || str(body.message), [key]).replace(/\.$/, "").slice(0, 200);
  const who = (provider && PROVIDER_NAME[provider]) || "This data provider";
  if (code === "THIRD_PARTY_DATA_TERMS_REQUIRED") {
    const url = str(obj(body.requiresAction).url);
    return {
      code: "forbidden",
      status,
      message: `${who}'s data terms need accepting in Firecrawl before the first lookup. An admin of your Firecrawl team can accept them${url ? " here" : " in the Firecrawl dashboard"}.`,
      ...(url.startsWith("https://") ? { fixUrl: url } : {}),
    };
  }
  if (status === 401) return { code: "auth", status, message: `${TOOL} rejected the key. Check that you copied all of it, then paste it again.` };
  if (status === 402 || /credit/i.test(code)) return { code: "plan", status, message: `Your ${TOOL} team is out of credits. Add credits in Firecrawl, then try again.` };
  if (status === 403) return { code: "forbidden", status, message: `${TOOL} refused the lookup${detail ? `: ${detail}` : ""}.` };
  if (status === 429) return { code: "rate_limited", status, message: `${who} is busy. Try again in a minute.` };
  if (status !== undefined && status >= 500) return { code: "upstream", status, message: `${provider ? who : TOOL} had a problem on its side (${status}). Try again in a minute.` };
  return { code: "validation", status, message: `${provider ? who : TOOL} rejected the lookup${detail ? `: ${detail}` : ""}.` };
}

async function http(key: string, path: string, init: { body?: unknown; requestId?: string; timeoutMs: number }): Promise<Result<Json>> {
  const retries = 2;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${api()}${path}`, {
        method: init.body === undefined ? "GET" : "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${key}`,
          "user-agent": "Inroad/1.0 (+local)",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(init.requestId ? { "x-request-id": init.requestId } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (err) {
      // Safe to retry: the same request id makes Firecrawl return the first result instead of running it again.
      if (attempt < retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return fail("network", timedOut ? `${TOOL} didn't answer within ${Math.round(init.timeoutMs / 1000)}s. Try again in a minute.` : `Couldn't reach ${TOOL}. Check your internet connection.`);
    }
    const text = await res.text().catch(() => "");
    let body: Json = {};
    try {
      body = obj(JSON.parse(text));
    } catch {
      // not JSON
    }
    if (res.ok && body.success !== false) return ok(body);
    if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(10_000, after * 1000) : 600 * 2 ** attempt);
      continue;
    }
    return { ok: false, error: describe(res.status, body, undefined, key) };
  }
}

/** One Alexandria call. Returns the provider's data and the credits it was billed. */
async function alexandria(key: string, provider: string, capability: string, options: Json, timeoutMs: number): Promise<Result<{ data: Json; credits: number }>> {
  const r = await http(key, "/v2/scrape", {
    body: { alexandria: [{ provider, capability, options }], timeout: Math.min(120_000, timeoutMs) },
    requestId: crypto.randomUUID(),
    timeoutMs: Math.min(120_000, timeoutMs) + 30_000,
  });
  if (!r.ok) {
    // Name the provider in errors that came back for the whole request.
    return r.error.code === "forbidden" || r.error.code === "validation" ? { ok: false, error: { ...r.error, message: r.error.message.replace(/^Firecrawl refused/, `${PROVIDER_NAME[provider] ?? provider} refused`) } } : r;
  }
  const data = obj(r.value.data);
  const item = obj(arr(data.alexandria)[0]);
  if (!Object.keys(item).length) return fail("upstream", `${TOOL} returned an empty answer. Try again in a minute.`);
  if (item.error) {
    const e = obj(item.error);
    return { ok: false, error: describe(typeof e.status === "number" ? e.status : undefined, { ...e, error: e.message, requiresAction: e.requiresAction ?? item.requiresAction }, provider, key) };
  }
  const credits = typeof item.creditsCost === "number" ? item.creditsCost : typeof data.creditsCost === "number" ? data.creditsCost : 0;
  return ok({ data: obj(item.data), credits });
}

/** A work address we'd stand behind: not Apollo's locked placeholder, not a personal mailbox. */
function workEmail(address: string, status: string, verified: boolean): FoundEmail | undefined {
  const a = address.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a) || a.startsWith("email_not_unlocked@") || !companyDomainOf(a)) return undefined;
  return { address: a, verified, status: status || "unknown" };
}

const orgDomain = (org: unknown) => normalizeDomain(str(obj(org).primary_domain) || str(obj(org).website_url));

function toPreview(raw: unknown): PersonPreview | null {
  const p = obj(raw);
  const id = str(p.id);
  const firstName = str(p.first_name);
  if (!id || !firstName) return null;
  return {
    id,
    firstName,
    lastName: str(p.last_name) || str(p.last_name_obfuscated),
    title: str(p.title),
    companyName: str(obj(p.organization).name) || undefined,
    ...(orgDomain(p.organization) ? { companyDomain: orgDomain(p.organization)! } : {}),
    hasEmail: p.has_email === true,
  };
}

function toPerson(raw: unknown): FoundPerson | null {
  const p = obj(raw);
  const id = str(p.id);
  const name = str(p.name) || [str(p.first_name), str(p.last_name)].filter(Boolean).join(" ");
  if (!id || !name) return null;
  const org = obj(p.organization);
  const status = str(p.email_status);
  const email = workEmail(str(p.email), status, status.toLowerCase() === "verified");
  const location = [str(p.city), str(p.state), str(p.country)].filter(Boolean).join(", ");
  const linkedin = str(p.linkedin_url);
  return {
    id,
    name,
    title: str(p.title) || str(p.headline),
    ...(/^https?:\/\/([a-z]+\.)?linkedin\.com\/in\//i.test(linkedin) ? { linkedinUrl: linkedin } : {}),
    ...(location ? { location } : {}),
    ...(normalizeDomain(str(org.primary_domain) || str(org.website_url)) ? { companyDomain: normalizeDomain(str(org.primary_domain) || str(org.website_url))! } : {}),
    ...(str(org.name) ? { companyName: str(org.name) } : {}),
    ...(email ? { email } : {}),
  };
}

function toWorkEmail(data: Json): FoundEmail | null {
  const result = obj(arr(data.results)[0]);
  const info = obj(result.contact_info);
  const best = info.most_probable_work_email;
  let address = typeof best === "string" ? best : str(obj(best).email);
  let status = typeof best === "string" ? "" : str(obj(best).status);
  const candidates = arr(info.work_emails).map(obj);
  if (!address && candidates[0]) address = str(candidates[0].email);
  if (!status) status = str(candidates.find((c) => str(c.email).toLowerCase() === address.toLowerCase())?.status);
  return workEmail(address, status, status.toUpperCase() === "DELIVERABLE") ?? null;
}

export interface WebResult {
  url: string;
  title: string;
  description: string;
}

/**
 * Plain web search (POST /v2/search, 2 credits per 10 results), for AI providers that have no search of
 * their own (everyone but Anthropic). Reads both the v2 shape (`data.web`) and the older flat `data` list.
 */
export async function firecrawlSearch(key: string, query: string, limit = 8): Promise<Result<WebResult[]>> {
  const r = await http(key.trim(), "/v2/search", { body: { query, limit }, timeoutMs: 30_000 });
  if (!r.ok) return r;
  const data = r.value.data;
  const rows = Array.isArray(data) ? data : arr(obj(data).web);
  const out: WebResult[] = [];
  for (const row of rows.map(obj)) {
    const url = str(row.url);
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ url, title: str(row.title) || url, description: str(row.description) || str(row.snippet) });
  }
  return ok(out.slice(0, limit));
}

export const firecrawl: ConnectorFactory = (key) => {
  const k = key.trim();
  const connector: Connector = {
    id: "firecrawl",
    name: TOOL,

    async validate() {
      if (!/^fc-[A-Za-z0-9_-]{8,}$/.test(k)) return fail("validation", "That isn't a Firecrawl API key. They start with fc-.");
      const r = await connector.people!.credits();
      if (!r.ok) return r;
      return ok({
        accountLabel: `${r.value.remaining.toLocaleString("en-US")} credits left`,
        ...(r.value.plan !== undefined ? { config: { planCredits: r.value.plan } } : {}),
      });
    },

    people: {
      async credits() {
        const r = await http(k, "/v2/team/credit-usage", { timeoutMs: 15_000 });
        if (!r.ok) return r;
        const d = obj(r.value.data);
        const remaining = Number(d.remainingCredits ?? d.remaining_credits);
        const plan = Number(d.planCredits ?? d.plan_credits);
        if (!Number.isFinite(remaining)) return fail("upstream", `${TOOL} answered, but without a credit balance. Try again in a minute.`);
        return ok({ remaining, ...(Number.isFinite(plan) ? { plan } : {}) });
      },

      async search({ domain, locations, titles, perPage = 10 }) {
        const r = await alexandria(
          k,
          "apollo",
          "people/search",
          {
            ...(domain ? { q_organization_domains_list: [domain] } : {}),
            ...(locations?.length ? { person_locations: locations.slice(0, 5) } : {}),
            ...(titles.length ? { person_titles: titles.slice(0, 10) } : {}),
            page: 1,
            per_page: Math.min(25, Math.max(1, perPage)),
          },
          30_000,
        );
        if (!r.ok) return r;
        const people = arr(r.value.data.people).map(toPreview).filter((p): p is PersonPreview => !!p);
        const total = Number(r.value.data.total_entries ?? obj(r.value.data.pagination).total_entries);
        return ok<Billed<{ people: PersonPreview[]; total?: number }>>({ value: { people, ...(Number.isFinite(total) ? { total } : {}) }, credits: r.value.credits });
      },

      async add(id) {
        const r = await alexandria(k, "apollo", "people/match", { id, reveal_personal_emails: false, reveal_phone_number: false }, 45_000);
        if (!r.ok) return r;
        return ok<Billed<FoundPerson | null>>({ value: toPerson(r.value.data.person), credits: r.value.credits });
      },

      async workEmail(q) {
        const options: Json = q.linkedinUrl
          ? { linkedin_url: q.linkedinUrl }
          : { first_name: q.firstName, last_name: q.lastName, ...(q.domain ? { domain: q.domain } : { company_name: q.companyName }) };
        const r = await alexandria(k, "fullenrich", "contacts/work-email", options, 110_000);
        if (!r.ok) return r;
        return ok<Billed<FoundEmail | null>>({ value: toWorkEmail(r.value.data), credits: r.value.credits });
      },
    },
  };
  return connector;
};
