import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, connected = false, market = "consumer") {
  let ws = await (await page.request.get("/api/workspace")).json();
  if (!ws.company) {
    const sample = await page.request.post("/api/workspace/sample", { data: {} });
    expect(sample.ok()).toBe(true);
    ws = await sample.json();
  }
  ws.sample = false; ws.onboarding.status = "hired";
  ws.company.market = market; ws.company.consumerModel = market === "consumer" ? "app" : undefined;
  ws.growthLog = []; ws.integrations = {}; ws.businessMetrics = {};
  ws.goal.metric = market === "consumer" ? "active_users" : "deals";
  ws.waitlist = connected ? state() : undefined;
  await page.route("**/api/workspace", (route) => route.fulfill({ json: ws }));
  await page.route("**/api/integrations/poll", (route) => route.fulfill({ json: { results: [], changed: false } }));
  return ws;
}

function state(total = 1234) {
  return { enabled: true, connectedAt: "2026-10-20T12:00:00Z", source: { id: "fixture", provider: "convex", label: "Convex · waitlist", table: { name: "waitlist" } }, current: { sourceId: "fixture", at: "2026-10-29T12:00:00Z", total }, history: [{ sourceId: "fixture", at: "2026-10-20T12:00:00Z", total: 1100 }, { sourceId: "fixture", at: "2026-10-29T12:00:00Z", total }], goal: 2000 };
}

test("a Convex waitlist connects on one paste and takes priority over post-launch forms", async ({ page }) => {
  const ws = await fixture(page);
  let requests = 0;
  await page.route("**/api/waitlist", (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: "convex", credential: "prod:my-waitlist|fixture" });
    requests++; ws.waitlist = state();
    return route.fulfill({ json: { status: "done" } });
  });
  await page.goto("/growth");
  await page.getByRole("button", { name: "Connect Convex", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Convex waitlist" });
  await expect(dialog.locator("input:visible")).toHaveCount(1);
  await dialog.getByLabel("Deploy key").evaluate((input) => { const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "prod:my-waitlist|fixture"); input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData })); });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("1,234 waitlist signups", { exact: true })).toBeVisible();
  await expect(page.getByText("Product growth, after launch", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Signups", { exact: true })).not.toBeVisible();
  expect(requests).toBe(1);
});

test("Postgres asks for just the connection string and a named choice when needed", async ({ page }) => {
  const ws = await fixture(page);
  const credential = "postgresql://reader:fixture@host.neon.tech/database";
  await page.route("**/api/waitlist", (route) => {
    const body = route.request().postDataJSON();
    expect(body.provider).toBe("postgres"); expect(body.credential).toBe(credential);
    if (!body.table) return route.fulfill({ json: { status: "choose", tables: [{ schema: "public", name: "launch_signups" }, { schema: "public", name: "users" }] } });
    expect(body.table).toEqual({ schema: "public", name: "launch_signups" });
    ws.waitlist = state(0);
    return route.fulfill({ json: { status: "done" } });
  });
  await page.goto("/growth");
  await page.getByRole("button", { name: "Neon", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("input:visible")).toHaveCount(1);
  await dialog.getByLabel("Connection string").fill(credential);
  await dialog.getByRole("button", { name: "Connect waitlist", exact: true }).click();
  await dialog.getByRole("button", { name: "public.launch_signups", exact: true }).click();
  await expect(page.getByLabel("0 waitlist signups", { exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`waitlist totals, history and target fit at ${width}px`, async ({ page }, testInfo) => {
    await fixture(page, true);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/growth");
    const panel = page.getByRole("region", { name: "Waitlist", exact: true });
    await expect(panel.getByLabel("1,234 waitlist signups", { exact: true })).toBeVisible();
    await expect(panel.getByRole("progressbar", { name: "Waitlist goal progress" })).toHaveAttribute("aria-valuenow", "1234");
    await expect(panel.getByRole("img", { name: /Waitlist history/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`waitlist-${width}.png`), animations: "disabled" });
  });
}

test("target edits and disconnect preserve the saved count and history", async ({ page }) => {
  const ws = await fixture(page, true);
  await page.route("**/api/waitlist", (route) => {
    if (route.request().method() === "PATCH") ws.waitlist.goal = route.request().postDataJSON().goal;
    if (route.request().method() === "DELETE") ws.waitlist.enabled = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/growth");
  const panel = page.getByRole("region", { name: "Waitlist", exact: true });
  await panel.getByText("Manage waitlist", { exact: true }).click();
  await panel.getByLabel("Waitlist target (optional)").fill("3,000");
  await panel.getByRole("button", { name: "Save target", exact: true }).click();
  await expect(panel.getByText("Goal: 3,000", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Disconnect waitlist", exact: true }).click();
  await expect(panel.getByText("Last saved waitlist total", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("1,234 waitlist signups", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Reconnect waitlist", exact: true })).toBeVisible();
});

test("business companies do not see consumer waitlist setup", async ({ page }) => {
  await fixture(page, true, "b2b");
  await page.goto("/integrations");
  await expect(page.getByRole("region", { name: "Waitlist", exact: true })).toHaveCount(0);
});
