import { expect, test, type Page } from "@playwright/test";

/**
 * ⌘K on the workspace the first-run test built (northwind.io was researched there): a page of the
 * palette goes back on Esc, and "Paste a reply" works out who sent it in code, logs it and lands on
 * their company with the answer drafted (by the mock).
 */

const mod = process.platform === "darwin" ? "Meta" : "Control";

/** ⌘K, once the app has hydrated (a key pressed before that goes nowhere). */
async function openPalette(page: Page) {
  await expect(async () => {
    if (!(await page.getByRole("dialog", { name: "Command menu" }).isVisible())) await page.keyboard.press(`${mod}+K`);
    await expect(page.getByRole("option", { name: /^Paste a reply/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test("Esc on a palette page goes back, then closes", async ({ page }) => {
  await page.goto("/today");
  await openPalette(page);
  await page.getByRole("option", { name: /^Write to/ }).click();
  await expect(page.getByPlaceholder("Who are you writing to?")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: /^Paste a reply/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: /^Paste a reply/ })).toHaveCount(0);
});

test("paste a reply from someone new at a company you researched, and land on the draft", async ({ page }) => {
  await page.goto("/today");
  await openPalette(page);
  await page.getByRole("option", { name: /^Paste a reply/ }).click();
  await page.getByRole("textbox", { name: "Their reply" }).fill("From: Jo Lee <jo.lee@northwind.io>\nSubject: Re: month-end\n\nYes, let's talk. Thursday works.\n\nJo\n\nOn Tue, Priya <priya@acme.com> wrote:\n> Hi Jo");

  const from = page.getByRole("radio", { name: /Jo Lee/ });
  await expect(from).toBeVisible();
  await expect(from).toHaveAttribute("aria-checked", "true");
  await expect(from).toContainText(/New at/);

  await page.getByRole("button", { name: "Read it and draft a reply" }).click();
  await expect(page).toHaveURL(/c=northwind\.io&intent=reply/, { timeout: 30_000 });
  await expect(page.getByText("Reply logged. Their follow-ups are cancelled.")).toBeVisible();
  const block = page.getByRole("region", { name: "Reply to Jo" });
  await expect(block).toBeVisible();
  await expect(block.getByRole("button", { name: /Mark as sent/ })).toBeVisible({ timeout: 90_000 });

  // The reply is on their timeline, with only their words.
  const ws = (await (await page.request.get("/api/workspace")).json()) as { people: Record<string, { id: string; name: string }>; activities: { kind: string; personId?: string; body?: string }[] };
  const jo = Object.values(ws.people).find((p) => p.name === "Jo Lee");
  expect(jo).toBeTruthy();
  expect(ws.activities.find((a) => a.kind === "reply_received" && a.personId === jo!.id)?.body).toBe("Yes, let's talk. Thursday works.\n\nJo");
});
