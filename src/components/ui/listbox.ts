/** Keyboard movement through a list of options (select.tsx), kept pure so it's testable. */

export interface ListOption {
  label: string;
  disabled?: boolean;
}

/** The next option that can be picked, `step` away from `from` (±1, ±10), clamped to the ends; -1 if none can be. */
export function nextEnabled(options: readonly ListOption[], from: number, step: number): number {
  const last = options.length - 1;
  if (last < 0 || !options.some((o) => !o.disabled)) return -1;
  const dir = step < 0 ? -1 : 1;
  const target = Math.min(last, Math.max(0, from + step));
  for (let i = target; i >= 0 && i <= last; i += dir) if (!options[i].disabled) return i;
  // Nothing enabled from there to the end: the nearest enabled one back the way it came.
  for (let i = target; i >= 0 && i <= last; i -= dir) if (!options[i].disabled) return i;
  return -1;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trimStart();

/**
 * Type-to-find, the way a native select does it: the first enabled option whose label starts with what was typed,
 * looking from `from`. Typing one letter again moves on to the next option with that letter.
 */
export function typeahead(options: readonly ListOption[], typed: string, from: number): number {
  const query = fold(typed);
  if (!query) return -1;
  const repeat = query.length > 1 && [...query].every((c) => c === query[0]);
  const needle = repeat ? query[0] : query;
  const start = repeat || query.length === 1 ? from + 1 : from;
  for (let k = 0; k < options.length; k++) {
    const i = (((start + k) % options.length) + options.length) % options.length;
    if (!options[i].disabled && fold(options[i].label).startsWith(needle)) return i;
  }
  return -1;
}
