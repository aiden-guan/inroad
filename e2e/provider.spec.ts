import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Bring your own AI: on the workspace the earlier runs built (which ran on Claude through the mock), switch
 * to OpenAI by pasting a key in Settings, ask a question that the OpenAI-compatible path answers (the mock
 * speaks Chat Completions too), then switch back to Claude, whose key comes from the environment.
 */

const mod = process.platform === "darwin" ? "Meta" : "Control";
const KEY = "sk-proj-e2etestkey0000000000000000";

test("save multiple AI accounts, select a task model, and override it for one Ask message", async ({ page, request }) => {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  const mockBase = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 4301}/v1`;
  await page.goto("/settings#ai-routing");
  const group = page.locator("#ai-routing");
  const created: string[] = [];
  try {
    for (const [name, model] of [["Research account", "mock-routed"], ["Writing account", "mock-large"]]) {
      await group.getByRole("button", { name: "Add connection" }).click();
      await group.getByLabel("Connection provider").selectOption("custom");
      await group.getByLabel("Connection name", { exact: true }).fill(name);
      await group.getByLabel("API base URL", { exact: true }).fill(mockBase);
      await group.getByLabel("API key", { exact: true }).fill("multi-account-e2e-key-123456");
      await group.getByLabel("Default model ID", { exact: true }).fill(model);
      await group.getByRole("button", { name: "Save connection", exact: true }).click();
      await expect(group.getByText(name, { exact: true }).first()).toBeVisible();
      const status = await (await request.get("/api/ai/connections")).json();
      created.push(status.connections.find((c: { name: string }) => c.name === name).id);
    }
    await page.reload();
    await expect(group.getByText("Research account", { exact: true }).first()).toBeVisible();
    await group.getByText("Choose a model for each task", { exact: true }).click();
    const connection = group.getByLabel("Ask Inroad", { exact: true });
    await connection.selectOption(created[0]);
    await expect(connection).toBeEnabled();
    const model = group.getByRole("combobox", { name: "Ask Inroad model", exact: true });
    await model.selectOption("mock-routed");
    await expect(model).toBeEnabled();
    await expect.poll(async () => (await (await request.get("/api/ai/connections")).json()).routing.tasks.ask?.model).toBe("mock-routed");
    expect(await (await request.get("/api/ai/connections")).text()).not.toContain("multi-account-e2e-key-123456");

    await page.goto("/today");
    await openPalette(page);
    await page.getByRole("option", { name: /^Ask a question/ }).click();
    const input = page.locator("#ask-input");
    await input.fill("Write a short outreach plan for next week.");
    await input.press("Enter");
    await expect(page.getByText(/· mock-routed/)).toBeVisible({ timeout: 90_000 });
    const picker = page.getByRole("combobox", { name: "Model for this message" });
    await expect(picker).toBeEnabled();
    await picker.selectOption(`${created[1]}|mock-large`);
    await input.fill("Make this plan more concise.");
    await input.press("Enter");
    await expect(page.getByText(/· mock-large/)).toBeVisible({ timeout: 90_000 });
    const status = await (await request.get("/api/ai/connections")).json();
    expect(status.routing.tasks.ask).toEqual({ connectionId: created[0], model: "mock-routed" });
  } finally {
    for (const id of created) await request.post("/api/ai/connections", { data: { action: "remove", id } });
  }
});

async function openPalette(page: Page) {
  await expect(async () => {
    if (!(await page.getByRole("dialog", { name: "Command menu" }).isVisible())) await page.keyboard.press(`${mod}+K`);
    await expect(page.getByRole("option", { name: /^Ask a question/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test("switch to OpenAI with a pasted key, ask on it, and switch back to Claude", async ({ page }) => {
  await page.goto("/settings#api-key");
  const group = page.locator("#api-key");
  await expect(group.getByText("Connected · Claude")).toBeVisible();

  await group.getByRole("button", { name: "Change" }).click();
  const key = group.getByLabel("Anthropic API key");
  await key.fill(KEY);
  // The pasted key says which provider it belongs to.
  await expect(group.getByLabel("AI provider")).toHaveValue("openai");
  await group.getByRole("button", { name: "Connect" }).click();
  await expect(group.getByText("Connected · OpenAI")).toBeVisible();
  await expect(group.getByLabel("Model", { exact: true })).toHaveValue("mock-large");
  // The key is never shown again, only its last four characters.
  await expect(group).toContainText("…0000");
  await expect(page.locator("body")).not.toContainText(KEY);

  await page.goto("/today");
  await openPalette(page);
  await page.getByRole("option", { name: /^Ask a question/ }).click();
  const input = page.locator("#ask-input");
  await expect(input).toBeVisible();
  await input.fill("What should I do first this week?");
  await input.press("Enter");
  // The answer's receipt names the model that ran it.
  await expect(page.getByText(/· mock-large/)).toBeVisible({ timeout: 90_000 });
  await page.keyboard.press("Escape");

  await page.goto("/settings#api-key");
  await group.getByRole("button", { name: "Change" }).click();
  await group.getByLabel("AI provider").selectOption("anthropic");
  await group.getByRole("button", { name: "Connect" }).click();
  await expect(group.getByText("Connected · Claude")).toBeVisible();
  // The OpenAI key stays saved for later.
  await expect(group.getByText("Also saved")).toBeVisible();
});

test("configure and test a custom search provider, preserve it across reloads, and turn it off", async ({ page, request }) => {
  // A real local adapter verifies the app's HTTP path without spending provider credits.
  const calls: { authorization?: string; body: unknown }[] = [];
  const adapter = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: [{ url: "https://example.com/news", title: "Company news", description: "A sales leader joined." }] }));
  });
  await new Promise<void>((resolve) => adapter.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(adapter.address() as AddressInfo).port}/search`;
  const searchKey = "search-e2e-secret-123456";
  try {
    expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
    await page.goto("/settings#web-search");
    const group = page.locator("#web-search");
    const select = group.getByLabel("Search provider", { exact: true });
    await expect(select).toBeEnabled();
    for (const id of ["deepseek", "tinyfish", "tavily", "exa", "brave", "firecrawl"]) await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
    await select.selectOption("custom");
    await group.getByLabel("Search endpoint", { exact: true }).fill(endpoint);
    await group.getByLabel("Custom search endpoint key", { exact: true }).fill(searchKey);
    await group.getByRole("button", { name: "Save", exact: true }).click();
    await expect(group.getByRole("status")).toContainText("Search settings saved");
    expect(calls).toHaveLength(0);
    await expect(group.getByLabel("Custom search endpoint key", { exact: true })).toHaveValue("");
    const publicSettings = await (await request.get("/api/settings")).text();
    expect(publicSettings).not.toContain(searchKey);
    await group.getByRole("button", { name: "Test search", exact: true }).click();
    await expect(group.getByRole("status")).toContainText("answered with 1 search result");
    expect(calls).toEqual([{ authorization: `Bearer ${searchKey}`, body: { query: "Inroad go to market", limit: 3 } }]);

    await page.reload();
    await expect(select).toHaveValue("custom");
    await expect(group.getByLabel("Search endpoint", { exact: true })).toHaveValue(endpoint);
    await select.selectOption("off");
    await group.getByRole("button", { name: "Save", exact: true }).click();
    await expect(group.getByRole("status")).toContainText("External search is off");
    await expect(group.getByRole("button", { name: "Test search", exact: true })).toBeDisabled();
    expect(calls).toHaveLength(1);
  } finally {
    await request.post("/api/settings", { data: { search: { provider: "custom", key: null } } });
    await request.post("/api/settings", { data: { search: { provider: "auto", endpoint: "" } } });
    await new Promise<void>((resolve, reject) => adapter.close((error) => error ? reject(error) : resolve()));
  }
});

