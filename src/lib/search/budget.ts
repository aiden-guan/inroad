import "server-only";
import { todayISO } from "@/lib/domain/ids";
import { readSettings, writeSettings } from "@/lib/store/settings";
import { readAutomation } from "@/lib/automation/store";

/** Reserve synchronously before any await. Counters are local settings, outside restorable history. */
function reserve(kind: "researchRequests" | "browserRequests", count: number): ((actual?: number) => void) | string {
  const settings = readSettings();
  const day = todayISO();
  const counters = { ...(settings[kind] ?? {}) };
  const previous =
    counters[day] ??
    readAutomation()
      .receipts.filter(
        (r) =>
          todayISO(new Date(r.at)) === day &&
          (kind === "researchRequests" ? r.kind === "search" && !r.cached : r.kind === "fetch" && r.provider === "TinyFish Browser"),
      )
      .reduce((n, r) => n + (r.requests ?? 1), 0);
  const limit = kind === "researchRequests" ? (settings.search?.dailyLimit ?? 100) : (settings.search?.browserDailyLimit ?? 10);
  if (previous + count > limit)
    return `Today's ${limit}-request ${kind === "researchRequests" ? "search" : "browser"} limit has too few requests left. Change it under Web search in Settings.`;
  counters[day] = previous + count;
  const kept = Object.fromEntries(Object.entries(counters).filter(([date]) => date >= todayISO(new Date(Date.now() - 31 * 86400_000))));
  writeSettings({ [kind]: kept });
  let released = false;
  return (actual = count) => {
    if (released) return;
    released = true;
    const refund = Math.max(0, count - Math.max(0, actual));
    if (!refund) return;
    const latest = readSettings()[kind] ?? {};
    writeSettings({ [kind]: { ...latest, [day]: Math.max(0, (latest[day] ?? count) - refund) } });
  };
}
export const reserveSearchRequests = (count: number) => reserve("researchRequests", count);
export const reserveBrowserRequest = () => reserve("browserRequests", 1);
