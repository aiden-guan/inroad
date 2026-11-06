import { test, expect, type APIRequestContext } from "@playwright/test";
import type { Workspace } from "../src/lib/domain/types";

let before: Workspace;
test.use({ actionTimeout: 15_000 });
async function read(request: APIRequestContext): Promise<Workspace> { return (await request.get("/api/workspace")).json(); }
async function restore(request: APIRequestContext, ws: Workspace) { const response = await request.post("/api/workspace/restore", { data: ws }); expect(response.ok(), await response.text()).toBe(true); }

test.beforeEach(async ({ page, request }) => {
  before = await read(request);
  if (!before.company) await request.post("/api/workspace/sample", { data: {} });
  const ws = await read(request); const at = new Date().toISOString();
  ws.sample = false; ws.onboarding.status = "hired"; ws.company!.market = "consumer"; ws.company!.consumerModel = "app";
  ws.goal.metric = "active_users"; ws.growthDashboard = undefined; ws.growthLog = []; ws.gtmInitiatives = {}; ws.metricHistory = {};
  ws.waitlist = { enabled: true, connectedAt: at, source: { id: "fixture", provider: "convex", label: "Convex · waitlist", table: { name: "waitlist" } }, current: { sourceId: "fixture", at, total: 41 }, history: [{ sourceId: "fixture", at: new Date(Date.now() - 7 * 86400000).toISOString(), total: 39 }, { sourceId: "fixture", at, total: 41 }], goal: 1000 };
  ws.integrations = { posthog: { id: "posthog", enabled: true, connectedAt: at, lastSyncAt: at, config: { projectId: "695972", projectName: "alai", region: "us", activityEvent: "", identifiedOnly: true } }, stripe: { id: "stripe", enabled: true, connectedAt: at, lastSyncAt: at, config: {} } };
  ws.businessMetrics = {
    posthog: { provider: "posthog", accountLabel: "alai · US", environment: "live", syncedAt: at, windowStart: at, windowEnd: at, metrics: [1, 7, 30].map((d) => ({ key: `active_${d}d`, label: "Active users", value: d === 1 ? 4 : 9, period: d === 1 ? "24 hours" : `${d} days`, definition: "Unique identified people with recorded activity." })), notes: [] },
    stripe: { provider: "stripe", accountLabel: "Stripe", environment: "live", syncedAt: at, windowStart: at, windowEnd: at, metrics: [{ key: "collected_30d_usd", label: "Collected revenue", value: 7.49, currency: "USD", period: "30 days", definition: "Refund-adjusted captured payments." }, { key: "paying_customers_30d", label: "Paying customers", value: 1, period: "30 days", definition: "Distinct paying customers." }], notes: [] },
  };
  await restore(request, ws);
  await page.route("**/api/integrations/poll", (route) => route.fulfill({ json: { results: [], changed: false } }));
});
test.afterEach(async ({ request }) => { if (before) await restore(request, before); });

