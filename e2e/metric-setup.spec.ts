import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const response = await page.request.get("/api/workspace");
  const ws = await response.json();
  ws.sample = false;
  ws.onboarding.status = "hired";
  ws.integrations = {};
  ws.businessMetrics = {};
  await page.route("**/api/workspace", (route) => route.fulfill({ json: ws }));
  await page.route("**/api/integrations/poll", (route) => route.fulfill({ json: { results: [], changed: false } }));
  return ws;
}

for (const width of [390, 1280]) {
  test(`PostHog starts with one sign-in button and no setup fields at ${width}px`, async ({ page }, testInfo) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/integrations#posthog");
    const panel = page.getByRole("region", { name: "PostHog", exact: true });
    await expect(panel.getByRole("button", { name: "Connect PostHog", exact: true })).toBeEnabled();
    await expect(panel.locator("input:visible")).toHaveCount(0);
    await expect(panel.getByText("PostHog region", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("Project ID", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`posthog-simple-${width}.png`), fullPage: false });
    await page.locator("li#posthog").screenshot({ path: testInfo.outputPath(`posthog-card-${width}.png`), animations: "disabled" });
  });
}

test("PostHog connects with just the app button and provider approval when there is one project", async ({ page, context }) => {
  const ws = await fixture(page);
  let approved = false;
  const flow = { flowId: "fixture_connection_state_123456", status: "waiting", url: "https://oauth.posthog.com/oauth/authorize/?client_id=fixture" };
  await context.route("https://oauth.posthog.com/**", (route) => {
    if (route.request().url().includes("/approved")) { approved = true; return route.fulfill({ contentType: "text/html", body: "Connected. Return to Inroad." }); }
    return route.fulfill({ contentType: "text/html", body: '<html><body><h1>PostHog</h1><form action="/approved"><button type="submit">Approve access</button></form></body></html>' });
  });
  await page.route("**/api/metrics/posthog/oauth", (route) => route.fulfill({ json: flow }));
  await page.route("**/api/metrics/posthog/oauth?*", (route) => {
    if (approved) {
      const at = new Date().toISOString();
      ws.integrations.posthog = { id: "posthog", enabled: true, connectedAt: at, lastSyncAt: at, config: { projectId: "17", projectName: "My app", region: "us", authMode: "oauth", activityEvent: "", identifiedOnly: true } };
      ws.businessMetrics.posthog = { provider: "posthog", syncedAt: at, windowStart: at, windowEnd: at, accountLabel: "My app · US", environment: "live", metrics: [{ key: "active_7d", label: "Active users", value: 42, period: "7 days", definition: "Fixture" }], notes: [] };
    }
    return route.fulfill({ json: { ...flow, status: approved ? "done" : "waiting" } });
  });
  await page.goto("/integrations#posthog");
  const popupEvent = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect PostHog", exact: true }).click();
  const popup = await popupEvent;
  await popup.getByRole("button", { name: "Approve access" }).click();
  await expect(page.getByText("My app · US", { exact: true })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "42" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect PostHog", exact: true })).toHaveCount(0);
  await popup.close();
});

test("several PostHog projects require one named choice, with no IDs to type", async ({ page }) => {
  const ws = await fixture(page);
  const flowId = "fixture_connection_state_123456";
  await page.route("**/api/metrics/posthog/connect", async (route) => {
    const body = route.request().postDataJSON();
    if (body.key) return route.fulfill({ json: { flowId, status: "choose", projects: [{ id: "17", name: "Website", region: "us" }, { id: "24", name: "Mobile app", region: "eu" }] } });
    expect(body).toEqual({ flowId, projectId: "24", region: "eu" });
    ws.integrations.posthog = { id: "posthog", enabled: true, config: { projectName: "Mobile app" } };
    return route.fulfill({ json: { flowId, status: "done" } });
  });
  await page.goto("/integrations#posthog");
  await page.getByText("Use an API key instead", { exact: true }).click();
  await page.getByLabel("Personal API key", { exact: true }).fill("phx_fixture_key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Mobile app", exact: true }).click();
  await expect(page.getByRole("button", { name: "Change connection", exact: true })).toBeVisible();
});

test("Stripe and Polar need just a key, and connect immediately when pasted", async ({ page }) => {
  const ws = await fixture(page);
  for (const [id, key] of [["stripe", "rk_test_fixture_key"], ["polar", "polar_oat_fixture_key"]]) {
    await page.route(`**/api/metrics/${id}`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ key, config: {} });
      ws.integrations[id] = { id, enabled: true, config: {} };
      return route.fulfill({ json: { ok: true, workspace: ws } });
    });
    await page.goto(`/integrations#${id}`);
    const name = id === "stripe" ? "Stripe" : "Polar";
    const panel = page.getByRole("region", { name, exact: true });
    await expect(panel.locator("input:visible")).toHaveCount(1);
    await panel.locator("input").evaluate((input, value) => { const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", value); input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData })); }, key);
    await expect(panel.getByRole("button", { name: "Change connection", exact: true })).toBeVisible();
  }
});
