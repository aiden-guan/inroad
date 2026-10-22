import { expect, test } from "@playwright/test";

/**
 * Runs last, on the workspace the first-run test built: try the sample, see that it says it's made up,
 * leave it with one click, and get the founder's own work back from the backup taken before the sample
 * replaced it.
 */

test("the sample says it's made up, leaving is one click, and a backup brings the real work back", async ({ page, request }) => {
  const res = await request.post("/api/workspace/sample", { data: { replace: true } });
  expect(res.ok()).toBe(true);

  await page.goto("/today");
  const banner = page.getByRole("note", { name: "Sample workspace" });
  await expect(banner.first()).toBeVisible();
  await expect(banner.first()).toContainText(/made up/);

  await page.getByRole("button", { name: /Start with my company/ }).first().click();
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Let’s find your first customers." })).toBeVisible();

  // The founder's own workspace was backed up before the sample replaced it.
  const { backups } = (await (await request.get("/api/workspace/backups")).json()) as { backups: { name: string; reason: string }[] };
  const before = backups.find((b) => b.reason === "before_sample");
  expect(before).toBeTruthy();
  const restored = await request.post(`/api/workspace/restore?backup=${encodeURIComponent(before!.name)}`);
  expect(restored.ok()).toBe(true);

  await page.goto("/companies?c=northwind.io");
  await expect(page.getByText("My recommendation")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("note", { name: "Sample workspace" })).toHaveCount(0);
});
