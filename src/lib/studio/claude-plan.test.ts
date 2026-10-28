import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, type RunOptions } from "@/lib/ai/engine";
import { sampleWorkspace } from "@/lib/sample";
import { PIECE } from "@/lib/sample/studio";
import { readStudioFile } from "./files";
import { runVisual } from "@/lib/workflows/visual";
import { runStudio } from "@/lib/workflows/studio";
import { claudePlanStatus, connectClaudePlan, disconnectClaudePlan, runClaudePlan } from "./claude-plan";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-claude-fixture-"));
const binary = path.join(dir, "claude");
const LIVE = process.env.INROAD_CLAUDE_LIVE_TEST === "1";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#3344aa"/></svg>';
const options = (): RunOptions => ({ system: "Create a graphic.", messages: [{ role: "user", content: "A blue square." }], tools: [defineTool({ name: "submit_svg", description: "Submit the SVG", schema: z.object({ svg: z.string() }), terminal: true })], emit: vi.fn(), requireTerminal: true });

beforeEach(async () => {
  if (LIVE) return;
  await disconnectClaudePlan();
  fs.writeFileSync(binary, `#!/usr/bin/env node
const args=process.argv.slice(2);const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');
if(args.includes('auth')){
 if(args.includes('status')){send({loggedIn:process.env.TEST_CLAUDE_AUTH!=='none',authMethod:process.env.TEST_CLAUDE_AUTH||'claude.ai',apiProvider:'firstParty',subscriptionType:'max'});process.exit(0);}
 if(args.includes('login')){process.stdout.write('https://claude.ai/oauth/authorize?test=1\\n');setInterval(()=>{},10000);}
 else process.exit(0);
}else{
 let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
  if(Object.keys(process.env).some(k=>k.startsWith('ANTHROPIC_')||k.startsWith('CLAUDE_CODE_USE_')||/(API_KEY|AUTH_TOKEN)$/.test(k)))process.exit(7);
  if(!args.includes('--safe-mode')||args[args.indexOf('--tools')+1]!==''||!args.includes('--no-session-persistence'))process.exit(8);
  if(process.env.TEST_CLAUDE_SLOW)return setInterval(()=>{},10000);
  const user=JSON.parse(input);if(process.env.TEST_CLAUDE_IMAGE&&!user.message.content.some(b=>b.type==='image'))process.exit(9);
  send({type:'system',subtype:'init',model:'claude-sonnet-5-5'});
  if(process.env.TEST_CLAUDE_QUOTA)return send({type:'result',subtype:'error_during_execution',is_error:true,result:'usage limit reached'});
  send({type:'result',subtype:'success',structured_output:process.env.TEST_CLAUDE_INVALID?{svg:1}:{svg:${JSON.stringify(SVG)}},usage:{input_tokens:30,output_tokens:20},total_cost_usd:1.23});
 });
}
`, { mode: 0o700 });
  vi.stubEnv("INROAD_CLAUDE_PATH", binary);
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(LIVE)("Claude plan adapter", () => {
  it("requires connection and disconnect preserves the shared Claude sign-in", async () => {
    expect(await claudePlanStatus()).toMatchObject({ available: true, connected: false });
    await expect(runClaudePlan(options())).rejects.toThrow("Connect your Claude plan");
    expect(await connectClaudePlan()).toMatchObject({ connected: true, plan: "max" });
    await disconnectClaudePlan();
    expect(await claudePlanStatus()).toMatchObject({ connected: false });
    expect(await connectClaudePlan()).toMatchObject({ connected: true });
  });
  it("validates structured SVG output and never books the CLI's API-price estimate as a subscription charge", async () => {
    await connectClaudePlan();
    vi.stubEnv("ANTHROPIC_API_KEY", "not-for-this-route"); vi.stubEnv("OPENAI_API_KEY", "not-for-this-route");
    const result = await runClaudePlan<{ svg: string }>(options());
    expect(result.result?.svg).toBe(SVG);
    expect(result.costUsd).toBe(0);
    expect(result.modelName).toBe("Claude plan · claude-sonnet-5-5");
    expect(result.usage.outputTokens).toBe(20);
  });
  it("keeps images in the direct multimodal input for render review", async () => {
    await connectClaudePlan(); vi.stubEnv("TEST_CLAUDE_IMAGE", "1");
    const opts = options(); opts.messages = [{ role: "user", content: [{ type: "text", text: "Review this render" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "test-image" } }] }];
    expect((await runClaudePlan(opts)).result).toEqual({ svg: SVG });
  });
  it("rejects an API account, invalid structured output and usage limits without falling back", async () => {
    await connectClaudePlan(); vi.stubEnv("TEST_CLAUDE_AUTH", "api_key");
    await expect(runClaudePlan(options())).rejects.toThrow("won't use an API key");
    vi.stubEnv("TEST_CLAUDE_AUTH", "claude.ai"); vi.stubEnv("TEST_CLAUDE_INVALID", "1");
    await expect(runClaudePlan(options())).rejects.toThrow("format checks");
    vi.stubEnv("TEST_CLAUDE_INVALID", ""); vi.stubEnv("TEST_CLAUDE_QUOTA", "1");
    await expect(runClaudePlan(options())).rejects.toMatchObject({ code: "rate_limit" });
  });
  it("starts official private sign-in when needed and cancels it", async () => {
    vi.stubEnv("TEST_CLAUDE_AUTH", "none");
    expect(await connectClaudePlan()).toMatchObject({ pending: true, connected: false });
    await disconnectClaudePlan();
    expect(await claudePlanStatus()).toMatchObject({ connected: false });
  });
  it("stops a cancelled request and releases its slot", async () => {
    await connectClaudePlan(); vi.stubEnv("TEST_CLAUDE_SLOW", "1");
    const controller = new AbortController(); const pending = runClaudePlan({ ...options(), signal: controller.signal }); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "stopped" });
    vi.stubEnv("TEST_CLAUDE_SLOW", ""); expect((await runClaudePlan(options())).result).toEqual({ svg: SVG });
  });
});

