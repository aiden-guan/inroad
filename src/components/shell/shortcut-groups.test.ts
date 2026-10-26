import { describe, expect, it } from "vitest";
import { shortcutGroups } from "./shortcut-groups";

describe("shortcutGroups", () => {
  it("covers every place with its own keys, Companies and Check replies included", () => {
    expect(shortcutGroups(true).map((g) => g.title)).toEqual(["Everywhere", "Today", "A draft", "Check replies", "Companies", "Events", "Studio"]);
    const keys = (title: string) => shortcutGroups(true).find((g) => g.title === title)!.rows.map(([k]) => k.join(" "));
    expect(keys("Check replies")).toEqual(expect.arrayContaining(["R", "N", "B", "U"]));
    expect(keys("Companies")).toEqual(expect.arrayContaining(["J", "K", "Enter", "T", "X"]));
  });

  it("labels the modifier for this computer", () => {
    const palette = (mac: boolean) => shortcutGroups(mac)[0].rows[0][0];
    expect(palette(true)).toEqual(["⌘", "K"]);
    expect(palette(false)).toEqual(["Ctrl", "K"]);
    expect(JSON.stringify(shortcutGroups(false))).not.toContain("⌘");
  });

  it("never repeats a row within a group (rows are keyed by what they do)", () => {
    for (const g of shortcutGroups(true)) {
      const whats = g.rows.map(([, what]) => what);
      expect(new Set(whats).size).toBe(whats.length);
    }
  });
});
