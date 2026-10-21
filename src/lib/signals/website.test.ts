import { describe, expect, it, vi } from "vitest";
import { fixture, routeFetches } from "@/test/http-fixtures";
import { fetchText } from "./http";
import { crawlSite, siteDigestToText } from "./website";

vi.mock("./http", () => ({ fetchText: vi.fn(), fetchJSON: vi.fn() }));

/** acme.com redirects to www; the customers page fails to load. */
const SITE = {
  "https://acme.com": { url: "https://www.acme.com/", body: fixture("acme-home.html") },
  "https://www.acme.com/pricing": fixture("acme-pricing.html"),
  "https://www.acme.com/about-us": fixture("acme-about.html"),
  "https://www.acme.com/careers": fixture("acme-careers.html"),
};

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  return r.requested;
}

describe("crawlSite", () => {
  it("reads the home page and up to four key pages on the same host", async () => {
    const requested = serve(SITE);
    const site = await crawlSite("acme.com");
    // Shortest match per kind, in kind order, same host only (no blog, partner or javascript: links).
    expect(requested).toEqual(["https://acme.com", "https://www.acme.com/pricing", "https://www.acme.com/customers", "https://www.acme.com/about-us", "https://www.acme.com/careers"]);
    expect(site?.pages.map((p) => p.url)).toEqual(["https://www.acme.com/", "https://www.acme.com/pricing", "https://www.acme.com/about-us", "https://www.acme.com/careers"]);
    expect(site?.name).toBe("Acme");
  });

  it("digests each page: title, description, unique headings and the main text without chrome", async () => {
    serve(SITE);
    const [home, pricing] = (await crawlSite("acme.com"))!.pages;
    expect(home.title).toBe("Acme Billing | Usage-based invoicing for API companies");
    expect(home.description).toBe("Acme turns metered usage into accurate invoices, so finance closes the month in hours.");
    expect(home.headings).toEqual(["Invoices that match usage, every month", "Close in hours, not days"]);
    expect(home.text).toContain("Acme reconciles metered usage with your billing system");
    for (const chrome of ["We use cookies", "logo glyph", "Book a demo", "Enterprise pricing", "© 2026"]) expect(home.text).not.toContain(chrome);
    expect(pricing.description).toBe("Plans start at $500 a month, billed on usage.");
  });

  it("detects the stack from what pages load, never from what they say", async () => {
    serve(SITE);
    const site = await crawlSite("acme.com");
    // Drift is only mentioned in a link, so it isn't their stack.
    expect(site?.tech).toEqual(["HubSpot", "Segment", "Stripe", "Webflow", "Next.js", "Google Tag Manager"]);
  });

  it("finds job boards and social profiles across the pages it read", async () => {
    serve(SITE);
    const site = await crawlSite("acme.com");
    expect(site?.jobBoards).toEqual([
      { provider: "greenhouse", token: "acme" },
      { provider: "lever", token: "acme-labs" },
      { provider: "ashby", token: "acme" },
    ]);
    expect(site?.socials).toEqual({ linkedin: "https://www.linkedin.com/company/acme-billing", x: "https://twitter.com/acmebilling", github: "https://github.com/acme-billing" });
  });

  it("falls back to www, honors maxPages and the per-page budget, and gives up when nothing loads", async () => {
    const { "https://acme.com": home, ...rest } = SITE;
    const requested = serve({ "https://www.acme.com": home, ...rest });
    const site = await crawlSite("acme.com", { maxPages: 2, perPageChars: 40 });
    expect(requested.slice(0, 2)).toEqual(["https://acme.com", "https://www.acme.com"]);
    expect(site?.pages.map((p) => p.url)).toEqual(["https://www.acme.com/", "https://www.acme.com/pricing"]);
    expect(site?.pages[0].text.length).toBeLessThanOrEqual(60);
    expect(site?.pages[1].text.length).toBeLessThanOrEqual(40);

    serve({});
    expect(await crawlSite("acme.com")).toBeNull();
  });

  it("names the company from the title when there is no og:site_name", async () => {
    serve({ "https://beta.dev": "<html><head><title>Beta Labs – Ledger APIs</title></head><body><h1>Hi there</h1></body></html>" });
    expect((await crawlSite("beta.dev"))?.name).toBe("Beta Labs");
  });
});

describe("siteDigestToText", () => {
  it("lays the digest out compactly for a prompt", async () => {
    serve(SITE);
    const text = siteDigestToText((await crawlSite("acme.com"))!);
    const lines = text.split("\n");
    expect(lines.slice(0, 6)).toEqual([
      "Website: acme.com (Acme)",
      "Scripts loaded on their site: HubSpot, Segment, Stripe, Webflow, Next.js, Google Tag Manager",
      "## https://www.acme.com/",
      "Title: Acme Billing | Usage-based invoicing for API companies",
      "Description: Acme turns metered usage into accurate invoices, so finance closes the month in hours.",
      "Headings: Invoices that match usage, every month · Close in hours, not days",
    ]);
    expect(lines).toContain("## https://www.acme.com/careers");
    expect(lines).not.toContain("");
  });
});
