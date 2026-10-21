/**
 * Firecrawl connector checks against a local fake of the API. Run:
 *   npx tsx --conditions=react-server src/lib/connectors/firecrawl.test.ts
 * Plain node:assert, no test runner: request shape, response mapping, error mapping and retries.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> | null };

const queue: Reply[] = [];
const seen: Seen[] = [];

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : null });
  const next = queue.shift() ?? { status: 500, body: { success: false, error: "no reply queued" } };
  res.writeHead(next.status, { "content-type": "application/json", ...next.headers }).end(JSON.stringify(next.body));
});

const item = (data: unknown, creditsCost = 0) => ({ status: 200, body: { success: true, scrape_id: "s1", data: { alexandria: [{ provider: "p", capability: "c", creditsCost, data }], creditsCost } } });

const results: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  queue.length = 0;
  seen.length = 0;
  await fn();
  results.push(name);
  console.log(`  ok   ${name}`);
}

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.FIRECRAWL_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { firecrawl } = await import("./firecrawl");
  const fc = firecrawl("fc-test_key_123456", {});
  const people = fc.people!;
  console.log("firecrawl");

  await check("validate rejects a key that isn't fc-…, without a network call", async () => {
    const r = await firecrawl("sk-ant-nope-123456", {}).validate();
    assert.equal(r.ok, false);
    assert.equal(seen.length, 0);
  });

  await check("validate reads the credit balance into the account label", async () => {
    queue.push({ status: 200, body: { success: true, data: { remainingCredits: 4200, planCredits: 5000 } } });
    const r = await fc.validate();
    assert.ok(r.ok);
    assert.equal(r.value.accountLabel, "4,200 credits left");
    assert.deepEqual(r.value.config, { planCredits: 5000 });
    assert.equal(seen[0].url, "/v2/team/credit-usage");
    assert.equal(seen[0].headers.authorization, "Bearer fc-test_key_123456");
  });

  await check("search sends one Apollo call by domain and titles, and maps masked previews", async () => {
    queue.push(item({ people: [{ id: "a1", first_name: "Maya", last_name: "O***", title: "Controller", organization: { name: "Acme" }, has_email: true }, { id: "", first_name: "x" }], total_entries: 23 }));
    const r = await people.search({ domain: "acme.com", titles: ["Controller", "CFO"] });
    assert.ok(r.ok);
    assert.equal(r.value.credits, 0);
    assert.equal(r.value.value.total, 23);
    assert.deepEqual(r.value.value.people, [{ id: "a1", firstName: "Maya", lastName: "O***", title: "Controller", companyName: "Acme", hasEmail: true }]);
    const s = seen[0];
    assert.equal(s.url, "/v2/scrape");
    assert.match(String(s.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
    const call = (s.body!.alexandria as Record<string, unknown>[])[0];
    assert.equal(call.provider, "apollo");
    assert.equal(call.capability, "people/search");
    assert.deepEqual((call.options as Record<string, unknown>).q_organization_domains_list, ["acme.com"]);
    assert.deepEqual((call.options as Record<string, unknown>).person_titles, ["Controller", "CFO"]);
  });

  await check("add never asks for personal emails or phones, and keeps a verified work email", async () => {
    queue.push(
      item(
        {
          person: {
            id: "a1",
            name: "Maya Okafor",
            title: "Controller",
            email: "Maya@Acme.com",
            email_status: "verified",
            linkedin_url: "https://www.linkedin.com/in/maya-okafor",
            city: "San Francisco",
            country: "United States",
            organization: { primary_domain: "acme.com" },
          },
        },
        30,
      ),
    );
    const r = await people.add("a1");
    assert.ok(r.ok);
    assert.equal(r.value.credits, 30);
    assert.deepEqual(r.value.value, {
      id: "a1",
      name: "Maya Okafor",
      title: "Controller",
      linkedinUrl: "https://www.linkedin.com/in/maya-okafor",
      location: "San Francisco, United States",
      companyDomain: "acme.com",
      email: { address: "maya@acme.com", verified: true, status: "verified" },
    });
    const options = (seen[0].body!.alexandria as Record<string, unknown>[])[0].options as Record<string, unknown>;
    assert.equal(options.reveal_personal_emails, false);
    assert.equal(options.reveal_phone_number, false);
  });

  await check("add drops Apollo's locked placeholder and personal mailboxes; a miss is null", async () => {
    queue.push(item({ person: { id: "a2", name: "Tom B", email: "email_not_unlocked@domain.com", email_status: "verified" } }, 30));
    const locked = await people.add("a2");
    assert.ok(locked.ok);
    assert.equal(locked.value.value?.email, undefined);
    queue.push(item({ person: { id: "a3", name: "Sam C", email: "sam@gmail.com", email_status: "verified" } }, 30));
    const personal = await people.add("a3");
    assert.ok(personal.ok);
    assert.equal(personal.value.value?.email, undefined);
    queue.push(item({ person: null }, 0));
    const miss = await people.add("a4");
    assert.ok(miss.ok);
    assert.equal(miss.value.value, null);
    assert.equal(miss.value.credits, 0);
  });

  await check("work email: DELIVERABLE is verified, CATCH_ALL is not, nothing found is null", async () => {
    queue.push(item({ results: [{ contact_info: { most_probable_work_email: { email: "kenji@acme.com", status: "DELIVERABLE" } } }] }, 20));
    const good = await people.workEmail({ linkedinUrl: "https://www.linkedin.com/in/kenji" });
    assert.ok(good.ok);
    assert.deepEqual(good.value.value, { address: "kenji@acme.com", verified: true, status: "DELIVERABLE" });
    const call = (seen[0].body!.alexandria as Record<string, unknown>[])[0];
    assert.equal(call.provider, "fullenrich");
    assert.equal(call.capability, "contacts/work-email");
    assert.deepEqual(call.options, { linkedin_url: "https://www.linkedin.com/in/kenji" });

    queue.push(item({ results: [{ contact_info: { most_probable_work_email: "ravi@acme.com", work_emails: [{ email: "ravi@acme.com", status: "CATCH_ALL" }] } }] }, 20));
    const catchAll = await people.workEmail({ firstName: "Ravi", lastName: "Iyer", domain: "acme.com" });
    assert.ok(catchAll.ok);
    assert.deepEqual(catchAll.value.value, { address: "ravi@acme.com", verified: false, status: "CATCH_ALL" });

    queue.push(item({ results: [] }, 0));
    const none = await people.workEmail({ firstName: "No", lastName: "One", domain: "acme.com" });
    assert.ok(none.ok);
    assert.equal(none.value.value, null);
  });

  await check("terms not accepted (top level or per call) names the provider and links the fix", async () => {
    queue.push({ status: 403, body: { success: false, error: "Terms required", code: "THIRD_PARTY_DATA_TERMS_REQUIRED", requiresAction: { type: "accept_terms", url: "https://www.firecrawl.dev/app/terms" } } });
    const top = await people.search({ domain: "acme.com", titles: [] });
    assert.ok(!top.ok);
    assert.equal(top.error.code, "forbidden");
    assert.equal(top.error.fixUrl, "https://www.firecrawl.dev/app/terms");

    queue.push({
      status: 200,
      body: { success: true, data: { creditsCost: 0, alexandria: [{ provider: "fullenrich", error: { code: "THIRD_PARTY_DATA_TERMS_REQUIRED", message: "x", status: 403, requiresAction: { url: "https://www.firecrawl.dev/app/fe" } } }] } },
    });
    const perCall = await people.workEmail({ linkedinUrl: "https://www.linkedin.com/in/x" });
    assert.ok(!perCall.ok);
    assert.match(perCall.error.message, /^FullEnrich's data terms/);
    assert.equal(perCall.error.fixUrl, "https://www.firecrawl.dev/app/fe");
  });

  await check("401 is a bad key, 402 is out of credits, and the key never appears in a message", async () => {
    queue.push({ status: 401, body: { success: false, error: "Unauthorized: fc-test_key_123456 is invalid" } });
    const auth = await people.credits();
    assert.ok(!auth.ok);
    assert.equal(auth.error.code, "auth");
    assert.ok(!auth.error.message.includes("fc-test_key_123456"));
    queue.push({ status: 402, body: { success: false, error: "Insufficient credits fc-test_key_123456" } });
    const plan = await people.add("a1");
    assert.ok(!plan.ok);
    assert.equal(plan.error.code, "plan");
  });

  await check("a 503 is retried with the same request id, so a retry is never billed twice", async () => {
    queue.push({ status: 503, body: { success: false, error: "busy" }, headers: { "retry-after": "0" } });
    queue.push(item({ people: [] }));
    const r = await people.search({ domain: "acme.com", titles: [] });
    assert.ok(r.ok);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].headers["x-request-id"], seen[1].headers["x-request-id"]);
  });

  server.close();
  console.log(`\nall passing (${results.length})`);
}

main().catch((err) => {
  server.close();
  console.error(err);
  process.exit(1);
});
