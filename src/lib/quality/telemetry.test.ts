import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DraftCritic } from "@/lib/domain/types";
import { DATA_DIR } from "@/lib/store/settings";
import { NOW, at, makeActivity, makeDeal, makeMeeting, makePackage, makeStep, makeWorkspace } from "@/test/factories";
import { lintDraft } from "./lint";
import { pickReference } from "./references";
import { localReferences } from "./references-store";
import { criticPass, productHealth } from "./telemetry";

const critic = (patch: Partial<DraftCritic> = {}): DraftCritic => ({ wouldReply: true, preferredOverReference: true, povObvious: false, fatal: [], rewrite: "", unsupportedSpans: [], referenceId: "ref", at: at(0), ...patch });

describe("productHealth", () => {
  it("computes the critic, edit, evidence and Check replies rates from the workspace", () => {
    const ws = makeWorkspace();
    ws.outreach.o1 = makePackage("o1", "a.example", {
      steps: [makeStep(1, { critic: critic() }), makeStep(2, { critic: critic({ wouldReply: false }) })],
      alternates: [makeStep(1, { critic: critic({ fatal: ["generic opener"], preferredOverReference: false }) })],
    });
    for (let i = 0; i < 5; i++) ws.activities.push(makeActivity(`s${i}`, { kind: "touch_sent", draftRef: { packageId: "o1", step: 1 }, editDistance: i < 4 ? 0.1 : 0.6, at: at(-10), outcome: i < 2 ? "no_reply" : undefined, outcomeAt: i < 2 ? at(-5) : undefined, personId: `p${i}` }));
    ws.activities.push(makeActivity("r", { kind: "reply_received", personId: "p2", at: at(-8) }));
    ws.evidence.e1 = { id: "e1", claim: "", quote: "", url: "", host: "", sourceType: "press", retrievedAt: at(-1), confidence: "high", flaggedWrong: { at: at(0) } };
    const rows = Object.fromEntries(productHealth(ws, NOW).map((r) => [r.key, r]));
    // Three verdicts: too few to judge against the target yet.
    expect(rows.critic_first_pass).toMatchObject({ value: "33%", n: 3, ok: null, target: "≥70%" });
    expect(rows.critic_vs_reference).toMatchObject({ value: "67%", n: 3 });
    expect(rows.light_edits).toMatchObject({ value: "80%", n: 5, ok: true });
    expect(rows.flagged_wrong).toMatchObject({ value: "100%", n: 1, ok: null });
    expect(rows.outcomes_marked).toMatchObject({ value: "60%", n: 5, ok: false });
  });

  it("times the first run and the founder's first weeks", () => {
    const ws = makeWorkspace();
    ws.onboarding = { status: "hired", runId: "run_f", discoveryRunId: "run_d", hiredAt: at(-30), sections: { snapshot: new Date(new Date(at(-30, "09:00")).getTime() + 18_000).toISOString() } };
    ws.runs = [
      { id: "run_f", workflow: "foundation", title: "", startedAt: at(-30, "09:00"), status: "done" },
      { id: "run_d", workflow: "discovery", title: "", startedAt: at(-30, "09:00"), endedAt: new Date(new Date(at(-30, "09:00")).getTime() + 150_000).toISOString(), status: "done" },
    ];
    ws.deals.d = makeDeal("d", "a.example");
    for (let i = 0; i < 5; i++) ws.meetings[`m${i}`] = makeMeeting(`m${i}`, "d", { startsAt: at(-25 + i) });
    ws.activities.push(makeActivity("first", { kind: "touch_sent", draftRef: { packageId: "x", step: 1 }, at: at(-29, "09:00") }));
    const rows = Object.fromEntries(productHealth(ws, NOW).map((r) => [r.key, r]));
    expect(rows.first_learned).toMatchObject({ value: "18s", ok: true });
    expect(rows.first_companies).toMatchObject({ value: "2m 30s", ok: false });
    expect(rows.day1_send).toMatchObject({ value: "Yes", ok: true });
    expect(rows.week1_import).toMatchObject({ value: "No", ok: false });
    expect(rows.week3_conversations).toMatchObject({ value: "Yes", ok: true });
  });

  it("uses the same pass rule as the composer", () => {
    expect(criticPass(critic())).toBe(true);
    expect(criticPass(critic({ povObvious: true }))).toBe(false);
    expect(criticPass(critic({ unsupportedSpans: ["x"] }))).toBe(false);
  });
});

describe("permissioned references", () => {
  it("replace the bundled ones when references.json is in the data folder", () => {
    const file = path.join(DATA_DIR, "references.json");
    expect(localReferences()).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify([{ id: "real-1", frames: ["4t"], step: 1, subject: "your close", body: "Ana, a real email that got a reply, with permission to use it." }]));
    const refs = localReferences();
    expect(refs?.map((r) => r.id)).toEqual(["real-1"]);
    expect(pickReference(makeWorkspace(), "4t", 1, () => 0, refs)).toEqual({ id: "real-1", text: "Subject: your close\n\nAna, a real email that got a reply, with permission to use it." });
    // A broken file is ignored, never a failed draft.
    fs.writeFileSync(file, "{not json");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    expect(localReferences()).toBeUndefined();
    fs.rmSync(file);
  });
});

describe("drafts that read like a pasted AI-written email", () => {
  const bad = "Hi Dana, I hope this email finds you well! I came across Northwind and was really impressed by your growth. Companies like yours often struggle with financial operations, and our AI-powered platform helps streamline reconciliation seamlessly.";
  const lint = (body: string) => lintDraft({ subject: "close", body, frame: "4t", step: 1, kind: "email", sourcedText: body, badExamples: [bad] });
  it("warn, and a founder-style draft doesn't", () => {
    const echo = lint("Dana, I hope this email finds you well. I came across Northwind and was impressed by your growth. Companies like yours struggle with financial operations, and our platform helps with reconciliation. Is it on your list?");
    expect(echo.violations).toContainEqual(expect.objectContaining({ code: "NEAR_DUPLICATE", severity: "warn" }));
    const own = lint("Dana, the billing analyst post at Northwind asks the new hire to own usage reconciliation in their first 90 days. That script tends to outlive the person who wrote it. Is reconciliation going to sit with the analyst, or stay with you?");
    expect(own.violations.filter((v) => v.code === "NEAR_DUPLICATE")).toEqual([]);
  });
});
