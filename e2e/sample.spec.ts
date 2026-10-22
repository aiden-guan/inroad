import { expect, test } from "@playwright/test";

/**
 * On the workspace the first-run test built: try the sample, see that it says it's made up, and leave it
 * with one click, which brings the founder's own work back (from the backup taken before the sample
 * replaced it; Backups can't be reached from the first screen).
 */

test("the sample says it's made up, and leaving it with one click brings the real work back", async ({ page, request }) => {
  const res = await request.post("/api/workspace/sample", { data: { replace: true } });
  expect(res.ok()).toBe(true);

  await page.goto("/today");
  const banner = page.getByRole("note", { name: "Sample workspace" });
  await expect(banner.first()).toBeVisible();
  await expect(banner.first()).toContainText(/made up/);

  // The founder's own workspace was backed up before the sample replaced it.
  const { backups } = (await (await request.get("/api/workspace/backups")).json()) as { backups: { name: string; reason: string }[] };
  expect(backups.find((b) => b.reason === "before_sample")).toBeTruthy();

  await page.getByRole("button", { name: /Start with my company/ }).first().click();
  await expect(page.getByText("Sample cleared. Your own workspace is back, as it was before the sample.")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("note", { name: "Sample workspace" })).toHaveCount(0);
  const ws = (await (await request.get("/api/workspace")).json()) as { sample?: boolean; onboarding: { status: string }; accounts: Record<string, unknown> };
  expect(ws.sample).toBeFalsy();
  expect(ws.onboarding.status).toBe("hired");
  expect(ws.accounts["northwind.io"]).toBeTruthy();

  await page.goto("/companies?c=northwind.io");
  await expect(page.getByText("My recommendation")).toBeVisible({ timeout: 60_000 });
});
