import { describe, expect, it } from "vitest";
import { nextEnabled, typeahead } from "./listbox";

const options = [{ label: "Anthropic" }, { label: "Azure", disabled: true }, { label: "Bedrock" }, { label: "Bard" }, { label: "Cohere" }, { label: "Ollama", disabled: true }];

describe("nextEnabled", () => {
  it("steps over disabled options and stops at the ends", () => {
    expect(nextEnabled(options, 0, 1)).toBe(2);
    expect(nextEnabled(options, 2, -1)).toBe(0);
    expect(nextEnabled(options, 0, -1)).toBe(0);
    expect(nextEnabled(options, 4, 1)).toBe(4);
  });

  it("jumps by pages and lands on the nearest enabled option", () => {
    expect(nextEnabled(options, 0, 10)).toBe(4);
    expect(nextEnabled(options, 4, -10)).toBe(0);
  });

  it("finds the first and last enabled for Home and End", () => {
    expect(nextEnabled(options, -1, 1)).toBe(0);
    expect(nextEnabled(options, options.length, -1)).toBe(4);
  });

  it("says -1 when nothing can be picked", () => {
    expect(nextEnabled([{ label: "A", disabled: true }], 0, 1)).toBe(-1);
  });
});

describe("typeahead", () => {
  it("finds the first enabled option that starts with what was typed", () => {
    expect(typeahead(options, "co", 0)).toBe(4);
    expect(typeahead(options, "BED", 0)).toBe(2);
    expect(typeahead(options, "az", 0)).toBe(-1);
  });

  it("moves on through options with the same letter, wrapping around", () => {
    expect(typeahead(options, "b", 0)).toBe(2);
    expect(typeahead(options, "b", 2)).toBe(3);
    expect(typeahead(options, "bb", 3)).toBe(2);
  });

  it("ignores case and accents, and finds nothing for nothing", () => {
    expect(typeahead([{ label: "Équipe" }], "eq", -1)).toBe(0);
    expect(typeahead(options, "", 0)).toBe(-1);
  });
});
