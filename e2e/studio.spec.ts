import { expect, test, type Page } from "@playwright/test";
import type { Workspace } from "../src/lib/domain/types";

const studioNav = (page: Page) =>
  page.getByRole("navigation", { name: "Studio views" });

// Local image/availability fixtures exercise the interface without external publisher dependencies.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/studio/campaign-media/**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("check") === "video") {
      await route.fulfill({ json: { status: "available" } });
    } else {
      await route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6S8AAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
  });
});

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

test("the library filters current studies and explains results, mechanisms and sources", async ({
  page,
}) => {
  await page.goto("/studio?view=campaigns");
  const search = page.getByLabel("Find a campaign", { exact: true });
  await expect(page.getByRole("article")).toHaveCount(20);
  await expect(
    page.getByRole("article").filter({ hasText: "Supabase" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("article").filter({ hasText: "Cider" }),
  ).toHaveCount(0);
  await search.fill("CeraVe");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page
    .getByRole("button", { name: "View CeraVe campaign details", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: /^CeraVe/ });
  await expect(page).toHaveURL(/campaign=cerave-michael/);
  await expect(dialog).toContainText("+25%");
  await expect(dialog).toContainText(
    "measurement period and baseline not disclosed",
  );
  await expect(
    dialog.getByRole("list", { name: "Campaign execution" }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Why it worked", exact: true }).click();
  await expect(
    dialog.getByRole("list", { name: "Creative mechanisms" }),
  ).toBeVisible();
  await expect(dialog).toContainText("The hook carried the message");
  await dialog.getByRole("tab", { name: "Make it yours", exact: true }).click();
  await expect(
    dialog.getByRole("list", { name: "Adaptation framework" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Where it breaks");
  await dialog.getByText(/^Sources & measurement/).click();
  await expect(
    dialog.getByRole("link", {
      name: "Campaign submission · The One Club",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    "https://www.oneclub.org/awards/theoneshow/-award/53015/michael-cerave/",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await search.fill("");
  await page
    .getByRole("checkbox", { name: "With reported outcomes", exact: true })
    .check();
  await expect(
    page.getByRole("article").filter({ hasText: "Wispr Flow" }),
  ).toHaveCount(0);
  await page.getByLabel("Audience", { exact: true }).selectOption("b2b");
  await expect(
    page.getByRole("article").filter({ hasText: "Heinz" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("article").filter({ hasText: "CeraVe" }),
  ).toHaveCount(0);
  await page
    .getByLabel("What do you want to do?", { exact: true })
    .selectOption("proof");
  await expect(
    page.getByRole("article").filter({ hasText: "AXA" }),
  ).toHaveCount(1);
  await search.fill("no-such-campaign");
  await expect(
    page.getByText("No campaigns match", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(20);
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
    .getByRole("button", {
      name: "View Wispr Flow campaign details",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: /^Wispr Flow/ })
    .getByRole("button", { name: "Create with this approach", exact: true })
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
    page.getByRole("dialog", { name: /^Wispr Flow/ }),
  ).toBeVisible();
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
    .getByRole("button", {
      name: "View Wispr Flow campaign details",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: /^Wispr Flow/ })
    .getByRole("button", { name: "Create with this approach", exact: true })
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
    const tabs = dialog.getByRole("tablist", { name: "Campaign study sections" });
    expect(await tabs.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.getByText(/^Sources & measurement/).scrollIntoViewIfNeeded();
    await dialog.getByRole("tab", { name: "Make it yours", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "A starting point for your brief.", exact: true }),
    ).toBeInViewport();
    await dialog.getByText(/^Sources & measurement/).scrollIntoViewIfNeeded();
    await dialog.getByRole("tab", { name: "Make it yours", exact: true }).press("Home");
    await expect(dialog.getByRole("tab", { name: "The campaign", exact: true })).toBeFocused();
    await expect(dialog.getByRole("region", { name: "Original campaign creative" })).toBeInViewport();
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
  await page.addInitScript(() => {
    class Player {
      element: HTMLElement;
      onError: () => void;
      constructor(
        element: HTMLElement,
        options: {
          events: {
            onReady: (event: { target: Player }) => void;
            onError: () => void;
          };
        },
      ) {
        this.element = element;
        this.onError = options.events.onError;
        window.addEventListener("test-player-error", this.onError);
        queueMicrotask(() => options.events.onReady({ target: this }));
      }
      playVideo() {}
      destroy() {
        window.removeEventListener("test-player-error", this.onError);
        this.element.remove();
      }
    }
    Object.assign(window, { YT: { Player } });
  });
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
    /https:\/\/www.youtube-nocookie.com\/embed\/9KqGpxtsawc\?enablejsapi=1/,
  );
  await expect.poll(() => players.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("iframe")).toHaveCount(0);

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
  await page.route(
    /\/api\/studio\/campaign-media\/wispr-old-way\/0\?v=casebook-1$/,
    (route) => route.abort(),
  );
  await page.goto("/studio?view=campaigns");
  const card = page.getByRole("article", { name: /^Wispr Flow:/ });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText("Publisher preview unavailable");
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

test("a removed video never opens a broken player", async ({
  page,
}) => {
  await page.route(
    /\/api\/studio\/campaign-media\/wispr-old-way\/0\?v=casebook-1&check=video$/,
    (route) => route.fulfill({ json: { status: "unavailable" } }),
  );
  await page.goto("/studio?view=campaigns&campaign=wispr-old-way");
  const dialog = page.getByRole("dialog", { name: /^Wispr Flow/ });
  await dialog
    .getByRole("button", {
      name: "Play Break up with your keyboard",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "not allowing playback here",
  );
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: "Open original", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("tab", { name: "Creative logic", exact: true })
    .click();
  await expect(
    dialog.getByRole("list", { name: "Creative mechanisms" }),
  ).toBeVisible();
});

test("case-study links survive reload and the sections support keyboard navigation", async ({
  page,
}) => {
  await page.goto("/studio?view=campaigns&campaign=pedigree-adoptable");
  let dialog = page.getByRole("dialog", { name: /^Pedigree/ });
  await expect(dialog).toContainText("featured animals");
  await page.reload();
  dialog = page.getByRole("dialog", { name: /^Pedigree/ });
  const first = dialog.getByRole("tab", { name: "The campaign", exact: true });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("tab", { name: "Why it worked", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("list", { name: "Creative mechanisms" }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    dialog.getByRole("tab", { name: "Make it yours", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("list", { name: "Adaptation framework" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/view=campaigns$/);
  await expect(page.getByRole("article")).toHaveCount(20);
});
