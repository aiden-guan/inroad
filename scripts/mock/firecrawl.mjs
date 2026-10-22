/**
 * Fakes the three Firecrawl Alexandria people capabilities Inroad uses (any fc-… key works;
 * fc-terms… simulates a provider whose data terms aren't accepted yet).
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let counter = 0;
const id = (p) => `${p}_mock${(++counter).toString(36)}`;

const FIRST = ["Maya", "Daniel", "Priya", "Tom", "Sofia", "Kenji", "Amara", "Lucas", "Nora", "Ravi"];
const LAST = ["Okafor", "Lindqvist", "Raman", "Becker", "Alvarez", "Sato", "Mensah", "Moreau", "Fischer", "Iyer"];
const fcPeople = (domain, titles) =>
  FIRST.slice(0, 6).map((first, i) => ({
    id: `ap_${domain.replace(/\W/g, "")}_${i}`,
    first,
    last: LAST[i],
    title: titles[i % Math.max(1, titles.length)] ?? ["VP Engineering", "Head of Platform", "CTO", "Staff Engineer"][i % 4],
    hasEmail: i % 3 !== 2,
    domain,
  }));
const fcIndex = new Map();
let fcCredits = 4200;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

export async function firecrawl(req, res, DELAY) {
  const key = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!key.startsWith("fc-")) return json(res, 401, { success: false, error: "Unauthorized: invalid token" });
  if (req.method === "GET" && req.url.startsWith("/v2/team/credit-usage")) {
    return json(res, 200, { success: true, data: { remainingCredits: fcCredits, planCredits: 5000, billingPeriodStart: null, billingPeriodEnd: null } });
  }
  if (req.method !== "POST" || !req.url.startsWith("/v2/scrape")) return json(res, 404, { success: false, error: "Not found" });
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const calls = JSON.parse(raw).alexandria ?? [];
  await sleep(DELAY * 4);
  const out = calls.map(({ provider, capability, options = {} }) => {
    if (key.startsWith("fc-terms") && provider !== "firecrawl") {
      return { provider, capability, error: { code: "THIRD_PARTY_DATA_TERMS_REQUIRED", message: "Accept the provider's data terms first.", status: 403 }, requiresAction: { type: "accept_terms", url: "https://www.firecrawl.dev/app/alexandria" } };
    }
    if (provider === "apollo" && capability === "people/search" && !options.q_organization_domains_list && options.person_locations?.length) {
      // Near a place: buyers at several companies in that city.
      const where = String(options.person_locations[0]);
      const city = where.split(",")[0].trim();
      const firms = ["Tallyrock", "Meterly", "Brightledger", "Quantaloop", "Northpeak", "Sablewire", "Coppergate"];
      const people = FIRST.slice(0, 7).map((first, i) => {
        const firm = firms[i];
        const p = { id: `ap_near_${city.toLowerCase().replace(/\W/g, "")}_${i}`, first, last: LAST[(i + 3) % LAST.length], title: (options.person_titles ?? [])[i % Math.max(1, (options.person_titles ?? []).length)] ?? "Controller", hasEmail: i % 3 !== 1, domain: `${firm.toLowerCase()}.example`, firm, where };
        fcIndex.set(p.id, p);
        return p;
      });
      return {
        provider, capability, creditsCost: 0, records: people.length,
        data: { people: people.map((p) => ({ id: p.id, first_name: p.first, last_name: `${p.last[0]}***`, title: p.title, organization: { name: p.firm, primary_domain: p.domain }, has_email: p.hasEmail })), total_entries: 140 },
      };
    }
    if (provider === "apollo" && capability === "people/search") {
      const domain = options.q_organization_domains_list?.[0] ?? "example.com";
      const people = fcPeople(domain, options.person_titles ?? []);
      people.forEach((p) => fcIndex.set(p.id, p));
      return {
        provider, capability, creditsCost: 0, records: people.length,
        data: { people: people.map((p) => ({ id: p.id, first_name: p.first, last_name: `${p.last[0]}***`, title: p.title, organization: { name: domain.split(".")[0] }, has_email: p.hasEmail })), total_entries: 23 },
      };
    }
    if (provider === "apollo" && capability === "people/match") {
      const p = fcIndex.get(options.id);
      if (!p) return { provider, capability, creditsCost: 0, data: { person: null } };
      return {
        provider, capability, creditsCost: 30, records: 1,
        data: {
          person: {
            id: p.id, name: `${p.first} ${p.last}`, first_name: p.first, last_name: p.last, title: p.title,
            linkedin_url: `https://www.linkedin.com/in/${p.first.toLowerCase()}-${p.last.toLowerCase()}`,
            email: p.hasEmail ? `${p.first.toLowerCase()}@${p.domain}` : "email_not_unlocked@domain.com",
            email_status: p.hasEmail ? "verified" : "unavailable",
            ...(p.where ? { city: p.where.split(",")[0].trim(), country: "United States" } : { city: "San Francisco", state: "California", country: "United States" }),
            organization: { name: p.firm ?? p.domain.split(".")[0], primary_domain: p.domain },
          },
        },
      };
    }
    if (provider === "fullenrich" && capability === "contacts/work-email") {
      const first = (options.first_name ?? options.linkedin_url?.match(/\/in\/([a-z]+)/)?.[1] ?? "").toLowerCase();
      const known = [...fcIndex.values()].find((p) => p.first.toLowerCase() === first);
      const domain = options.domain ?? known?.domain ?? "example.com";
      if (!first || first.startsWith("x")) return { provider, capability, creditsCost: 0, data: { results: [] } };
      return {
        provider, capability, creditsCost: 20, records: 1,
        data: { results: [{ input: options, contact_info: { most_probable_work_email: { email: `${first}@${domain}`, status: "DELIVERABLE" }, work_emails: [{ email: `${first}@${domain}`, status: "DELIVERABLE" }] }, profile: {} }] },
      };
    }
    return { provider, capability, error: { code: "UNKNOWN_CAPABILITY", message: `Unknown capability ${provider}/${capability}`, status: 400 } };
  });
  const spent = out.reduce((n, r) => n + (r.creditsCost ?? 0), 0);
  fcCredits -= spent;
  json(res, 200, { success: true, scrape_id: id("scrape"), data: { alexandria: out, creditsCost: spent } });
}
