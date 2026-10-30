import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Workspace } from "../src/lib/domain/types";

let before: Workspace;
const ago = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); date.setHours(12, 0, 0, 0); return date.toISOString(); };
async function read(request: APIRequestContext): Promise<Workspace> { return (await request.get("/api/workspace")).json(); }
async function restore(request: APIRequestContext, ws: Workspace) { const response = await request.post("/api/workspace/restore", { data: ws }); expect(response.ok(), await response.text()).toBe(true); }

test.beforeEach(async ({ page, request }) => {
  before = await read(request);
  if (!before.company) expect((await request.post("/api/workspace/sample", { data: {} })).ok()).toBe(true);
  const ws = await read(request);
  ws.sample = false; ws.onboarding.status = "hired";
  ws.company!.market = "consumer"; ws.company!.consumerModel = "app";
  ws.goal.metric = "active_users";
  ws.growthLog = []; ws.waitlist = undefined; ws.gtmInitiatives = {}; ws.metricHistory = {};
  ws.deals = {}; ws.moves = {}; ws.activities = []; ws.runs = [];
  const at = new Date().toISOString();
  ws.integrations = { posthog: { id: "posthog", enabled: true, connectedAt: at, config: { projectId: "12", region: "us", activityEvent: "", identifiedOnly: true, metricConnectionId: "e2e-project" }, lastSyncAt: at } };
  ws.businessMetrics = { posthog: { provider: "posthog", accountLabel: "Product", environment: "live", syncedAt: at, windowStart: ago(7), windowEnd: at, metrics: [{ key: "active_7d", label: "Active users", value: 42, period: "7 days", definition: "Unique identified people with recorded activity." }], notes: [] } };
  await restore(request, ws);
  await page.route("**/api/integrations/poll", (route) => route.fulfill({ json: { results: [], changed: false } }));
});

test.afterEach(async ({ request }) => { if (before) await restore(request, before); });

