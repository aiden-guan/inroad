import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Today's cards that end through their own buttons, on the sample workspace with a few things added
 * through a restore: an interested prospect who went quiet after the founder offered times (Mei at
 * Driftglass, no deal), the people a call named, and companies from the founder's network. Each "not
 * now" has to mean later, and nothing here may drop a lead with a bare Done.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const daysAgo = (n: number, hour = 15) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function workspace(request: APIRequestContext): Promise<Json> {
  const body = (await (await request.get("/api/workspace")).json()) as Json;
  return (body.workspace ?? body) as Json;
}

/** The sample, plus Mei's yes and the founder's answer, Saltmarsh's referrals and two network companies. */
async function seed(request: APIRequestContext) {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  const ws = await workspace(request);
  ws.activities.push(
    { id: "act_e2e_mei_reply", at: daysAgo(5), kind: "reply_received", personId: "per_mei_tanaka", accountDomain: "driftglass.example", channel: "email", sentiment: "positive", summary: "Mei: yes, keen to talk", body: "Thanks, this is timely. Yes, happy to talk next week." },
    { id: "act_e2e_mei_answer", at: daysAgo(4), kind: "touch_sent", personId: "per_mei_tanaka", accountDomain: "driftglass.example", channel: "email", source: "founder", summary: "Answered Mei with times", body: "Great. Does Tue 2pm or Wed 11am work?" },
  );
  const m = ws.meetings.mtg_saltmarsh_discovery;
  m.debrief = { ...m.debrief, generatedAt: daysAgo(2), referralPeople: [{ name: "Hana Ito", company: "Kestrel Compute", quote: "Hana's team closes the month by hand too, ask her." }, { name: "Victor Osei" }] };
  ws.network = {
    importedAt: daysAgo(1),
    screenedAt: daysAgo(1),
    total: 240,
    atIcpCompanies: 2,
    buyerTitles: 2,
    jobChanges: 0,
    topCompanies: [
      { name: "Kestrel Compute", domain: "kestrel.example", contacts: 2, buyerTitles: 1, fit: "likely", reason: "Usage-priced GPU cloud" },
      { name: "Tallow Data", domain: "tallow.example", contacts: 1, buyerTitles: 1, fit: "likely", reason: "Usage-billed data API" },
    ],
  };
  expect((await request.post("/api/workspace/restore", { data: ws })).ok()).toBe(true);
  expect((await request.post("/api/today/prepare", { data: { reason: "refresh" } })).ok()).toBe(true);
}

/** A card by its title, opening Later when it's folded there. */
async function card(page: Page, title: RegExp): Promise<Locator> {
  const header = page.getByRole("button", { name: title });
  await expect(page.getByRole("region", { name: "Your moves" })).toBeVisible();
  if (!(await header.isVisible())) {
    const later = page.getByRole("button", { name: /^Later/ });
    // Retried: a click that lands before the page has hydrated does nothing.
    await expect(async () => {
      if ((await later.getAttribute("aria-expanded")) !== "true") await later.click();
      await expect(later).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
    }).toPass();
  }
  await expect(header).toBeVisible();
  return header;
}

/** Opens a card (retrying a click that lands before the page has hydrated). */
async function open(header: Locator) {
  await expect(async () => {
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
  }).toPass();
}

const touchesTo = async (request: APIRequestContext, personId: string) =>
  ((await workspace(request)).activities as Json[]).filter((a) => a.personId === personId && a.kind === "touch_sent").length;

const moveStatus = async (request: APIRequestContext, prefix: string) =>
  Object.values((await workspace(request)).moves as Record<string, Json>)
    .filter((m) => String(m.id).startsWith(prefix))
    .map((m) => m.status as string);

test.describe.configure({ mode: "serial" });

test("a booking card has no bare Done, and A marks the nudge as sent", async ({ page, request }) => {
  await seed(request);
  await page.goto("/today");
  const header = await card(page, /^Book Mei: said yes/);
  await open(header);
  const body = page.locator("div.relative.rounded-lg", { has: header });
  await expect(body.getByRole("button", { name: "Mark as sent" })).toBeVisible();
  // Its own ways to end it, and Skip / Tomorrow; no Done that would drop Mei without logging anything.
  await expect(body.getByRole("button", { name: /^Done/ })).toHaveCount(0);
  // The why line already says when the founder answered; the body doesn't repeat it.
  await expect(body.getByText(/^You answered/)).toHaveCount(0);

  const before = await touchesTo(request, "per_mei_tanaka");
  await header.focus();
  await page.keyboard.press("a");
  await expect(page.getByText("Logged the nudge to Mei.", { exact: false })).toBeVisible();
  await expect.poll(() => touchesTo(request, "per_mei_tanaka")).toBe(before + 1);
});

