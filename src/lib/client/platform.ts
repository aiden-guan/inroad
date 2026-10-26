import { useSyncExternalStore } from "react";

/**
 * ⌘ on a Mac, Ctrl everywhere else. Every shortcut that says ⌘ also takes Ctrl (the handlers accept
 * metaKey || ctrlKey), so only the label changes. Server renders say ⌘; the browser corrects it on hydrate.
 */

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** macOS, iOS and iPadOS, from the client-hints platform when there is one, else the legacy fields. */
export function isApplePlatform(nav: NavigatorLike | undefined): boolean {
  if (!nav) return true;
  const hinted = nav.userAgentData?.platform;
  if (hinted) return /mac|ios/i.test(hinted);
  return /mac|iphone|ipad|ipod/i.test(nav.platform || nav.userAgent || "");
}

/** A key label as this computer spells it: "⌘K" → "Ctrl K", "⌘↵" → "Ctrl ↵", "⌥" → "Alt" off a Mac. */
export function modKeys(label: string, mac: boolean): string {
  if (mac) return label;
  return label
    .replace(/⌘\s*/g, "Ctrl ")
    .replace(/⌥\s*/g, "Alt ")
    .replace(/\s+$/, "");
}

const noSubscribe = () => () => {};

export function useIsMac(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => isApplePlatform(navigator as NavigatorLike),
    () => true,
  );
}

/** `modKeys` for this computer. */
export function useModKeys(): (label: string) => string {
  const mac = useIsMac();
  return (label: string) => modKeys(label, mac);
}
