import { expect, test } from "@playwright/test";

/**
 * A founder's first session against the mock Anthropic API: paste a website and a sentence, watch the
 * bet get written, arrive on Today, then add a company and read its freshly researched dossier. With
 * no network the site and job boards can't be read, so the run leans on the founder's sentence and the
 * dossier on (mock) web search, the same paths a thin site takes in real life.
 */

test("from the welcome screen to a rendered dossier", async ({ page }) => {
  await page.goto("/");
  // The first page a cold dev server compiles: it can reload itself a few times before redirecting.
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Let’s find your first customers." })).toBeVisible();

  await page.locator("#site").fill("acme.com");
  await page.locator("#note").fill("We reconcile usage data with invoices so finance teams at usage-priced SaaS companies close the month in hours.");
  await page.getByRole("button", { name: /^Start/ }).click();

  // The bet is written section by section, then the offer card with the one-sentence bet.
  await expect(page.getByText("My bet:")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/where the .+ still owns .+ by hand/)).toBeVisible();

  // Offline, discovery can't read anyone's job board: the card says so instead of padding the list.
  const cta = page.getByRole("button", { name: /^(Go to Today|Research these \d|Research this one)/ });
  await expect(cta).toBeEnabled({ timeout: 120_000 });
  await page.locator("#founder-name").fill("Priya");
  // Record what the navigation's view transition animates: the orb should fly into the sidebar.
  await page.evaluate(() => {
    const w = window as unknown as { __vt: string[] };
    w.__vt = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((arg: Parameters<typeof start>[0]) => {
      const t = start(arg);
      void t.ready.then(() => w.__vt.push(...document.getAnimations().map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? "")), () => {});
      return t;
    }) as typeof document.startViewTransition;
  });
  await cta.click();
  await expect(page).toHaveURL(/\/today/, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vt: string[] }).__vt.some((p) => p.startsWith("::view-transition-group(ember-orb)")))).toBe(true);

  // The goal stays in view: paid pilots against the goal, customers against the long arc.
  const goal = page.getByTitle("Your goal, from the plan").first();
  await expect(goal).toContainText("Paid pilots");
  await expect(goal).toContainText("Customers");

  // Add a company and research it: the dossier renders with its sources.
  await page.goto("/companies?add=northwind.io");
  await expect(page.getByText("My recommendation")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Researched /).first()).toBeVisible();
  await expect(page.getByText(/raises \$18M Series A/).first()).toBeVisible();
});
