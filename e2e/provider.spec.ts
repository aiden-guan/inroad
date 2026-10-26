import { expect, test, type Page } from "@playwright/test";

/**
 * Bring your own AI: on the workspace the earlier runs built (which ran on Claude through the mock), switch
 * to OpenAI by pasting a key in Settings, ask a question that the OpenAI-compatible path answers (the mock
 * speaks Chat Completions too), then switch back to Claude, whose key comes from the environment.
 */

const mod = process.platform === "darwin" ? "Meta" : "Control";
const KEY = "sk-proj-e2etestkey0000000000000000";

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
