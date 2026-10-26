import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AgentError, type RunOptions, type RunResult } from "@/lib/ai/engine";
import { emptyUsage } from "@/lib/ai/models";
import type { Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { CLAIM } from "@/lib/sample/ids";
import { MATERIAL, PIECE } from "@/lib/sample/studio";
import { NOW, makeWorkspace } from "@/test/factories";
import { runStudio } from "./studio";
import type { WorkflowContext } from "./types";

/**
 * The Studio pipeline against a scripted model: no network, no tokens. Each script step answers one
 * model call (writer, revision, reader, rewrite) and records what the pipeline sent.
 */

type Opts = Omit<RunOptions, "emit" | "signal">;
type Step = (opts: Opts) => unknown;
type Args = Parameters<typeof runStudio>[0]["args"];

function harness(ws: Workspace, args: Args, script: Step[]) {
  const state = { ws: structuredClone(ws) };
  const calls: Opts[] = [];
  const ctx: WorkflowContext<Args> = {
    runId: "run_studio_test",
    args,
    emit: () => {},
    signal: new AbortController().signal,
    agent: async <T,>(opts: Opts): Promise<RunResult<T>> => {
      calls.push(opts);
      const step = script.shift();
      if (!step) throw new Error(`Unexpected model call #${calls.length}`);
      const result = step(opts) as T;
      const tool = opts.tools?.[0]?.name ?? "submit";
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        ...opts.messages,
        { role: "assistant", content: [{ type: "tool_use", id: `tu_${calls.length}`, name: tool, input: result as Record<string, unknown> }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${calls.length}`, content: "Saved." }] },
      ];
      return { result, text: "", messages, stopReason: "tool_use", usage: emptyUsage(), costUsd: 0 };
    },
    read: () => state.ws,
    mutate: async <R,>(fn: (w: Workspace) => R) => fn(state.ws),
    noteFreeSignals: () => {},
  };
  return { ctx, calls, state };
}

const opt = (moveId: string, line: string, receiptIds: string[] = []) => ({ moveId, parts: { line }, receiptIds, why: "A controller sees their own close." });

/** The reader: ranks options by a preference list of their text, and can flag one as AI-sounding. */
function reader(prefer: string[], flags: Record<string, { soundsAi?: boolean; act?: boolean }> = {}): Step {
  return (opts) => {
    const text = String(opts.messages[0].content);
    const labeled = [...text.matchAll(/<option label="([A-L])">\nLine: ([^\n]+)\n<\/option>/g)].map((m) => ({ label: m[1], line: m[2] }));
    const rank = (l: string) => {
      const i = prefer.indexOf(l);
      return i === -1 ? 99 : i;
    };
    const ranking = [...labeled].sort((a, b) => rank(a.line) - rank(b.line)).map((x) => x.label);
    return {
      verdicts: labeled.map(({ label, line }) => ({
        label,
        stop: true,
        act: flags[line]?.act ?? true,
        soundsAi: flags[line]?.soundsAi ?? false,
        giveaway: flags[line]?.soundsAi ? "reimagined" : "",
        swappable: false,
        believable: true,
        fatal: [],
        rewrite: flags[line]?.soundsAi ? "Name the spreadsheet step instead." : "",
      })),
      ranking,
    };
  };
}

const sample = sampleWorkspace(NOW);
const CLEAN_A = "Stop rebuilding the close in spreadsheets";
const CLEAN_D = "Your controller gets the first week of the month back";
const FIXED_B = "Close usage revenue in 6 hours instead of 4 days";
const FIXED_C = "Tie out usage before the invoice run";

describe("runStudio", () => {
  it("writes, lints, fixes what failed, lets the reader rank, and saves the piece", async () => {
    const { ctx, calls, state } = harness(sample, { format: "one_liner", pieceId: "stu_new", brief: "A line for the homepage" }, [
      () => ({
        options: [
          opt("villain_object", CLEAN_A, ["co_what"]),
          opt("one_number", "Unlock the power of 6-hour closes", [CLAIM.designPartner]),
          opt("their_words", FIXED_C, ["clm_invented"]),
          opt("two_buyers", CLEAN_D),
        ],
        gaps: [],
      }),
      // Revision: only the failing options change.
      (o) => {
        const last = o.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
        expect(String(last[0].content)).toMatch(/Option 2[\s\S]*unlock the power/i);
        expect(String(last[0].content)).toMatch(/Option 3[\s\S]*clm_invented/);
        return {
          options: [opt("villain_object", CLEAN_A, ["co_what"]), opt("one_number", FIXED_B, [CLAIM.designPartner]), opt("their_words", FIXED_C, []), opt("two_buyers", CLEAN_D)],
          gaps: [],
        };
      },
      reader([CLEAN_D, FIXED_B, CLEAN_A, FIXED_C]),
    ]);

    const out = await runStudio(ctx);
    expect(out).toEqual({ pieceId: "stu_new", options: 4, clean: 4 });
    expect(calls.map((c) => c.tier)).toEqual(["strategist", "strategist", "fast"]); // short lines write on Opus; the reader is Haiku

    const piece = state.ws.studio.pieces.stu_new;
    expect(piece.options.map((o) => o.parts.line)).toEqual([CLEAN_D, FIXED_B, CLEAN_A, FIXED_C]);
    expect(piece.options.every((o) => o.lint.passed)).toBe(true);
    expect(piece.options[0].critic).toMatchObject({ rank: 1, of: 4 });
    expect(piece.options.flatMap((o) => o.receiptIds)).not.toContain("clm_invented");
    expect(piece).toMatchObject({ format: "one_liner", audience: "b2b", occasion: "evergreen", brief: "A line for the homepage", runId: "run_studio_test" });

    // The writer saw receipts, moves and the format's limits; the reader saw only the copy.
    const task = String(calls[0].messages[0].content);
    expect(task).toContain(`[${CLAIM.designPartner}]`);
    expect(task).toContain("[villain_object]");
    expect(task).toMatch(/≤12 words/);
    expect(String(calls[2].messages[0].content)).not.toContain("villain_object");
  });

  it("rewrites a top option the reader smelled as AI, and keeps the rewrite only if it's clean", async () => {
    const AI_ISH = "Month-end close, reimagined for controllers";
    const { ctx, calls, state } = harness(sample, { format: "one_liner", pieceId: "stu_ai" }, [
      () => ({ options: [opt("villain_object", AI_ISH), opt("two_buyers", CLEAN_D)], gaps: [] }),
      reader([AI_ISH, CLEAN_D], { [AI_ISH]: { soundsAi: true } }),
      (o) => {
        expect(String(o.messages[0].content)).toMatch(/reads as AI-written \(“reimagined”\)/);
        return { options: [opt("villain_object", "Month-end close without the VLOOKUP on customer ID"), opt("two_buyers", CLEAN_D)], gaps: [] };
      },
    ]);
    await runStudio(ctx);
    expect(calls).toHaveLength(3);
    const lines = state.ws.studio.pieces.stu_ai.options.map((o) => o.parts.line);
    expect(lines).toContain("Month-end close without the VLOOKUP on customer ID");
    expect(lines).not.toContain(AI_ISH);
  });

  it("ships the linted options when the reader fails", async () => {
    const { ctx, state } = harness(sample, { format: "one_liner", pieceId: "stu_noreader" }, [
      () => ({ options: [opt("villain_object", CLEAN_A), opt("two_buyers", CLEAN_D)], gaps: [] }),
      () => {
        throw new AgentError("overloaded", "overloaded");
      },
    ]);
    const out = await runStudio(ctx);
    expect(out.clean).toBe(2);
    expect(state.ws.studio.pieces.stu_noreader.options.every((o) => o.critic === undefined)).toBe(true);
  });

  it("records gaps instead of guessing, and counts material it used", async () => {
    const { ctx, state } = harness(sample, { format: "one_liner", pieceId: "stu_gaps" }, [
      () => ({ options: [opt("before_after", "Month-end close without the VLOOKUP on customer ID", [MATERIAL.closeStory]), opt("one_number", "Pilots from [[pilot fee]]", [])], gaps: ["The pilot fee"] }),
      (o) => {
        const last = o.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
        expect(String(last[0].content)).toMatch(/PLACEHOLDER/);
        // The gap can't be filled from receipts, so it stays a gap.
        return { options: [opt("before_after", "Month-end close without the VLOOKUP on customer ID", [MATERIAL.closeStory]), opt("one_number", "Pilots from [[pilot fee]]", [])], gaps: ["The pilot fee"] };
      },
      reader([]),
    ]);
    await runStudio(ctx);
    const piece = state.ws.studio.pieces.stu_gaps;
    expect(piece.gaps).toEqual(["pilot fee"]);
    expect(piece.options[0].lint.passed).toBe(true); // clean options first
    expect(piece.options[1].lint.passed).toBe(false);
    const story = state.ws.studio.material.find((m) => m.id === MATERIAL.closeStory)!;
    expect(story.uses).toBe(sample.studio.material.find((m) => m.id === MATERIAL.closeStory)!.uses + 1);
  });

  it("writes more into an existing piece and never drops a kept option", async () => {
    const before = sample.studio.pieces[PIECE.hero];
    const kept = before.options.find((o) => o.kept)!;
    const hero = (headline: string) => ({ moveId: "situation_qualifier", parts: { headline, subhead: "Ledgerline matches each usage event to its invoice line, including late events.", cta: "Run last month's close", proof: "" }, receiptIds: ["co_what"], why: "x" });
    const { ctx, state } = harness(sample, { format: "homepage_hero", pieceId: PIECE.hero }, [
      () => ({ options: [hero("Month-end close for usage-priced companies"), hero("The close for controllers who bill on usage")], gaps: [] }),
      () => ({ verdicts: [], ranking: [] }),
    ]);
    await runStudio(ctx);
    const after = state.ws.studio.pieces[PIECE.hero];
    expect(after.options.map((o) => o.id)).toContain(kept.id);
    expect(after.options[0].parts.headline).toBe("Month-end close for usage-priced companies");
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.title).toBe(before.title);
  });

  it("refuses a customer story without a real result, before spending tokens", async () => {
    const { ctx, calls } = harness(makeWorkspace(), { format: "customer_story" }, []);
    await expect(runStudio(ctx)).rejects.toMatchObject({ code: "bad_request" });
    expect(calls).toHaveLength(0);
  });
});
