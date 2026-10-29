import { modKeys } from "@/lib/client/platform";
import type { Market } from "@/lib/domain/types";
import { SECONDARY, navFor } from "./nav";

export interface ShortcutGroup {
  title: string;
  rows: [keys: string[], what: string][];
}

/**
 * Every keyboard shortcut, grouped by where it works, labeled for this computer (⌘ on a Mac, Ctrl
 * elsewhere). Keep in step with the handlers: app-shell (G then…, from ./nav), command-palette (⌘K), today-view,
 * composer, check-replies, prospects and events-page.
 */
export function shortcutGroups(mac: boolean, market: Market = "b2b"): ShortcutGroup[] {
  const mod = modKeys("⌘", mac);
  const shown = new Set(navFor(market).map((p) => p.label));
  const elsewhere = new Set([...navFor("b2b"), ...navFor("consumer")].map((p) => p.label).filter((label) => !shown.has(label)));
  const groups: ShortcutGroup[] = [
    {
      title: "Everywhere",
      rows: [
        [[mod, "K"], "Ask, or jump to a company, page or action"],
        [["?"], "These shortcuts"],
        // The pages this market shows, in sidebar order (see ./nav).
        ...[...navFor(market), ...SECONDARY].map((p): ShortcutGroup["rows"][number] => [["G", p.key], p.long ?? p.label]),
        [[mod, "↵"], "Save or send what you're typing"],
        [["Esc"], "Close the sheet or dialog"],
      ],
    },
    {
      title: "Today",
      rows: [
        [["J"], "Next move"],
        [["K"], "Previous move"],
        [["Enter"], "Open it"],
        [["A"], "Done (on a booking card: the nudge is sent)"],
        [["X"], "Skip, then pick a reason"],
        [["S"], "Tomorrow"],
        [["Esc"], "Close"],
      ],
    },
    {
      title: "A draft",
      rows: [
        [["A"], "Mark as sent"],
        [["E"], "Edit the text"],
        [["]"], "A different angle"],
        [["["], "Back to the previous one"],
      ],
    },
    {
      title: "Check replies",
      rows: [
        [["J"], "Next person"],
        [["K"], "Previous person"],
        [["R"], "Replied: paste it"],
        [["N"], "No reply"],
        [["B"], "Bounced"],
        [["U"], "Didn't send"],
      ],
    },
    {
      title: "Companies",
      rows: [
        [["J"], "Next company"],
        [["K"], "Previous company"],
        [["Enter"], "Open it"],
        [["T"], "Track or untrack"],
        [["X"], "Dismiss, with a reason"],
      ],
    },
    {
      title: "Events",
      rows: [[["N"], "Plan an event"]],
    },
    {
      title: "Studio",
      rows: [[["N"], "New piece"]],
    },
  ];
  // A page's own keys only list where the market shows the page.
  return groups.filter((g) => !elsewhere.has(g.title));
}