it.skipIf(!LIVE)("live Claude plan designs, renders and reviews a finished PNG and SVG", async () => {
  expect((await connectClaudePlan()).connected).toBe(true);
  const ws = sampleWorkspace(new Date()); const signal = new AbortController().signal;
  try {
    const result = await runVisual({ runId: "run_claude_live", args: { pieceId: PIECE.hero, optionId: "opt_ll_hours", preset: "og", variants: 1, agentProvider: "claude_plan", direction: "An editorial illustration drawn directly with SVG paths: a messy cascade of receipts folding into one crisp ledger. Large confident headline on the left; hand-drawn paper metaphor on the right. Restrained brand palette, no generic circles or gradient blobs. Use only approved words." }, signal,
      agent: (opts) => runClaudePlan({ ...opts, emit: () => {}, signal }), emit: () => {}, read: () => ws, mutate: async (fn) => fn(ws), noteFreeSignals: () => {},
    });
    expect(result.visualIds).toHaveLength(1);
    const visual = ws.studio.visuals[result.visualIds[0]];
    const png = readStudioFile(visual.pngFile!); expect(png?.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    fs.writeFileSync("/tmp/inroad-claude-plan-live.png", png!, { mode: 0o600 });
    fs.writeFileSync("/tmp/inroad-claude-plan-live.svg", readStudioFile(visual.svgFile)!, { mode: 0o600 });
    fs.writeFileSync("/tmp/inroad-claude-plan-live-verification.json", JSON.stringify({ checks: visual.checks, review: visual.review, width: visual.width, height: visual.height }), { mode: 0o600 });
  } finally { await disconnectClaudePlan(); }
}, 900_000);

it.skipIf(!LIVE)("live Claude plan writes and reviews copy without an API key", async () => {
  expect((await connectClaudePlan()).connected).toBe(true);
  const ws = sampleWorkspace(new Date()); const signal = new AbortController().signal;
  try {
    const result = await runStudio({ runId: "run_claude_copy_live", args: { format: "homepage_hero", pieceId: "stu_claude_live", agentProvider: "claude_plan" }, signal,
      agent: (opts) => runClaudePlan({ ...opts, emit: () => {}, signal }), emit: () => {}, read: () => ws, mutate: async (fn) => fn(ws), noteFreeSignals: () => {},
    });
    expect(result).toBeDefined();
    const piece = ws.studio.pieces.stu_claude_live;
    expect(piece.options.length).toBeGreaterThan(0);
    fs.writeFileSync("/tmp/inroad-claude-plan-copy-verification.json", JSON.stringify({ options: piece.options.length, passed: piece.options.filter((option) => option.lint.passed).length }), { mode: 0o600 });
  } finally { await disconnectClaudePlan(); }
}, 900_000);
