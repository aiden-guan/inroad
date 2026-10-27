import { plural, relativeTime } from "@/lib/client/format";
import type { UpdateStatus } from "@/lib/updates/types";

/** What the update UI says and offers for a status. Pure, so it's tested without a browser (update-model.test.ts). */

/** The one-click action, when there is one: update a checkout, or restart the Mac app into its download. */
export function updateAction(s: UpdateStatus | null): "update" | "restart" | null {
  if (!s || s.blocked) return null;
  if (s.channel === "desktop") return s.phase === "ready" ? "restart" : null;
  return s.phase === "available" ? "update" : null;
}

/** The status line under the version in Settings → Updates. */
export function statusLine(s: UpdateStatus, now = Date.now()): string {
  const checked = s.checkedAt ? `checked ${relativeTime(s.checkedAt, now)}` : null;
  switch (s.phase) {
    case "checking":
      return "Checking GitHub…";
    case "downloading":
      return `Downloading Inroad ${s.latest?.label ?? ""}${typeof s.progress === "number" ? ` · ${Math.round(s.progress * 100)}%` : ""}`.replace("  ", " ");
    case "ready":
      return `Inroad ${s.latest?.label} is downloaded and ready.`;
    case "available":
      return s.channel === "desktop" ? `Inroad ${s.latest?.label} is available.` : `${s.latest?.label ?? "New changes"} on GitHub${checked ? `, ${checked}` : ""}.`;
    case "updating":
      return "Updating now…";
    case "up-to-date":
      return `Up to date${checked ? `, ${checked}` : ""}.`;
    case "unavailable":
      return "This copy can't update itself in one click.";
    default:
      return s.autoCheck ? "Not checked yet." : "Automatic checks are off.";
  }
}

/** The sidebar notice, when one is worth showing: a ready update, or (source) changes waiting. */
export function noticeFor(s: UpdateStatus | null): { title: string; body: string; action: "update" | "restart" | null } | null {
  if (!s) return null;
  const action = updateAction(s);
  if (s.channel === "desktop") {
    if (s.phase === "ready") return { title: `Inroad ${s.latest?.label} is ready`, body: "Restarting takes a few seconds. Your work is backed up first.", action };
    return null;
  }
  if (s.phase !== "available") return null;
  const n = s.latest?.total ?? 0;
  return {
    title: "An update is ready",
    body: s.blocked ? "It can't install in one click here; Settings says why." : `${plural(n, "change")} on GitHub. Your work is backed up first.`,
    action,
  };
}

/** What the button says, two-step when an update would stop work in progress. */
export function actionLabel(action: "update" | "restart", busyRuns: number, confirming: boolean): string {
  if (confirming) return `Stop ${plural(busyRuns, "run")} and ${action === "restart" ? "restart" : "update"}`;
  return action === "restart" ? "Restart to update" : "Update now";
}
