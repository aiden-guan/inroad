import { beforeAll, describe, expect, it } from "vitest";
import type { Foundation, Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, at } from "@/test/factories";
import { HISTORY_MAX, applyRevision, buildRevision, changeLine, restoreFoundation, reviseFoundation, revisionLabel, revisionStale } from "./revision";

let sample: Workspace;
beforeAll(() => {
  sample = sampleWorkspace(NOW);
});
const f = (): Foundation => structuredClone(sample.foundation!);

describe("buildRevision", () => {
  it("keeps only changes that make sense for the target", () => {
    const fd = f();
    expect(buildRevision(fd, { target: "icp.sentence", op: "add", text: "x" })).toBeNull();
    expect(buildRevision(fd, { target: "icp.sentence", op: "set", text: "" })).toBeNull();
    // Saying what it already says is no change.
    expect(buildRevision(fd, { target: "icp.sentence", op: "set", text: ` ${fd.icp.hypothesis.sentence.toUpperCase()} ` })).toBeNull();
    // A persona or criterion that doesn't exist.
    expect(buildRevision(fd, { target: "persona.line", op: "set", refId: "per_nobody", text: "Lead with the close." })).toBeNull();
    expect(buildRevision(fd, { target: "icp.criterion", op: "remove", refId: "icp_nobody" })).toBeNull();
    // Adding what's there already.
    expect(buildRevision(fd, { target: "positioning.bestFit", op: "add", text: fd.positioning.bestFit[0] })).toBeNull();
    expect(buildRevision(fd, { target: "icp.criterion", op: "add", text: "Has a controller", criterion: undefined })).toBeNull();
  });

  it("records before and after for the diff", () => {
    const fd = f();
    const persona = fd.personas[0];
    expect(buildRevision(fd, { target: "persona.line", op: "set", refId: persona.id, text: "Lead with  the close." })).toEqual({
      target: "persona.line",
      op: "set",
      refId: persona.id,
      text: "Lead with the close.",
      section: "personas",
      before: persona.line,
      after: "Lead with the close.",
    });
    const hypothesis = fd.icp.criteria.find((c) => c.status === "hypothesis")!;
    expect(buildRevision(fd, { target: "icp.criterion", op: "validate", refId: hypothesis.id })).toMatchObject({ before: `${hypothesis.text} (hypothesis)`, after: `${hypothesis.text} (validated)` });
    expect(buildRevision(fd, { target: "icp.antiIcp", op: "add", text: "No finance team yet", reason: null })).toMatchObject({ reason: "Seen in recent calls", before: "", after: "No finance team yet" });
  });
});

describe("applyRevision", () => {
  it("applies each kind of change", () => {
    const fd = f();
    const persona = fd.personas[0];
    const criterion = fd.icp.criteria[0];
    const run = (c: Parameters<typeof buildRevision>[1]) => applyRevision(fd, buildRevision(fd, c)!);
    run({ target: "positioning.category", op: "set", text: "Usage billing reconciliation" });
    run({ target: "positioning.bestFit", op: "add", text: "Bills on usage with a controller in seat" });
    run({ target: "icp.segment", op: "set", text: "Usage-priced dev tools, 50–300 people" });
    run({ target: "icp.criterion", op: "add", text: "Bills on usage", criterion: { kind: "firmographic", mustHave: true, detection: "site" } });
    run({ target: "icp.criterion", op: "remove", refId: criterion.id });
    run({ target: "persona.pain", op: "add", refId: persona.id, text: "The close takes nine days" });
    run({ target: "messaging.oneLiner", op: "set", text: "Tollgate reconciles usage to invoices." });
    run({ target: "messaging.customerWords", op: "add", text: "month-end fire drill" });
    expect(fd.positioning.category.name).toBe("Usage billing reconciliation");
    expect(fd.positioning.bestFit.at(-1)).toBe("Bills on usage with a controller in seat");
    expect(fd.icp.primarySegment).toBe("Usage-priced dev tools, 50–300 people");
    expect(fd.icp.criteria.at(-1)).toMatchObject({ id: "icp_r_bills_on_usage", text: "Bills on usage", status: "hypothesis", mustHave: true, detection: "site" });
    expect(fd.icp.criteria.some((c) => c.id === criterion.id)).toBe(false);
    expect(fd.personas[0].pains.at(-1)).toBe("The close takes nine days");
    expect(fd.messaging.oneLiner).toBe("Tollgate reconciles usage to invoices.");
    expect(fd.messaging.customerWords.at(-1)).toEqual({ phrase: "month-end fire drill", source: "call" });
  });

  it("derives criterion ids from the text, so both sides of the reducer agree", () => {
    const a = f();
    const b = f();
    const r = buildRevision(a, { target: "icp.criterion", op: "add", text: "Bills on usage", criterion: { kind: "firmographic", mustHave: false, detection: "site" } })!;
    applyRevision(a, r);
    applyRevision(b, r);
    expect(a.icp.criteria.at(-1)!.id).toBe(b.icp.criteria.at(-1)!.id);
  });

  it("knows when the playbook moved on since a suggestion", () => {
    const fd = f();
    const r = buildRevision(fd, { target: "messaging.oneLiner", op: "set", text: "Something sharper." })!;
    expect(revisionStale(fd, r)).toBe(false);
    fd.messaging.oneLiner = "The founder rewrote it.";
    expect(revisionStale(fd, r)).toBe(true);
    expect(revisionStale(null, r)).toBe(true);
  });

  it("labels and describes changes in words", () => {
    const fd = f();
    const r = buildRevision(fd, { target: "persona.line", op: "set", refId: fd.personas[0].id, text: "Lead with the close." })!;
    expect(revisionLabel(fd, r)).toBe(`How to talk to: ${fd.personas[0].titles[0]}`);
    expect(changeLine(fd, r)).toBe(`How to talk to: ${fd.personas[0].titles[0]}: “Lead with the close.”`);
  });
});

describe("versions", () => {
  it("keeps at most 10 versions, oldest dropped first", () => {
    const ws = structuredClone(sample);
    for (let i = 0; i < 12; i++) {
      reviseFoundation(ws, { revision: buildRevision(ws.foundation!, { target: "messaging.oneLiner", op: "set", text: `Version ${i}` })!, source: "refresh", runId: `run_${i}`, at: at(0) });
    }
    expect(ws.foundationHistory).toHaveLength(HISTORY_MAX);
    expect(ws.foundation!.version).toBe(sample.foundation!.version + 12);
    expect(ws.foundationHistory![0].version).toBe(sample.foundation!.version + 2);
    // Restoring brings an old text back as a new version, and can itself be undone.
    const target = ws.foundationHistory![4];
    restoreFoundation(ws, target.version, at(0));
    expect(ws.foundation!.messaging.oneLiner).toBe(target.snapshot.messaging.oneLiner);
    expect(ws.foundation!.version).toBe(sample.foundation!.version + 13);
  });
});
