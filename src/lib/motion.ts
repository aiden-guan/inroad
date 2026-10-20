/**
 * Motion tokens. UI chrome is fast and plain (≤200ms, ease-out); springs are for layout and
 * the few signature moments. Never animate keyboard-driven or high-frequency actions.
 */
export const dur = { fast: 0.1, base: 0.15, mod: 0.2, slow: 0.3, drawer: 0.5 } as const;

export const ease = {
  out: [0.23, 1, 0.32, 1],
  outQuad: [0.25, 0.46, 0.45, 0.94],
  inQuad: [0.55, 0.085, 0.68, 0.53],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const;

export const spring = {
  snappy: { type: "spring", visualDuration: 0.25, bounce: 0.15 },
  smooth: { type: "spring", visualDuration: 0.3, bounce: 0 },
  layout: { type: "spring", visualDuration: 0.35, bounce: 0 },
  gentle: { type: "spring", visualDuration: 0.5, bounce: 0.2 },
} as const;

/** Staggered list entry; animate only on first load, cap the cascade at 8 items. */
export const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.28, ease: ease.out, delay: Math.min(i, 8) * 0.04 } }),
};
