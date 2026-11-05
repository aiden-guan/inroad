/**
 * Amounts the way people type them into a price, fee, cost or count field: "$25K", "25k", "1.5M", "2bn", "$2,500",
 * "25 000", "USD 1,200", "€900", "18.2k" (followers). Server and browser.
 */

const SUFFIX: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

// currency? number suffix? currency?  e.g. "us$ 1,250.50", "25k", "1.5 m usd", "25 000 dollars"
const AMOUNT =
  /^(?:us\$|usd|eur|gbp|cad|aud|[$€£])?\s*(\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+|\d+)?(?:\.(\d+))?\s*(k|thousand|mm|mn|m|million|bn|b|billion)?\s*(?:usd|eur|gbp|cad|aud|dollars?|[$€£])?$/;

/**
 * The amount in `input`, with a k/m/b suffix applied, thousands separators and currency marks dropped. Null when it
 * isn't one plain amount: empty, negative, a range ("25-30k"), a rate ("2k/mo"), words, or ambiguous ("2,5k", or
 * "25.000" with no suffix, which is 25 thousand in much of Europe). Cents are kept; round where a field wants dollars.
 */
export function parseAmount(input: string): number | null {
  const m = AMOUNT.exec(input.trim().toLowerCase().replace(/[  ]/g, " "));
  if (!m) return null;
  const [, whole, fraction, suffix] = m;
  if (whole === undefined && fraction === undefined) return null;
  // "1.500" is 1,500 to many Europeans and $1.50 to nobody: ask rather than guess.
  if (fraction?.length === 3 && !suffix) return null;
  const n = Number(`${(whole ?? "0").replace(/[, ]/g, "")}.${fraction ?? "0"}`) * (suffix ? SUFFIX[suffix] : 1);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Whole dollars from a typed amount ("$25K" → 25000), or null when it isn't one. */
export function parseDollars(input: string): number | null {
  const n = parseAmount(input);
  return n === null ? null : Math.round(n);
}
