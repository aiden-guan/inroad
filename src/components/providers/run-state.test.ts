import { describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@/lib/domain/types";
import { createRunsStore, fromSummary, reduceRun, sameRun } from "./run-state";

const summary = (patch: Partial<RunSummary> = {}): RunSummary => ({ id: "run_1", workflow: "dossier", title: "Researching Northwind", startedAt: "2026-10-20T16:00:00.000Z", status: "running", ...patch });

describe("reduceRun", () => {
  it("moves a queued run to running on its first word, and no sooner", () => {
    const queued = fromSummary(summary({ status: "queued" }));
    expect(queued.status).toBe("queued");
    const started = reduceRun(queued, { type: "status", text: "Starting" });
    expect(started.status).toBe("running");
    expect(started.steps.map((s) => s.text)).toEqual(["Starting"]);
    expect(reduceRun(queued, { type: "thinking", text: "Reading the site" }).status).toBe("running");
  });

  it("ends a queued run that never started (stopped in the queue) as stopped, not running", () => {
    const queued = fromSummary(summary({ status: "queued" }));
    const stopped = reduceRun(reduceRun(queued, { type: "error", message: "Stopped.", code: "stopped" }), { type: "done" });
    expect(stopped.status).toBe("stopped");
  });

  it("closes the last step when the run is done", () => {
    let run = fromSummary(summary());
    run = reduceRun(run, { type: "search", query: "northwind series a" });
    run = reduceRun(run, { type: "result", data: { ok: true } });
    run = reduceRun(run, { type: "done" });
    expect(run.status).toBe("done");
    expect(run.steps.every((s) => s.doneAt)).toBe(true);
    expect(run.endedAt).toBeDefined();
  });

  it("collapses a repeated status", () => {
    let run = fromSummary(summary());
    run = reduceRun(run, { type: "status", text: "Filtering results" });
    run = reduceRun(run, { type: "status", text: "Filtering results" });
    expect(run.steps).toHaveLength(1);
  });
});

describe("createRunsStore", () => {
  it("lets this tab's runs override the summaries on file, and tells subscribers once per change", () => {
    const store = createRunsStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const onFile = fromSummary(summary({ status: "queued" }));
    store.setSummaries({ run_1: onFile });
    expect(store.get().run_1.status).toBe("queued");
    store.setLocal({ run_1: reduceRun(onFile, { type: "status", text: "Starting" }) });
    expect(store.get().run_1.status).toBe("running");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when nothing changed, so nothing re-renders", () => {
    const store = createRunsStore();
    const listener = vi.fn();
    const run = fromSummary(summary());
    store.setSummaries({ run_1: run });
    store.subscribe(listener);
    const before = store.get();
    store.setSummaries({ run_1: run });
    store.setLocal(store.local());
    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBe(before);
  });

  it("recognizes the same summary read again", () => {
    const a = fromSummary(summary());
    expect(sameRun(a, fromSummary(summary()))).toBe(true);
    expect(sameRun(a, fromSummary(summary({ status: "done" })))).toBe(false);
    expect(sameRun(undefined, a)).toBe(false);
  });
});
