import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { allowClipboardWrite } = require("../../../desktop/app/permissions.cjs");
const ownWindow = {
  permission: "clipboard-sanitized-write",
  requestingUrl: "http://127.0.0.1:3737/integrations#agents",
  serverUrl: "http://127.0.0.1:3737",
  isMainFrame: true,
  isAppWindow: true,
};

describe("desktop clipboard permissions", () => {
  it("allows clipboard writes from Inroad's main window", () => {
    expect(allowClipboardWrite(ownWindow)).toBe(true);
  });

  it.each(["clipboard-read", "deprecated-sync-clipboard-read", "media", "geolocation", "notifications", "fileSystem", "unknown"])("keeps %s denied", (permission) => {
    expect(allowClipboardWrite({ ...ownWindow, permission })).toBe(false);
  });

  it.each(["https://evil.example", "http://127.0.0.1:3738", "http://localhost:3737", "file:///tmp/page.html", "", "not a URL"])("denies another requesting origin: %s", (requestingUrl) => {
    expect(allowClipboardWrite({ ...ownWindow, requestingUrl })).toBe(false);
  });

  it("denies subframes, other windows, and requests before the app server starts", () => {
    expect(allowClipboardWrite({ ...ownWindow, isMainFrame: false })).toBe(false);
    expect(allowClipboardWrite({ ...ownWindow, isAppWindow: false })).toBe(false);
    expect(allowClipboardWrite({ ...ownWindow, serverUrl: "" })).toBe(false);
    expect(allowClipboardWrite({ ...ownWindow, requestingUrl: undefined })).toBe(false);
  });
});
