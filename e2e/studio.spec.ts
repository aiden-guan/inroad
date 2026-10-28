import { expect, test, type Page } from "@playwright/test";
import type { Workspace } from "../src/lib/domain/types";

const studioNav = (page: Page) =>
  page.getByRole("navigation", { name: "Studio views" });

// UI fixtures and mocked writing calls keep the shared workspace and provider accounts untouched.
test("Studio starts with creation and recommends campaigns without pasted examples", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(
    page.getByRole("heading", { name: "What are you making?", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Format", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /^What should this say/ }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /^Read .+ inspiration$/ }),
  ).toHaveCount(3);
  await expect(
    page.getByRole("textbox", { name: /^Your own inspiration/ }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Who it's for", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Write \d+ options$/ }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Brand & material", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Brand & material", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your material", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Brand & material", exact: true }),
  ).not.toBeVisible();
});

test("the campaign library searches, filters evidence and shows source records", async ({
  page,
}) => {
  await page.goto("/studio?view=campaigns");
  const search = page.getByLabel("Find a campaign", { exact: true });
  await search.fill("Cider Shorts");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page
    .getByRole("button", { name: "View Cider campaign details", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: /^Cider/ });
  await expect(dialog).toContainText("33% lower");
  await expect(dialog).toContainText("not a test of copy alone");
  await expect(
    dialog.getByRole("link", { name: "Google / Cider case study" }),
  ).toHaveAttribute(
    "href",
    "https://business.google.com/us/resources/success-stories/cider/",
  );
  await page.keyboard.press("Escape");
  await search.fill("");
  await page.getByLabel("Evidence", { exact: true }).selectOption("results");
  await expect(
    page.getByRole("article").filter({ hasText: "Wispr Flow" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article").filter({ hasText: "ClickLearn" }),
  ).toHaveCount(1);
  await page.getByLabel("Audience", { exact: true }).selectOption("b2b");
  await expect(
    page.getByRole("article").filter({ hasText: "Cider" }),
  ).toHaveCount(0);
  await search.fill("no-such-campaign");
  await expect(
    page.getByText("No campaigns match", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(15);
});

test("using a campaign preserves the brief and optional examples across views and browser history", async ({
  page,
}) => {
  await page.goto("/studio");
  await page
    .getByRole("textbox", { name: /^What should this say/ })
    .fill("A launch for people tired of manual exports.");
  await page
    .getByText("Add your own example or adjust creative direction", {
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: /^Your own inspiration/ })
    .fill("Use a concrete before-and-after opening.");
  await page
    .getByRole("button", { name: "Browse 15 campaigns", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use Wispr Flow approach", exact: true })
    .click();
  await expect(page.getByLabel("Format", { exact: true })).toHaveValue(
    "short_video",
  );
  await expect(
    page.getByRole("button", { name: /^Read .+ inspiration$/ }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Read Wispr Flow inspiration",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /^What should this say/ }),
  ).toHaveValue("A launch for people tired of manual exports.");
  await expect(
    page.getByRole("textbox", { name: /^Your own inspiration/ }),
  ).toHaveValue("Use a concrete before-and-after opening.");
  await page.goBack();
  await expect(
    studioNav(page).getByRole("link", {
      name: "Campaign library",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(
    page.getByRole("textbox", { name: /^What should this say/ }),
  ).toHaveValue("A launch for people tired of manual exports.");
  await page
    .getByRole("button", { name: "Skip campaign inspiration", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Read .+ inspiration$/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Choose automatically", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Read .+ inspiration$/ }),
  ).toHaveCount(3);
});

test("writing sends campaign direction, recovers from startup failure, and opens the saved result", async ({
  page,
  request,
}) => {
  const ws: Workspace = await (await request.get("/api/workspace")).json();
  let body: {
    workflow: string;
    args: {
      format: string;
      pieceId: string;
      campaignIds: string[];
      reference?: string;
      brief: string;
    };
  };
  let fail = true;
  await page.route("**/api/workspace", (route) => route.fulfill({ json: ws }));
  await page.route("**/api/runs", async (route) => {
    body = route.request().postDataJSON();
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Test writer is unavailable." },
      });
    const original = Object.values(ws.studio.pieces)[0];
    ws.studio.pieces[body.args.pieceId] = {
      ...original,
      id: body.args.pieceId,
      format: "one_liner",
      title: "Test campaign piece",
      brief: body.args.brief,
      campaignIds: body.args.campaignIds,
      reference: body.args.reference,
      options: [
        {
          ...original.options[0],
          id: "opt_studio_ui",
          parts: { line: "Close usage before your invoice run" },
        },
      ],
    };
    return route.fulfill({
      json: {
        run: {
          id: "run_studio_library_ui",
          workflow: "studio",
          title: "Writing options",
          status: "running",
          startedAt: new Date().toISOString(),
          ref: { kind: "studio", id: body.args.pieceId },
        },
      },
    });
  });
  await page.route("**/api/runs/run_studio_library_ui/stream", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"result","data":{}}\n\ndata: {"type":"done"}\n\n',
    }),
  );
  await page.goto("/studio?view=campaigns");
  await page
    .getByRole("button", { name: "Use Wispr Flow approach", exact: true })
    .click();
  await page.getByLabel("Format", { exact: true }).selectOption("one_liner");
  await page
    .getByRole("textbox", { name: /^What should this say/ })
    .fill("A concrete opening for the launch.");
  await page
    .getByText("Add your own example or adjust creative direction", {
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: /^Your own inspiration/ })
    .fill("Show the workflow before and after.");
  await page.getByRole("button", { name: /^Write \d+ options$/ }).click();
  await expect(
    page.getByText("Test writer is unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Write \d+ options$/ }),
  ).toBeEnabled();
  expect(body!.workflow).toBe("studio");
  expect(body!.args.campaignIds).toEqual(["wispr-old-way"]);
  expect(body!.args.reference).toBe("Show the workflow before and after.");
  fail = false;
  await page.getByRole("button", { name: /^Write \d+ options$/ }).click();
  await expect(page).toHaveURL(/\/studio\?piece=/);
  await expect(
    page.getByRole("heading", { name: "Test campaign piece", exact: true }),
  ).toBeVisible();
  await page.getByText("Brief & campaign direction", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Test campaign piece", exact: true })
      .getByText("Show the workflow before and after.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Wispr Flow · View approach/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Test campaign piece", exact: true }),
  ).toBeVisible();
});

test("saved work can be found without opening the creation setup", async ({
  page,
}) => {
  await page.goto("/studio?view=work");
  const search = page.getByRole("searchbox", {
    name: "Search your work",
    exact: true,
  });
  await expect(search).toBeVisible();
  await search.fill("no-such-piece");
  await expect(
    page.getByText("No pieces match", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page
    .getByRole("list")
    .filter({ has: page.getByRole("button", { name: /options.*kept/ }) })
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "← All your work", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Brand & material", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What are you making?", exact: true }),
  ).not.toBeVisible();
});

for (const width of [390, 850]) {
  test(`Studio's campaign flow fits ${width}px and keeps the write action accessible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/studio");
    await expect(
      page.getByRole("button", { name: /^Write \d+ options$/ }),
    ).toBeInViewport();
    await studioNav(page)
      .getByRole("link", { name: "Campaign library", exact: true })
      .click();
    await expect(
      page.getByLabel("Find a campaign", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "View Wispr Flow campaign details",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", { name: /^Wispr Flow/ });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Create with this approach", exact: true })
      .click();
    await expect(page.getByLabel("Format", { exact: true })).toHaveValue(
      "short_video",
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page
      .getByRole("button", { name: "Brand & material", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Brand & material", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}
