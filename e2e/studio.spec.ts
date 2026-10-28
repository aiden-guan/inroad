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
  await expect(page.getByRole("article")).toHaveCount(9);
  await page
    .getByText("Supporting research · 6 records", { exact: true })
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
    .getByRole("button", { name: "Browse campaign library", exact: true })
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

test("campaigns show original media, load players on demand and switch creative examples", async ({
  page,
}) => {
  // Exercise the player UI without relying on an external video platform or sending it workspace data.
  const players: string[] = [];
  await page.route(
    "https://www.youtube-nocookie.com/embed/**",
    async (route) => {
      players.push(route.request().url());
      await route.fulfill({
        contentType: "text/html",
        body: "<html><body>Campaign player fixture</body></html>",
      });
    },
  );
  await page.goto("/studio?view=campaigns");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Preview Wispr Flow campaign creative",
      exact: true,
    })
    .click();
  const wispr = page.getByRole("dialog", { name: /^Wispr Flow/ });
  await expect(
    wispr.getByRole("region", { name: "Original campaign creative" }),
  ).toBeVisible();
  await expect(
    wispr.getByRole("link", { name: "Open original", exact: true }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=9KqGpxtsawc");
  await expect(wispr.locator("iframe")).toHaveCount(0);
  await wispr
    .getByRole("button", {
      name: "Play Break up with your keyboard",
      exact: true,
    })
    .click();
  await expect(wispr.locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/9KqGpxtsawc?autoplay=1&rel=0",
  );
  await expect.poll(() => players.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.getByLabel("Find a campaign", { exact: true }).fill("Volvo");
  await page
    .getByRole("button", {
      name: "Preview Volvo campaign creative",
      exact: true,
    })
    .click();
  const volvo = page.getByRole("dialog", { name: /^Volvo/ });
  await volvo
    .getByRole("button", { name: "EX90 · 60-second cut", exact: true })
    .click();
  await expect(
    volvo.getByRole("button", { name: "EX90 · 60-second cut", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    volvo.getByRole("link", { name: "Open original", exact: true }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=O9Z_vzJyToA");
  await expect(volvo.locator("iframe")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByLabel("Find a campaign", { exact: true }).fill("Spotify");
  await page
    .getByRole("button", {
      name: "Preview Spotify campaign creative",
      exact: true,
    })
    .click();
  const spotify = page.getByRole("dialog", { name: /^Spotify/ });
  await expect(
    spotify.getByRole("link", {
      name: "Spotify Newsroom · campaign photography",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    "https://newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/",
  );
  await spotify
    .getByRole("button", { name: "Wrapped 2025 · Nashville", exact: true })
    .click();
  await expect(
    spotify.getByRole("link", { name: "Open original", exact: true }),
  ).toHaveAttribute("href", /2025-Wrapped-OOH-Nashville-Taylor341/);
});

test("unavailable campaign images retain the original source and usable actions", async ({
  page,
}) => {
  await page.route("https://i.ytimg.com/**", (route) => route.abort());
  await page.goto("/studio?view=campaigns");
  const card = page.getByRole("article", { name: /^Wispr Flow:/ });
  await expect(card).toContainText("Preview unavailable");
  await card
    .getByRole("button", {
      name: "View Wispr Flow campaign details",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /^Wispr Flow/ });
  await expect(
    dialog.getByRole("link", { name: "Open original", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Create with this approach",
      exact: true,
    }),
  ).toBeEnabled();
});
