/**
 * Which company sheet is on screen. A research run started from the sheet skips its toast while the sheet
 * still shows the result (or the one-line error), so nothing is said twice.
 */
let current: string | null = null;

export function setOpenSheet(domain: string | null) {
  current = domain;
}

export function isSheetOpen(domain: string): boolean {
  return current === domain;
}

/** For `start(…, { notify })`: toast only if the founder has left the sheet by the time it ends. */
export const unlessSheetOpen = (domain: string) => () => !isSheetOpen(domain);