test("roadmap: research, provenance, monitors, an existing API, mapping, and outcomes work together", async ({ page, request }) => {
  const hit = { url: "https://company.org/about", title: "Company billing software", description: "Billing software for finance teams in growing SaaS companies." };
  const record = { url: "https://prospect.org/about", title: "Prospect finance platform", description: "Finance workflow tools", company: { domain: "prospect.org", name: "Prospect" }, person: { email: "ana@prospect.org", name: "Ana" } };
  const adapter = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET") { res.end(JSON.stringify({ data: { matches: [record] } })); return; }
    for await (const chunk of req) void chunk;
    res.end(JSON.stringify({ results: [{ ...hit, url: `${hit.url}?utm_source=duplicate` }, hit, { ...hit, url: "https://unrelated.org/about" }] }));
  });
  await new Promise<void>((resolve) => adapter.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(adapter.address() as AddressInfo).port}`;
  try {
    expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
    expect((await request.post("/api/settings", { data: { search: { provider: "custom", endpoint: `${origin}/search` } } })).ok()).toBe(true);
    await page.goto("/research");
    await page.getByLabel("What companies or evidence are you looking for?", { exact: true }).fill("billing startups");
    await page.getByLabel("Include domains", { exact: true }).fill("company.org");
    await page.getByRole("button", { name: "Search the web", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 source" })).toBeVisible();
    await expect(page.getByRole("link", { name: hit.title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Track website", exact: true }).click();
    await expect(page.getByRole("link", { name: "Open saved company" })).toBeVisible();
    await page.getByRole("button", { name: "Monitor this search" }).click();
    await expect(page.getByLabel("Monitor query or URL")).toHaveValue("billing startups");
    await page.getByLabel("Monitor name", { exact: true }).fill("Billing signals");
    await page.getByRole("button", { name: "Save monitor" }).click();
    const monitor = page.getByRole("article").filter({ hasText: "Billing signals" });
    await expect(monitor).toContainText("Active");
    await monitor.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(monitor).toContainText("Paused");
    await monitor.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Save monitor", exact: true }).click();
    await expect(monitor).toContainText("Paused");

    await page.getByRole("tab", { name: "Connections", exact: true }).click();
    await page.getByLabel("Connection name", { exact: true }).fill("Legacy API");
    await page.getByLabel("Connection type", { exact: true }).selectOption("openapi");
    await page.getByLabel("Tool endpoint", { exact: true }).fill(`${origin}/api`);
    await page.getByLabel("Tool API key", { exact: true }).fill("legacy-api-e2e-secret");
    await page.getByLabel("OpenAPI JSON", { exact: true }).fill(JSON.stringify({ openapi: "3.0.3", paths: { "/companies": { get: { operationId: "search_companies", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }, { name: "count", in: "query", schema: { type: "integer" } }] } } } }));
    await page.getByRole("button", { name: "Discover tools" }).click();
    await expect(page.getByLabel("Read-only operation", { exact: true })).toHaveValue("search_companies");
    await page.getByLabel("Query argument", { exact: true }).fill("q");
    await page.getByLabel("Limit argument", { exact: true }).fill("count");
    await page.getByLabel("Tool results path", { exact: true }).fill("data.matches");
    await page.getByRole("button", { name: "Save connection", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Connection and mapping saved" })).toBeVisible();
    await page.getByLabel("Preview arguments", { exact: true }).fill('{"q":"finance","count":3}');
    await page.getByRole("button", { name: "Run read-only preview" }).click();
    await expect(page.getByRole("heading", { name: "Map and preview records" })).toBeVisible();
    await page.getByLabel("Records path", { exact: true }).fill("data.matches");
    await page.getByRole("button", { name: "Suggest field mapping" }).click();
    await expect(page.getByLabel("Map Website or domain", { exact: true })).toHaveValue("company.domain");
    await page.getByRole("button", { name: "Preview import", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 new companies" })).toBeVisible();
    await page.getByRole("button", { name: "Import previewed records", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Records imported" })).toBeVisible();
    const ws = await (await request.get("/api/workspace")).json();
    expect(ws.accounts["prospect.org"].name).toBe("Prospect");
    expect(Object.values(ws.people).some((person) => (person as { email?: string }).email === "ana@prospect.org")).toBe(true);
    expect(await (await request.get("/api/automation")).text()).not.toContain("legacy-api-e2e-secret");

    await page.getByRole("button", { name: "Use for web search", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Web search now uses Legacy API" })).toBeVisible();
    await page.getByRole("tab", { name: "Search", exact: true }).click();
    await page.getByLabel("Include domains", { exact: true }).fill("");
    await page.getByLabel("What companies or evidence are you looking for?", { exact: true }).fill("finance software");
    await page.getByRole("button", { name: "Search the web", exact: true }).click();
    await expect(page.getByRole("link", { name: record.title, exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Outcomes", exact: true }).click();
    await expect(page.getByRole("table")).toContainText("Legacy API");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await request.post("/api/settings", { data: { search: { provider: "auto", endpoint: "" } } });
    adapter.closeAllConnections(); await new Promise<void>((resolve) => adapter.close(() => resolve()));
  }
});
