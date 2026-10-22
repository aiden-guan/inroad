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

// Last: it starts a first run on a fresh workspace and leaves it reading.
test("skipping the two questions while the site is read keeps the list drop", async ({ page, request }) => {
  expect((await request.post("/api/workspace/reset")).ok()).toBe(true);
  await page.goto("/welcome");
  await page.locator("#site").fill("acme.com");
  await page.locator("#note").fill("We reconcile usage data with invoices so finance teams close the month in hours.");
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("heading", { name: /Two quick ones while I read/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Got a list? Drop it here")).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Two quick ones while I read/ })).toHaveCount(0);
  await expect(page.getByText("Got a list? Drop it here")).toBeVisible();
});
