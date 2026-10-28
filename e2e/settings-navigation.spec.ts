import { expect, test } from "@playwright/test";
import type { Workspace } from "../src/lib/domain/types";

// These checks only navigate and edit unsaved forms; the shared workspace is left untouched.
test("settings topics, direct links and browser history agree", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator("#general")).toBeVisible();
  await expect(page.locator("#api-key")).not.toBeVisible();
  await expect(page.locator("#sending")).not.toBeVisible();
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "AI & models", exact: true }).click();
  await expect(page.locator("#api-key")).toBeVisible();
  await expect(page.locator("#general")).not.toBeVisible();
  await nav.getByRole("link", { name: "Data sources", exact: true }).click();
  await expect(page.locator("#news")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#api-key")).toBeVisible();
  await page.goForward();
  await expect(page.locator("#news")).toBeVisible();

  for (const [anchor, panel] of [["domain", "sending"], ["web-search", "search"], ["api-key", "ai"], ["market", "company"], ["backups", "data"], ["runs", "usage"], ["images", "image-settings"]]) {
    await page.goto(`/settings#${anchor}`);
    await expect(page.locator(`#${panel}`)).toBeVisible();
    await expect(page.locator(`#${anchor}`)).toBeVisible();
  }
  await page.reload();
  await expect(page.locator("#images")).toBeVisible();
});

test("settings search opens the owning topic and recovers from no matches", async ({ page }) => {
  await page.goto("/settings");
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("domain");
  await expect(page.getByRole("status").filter({ hasText: "matching" })).toContainText("settings matching");
  await page.getByRole("link", { name: /Sending domain/ }).click();
  await expect(page).toHaveURL(/#domain$/);
  await expect(page.locator("#domain")).toBeVisible();
  await expect(search).toHaveValue("");
  await search.fill("backup");
  await page.getByRole("link", { name: /Backups Restore/ }).click();
  await expect(page.locator("#backups")).toBeVisible();
  await search.fill("no-such-setting");
  await expect(page.getByText("No settings found", { exact: true })).toBeVisible();
  await search.press("Escape");
  await expect(page.locator("#data")).toBeVisible();
});

test("switching settings topics preserves an unfinished connection", async ({ page }) => {
  await page.goto("/settings#ai-routing");
  await page.getByRole("button", { name: "Add connection", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Connection name", exact: true });
  await name.fill("Unfinished connection");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "General", exact: true }).click();
  await expect(name).not.toBeVisible();
  await nav.getByRole("link", { name: "AI & models", exact: true }).click();
  await expect(name).toHaveValue("Unfinished connection");
});

for (const width of [390, 850]) {
  test(`every settings topic is reachable without horizontal scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/settings");
    const picker = page.getByLabel("Settings section", { exact: true });
    for (const id of ["general", "you", "company", "sending", "ai", "search", "images", "sources", "usage", "data"]) {
      await picker.selectOption(id);
      await expect(page.locator("h2:visible")).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(picker).toBeInViewport();
  });
}

test("Playbook switches sections, follows cross-section actions and retains deep links", async ({ page }) => {
  await page.goto("/playbook");
  const nav = page.getByRole("navigation", { name: "Playbook sections" }).first();
  for (const [id, label] of [["why", "Why us"], ["how", "How we sell"], ["voice", "Voice"], ["journal", "Journal"], ["who", "Who"]]) {
    await nav.getByRole("link", { name: new RegExp(`^${label}`) }).click();
    await expect(page.locator(`#${id}`)).toBeVisible();
    for (const other of ["who", "why", "how", "voice", "journal"].filter((other) => other !== id)) await expect(page.locator(`#${other}`)).not.toBeVisible();
  }
  await page.goto("/playbook#questions");
  await expect(page.locator("#questions")).toBeVisible();
  await expect(page.locator("#who")).not.toBeVisible();
  await page.goto("/playbook?new=pilot_proposal");
  await expect(page.locator("#assets")).toBeVisible();
  await page.goto("/playbook#plan");
  await expect(page.locator("#plan")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Jump to a topic", { exact: true }).selectOption("commercial");
  await expect(page.locator("#commercial")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("consumer Playbook links open the growth section", async ({ page, request }) => {
  const ws: Workspace = await (await request.get("/api/workspace")).json();
  ws.company!.market = "consumer";
  await page.route("**/api/workspace", (route) => route.fulfill({ json: ws }));
  await page.goto("/playbook#numbers");
  await expect(page.locator("#how")).toBeVisible();
  await expect(page.getByRole("heading", { name: "How we grow", exact: true })).toBeVisible();
  await expect(page.locator("#numbers")).toBeVisible();
  await expect(page.locator("#who")).not.toBeVisible();
});
