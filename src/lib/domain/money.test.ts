import { describe, expect, it } from "vitest";
import { parseAmount, parseDollars } from "./money";

describe("reading a typed amount", () => {
  it("applies k, m and b suffixes, in any case and with or without a space", () => {
    expect(parseAmount("$25K")).toBe(25_000);
    expect(parseAmount("25k")).toBe(25_000);
    expect(parseAmount("25 K")).toBe(25_000);
    expect(parseAmount("1.5M")).toBe(1_500_000);
    expect(parseAmount("2mm")).toBe(2_000_000);
    expect(parseAmount("€5mn")).toBe(5_000_000);
    expect(parseAmount("1.2bn")).toBe(1_200_000_000);
    expect(parseAmount("3B")).toBe(3_000_000_000);
    expect(parseAmount(".5k")).toBe(500);
    expect(parseAmount("2 thousand dollars")).toBe(2_000);
    expect(parseAmount("1 million")).toBe(1_000_000);
    expect(parseAmount("18.2k")).toBe(18_200);
    // No float dust: 1.1 × 1000 is 1100, not 1100.0000000000002.
    expect(parseAmount("1.1k")).toBe(1_100);
  });

  it("drops thousands separators and currency marks", () => {
    expect(parseAmount("$25,000")).toBe(25_000);
    expect(parseAmount("25,000.00")).toBe(25_000);
    expect(parseAmount("$1,234.56")).toBe(1_234.56);
    expect(parseAmount("1,000,000")).toBe(1_000_000);
    expect(parseAmount("25 000")).toBe(25_000);
    expect(parseAmount("25 000")).toBe(25_000);
    expect(parseAmount("USD 1,200")).toBe(1_200);
    expect(parseAmount("US$ 900")).toBe(900);
    expect(parseAmount("1,200 usd")).toBe(1_200);
    expect(parseAmount("£40k")).toBe(40_000);
    expect(parseAmount("  $ 12,500  ")).toBe(12_500);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("0")).toBe(0);
  });

  it("returns null for anything that isn't one plain amount, rather than guessing", () => {
    for (const bad of ["", "   ", "$", "k", "usd", "-500", "25-30k", "2k/mo", "about 25k", "25k+", "1e6", "abc", "5.", "1,2,3", "1,0000", "1.000.000", "12k views"]) {
      expect(parseAmount(bad), bad).toBeNull();
    }
    // A decimal comma, or three decimals with no suffix, mean thousands in much of Europe.
    expect(parseAmount("2,5k")).toBeNull();
    expect(parseAmount("25.000")).toBeNull();
    expect(parseAmount("1.500")).toBeNull();
    // With a suffix the dot can only be a decimal point.
    expect(parseAmount("1.500k")).toBe(1_500);
  });

  it("rounds to whole dollars for fields that hold dollars", () => {
    expect(parseDollars("$25K")).toBe(25_000);
    expect(parseDollars("$1,234.56")).toBe(1_235);
    expect(parseDollars("2,5k")).toBeNull();
  });
});