async function add(page: Page, title = "Improve the welcome flow", target?: string) {
  await page.goto("/growth");
  const panel = page.getByRole("region", { name: "This week's GTM priorities", exact: true });
  await panel.getByRole("button", { name: "Add initiative", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a GTM initiative", exact: true });
  await dialog.getByLabel("What will you improve?").fill(title);
  if (target) await dialog.getByLabel("Target (optional)", { exact: true }).fill(target);
  await dialog.getByRole("button", { name: "Add initiative", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
  return panel;
}

test("an initiative needs only a title and captures its baseline through the real API", async ({ page, request }) => {
  await add(page);
  const items = Object.values((await read(request)).gtmInitiatives!);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ owner: "Me", status: "active", market: "consumer", measurement: { baseline: { value: 42 } } });
});

test("the weekly plan copies current progress, owner and review date", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await add(page, "Make the welcome flow clearer", "100");
  await panel.getByRole("button", { name: "Copy weekly plan", exact: true }).click();
  await expect(page.getByText("Weekly execution plan copied.", { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Make the welcome flow clearer | Me |");
  expect(copied).toContain("Active users · 7 days · PostHog · Product;");
  expect(copied).toContain("42 → 42; target 100; source observation");
  expect(copied).toContain("Observed before/after changes do not establish");
});

test("live progress updates automatically and a reviewed readout stays fixed", async ({ page, request }) => {
  let panel = await add(page, "Reach one hundred active users", "100");
  let ws = await read(request); ws.businessMetrics!.posthog!.metrics[0].value = 71; ws.businessMetrics!.posthog!.syncedAt = new Date().toISOString();
  await restore(request, ws); await page.reload();
  panel = page.getByRole("region", { name: "This week's GTM priorities", exact: true });
  await expect(panel.getByRole("progressbar", { name: "Progress for Reach one hundred active users" })).toHaveAttribute("aria-valuenow", "50");
  await panel.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(panel.getByText("Reviewed and parked · 1", { exact: true })).toBeVisible();
  ws = await read(request); ws.businessMetrics!.posthog!.metrics[0].value = 999; ws.businessMetrics!.posthog!.syncedAt = new Date().toISOString();
  await restore(request, ws); await page.reload();
  await page.getByText("Reviewed and parked · 1", { exact: true }).click();
  await expect(page.getByText("42 → 71 · target 100", { exact: true })).toBeVisible();
  expect(Object.values((await read(request)).gtmInitiatives!)[0].outcomes[0].current?.value).toBe(71);
});

test("source changes require a deliberate new baseline and keep the old target in history", async ({ page, request }) => {
  let panel = await add(page, "Grow weekly activity", "100");
  const ws = await read(request); ws.integrations.posthog!.config.projectId = "99"; ws.businessMetrics!.posthog!.metrics[0].value = 900;
  await restore(request, ws); await page.reload();
  panel = page.getByRole("region", { name: "This week's GTM priorities", exact: true });
  await expect(panel.getByText(/source or metric settings changed/i)).toBeVisible();
  await expect(panel.getByText("At target", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Edit plan or metric", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit GTM initiative", exact: true });
  await dialog.getByLabel("Measure progress", { exact: true }).selectOption({ label: "Active users · 7 days" });
  await expect(dialog.getByLabel("Target (optional)", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Save initiative", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const item = Object.values((await read(request)).gtmInitiatives!)[0];
  expect(item.measurement?.baseline.value).toBe(900); expect(item.measurement?.target).toBeUndefined();
  expect(item.revisions[0].measurement).toMatchObject({ baseline: { value: 42 }, target: 100 });
});

test("failed sync data cannot mark a target met", async ({ page, request }) => {
  await add(page, "Reach fifty", "50");
  const ws = await read(request); ws.businessMetrics!.posthog!.metrics[0].value = 90;
  ws.integrations.posthog!.lastError = { at: new Date().toISOString(), message: "Provider offline" };
  await restore(request, ws); await page.reload();
  const panel = page.getByRole("region", { name: "This week's GTM priorities", exact: true });
  await expect(panel.getByText("Provider offline", { exact: true })).toBeVisible();
  await expect(panel.getByText("At target", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("progressbar")).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`metric trends and initiative forms fit at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await add(page);
    const ws = await read(request); const item = Object.values(ws.gtmInitiatives!)[0]; const descriptor = item.measurement!.metric;
    ws.metricHistory = { [descriptor.id]: { ...descriptor, points: [{ at: ago(9), value: 20 }, { at: ago(1), value: 35 }, { at: ws.businessMetrics!.posthog!.syncedAt, value: 42 }] } };
    await restore(request, ws); await page.reload();
    await expect(page.getByText(/\+22 \(\+110\.0%\) since/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("region", { name: "This week's GTM priorities", exact: true }).screenshot({ path: testInfo.outputPath(`initiatives-${width}.png`), animations: "disabled" });
    await page.getByRole("region", { name: "Your business, kept in sync", exact: true }).screenshot({ path: testInfo.outputPath(`metric-trends-${width}.png`), animations: "disabled" });
    await page.getByRole("button", { name: "Add initiative", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a GTM initiative", exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`initiative-form-${width}.png`), animations: "disabled" });
  });
}

test("pipeline cohorts show the actual denominator and preserve first exits on reopened deals", async ({ page, request }, testInfo) => {
  const ws = await read(request); ws.company!.market = "b2b"; ws.goal.metric = "deals";
  const domain = Object.keys(ws.accounts)[0]; const at = new Date().toISOString();
  for (let i = 0; i < 10; i++) ws.deals[`gtm_deal_${i}`] = { id: `gtm_deal_${i}`, name: `Funnel ${i}`, accountDomain: domain, source: "inbound", stage: i < 6 ? "proposal" : "lost", amountUsd: 1000, contacts: [], meetingIds: [], createdAt: ago(20), updatedAt: at, lastActivityAt: at, stageHistory: [{ stage: "talking", at: ago(20) }, { stage: "qualified", at: ago(10) }, { stage: i < 6 ? "proposal" : "lost", at: ago(5) }] };
  for (let i = 6; i < 10; i++) { const deal = ws.deals[`gtm_deal_${i}`]; deal.stage = "proposal"; deal.stageHistory.push({ stage: "qualified", at: ago(3) }, { stage: "proposal", at: ago(1) }); }
  await restore(request, ws); await page.goto("/revenue");
  const panel = page.getByRole("region", { name: "Where the pipeline slows down", exact: true });
  const row = panel.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Qualified", exact: true }) });
  await expect(row.getByText("6/10", { exact: true })).toBeVisible();
  await expect(row.getByText("60%", { exact: true })).toBeVisible();
  await expect(panel.getByText(/4 of 10 decided exits were lost/)).toBeVisible();
  await expect(panel.getByRole("link", { name: "Plan an improvement", exact: true })).toHaveAttribute("href", "#gtm-initiatives");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByText("60% moved forward", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath("pipeline-390.png"), animations: "disabled" });
});
