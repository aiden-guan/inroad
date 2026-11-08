import { test, expect, type Page } from "@playwright/test";
import type { Workspace } from "../src/lib/domain/types";
import type { MonidReport } from "../src/lib/monid/types";

async function fixture(page: Page) {
  const ws: Workspace = await (await page.request.get("/api/workspace")).json();
  ws.sample = false; ws.onboarding.status = "hired"; ws.integrations = {}; ws.searchMetrics = {};
  await page.route("**/api/workspace", (route) => route.fulfill({ json: ws }));
  await page.route("**/api/integrations/poll", (route) => route.fulfill({ json: { results: [], changed: false } }));
  return ws;
}

for (const width of [390, 1440]) test(`search metrics, unavailable values and source setup fit at ${width}px`, async ({ page }, testInfo) => {
  const ws = await fixture(page), at = new Date().toISOString();
  ws.integrations["bing-webmaster"] = { id: "bing-webmaster", enabled: true, lastSyncAt: at, config: { nextMetricSyncAt: "2099-01-01T00:00:00Z" } };
  ws.searchMetrics = { "bing-webmaster": { provider: "bing-webmaster", syncedAt: at, windowStart: "2026-10-01", windowEnd: "2026-10-28", accountLabel: "Synthetic site", environment: "test", comparisonPeriod: "2026-09-03 – 2026-09-30", metrics: [{ key: "clicks", label: "Bing clicks", value: 30, previousValue: 20, period: "28 reporting dates", definition: "Synthetic fixture" }, { key: "ctr", label: "Click-through rate", value: null, previousValue: null, format: "percent", period: "28 reporting dates", definition: "No reported impressions" }], notes: [] } };
  await page.setViewportSize({ width, height: 1000 }); await page.goto("/visibility");
  await expect(page.getByRole("heading", { name: "Search & AI", exact: true })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^30$/ })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^—$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`search-ai-${width}.png`), fullPage: false });
  await page.goto("/integrations#google-search-console");
  await expect(page.getByLabel("Service account JSON", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Verified property", { exact: true })).toBeVisible();
  await page.goto("/integrations#posthog-search");
  await expect(page.getByLabel("Website hostname", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Conversion event (optional)", { exact: true })).toBeVisible();
});

test("creator research previews before an explicit paid submission and shows source profiles", async ({ page }) => {
  const ws = await fixture(page); ws.integrations.monid = { id: "monid", enabled: true, config: { workspaceId: "fixture" } };
  let submissions = 0;
  const report: MonidReport = { id: "11111111-1111-4111-8111-111111111111", workspaceId: "fixture", input: { kind: "creators", query: "skincare creator", country: "US", limit: 10 }, createdAt: "2026-11-08T12:00:00Z", reportDate: "2026-11-08", status: "COMPLETED", creators: [{ handle: "fixturecreator", profileUrl: "https://www.tiktok.com/@fixturecreator", views: 1200 }] };
  await page.route("**/api/integrations/monid/research", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { reports: [] } });
    const body = route.request().postDataJSON();
    if (body.action === "preview") return route.fulfill({ json: { value: { price: { type: "PER_RESULT", amount: { value: 0.0003, currency: "USD" } } } } });
    expect(body.action).toBe("run"); expect(body.input).toEqual(report.input); submissions++;
    return route.fulfill({ json: { value: report } });
  });
  await page.goto("/integrations#monid"); await page.getByLabel("Niche or keyword", { exact: true }).fill("skincare creator");
  await page.getByRole("button", { name: "Preview current price", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run paid research", exact: true })).toBeVisible(); expect(submissions).toBe(0);
  await page.getByRole("button", { name: "Run paid research", exact: true }).click();
  await expect(page.getByText("Saved research", { exact: true })).toBeVisible(); expect(submissions).toBe(1);
  await page.locator("summary").filter({ hasText: "skincare creator" }).click();
  await expect(page.getByRole("link", { name: /fixturecreator/ })).toHaveAttribute("href", "https://www.tiktok.com/@fixturecreator");
});

test("citation baselines stay matched and scroll inside their card on phones", async ({ page }) => {
  const ws = await fixture(page); ws.integrations.monid = { id: "monid", enabled: true, config: { workspaceId: "fixture" } };
  const base: MonidReport = { id: "11111111-1111-4111-8111-111111111111", workspaceId: "fixture", input: { kind: "citations", domain: "example.com", country: "US" }, createdAt: "2026-11-08T12:00:00Z", reportDate: "2026-11-08", status: "COMPLETED", citations: [{ platform: "chatgpt", citations: 42, pages: 5 }] };
  await page.route("**/api/integrations/monid/research", (route) => route.fulfill({ json: { reports: [base, { ...base, id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-11-01T12:00:00Z", reportDate: "2026-11-01", citations: [{ platform: "chatgpt", citations: 21, pages: 3 }] }] } }));
  await page.setViewportSize({ width: 390, height: 1000 }); await page.goto("/visibility");
  await page.locator("summary").filter({ hasText: "2026-11-08" }).click();
  await expect(page.getByRole("cell", { name: "42", exact: true })).toBeVisible();
  await expect(page.getByText("Ahrefs citation links and distinct cited pages. Previous matched snapshot: 2026-11-01.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