test("parking a booking with no deal takes the card off the desk until then, with Undo", async ({ page, request }) => {
  await seed(request);
  await page.goto("/today");
  const header = await card(page, /^Book Mei: said yes/);
  await open(header);
  await page.getByRole("button", { name: "Not now: check back later" }).click();
  await page.getByRole("button", { name: "Park it" }).click();
  await expect(page.getByText(/^Parked until .+ I'll bring Mei back then\./)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Book Mei: said yes/ })).toHaveCount(0);
  // Snoozed, not done: it comes back on the date.
  await expect.poll(() => moveStatus(request, "mv_book_act_e2e_mei_reply")).toEqual(["snoozed"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => moveStatus(request, "mv_book_act_e2e_mei_reply")).toEqual(["open"]);
});

test("'Not now' on the network card means next week, and the referral card has one Done", async ({ page, request }) => {
  await seed(request);
  // Today holds a dozen open cards a day and the sample fills them: clear the desk so these two get a slot.
  const others = Object.values((await workspace(request)).moves as Record<string, Json>).filter((m) => m.status === "open" && !/^mv_(network_companies|referrals)_/.test(m.id));
  expect((await request.post("/api/workspace/actions", { data: { actions: others.map((m) => ({ type: "move.done", id: m.id })) } })).ok()).toBe(true);
  expect((await request.post("/api/today/prepare", { data: { reason: "refresh" } })).ok()).toBe(true);
  await page.goto("/today");
  const referrals = await card(page, /people Leo suggested|Write to the 2 people/);
  await open(referrals);
  const refCard = page.locator("div.relative.rounded-lg", { has: referrals });
  await expect(refCard.getByRole("button", { name: /^Done/ })).toHaveCount(1);
  await expect(refCard.getByRole("button", { name: "Done for now" })).toHaveCount(0);
  await referrals.click();

  const network = await card(page, /^Track 2 companies where you know someone/);
  await open(network);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("I'll bring these back next week.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Track 2 companies where you know someone/ })).toHaveCount(0);
  await expect.poll(() => moveStatus(request, "mv_network_companies_")).toEqual(["snoozed"]);
});

test("a dossier with nothing citable says watch, as Today does, and offers no draft that can only fail", async ({ page, request }) => {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  const ws = await workspace(request);
  const acc = Object.values(ws.accounts as Record<string, Json>).find((a) => a.dossier?.recommendation?.move === "cold_email")!;
  expect(acc).toBeTruthy();
  // Everything behind its angles and signals is a low-confidence search snippet.
  const ids = [...acc.dossier.angles.flatMap((a: Json) => a.evidenceIds), ...acc.signals.map((s: Json) => s.evidenceId)].filter(Boolean);
  for (const id of ids) if (ws.evidence[id]) ws.evidence[id].confidence = "low";
  expect((await request.post("/api/workspace/restore", { data: ws })).ok()).toBe(true);

  await page.goto(`/companies?c=${encodeURIComponent(acc.domain)}`);
  await expect(page.getByText("My recommendation")).toBeVisible();
  await expect(page.getByText("Watch, don't write yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Write the first email" })).toHaveCount(0);
});

test("on a phone, a referral's quote gets the card's width, with its action below", async ({ page, request }) => {
  await seed(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  const referrals = await card(page, /Write to the 2 people/);
  await open(referrals);
  const quote = page.getByText("“Hana's team closes the month by hand too, ask her.”");
  await expect(quote).toBeVisible();
  const row = page.locator("li", { has: quote }).last();
  const [q, r] = [(await quote.boundingBox())!, (await row.boundingBox())!];
  expect(q.width).toBeGreaterThan(r.width * 0.8);
  const add = row.getByRole("button", { name: "Add Kestrel Compute" });
  expect((await add.boundingBox())!.y).toBeGreaterThan(q.y + q.height - 1);
});

test("the monthly review says whose time each number is, in plain words", async ({ page, request }) => {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  const ws = await workspace(request);
  ws.onboarding.hiredAt = daysAgo(40);
  expect((await request.post("/api/workspace/restore", { data: ws })).ok()).toBe(true);
  expect((await request.post("/api/today/prepare", { data: { reason: "refresh" } })).ok()).toBe(true);
  const others = Object.values((await workspace(request)).moves as Record<string, Json>).filter((m) => m.status === "open" && !m.id.startsWith("mv_review_monthly_"));
  if (others.length) expect((await request.post("/api/workspace/actions", { data: { actions: others.map((m) => ({ type: "move.done", id: m.id })) } })).ok()).toBe(true);
  expect((await request.post("/api/today/prepare", { data: { reason: "refresh" } })).ok()).toBe(true);

  await page.goto("/today");
  const review = await card(page, /^Monthly review/);
  await open(review);
  await expect(page.getByText(/About two minutes for me, then about half an hour for you to decide\./)).toBeVisible();
  await expect(page.getByText(/log your quotes against how they landed/)).toHaveCount(0);
});

test("day one asks for the LinkedIn import once, in the card for it", async ({ page, request }) => {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  const ws = await workspace(request);
  // Hired, no companies yet, no network and no investors: the first Today after onboarding without a list.
  Object.assign(ws, { sample: undefined, accounts: {}, people: {}, deals: {}, meetings: {}, outreach: {}, intros: {}, events: {}, activities: [], moves: {}, connectors: [], network: undefined });
  expect((await request.post("/api/workspace/restore", { data: ws })).ok()).toBe(true);
  expect((await request.post("/api/today/prepare", { data: { reason: "refresh" } })).ok()).toBe(true);

  await page.goto("/today");
  await expect(page.getByText("Let's find your first three companies")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Bring in your network/ })).toBeVisible();
  await expect(page.getByText(/Import your LinkedIn connections and I'll start/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Or import your LinkedIn connections first" })).toHaveCount(0);
});

test("research that ran out of credits says so after a reload, with Add credits first", async ({ page, request }) => {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  const ws = await workspace(request);
  const domain = "ashgrove.example";
  delete ws.accounts[domain].dossier;
  ws.runs.unshift({ id: "run_e2e_credit", workflow: "dossier", title: "Researching Ashgrove", ref: { kind: "account", id: domain }, startedAt: daysAgo(0, 9), endedAt: daysAgo(0, 9), status: "error", error: { code: "no_credit", message: "Your Anthropic account is out of credits." } });
  expect((await request.post("/api/workspace/restore", { data: ws })).ok()).toBe(true);

  await page.goto(`/companies?c=${domain}`);
  await expect(page.getByText(/My research on .+ didn't finish\./)).toBeVisible();
  await expect(page.getByText("Your Anthropic account is out of credits.")).toBeVisible();
  const add = page.getByRole("link", { name: "Add credits" }).first();
  await expect(add).toHaveAttribute("href", /console\.anthropic\.com/);
  await expect(page.getByText("Trying again costs about the same as the first attempt.")).toHaveCount(0);
});

test("with reduced motion, holding to close as lost says to keep holding", async ({ page, request }) => {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  const ws = await workspace(request);
  // Leo at Saltmarsh (an open deal) said yes after the call, and the founder answered with times.
  ws.activities.push(
    { id: "act_e2e_leo_reply", at: daysAgo(5), kind: "reply_received", personId: "per_leo_marchetti", accountDomain: "saltmarsh.example", channel: "email", sentiment: "positive", summary: "Leo: yes", body: "This is relevant. Let's find a time." },
    { id: "act_e2e_leo_answer", at: daysAgo(4), kind: "touch_sent", personId: "per_leo_marchetti", accountDomain: "saltmarsh.example", channel: "email", source: "founder", summary: "Answered Leo with times", body: "Tue 2pm or Wed 11am?" },
  );
  expect((await request.post("/api/workspace/restore", { data: ws })).ok()).toBe(true);
  expect((await request.post("/api/today/prepare", { data: { reason: "refresh" } })).ok()).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/today");
  const header = await card(page, /^Book Leo: said yes/);
  await open(header);
  await page.getByRole("button", { name: "Let it go" }).click();
  const hold = page.getByRole("button", { name: "Hold to close as lost" });
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole("button", { name: "Keep holding…" })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Hold to close as lost" })).toBeVisible();
});

// Last: a whole first run, on a phone, on a fresh workspace.
test("on a phone: skipping the two questions keeps the list drop, and the orb flies to Today's header", async ({ page, request }) => {
  expect((await request.post("/api/workspace/reset")).ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await page.locator("#site").fill("acme.com");
  await page.locator("#note").fill("We reconcile usage data with invoices so finance teams close the month in hours.");
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("heading", { name: /Two quick ones while I read/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Got a list? Drop it here")).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Two quick ones while I read/ })).toHaveCount(0);
  await expect(page.getByText("Got a list? Drop it here")).toBeVisible();

  // The offer card is long on a phone and its button at the bottom, far below the orb at the top.
  const cta = page.getByRole("button", { name: /^(Go to Today|Research these \d|Research this one)/ });
  await expect(cta).toBeEnabled({ timeout: 180_000 });
  await page.locator("#founder-name").fill("Priya");
  await page.evaluate(() => {
    const w = window as unknown as { __vt: string[] };
    w.__vt = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
      const t = start(arg);
      void t.ready.then(() => w.__vt.push(...document.getAnimations().map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? "")), () => {});
      return t;
    }) as typeof document.startViewTransition;
  });
  await cta.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await cta.click();
  await expect(page).toHaveURL(/\/today/, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vt: string[] }).__vt.some((p) => p.startsWith("::view-transition-group(ember-orb)")))).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
