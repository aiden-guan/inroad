import { expect, test, type Page } from "@playwright/test";
import type { Workspace } from "../src/lib/domain/types";

// These UI fixtures leave the shared end-to-end workspace untouched.
async function showSetup(page: Page, ws: Workspace) {
  ws.onboarding = { ...ws.onboarding, status: "new", url: undefined, note: undefined, error: undefined, market: undefined };
  await page.route("**/api/workspace", (route) => route.fulfill({ json: ws }));
}

test("setup keeps Enter for writing and supports keyboard customer selection", async ({ page, request }) => {
  await showSetup(page, await (await request.get("/api/workspace")).json());
  await page.route("**/api/settings", (route) => route.fulfill({ json: { hasKey: true } }));
  let starts = 0;
  await page.route("**/api/runs", (route) => {
    starts++;
    return route.fulfill({ status: 503, json: { error: "Test provider is offline." } });
  });
  await page.goto("/welcome");
  await page.getByLabel("Your website", { exact: true }).fill("acme.com");
  const note = page.getByLabel("What do you sell, and to whom?");
  await note.fill("We help finance teams.");
  await note.press("Enter");
  await note.press("End");
  await note.press("X");
  await expect(note).toHaveValue("We help finance teams.\nX");
  expect(starts).toBe(0);

  await page.getByRole("radio", { name: "Auto-detect" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Businesses", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Build my GTM plan" }).click();
  await expect(page.getByText("Test provider is offline.")).toBeVisible();
  expect(starts).toBe(1);
});

test("setup recovers from a failed AI connection check", async ({ page, request }) => {
  await showSetup(page, await (await request.get("/api/workspace")).json());
  let unavailable = true;
  await page.route("**/api/settings", (route) => {
    return route.fulfill(unavailable ? { status: 503, json: { error: "Unavailable" } } : { json: { hasKey: false } });
  });
  await page.goto("/welcome");
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't check your AI connection." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Build my GTM plan" })).toBeDisabled();
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Build my GTM plan" })).toBeEnabled();
  await expect(page.getByLabel("Anthropic API key", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try a sample · no API key needed" })).toBeEnabled();
});

for (const market of ["b2b", "consumer"] as const) {
  test(`${market}: open Today while the first search is still running`, async ({ page, request }) => {
    const ws: Workspace = await (await request.get("/api/workspace")).json();
    ws.company!.market = market;
    ws.accounts = {};
    ws.partners = {};
    ws.onboarding = { ...ws.onboarding, status: "offer", runId: undefined, discoveryRunId: "run_usability_search" };
    ws.runs = [{ id: "run_usability_search", workflow: market === "b2b" ? "discovery" : "partners", title: "Finding prospects", status: "running", startedAt: new Date().toISOString() }];
    await page.route("**/api/workspace", (route) => route.fulfill({ json: ws }));
    await page.route("**/api/runs/run_usability_search/stream", (route) => route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"status","text":"Still searching"}\n\n' }));
    await page.route("**/api/workspace/actions", async (route) => {
      const { actions } = route.request().postDataJSON();
      for (const action of actions) if (action.type === "onboarding.update") Object.assign(ws.onboarding, action.patch);
      await route.fulfill({ json: ws });
    });
    await page.route("**/api/today/prepare", (route) => route.fulfill({ json: { changed: false } }));
    await page.goto("/welcome");
    await expect(page.getByText("The search will keep running. Your next actions appear on Today.")).toBeVisible();
    await page.getByRole("button", { name: "Go to Today", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    expect(ws.onboarding.status).toBe("hired");
    expect(ws.runs[0].status).toBe("running");
  });
}

test("optional integrations expand from saved links and remain usable on a phone", async ({ page }) => {
  const transitionErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /ViewTransition.*same name/.test(message.text())) transitionErrors.push(message.text());
  });
  await page.goto("/integrations");
  const more = page.locator("#more-tools");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: /^Firecrawl/ })).not.toBeVisible();
  await more.locator("summary").click();
  await expect(page.getByRole("button", { name: /^Firecrawl/ })).toBeVisible();
  await more.locator("summary").click();
  await expect(page.getByRole("button", { name: /^Firecrawl/ })).not.toBeVisible();

  await page.goto("/integrations#firecrawl");
  await expect(more).toHaveAttribute("open", "");
  await expect(page.getByRole("region", { name: "Firecrawl", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/integrations");
  await expect(page.locator("#instantly")).toContainText("Not connected");
  await expect(page.locator("#instantly").getByText("Not connected").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(transitionErrors).toEqual([]);
});

test("copy prompt copies the complete Muse prompt and reports clipboard failures", async ({ page, request, context }) => {
  expect((await request.post("/api/workspace/sample", { data: { replace: true } })).ok()).toBe(true);
  expect((await request.post("/api/mcp/keys", { data: { name: "Clipboard test", client: "muse", access: "read" } })).ok()).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/integrations#agents");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const agents = page.locator("#agents");
  await agents.getByRole("button", { name: /Clipboard test/ }).click();
  const prompt = agents.locator("pre").filter({ hasText: "Create a custom connector for Inroad" });
  await expect(prompt).toBeVisible();
  const expected = await prompt.innerText();
  await agents.getByRole("button", { name: "Copy prompt", exact: true }).click();
  await expect(agents.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Clipboard access denied", "NotAllowedError")),
    });
  });
  await agents.getByRole("button", { name: "Copy prompt", exact: true }).click();
  await expect(page.getByText("Couldn't copy. Select the text and copy it manually.", { exact: true })).toBeVisible();
  await expect(agents.getByRole("button", { name: "Copy prompt", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
