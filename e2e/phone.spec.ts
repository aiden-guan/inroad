import { expect, test, type Page } from "@playwright/test";

/**
 * The workspace the first-run test just built, on the narrowest phone the UI is built for (the
 * "phone" project runs after "desktop"): Today and a researched dossier fit 390px with no sideways
 * page scroll, and a research run the API turns down says why once, in plain words, with the fix.
 */

const mockUrl = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 4301}`;

async function expectNoSideScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("Today and a dossier fit a phone", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expectNoSideScroll(page);

  await page.goto("/companies?c=northwind.io");
  await expect(page.getByText("My recommendation")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/raises \$18M Series A/).first()).toBeVisible();
  await expectNoSideScroll(page);
});

test("the phone header shows the agent, and the menu closes on Esc or a tap outside", async ({ page }) => {
  await page.goto("/today");
  const menu = page.getByRole("button", { name: "Menu" });
  // The agent's one line sits under the wordmark (the sidebar that carries it on desktop is hidden here).
  await expect(page.getByRole("button", { name: /^Head of GTM: / })).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  await menu.tap();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toHaveCount(0);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();

  // A tap below the menu closes it and lands on nothing underneath.
  await menu.tap();
  await expect(nav).toBeVisible();
  await page.mouse.click(195, 760);
  await expect(nav).toHaveCount(0);
  await expect(page).toHaveURL(/\/today$/);

  // Picking a page closes it too.
  await menu.tap();
  await nav.getByRole("link", { name: /Companies/ }).tap();
  await expect(page).toHaveURL(/\/companies/);
  await expect(nav).toHaveCount(0);
});

test("research the API turns down says why once, with the fix", async ({ page, request }) => {
  await request.post(`${mockUrl}/__mock/faults`, { data: { faults: [{ type: "credit" }] } });
  try {
    await page.goto("/companies?add=globex.com");
    const note = page.getByText(/out of credits/);
    await expect(note).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: /Add credits/ })).toHaveAttribute("href", /console\.anthropic\.com/);
    await expect(page.getByRole("button", { name: "Research again" })).toBeVisible();
    // Said once: the sheet shows it, so no toast repeats it and no raw API response appears.
    await page.waitForTimeout(1_000);
    await expect(note).toHaveCount(1);
    await expect(page.getByText(/invalid_request_error|credit balance is too low/)).toHaveCount(0);
    await expectNoSideScroll(page);
  } finally {
    await request.delete(`${mockUrl}/__mock/faults`);
  }
});
