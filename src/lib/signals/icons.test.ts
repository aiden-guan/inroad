import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as faviconRoute } from "@/app/api/favicon/route";
import { iconSrc } from "@/lib/client/icons";
import { DATA_DIR, writeSettings } from "@/lib/store/settings";
import { companyIcon, iconLinks, iconsAllowed, sniffImage } from "./icons";

/**
 * Company icons never come from a third party. Off by default (the first letter, nothing sent); when
 * on, from the company's own site through the SSRF-guarded fetch, cached on disk. The HTTP layer is
 * stubbed: nothing here touches the network.
 */

const { fetchText, fetchBytes } = vi.hoisted(() => ({ fetchText: vi.fn(), fetchBytes: vi.fn() }));
vi.mock("./http", async (original) => ({ ...(await original<typeof import("./http")>()), fetchText, fetchBytes }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const get = (domain: string) => faviconRoute(new Request(`http://localhost:3000/api/favicon?domain=${encodeURIComponent(domain)}`));

beforeEach(() => {
  fetchText.mockReset();
  fetchBytes.mockReset();
  fetchText.mockResolvedValue(null);
  fetchBytes.mockResolvedValue(null);
  fs.rmSync(path.join(DATA_DIR, "cache", "icons"), { recursive: true, force: true });
  writeSettings({ companyIcons: undefined });
});

describe("where a mark's image comes from", () => {
  it("is this app or nothing, and a prospect's only when icons are on", () => {
    expect(iconSrc("northwind.io", "letters")).toBeNull();
    expect(iconSrc("northwind.io", "site")).toBe("/api/favicon?domain=northwind.io");
    expect(iconSrc("www.Northwind.io", "site")).toBe("/api/favicon?domain=northwind.io");
    // The tools Inroad connects to always show their logo.
    expect(iconSrc("hubspot.com", "letters")).toBe("/api/favicon?domain=hubspot.com");
    expect(iconSrc("claude.ai", "letters")).toBe("/api/favicon?domain=claude.ai");
    expect(iconSrc("", "site")).toBeNull();
    expect(iconSrc("localhost", "site")).toBeNull();
  });

  it("never names Google or another favicon service in the component", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "components", "ui", "favicon.tsx"), "utf8");
    expect(source).not.toMatch(/google\.com|gstatic|duckduckgo|icon\.horse|favicone|clearbit/i);
  });

  it("is allowed server-side only with the setting on, or for a tool", () => {
    expect(iconsAllowed("northwind.io")).toBe(false);
    expect(iconsAllowed("slack.com")).toBe(true);
    writeSettings({ companyIcons: "site" });
    expect(iconsAllowed("northwind.io")).toBe(true);
  });
});

describe("reading an icon off a company's own site", () => {
  it("knows images by their bytes and refuses SVG and HTML", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(ICO)).toBe("image/x-icon");
    expect(sniffImage(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(Buffer.from("<!doctype html><html>"))).toBeNull();
  });

  it("takes the page's declared icons, best first, and never an SVG", () => {
    const html = `<head>
      <link rel="apple-touch-icon" href="/apple.png" sizes="180x180">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="icon" href="https://cdn.northwind.io/i/64.png" sizes="64x64">
      <link rel="stylesheet" href="/site.css">
    </head>`;
    expect(iconLinks(html, "https://www.northwind.io/home")).toEqual([
      "https://cdn.northwind.io/i/64.png",
      "https://www.northwind.io/favicon.ico",
      "https://www.northwind.io/apple.png",
    ]);
  });

  it("falls back to /favicon.ico, caches what it found, and asks the site once", async () => {
    fetchText.mockResolvedValue({ url: "https://northwind.io/", status: 200, body: "<html><head><title>Northwind</title></head></html>" });
    fetchBytes.mockImplementation(async (url: string) => (url === "https://northwind.io/favicon.ico" ? { url, contentType: "image/x-icon", bytes: ICO } : null));

    const icon = await companyIcon("northwind.io");
    expect(icon?.type).toBe("image/x-icon");
    expect(fetchText).toHaveBeenCalledWith("https://northwind.io/", expect.anything());
    await companyIcon("northwind.io");
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  it("remembers a site with no usable icon (an SVG) for a week", async () => {
    fetchText.mockResolvedValue({ url: "https://svgonly.io/", status: 200, body: '<link rel="icon" href="/logo.png">' });
    fetchBytes.mockResolvedValue({ url: "x", contentType: "image/png", bytes: SVG });
    const now = Date.now();
    expect(await companyIcon("svgonly.io", now)).toBeNull();
    const calls = fetchBytes.mock.calls.length;
    expect(await companyIcon("svgonly.io", now + 6 * 86_400_000)).toBeNull();
    expect(fetchBytes.mock.calls.length).toBe(calls);
    await companyIcon("svgonly.io", now + 8 * 86_400_000);
    expect(fetchBytes.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe("GET /api/favicon", () => {
  it("serves nothing for a prospect while icons are off, and fetches nothing", async () => {
    const res = await get("northwind.io");
    expect(res.status).toBe(404);
    expect(fetchText).not.toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("serves the company's own icon as an image only, once icons are on", async () => {
    writeSettings({ companyIcons: "site" });
    fetchText.mockResolvedValue({ url: "https://northwind.io/", status: 200, body: '<link rel="icon" href="/i.png">' });
    fetchBytes.mockResolvedValue({ url: "https://northwind.io/i.png", contentType: "text/html", bytes: PNG });
    const res = await get("northwind.io");
    expect(res.status).toBe(200);
    // The bytes decide the type, not the server's header.
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("refuses what isn't a domain", async () => {
    writeSettings({ companyIcons: "site" });
    expect((await get("")).status).toBe(400);
    expect((await get("not a domain")).status).toBe(400);
  });
});