test("choose individual metrics and keep the layout after reload through the real API", async ({ page, request }) => {
  await page.goto("/growth");
  await expect(page.getByRole("region", { name: "Active users · 7 days", exact: true })).toContainText("9");
  await page.getByRole("button", { name: "Add cards", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make Growth yours" });
  await dialog.getByRole("checkbox", { name: "Active users 24 hours", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Growth goal", exact: false }).uncheck();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('[data-growth-card="metric:posthog:active_1d"]')).toBeVisible();
  await expect(page.locator('[data-growth-card="goal"]')).toHaveCount(0);
  await expect.poll(async () => (await read(request)).growthDashboard?.cards.map((c) => c.id)).toContain("metric:posthog:active_1d");
  await page.reload();
  await expect(page.getByRole("region", { name: "Active users · 24 hours", exact: true })).toContainText("4");
  await expect(page.locator('[data-growth-card="goal"]')).toHaveCount(0);
});

test("pointer drag reorders cards and width and hide controls persist", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/growth");
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  const source = page.locator('[data-growth-card="waitlist"]'); const target = page.locator('[data-growth-card="metric:posthog:active_7d"]');
  const a = await source.getByRole("button", { name: "Move Waitlist", exact: true }).boundingBox(); const b = await target.boundingBox();
  expect(a).toBeTruthy(); expect(b).toBeTruthy();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2); await page.mouse.down(); await page.mouse.move(a!.x + a!.width / 2 + 10, a!.y + a!.height / 2, { steps: 5 }); await page.mouse.move(b!.x + b!.width / 2, b!.y + 25, { steps: 20 }); await page.mouse.up();
  await expect.poll(async () => (await read(request)).growthDashboard?.cards[0].id).toBe("metric:posthog:active_7d");
  await source.getByRole("button", { name: "Options for Waitlist" }).click(); await page.getByRole("menuitem", { name: "Full width", exact: true }).click();
  await expect.poll(async () => (await read(request)).growthDashboard?.cards.find((c) => c.id === "waitlist")?.wide).toBe(true);
  await target.getByRole("button", { name: "Options for Active users" }).click(); await page.getByRole("menuitem", { name: "Hide card", exact: true }).click();
  await page.getByRole("button", { name: "Done editing", exact: true }).click(); await page.reload();
  await expect(target).toHaveCount(0); await expect(source).toHaveClass(/md:col-span-2/);
});

test("keyboard rearranging and a hidden weekly log remain usable", async ({ page, request }) => {
  const ws = await read(request); ws.growthDashboard = { cards: [{ id: "waitlist", wide: false }, { id: "metric:posthog:active_7d", wide: false }] }; await restore(request, ws);
  await page.setViewportSize({ width: 390, height: 1000 }); await page.goto("/growth"); await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  const handle = page.getByRole("button", { name: "Move Waitlist", exact: true }); await handle.focus(); await handle.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await handle.press("ArrowDown");
  await expect(page.getByRole("status").filter({ hasText: "was moved over droppable area metric:posthog:active_7d" })).toBeAttached();
  await handle.press("Space");
  await expect.poll(async () => (await read(request)).growthDashboard?.cards[0].id).toBe("metric:posthog:active_7d");
  await page.getByRole("button", { name: "Done editing", exact: true }).click(); await page.getByRole("button", { name: "Log last week", exact: true }).first().click();
  await expect(page.getByLabel("Signups", { exact: true })).toBeVisible();
  expect((await read(request)).growthDashboard?.cards.map((c) => c.id)).not.toContain("weekly");
});

for (const width of [390, 1440]) test(`dashboard fits at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 1000 }); await page.goto("/growth");
  await expect(page.getByLabel("41 waitlist signups", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`growth-${width}.png`), fullPage: false });
});

test("PostHog exposes its project and switches with the saved connection", async ({ page, request }) => {
  await page.route("**/api/metrics/posthog/projects", (route) => route.fulfill({ json: { projects: [{ id: "668142", name: "Default project", region: "us" }, { id: "695972", name: "alai", region: "us" }] } }));
  await page.route("**/api/metrics/posthog", async (route) => {
    expect(route.request().method()).toBe("PATCH"); expect(route.request().postDataJSON()).toEqual({ projectId: "668142", region: "us" });
    const ws = await read(request); ws.integrations.posthog!.config.projectId = "668142"; ws.businessMetrics!.posthog!.accountLabel = "Default project · US"; await restore(request, ws);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/integrations#posthog");
  await expect(page.getByRole("link", { name: "Project 695972 · US ↗" })).toBeVisible();
  await page.getByRole("button", { name: "Change project", exact: true }).click();
  await page.getByRole("button", { name: /Default project 668142/ }).click();
  await expect(page.getByRole("link", { name: "Project 668142 · US ↗" })).toBeVisible();
});
