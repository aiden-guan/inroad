import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runAgent, type RunOptions } from "@/lib/ai/engine";
import { taskHeader } from "@/lib/ai/prompts/core";
import { REPLY_READ_RULES } from "@/lib/ai/prompts/outreach";
import type { Account, DraftCritic, DraftStep, ReplyIntent, Workspace } from "@/lib/domain/types";
import { DATA_DIR } from "@/lib/store/settings";
import { emptyWorkspace } from "@/lib/store/workspace";
import { critique, criticPassed, readInCode, submitRead } from "@/lib/workflows/compose";
import { CALIBRATION_SET, scoreCalibration, type CalibrationEmail } from "./calibration";
import { CLASSIFY_GATE, REPLY_SET, scoreClassify, type LabeledReply } from "./reply-set";

/**
 * The evals behind the draft-quality gates (SPEC §4.0): the critic's calibration gate and the reply classifier's
 * agreement check. They call the real API when a key is set (scripts/eval-*.ts), and run offline against the mock in
 * the test suite. Each returns a report; the scripts fail when the gate fails.
 */

export interface EvalCost {
  calls: number;
  costUsd: number;
}

function agentWithCost(cost: EvalCost) {
  return {
    agent: async <T>(opts: Omit<RunOptions, "emit" | "signal">) => {
      const res = await runAgent<T>({ ...opts, emit: () => {} });
      cost.calls++;
      cost.costUsd += res.costUsd;
      return res;
    },
  };
}

const Calibration = z.array(
  z.object({
    id: z.string().min(1).max(40),
    label: z.enum(["replied", "ai_sdr"]),
    frame: z.enum(["founder_card", "4t", "problem_prompter", "mouse_trap", "observation_problem_proof", "referral", "permission_to_close"]),
    persona: z.string().max(80),
    band: z.string().max(20),
    subject: z.string().max(120),
    body: z.string().min(20).max(2000),
  }),
);

/**
 * Permissioned real emails, when the founder or the team put them in `calibration.json` in the data folder (the shape
 * of CALIBRATION_SET). They replace the bundled set, which models the patterns but isn't real email.
 */
export function calibrationSet(ws?: Workspace): { set: CalibrationEmail[]; source: "local" | "bundled" } {
  const file = path.join(DATA_DIR, "calibration.json");
  const base = fs.existsSync(file) ? Calibration.parse(JSON.parse(fs.readFileSync(file, "utf8"))) : CALIBRATION_SET;
  // The founder's own "what bad looks like" emails are negatives for this workspace (SPEC §4.0 day-3 move).
  const theirs: CalibrationEmail[] = (ws?.voice?.badExamples ?? []).map((b, i) => ({ id: `ws${i + 1}`, label: "ai_sdr", frame: "4t", persona: "buyer", band: "small", subject: "", body: b.text }));
  return { set: [...base, ...theirs], source: fs.existsSync(file) ? "local" : "bundled" };
}

/** Judges one labeled email exactly as compose does: blind, pairwise against a reference, from the persona's seat. */
export async function judgeEmail(e: CalibrationEmail, cost: EvalCost): Promise<DraftCritic | null> {
  const step: DraftStep = {
    step: 1,
    personalizedSpans: [],
    sendOn: "",
    thread: "new",
    subject: e.subject,
    body: e.body,
    frame: e.frame,
    evidenceIds: [],
    claimIds: [],
    lint: { passed: true, violations: [], stats: { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 } },
    status: "draft",
  };
  const account = { domain: "calibration.example", name: "Calibration", dossier: { snapshot: { headcount: { value: e.band, method: "estimate" } } } } as unknown as Account;
  return critique(agentWithCost(cost), emptyWorkspace(), step, { title: e.persona }, account);
}

export async function runCriticEval(opts: { set?: CalibrationEmail[]; judge?: (e: CalibrationEmail, cost: EvalCost) => Promise<DraftCritic | null>; onItem?: (line: string) => void } = {}) {
  const set = opts.set ?? CALIBRATION_SET;
  const judge = opts.judge ?? judgeEmail;
  const cost: EvalCost = { calls: 0, costUsd: 0 };
  const results: { id: string; label: CalibrationEmail["label"]; accepted: boolean | null; preferred: boolean | null; fatal: string[] }[] = [];
  for (const e of set) {
    const v = await judge(e, cost).catch(() => null);
    const accepted = v ? criticPassed(v) : null;
    results.push({ id: e.id, label: e.label, accepted, preferred: v ? v.preferredOverReference : null, fatal: v?.fatal ?? [] });
    opts.onItem?.(`${e.id} ${e.label.padEnd(7)} ${accepted === null ? "no verdict" : accepted ? "accepted" : "rejected"}${v?.fatal.length ? ` · ${v.fatal.join("; ")}` : ""}`);
  }
  const preferred = results.filter((r) => r.label === "replied" && r.preferred !== null);
  return { ...scoreCalibration(results), winRateVsReference: preferred.length ? preferred.filter((r) => r.preferred).length / preferred.length : null, cost, results };
}

/* ───────────────────────────── Reply classifier ───────────────────────────── */

/** Reads one reply exactly as compose does: code for plain opt-outs and auto-replies, else the model on `tier`. */
export async function readReply(text: string, tier: "fast" | "operator" | "strategist", cost: EvalCost): Promise<ReplyIntent | null> {
  const coded = readInCode(text);
  if (coded) return coded;
  const res = await agentWithCost(cost).agent<{ intent: ReplyIntent }>({
    tier,
    system: REPLY_READ_RULES,
    messages: [{ role: "user", content: `${taskHeader()}\n\n<reply from="the prospect">\n${text.slice(0, 4000)}\n</reply>` }],
    tools: [submitRead],
    effort: "low",
    maxTokens: 2000,
    requireTerminal: true,
  });
  return res.result?.intent ?? null;
}

export async function runClassifyEval(opts: { set?: LabeledReply[]; tier?: "fast" | "operator" | "strategist"; read?: (r: LabeledReply, cost: EvalCost) => Promise<ReplyIntent | null>; onItem?: (line: string) => void } = {}) {
  const set = opts.set ?? REPLY_SET;
  const cost: EvalCost = { calls: 0, costUsd: 0 };
  const read = opts.read ?? ((r: LabeledReply, c: EvalCost) => readReply(r.text, opts.tier ?? "fast", c));
  const results: { id: string; expected: ReplyIntent; got: ReplyIntent | null }[] = [];
  for (const r of set) {
    const got = await read(r, cost).catch(() => null);
    results.push({ id: r.id, expected: r.intent, got });
    opts.onItem?.(`${r.id} ${r.intent.padEnd(12)} ${got ?? "no answer"}${got === r.intent ? "" : "  MISS"}`);
  }
  return { ...scoreClassify(results), gate: CLASSIFY_GATE, cost, results };
}
