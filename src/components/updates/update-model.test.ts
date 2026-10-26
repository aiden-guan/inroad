import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "@/lib/updates/types";
import { actionLabel, noticeFor, statusLine, updateAction } from "./update-model";

const NOW = new Date("2026-10-26T12:00:00Z").getTime();
const base: UpdateStatus = { channel: "source", phase: "up-to-date", current: "0.1.0 · 796721b", latest: null, checkedAt: "2026-10-26T10:00:00Z", autoCheck: true };

describe("what the update UI offers", () => {
  it("offers one click only when it can finish it", () => {
    const available: UpdateStatus = { ...base, phase: "available", latest: { label: "3 new changes", total: 3 } };
    expect(updateAction(available)).toBe("update");
    expect(updateAction({ ...available, blocked: "Commit or stash them." })).toBeNull();
    expect(updateAction({ ...base, channel: "desktop", phase: "available", latest: { label: "0.2.0" } })).toBeNull();
    expect(updateAction({ ...base, channel: "desktop", phase: "ready", latest: { label: "0.2.0" } })).toBe("restart");
    expect(updateAction(null)).toBeNull();
  });

  it("says where things stand in a line", () => {
    expect(statusLine(base, NOW)).toBe("Up to date, checked 2h ago.");
    expect(statusLine({ ...base, phase: "available", latest: { label: "3 new changes" } }, NOW)).toBe("3 new changes on GitHub, checked 2h ago.");
    expect(statusLine({ ...base, channel: "desktop", phase: "downloading", latest: { label: "0.2.0" }, progress: 0.42 }, NOW)).toBe("Downloading Inroad 0.2.0 · 42%");
    expect(statusLine({ ...base, phase: "idle", checkedAt: null, autoCheck: false }, NOW)).toBe("Automatic checks are off.");
  });

  it("shows the sidebar notice for an update worth a click", () => {
    expect(noticeFor({ ...base, phase: "available", latest: { label: "1 new change", total: 1 } })).toEqual({ title: "An update is ready", body: "1 change on GitHub. Your work is backed up first.", action: "update" });
    expect(noticeFor({ ...base, channel: "desktop", phase: "downloading", latest: { label: "0.2.0" } })).toBeNull();
    expect(noticeFor({ ...base, channel: "desktop", phase: "ready", latest: { label: "0.2.0" } })).toMatchObject({ title: "Inroad 0.2.0 is ready", action: "restart" });
    expect(noticeFor(base)).toBeNull();
  });

  it("asks first when an update would stop work in progress", () => {
    expect(actionLabel("update", 0, false)).toBe("Update now");
    expect(actionLabel("restart", 2, true)).toBe("Stop 2 runs and restart");
  });
});
