import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it, vi } from "vitest";
import type { RunOptions, RunResult } from "@/lib/ai/engine";
import { emptyUsage } from "@/lib/ai/models";
import type { Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { PIECE } from "@/lib/sample/studio";
import { readStudioFile } from "@/lib/studio/files";
import { generateImage } from "@/lib/studio/openai";
import { generateChatGptImage } from "@/lib/studio/chatgpt";
import { NOW } from "@/test/factories";
import type { WorkflowContext } from "./types";
import { runVisual } from "./visual";

/**
 * The visuals pipeline against a scripted model and a stubbed OpenAI: no network, no tokens. The SVG
 * sanitizer, checks and resvg renders are real, so the files written are real PNGs.
 */

vi.mock("@/lib/studio/openai", () => ({ generateImage: vi.fn(), imageModel: () => "gpt-image-2.5-sunburst" }));
vi.mock("@/lib/studio/chatgpt", () => ({ generateChatGptImage: vi.fn() }));

type Opts = Omit<RunOptions, "emit" | "signal">;
type Step = (opts: Opts) => unknown;
type Args = Parameters<typeof runVisual>[0]["args"];

function harness(ws: Workspace, args: Args, script: Step[]) {
  const state = { ws: structuredClone(ws) };
  const calls: Opts[] = [];
  const ctx: WorkflowContext<Args> = {
    runId: "run_visual_test",
    args,
    emit: () => {},
    signal: new AbortController().signal,
    agent: async <T,>(opts: Opts): Promise<RunResult<T>> => {
      calls.push(opts);
      const step = script.shift();
      if (!step) throw new Error(`Unexpected model call #${calls.length}`);
      return { result: step(opts) as T, text: "", messages: opts.messages, stopReason: "tool_use", usage: emptyUsage(), costUsd: 0 };
    },
    read: () => state.ws,
    mutate: async <R,>(fn: (w: Workspace) => R) => fn(state.ws),
    noteFreeSignals: () => {},
  };
  return { ctx, calls, state };
}

const sample = sampleWorkspace(NOW);
const OPTION = "opt_ll_hours";
const base: Args = { pieceId: PIECE.hero, optionId: OPTION, preset: "og" };

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#F4F1EA"/>${body}</svg>`;
const HEADLINE = `<text x="80" y="220" font-family="Inter" font-size="64" font-weight="700" fill="#14120F"><tspan x="80" dy="0">Close usage revenue</tspan><tspan x="80" dy="1.15em">in 6 hours instead of 4 days</tspan></text>`;
const GOOD = svg(HEADLINE);
const INVENTED = svg(`${HEADLINE}<text x="80" y="520" font-size="28" fill="#14120F">Trusted by 500 finance teams</text>`);
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#14120F"/><rect data-slot="image" x="640" y="0" width="560" height="630" fill="#C9C3B8"/><text x="80" y="220" font-size="56" font-weight="700" fill="#F4F1EA"><tspan x="80" dy="0">Close usage revenue</tspan><tspan x="80" dy="1.15em">in 6 hours</tspan><tspan x="80" dy="1.15em">instead of 4 days</tspan></text></svg>`;

const designs = (...list: { layout: string; svg: string }[]) => () => ({ designs: list.map((d) => ({ ...d, why: "The number does the work." })) });
const imageReview = (patch: Record<string, unknown> = {}) => () => ({ score: 9, concept: 9, distinctiveness: 8, craft: 9, template: false, issues: [], fix: "", ...patch });
const reviews = (...scores: number[]) => (opts: Opts) => {
  const content = opts.messages[0].content as { type: string; text?: string }[];
  const ns = content.filter((b) => b.type === "text" && /^Image \d+:$/.test(b.text ?? "")).map((b) => Number(b.text!.match(/\d+/)![0]));
  return { reviews: ns.map((n, i) => ({ n, readable: true, broken: false, lowContrast: false, template: false, issues: scores[i] < 7 ? ["headline crowds the edge"] : [], fix: scores[i] < 7 ? "Move it 40px right." : "", score: scores[i] })) };
};

// Real resvg integration includes raster compositing and font discovery, which can exceed 5s
// when the repository suite runs its renderer tests concurrently.
describe("runVisual", { timeout: 20000 }, () => {
  it("generates and saves a ChatGPT image with zero prompt, copy, layout or API image calls", async () => {
    const png = Buffer.from(new Resvg(svg('<rect width="1200" height="630" fill="#aabbcc"/>')).render().asPng());
    vi.mocked(generateChatGptImage).mockResolvedValue({ png, width: 1200, height: 630, model: "ChatGPT plan", size: "1200x630", quality: "auto" });
    const apiCalls = vi.mocked(generateImage).mock.calls.length;
    const { ctx, calls, state } = harness(sample, { ...base, generate: true, imageProvider: "chatgpt", mode: "image" }, []);
    const result = await runVisual(ctx);
    expect(calls).toHaveLength(0);
    expect(vi.mocked(generateImage).mock.calls).toHaveLength(apiCalls);
    expect(state.ws.studio.images[result.imageId!]).toMatchObject({ source: "chatgpt", generated: { model: "ChatGPT plan" } });
    expect(readStudioFile(state.ws.studio.images[result.imageId!].file)).toEqual(png);
    expect(result.visualIds).toEqual([]);
    const sent = vi.mocked(generateChatGptImage).mock.lastCall![0].prompt;
    expect(sent).toContain("three genuinely different concepts");
    expect(sent).toContain("REFERENCE TECHNIQUES");
    expect(sent).toContain("OUTPUT CONTRACT");
    expect(state.ws.studio.images[result.imageId!].generated?.prompt).toBe(sent);
    expect(state.ws.studio.images[result.imageId!].generated?.artDirection).toMatchObject({ version: "creative-v1", style: "auto", energy: "bold", optionId: OPTION });
    expect(state.ws.studio.images[result.imageId!].generated?.review).toBeUndefined();
  });

  it("keeps ChatGPT generated images out of screenshot layouts", async () => {
    const ws = structuredClone(sample);
    ws.studio.images.img_chatgpt01 = { id: "img_chatgpt01", source: "chatgpt", file: "img_chatgpt01.png", mime: "image/png", width: 1200, height: 630, alt: "A generated illustration", createdAt: NOW.toISOString() };
    await expect(runVisual(harness(ws, { ...base, imageId: "img_chatgpt01", layout: "screenshot" }, []).ctx)).rejects.toThrow("can't stand in for a screenshot");
  });

  it("designs, checks, renders, has Claude look at the renders, fixes what failed, and saves real PNGs", async () => {
    const { ctx, calls, state } = harness(sample, { ...base, variants: 2 }, [
      designs({ layout: "statement", svg: GOOD }, { layout: "stat", svg: INVENTED }),
      reviews(8, 8),
      designs({ layout: "statement", svg: GOOD }, { layout: "stat", svg: GOOD }),
      reviews(9),
    ]);
    const out = await runVisual(ctx);

    expect(calls.map((c) => c.tier)).toEqual(["strategist", "operator", "strategist", "operator"]);
    // The reviewer sees the actual renders as images.
    const shown = (calls[1].messages[0].content as { type: string }[]).filter((b) => b.type === "image");
    expect(shown).toHaveLength(2);
    // The revision asks only about what failed: the invented claim on design 2.
    const ask = String(calls[2].messages[0].content);
    expect(ask).toContain("TEXT_NOT_APPROVED");
    expect(ask).toContain("<current_designs>");
    // Only the revised design is looked at again.
    expect((calls[3].messages[0].content as { type: string }[]).filter((b) => b.type === "image")).toHaveLength(1);

    expect(out.visualIds).toHaveLength(2);
    for (const id of out.visualIds) {
      const v = state.ws.studio.visuals[id];
      expect(v.checks.filter((c) => c.severity === "error")).toEqual([]);
      expect(v.width).toBe(1200);
      expect(v.aiImagery).toBe(false);
      expect(readStudioFile(v.pngFile!)?.subarray(1, 4).toString()).toBe("PNG");
      expect(readStudioFile(v.svgFile)?.toString()).not.toContain("Trusted by");
    }
  });

  it("keeps the original when a revision is worse", async () => {
    const { ctx, state } = harness(sample, { ...base, variants: 1 }, [designs({ layout: "statement", svg: GOOD }), reviews(5), designs({ layout: "statement", svg: INVENTED }), reviews(9)]);
    const out = await runVisual(ctx);
    const v = state.ws.studio.visuals[out.visualIds[0]];
    expect(v.checks.map((c) => c.code)).not.toContain("TEXT_NOT_APPROVED");
    expect(v.review?.score).toBe(5);
    expect(v.checks.map((c) => c.code)).toContain("REVIEW");
  });

  it("writes a ChatGPT-ready image prompt, sends it back once when it breaks a rule, and stops there", async () => {
    const { ctx, calls, state } = harness(sample, { ...base, mode: "prompt" }, [
      () => ({ prompt: "A glowing brain of neon circuitry above a desk.", alt: "A brain" }),
      () => ({ prompt: "A controller's desk at 7am on the first of the month: two monitors, a cold coffee, a printed invoice run with pencil ticks. The right third is a plain wall. Overcast window light, 35mm.", alt: "A desk at month-end" }),
    ]);
    const out = await runVisual(ctx);
    expect(calls).toHaveLength(2);
    expect(String(calls[1].messages[0].content)).toContain("AI-art cliché");
    expect(out.prompt).toContain("Aspect ratio 1.90:1 (1200×630 px)");
    expect(out.prompt).toContain("No text, letters, numbers, logos");
    const option = state.ws.studio.pieces[PIECE.hero].options.find((o) => o.id === OPTION)!;
    expect(option.imagePrompt?.text).toBe(out.prompt);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("paints the picture with OpenAI, shows it to the designer, and marks the graphic as AI imagery", async () => {
    const png = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1232" height="640"><rect width="1232" height="640" fill="#2F5BEA"/></svg>`).render().asPng();
    vi.mocked(generateImage).mockResolvedValue({ png, width: 1232, height: 640, model: "gpt-image-2.5-sunburst", size: "1232x640", quality: "high" });
    const { ctx, calls, state } = harness(sample, { ...base, generate: true, variants: 1 }, [
      () => ({ prompt: "A controller's desk at 7am: a cold coffee and a printed invoice run. The left third is a plain wall. Overcast light, 35mm.", alt: "A desk at month-end" }),
      imageReview(),
      designs({ layout: "photo", svg: PHOTO }),
      reviews(8),
    ]);
    const out = await runVisual(ctx);
    expect(vi.mocked(generateImage).mock.calls[0][0]).toMatchObject({ w: 1200, h: 630 });
    const designMsg = calls[2].messages[0].content as { type: string; text?: string }[];
    expect(designMsg.some((b) => b.type === "image")).toBe(true);
    expect(designMsg[0].text).toContain("- photo:");
    expect(designMsg[0].text).not.toContain("- screenshot:");

    const image = state.ws.studio.images[out.imageId!];
    expect(image).toMatchObject({ source: "openai", width: 1232, height: 640, generated: { model: "gpt-image-2.5-sunburst" } });
    expect(image.generated?.prompt).toBe(vi.mocked(generateImage).mock.lastCall![0].prompt);
    expect(image.generated?.review).toMatchObject({ concept: 9, distinctiveness: 8, craft: 9 });
    const v = state.ws.studio.visuals[out.visualIds[0]];
    expect(v).toMatchObject({ aiImagery: true, imageId: image.id, slot: { x: 640, y: 0, w: 560, h: 630 }, layout: "photo" });
    expect(v.checks.filter((c) => c.severity === "error")).toEqual([]);
  });

  it("revises a generic SVG even when its overall score is high", async () => {
    const generic = (opts: Opts) => {
      const result = reviews(9)(opts);
      return { reviews: result.reviews.map((r) => ({ ...r, template: true, fix: "Replace the interchangeable card with a message-specific visual metaphor." })) };
    };
    const { ctx, calls, state } = harness(sample, { ...base, variants: 1 }, [designs({ layout: "statement", svg: GOOD }), generic, designs({ layout: "statement", svg: GOOD }), reviews(8)]);
    const result = await runVisual(ctx);
    expect(calls).toHaveLength(4);
    expect(String(calls[2].messages[0].content)).toContain("message-specific visual metaphor");
    expect(state.ws.studio.visuals[result.visualIds[0]].review).toMatchObject({ score: 8, template: false });
    expect(state.ws.studio.visuals[result.visualIds[0]].checks.filter((c) => c.code === "REVIEW")).toEqual([]);
  });

  it("refines a weak image once, keeps the stronger render and records the exact revised prompt", async () => {
    const first = Buffer.from(new Resvg(svg('<circle cx="900" cy="300" r="100" fill="#2F5BEA"/>')).render().asPng());
    const second = Buffer.from(new Resvg(svg('<path d="M700 400L900 100L1100 400Z" fill="#2F5BEA"/>')).render().asPng());
    const generated = (png: Buffer) => ({ png, width: 1200, height: 630, model: "ChatGPT plan", size: "1200x630", quality: "auto" });
    vi.mocked(generateChatGptImage).mockReset().mockResolvedValueOnce(generated(first)).mockResolvedValueOnce(generated(second));
    const { ctx, calls, state } = harness(sample, { ...base, generate: true, imageProvider: "chatgpt", variants: 1, artDirection: "sculptural", energy: "experimental" }, [
      imageReview({ score: 9, distinctiveness: 4, template: true, issues: ["Arbitrary object"], fix: "Use an impossible compression of the relevant material to express the time saved." }),
      imageReview(), designs({ layout: "photo", svg: PHOTO }), reviews(9),
    ]);
    const result = await runVisual(ctx);
    expect(vi.mocked(generateChatGptImage)).toHaveBeenCalledTimes(2);
    expect(calls[0].tools?.[0].name).toBe("submit_image_review");
    expect(calls[0].messages[0].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
    const image = state.ws.studio.images[result.imageId!];
    expect(readStudioFile(image.file)).toEqual(second);
    expect(image.generated?.prompt).toBe(vi.mocked(generateChatGptImage).mock.lastCall![0].prompt);
    expect(image.generated?.prompt).toContain("TARGETED REVISION");
    expect(image.generated?.artDirection).toMatchObject({ style: "sculptural", energy: "experimental" });
    expect(image.generated?.review?.distinctiveness).toBe(8);
    expect(state.ws.studio.pieces[base.pieceId].options.find((o) => o.id === OPTION)?.imagePrompt?.text).toBe(image.generated?.prompt);
  });

  it("keeps the original image when refinement scores worse and surfaces the unresolved review", async () => {
    const png = Buffer.from(new Resvg(GOOD).render().asPng());
    vi.mocked(generateChatGptImage).mockReset().mockResolvedValue({ png, width: 1200, height: 630, model: "ChatGPT plan", size: "1200x630", quality: "auto" });
    const { ctx, state } = harness(sample, { ...base, generate: true, imageProvider: "chatgpt", variants: 1 }, [
      imageReview({ score: 6, distinctiveness: 5, fix: "Clarify the visual metaphor." }),
      imageReview({ score: 5, distinctiveness: 4 }), designs({ layout: "photo", svg: PHOTO }), reviews(9),
    ]);
    const result = await runVisual(ctx);
    expect(vi.mocked(generateChatGptImage)).toHaveBeenCalledTimes(2);
    const image = state.ws.studio.images[result.imageId!];
    expect(image.generated?.prompt).not.toContain("TARGETED REVISION");
    expect(image.generated?.review?.score).toBe(6);
    expect(state.ws.studio.visuals[result.visualIds[0]].checks).toContainEqual(expect.objectContaining({ code: "REVIEW", detail: "Image layer: Clarify the visual metaphor." }));
  });

  it("never silently changes image provider when refinement fails", async () => {
    const png = Buffer.from(new Resvg(GOOD).render().asPng());
    vi.mocked(generateChatGptImage).mockReset().mockResolvedValueOnce({ png, width: 1200, height: 630, model: "ChatGPT plan", size: "1200x630", quality: "auto" }).mockRejectedValueOnce(new Error("quota"));
    const apiCalls = vi.mocked(generateImage).mock.calls.length;
    const { ctx, state } = harness(sample, { ...base, generate: true, imageProvider: "chatgpt", variants: 1 }, [
      imageReview({ score: 5, fix: "Recompose the subject." }), designs({ layout: "photo", svg: PHOTO }), reviews(9),
    ]);
    const result = await runVisual(ctx);
    expect(vi.mocked(generateImage).mock.calls.length).toBe(apiCalls);
    expect(state.ws.studio.images[result.imageId!].generated?.review?.score).toBe(5);
    expect(result.visualIds).toHaveLength(1);
  });

  it("does not report a successful visual review when the reviewer is unavailable", async () => {
    const { ctx, state } = harness(sample, { ...base, variants: 1 }, [designs({ layout: "statement", svg: GOOD }), () => { throw new Error("offline"); }]);
    const result = await runVisual(ctx);
    expect(state.ws.studio.visuals[result.visualIds[0]].checks).toContainEqual(expect.objectContaining({ code: "REVIEW", detail: expect.stringContaining("unavailable") }));
  });

  it("keeps the reviewed original when a revision has no assessment at the same code quality", async () => {
    const { ctx, calls, state } = harness(sample, { ...base, variants: 1 }, [
      designs({ layout: "statement", svg: GOOD }), reviews(6),
      designs({ layout: "statement", svg: GOOD }), () => { throw new Error("review unavailable"); },
    ]);
    const result = await runVisual(ctx);
    expect(String(calls[2].messages[0].content)).toContain("overall 6/10");
    expect(state.ws.studio.visuals[result.visualIds[0]].review?.score).toBe(6);
    expect(state.ws.studio.visuals[result.visualIds[0]].checks).toContainEqual(expect.objectContaining({ code: "REVIEW" }));
  });

  it("refuses what would misrepresent the product or can't work", async () => {
    const withImage = structuredClone(sample);
    withImage.studio.images.img_painted01 = { id: "img_painted01", source: "openai", file: "img_painted01.png", mime: "image/png", width: 10, height: 10, alt: "", createdAt: NOW.toISOString() };
    await expect(runVisual(harness(withImage, { ...base, imageId: "img_painted01", layout: "screenshot" }, []).ctx)).rejects.toThrow(/can't stand in for a screenshot/);
    await expect(runVisual(harness(sample, { ...base, layout: "screenshot" }, []).ctx)).rejects.toThrow(/needs an image/);
    await expect(runVisual(harness(sample, { ...base, optionId: "opt_missing" }, []).ctx)).rejects.toThrow(/option is gone/);
  });

  it("keeps the newest unkept graphics per option and removes older ones with their files", async () => {
    const ws = structuredClone(sample);
    for (let i = 0; i < 6; i++) {
      ws.studio.visuals[`vis_old00000${i}`] = { id: `vis_old00000${i}`, pieceId: PIECE.hero, optionId: OPTION, layout: "statement", preset: "og", width: 1200, height: 630, svgFile: `vis_old00000${i}.svg`, pngFile: null, why: "", checks: [], aiImagery: false, kept: i === 0, createdAt: `2026-10-0${i + 1}T00:00:00.000Z` };
    }
    const { ctx, state } = harness(ws, { ...base, variants: 2 }, [designs({ layout: "statement", svg: GOOD }, { layout: "statement", svg: GOOD }), reviews(8, 8)]);
    await runVisual(ctx);
    const forOption = Object.values(state.ws.studio.visuals).filter((v) => v.optionId === OPTION);
    expect(forOption.filter((v) => !v.kept)).toHaveLength(6);
    expect(state.ws.studio.visuals.vis_old000000).toBeDefined(); // kept stays
    expect(state.ws.studio.visuals.vis_old000001).toBeUndefined(); // oldest unkept goes
  });
});
