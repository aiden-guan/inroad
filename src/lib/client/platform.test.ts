import { describe, expect, it } from "vitest";
import { isApplePlatform, modKeys } from "./platform";

describe("isApplePlatform", () => {
  it("prefers the client-hints platform", () => {
    expect(isApplePlatform({ userAgentData: { platform: "macOS" }, platform: "Win32" })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: "Windows" }, platform: "MacIntel" })).toBe(false);
    expect(isApplePlatform({ userAgentData: { platform: "Linux" } })).toBe(false);
  });

  it("falls back to navigator.platform, then the user agent", () => {
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "iPhone" })).toBe(true);
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isApplePlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isApplePlatform({ platform: "", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
  });

  it("says ⌘ when it can't tell (the server render)", () => {
    expect(isApplePlatform(undefined)).toBe(true);
  });
});

describe("modKeys", () => {
  it("leaves labels alone on a Mac", () => {
    expect(modKeys("⌘K", true)).toBe("⌘K");
    expect(modKeys("Unsaved · ⌘S", true)).toBe("Unsaved · ⌘S");
  });

  it("spells the modifier out everywhere else", () => {
    expect(modKeys("⌘K", false)).toBe("Ctrl K");
    expect(modKeys("⌘↵", false)).toBe("Ctrl ↵");
    expect(modKeys("⌘", false)).toBe("Ctrl");
    expect(modKeys("⌥⌘K", false)).toBe("Alt Ctrl K");
    expect(modKeys("Unsaved · ⌘S", false)).toBe("Unsaved · Ctrl S");
    expect(modKeys("↵", false)).toBe("↵");
  });
});
