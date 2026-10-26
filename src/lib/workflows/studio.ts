import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { defineTool, type AgentTool } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { taskHeader } from "@/lib/ai/prompts/core";
import { STUDIO_CORE, STUDIO_CRITIC, STUDIO_RULES } from "@/lib/ai/prompts/studio";
import { daysBetween, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { StudioAudience, StudioCritic, StudioFormatId, StudioLint, StudioOccasion, StudioOption, StudioPiece, Workspace } from "@/lib/domain/types";
import { AUDIENCES, FORMAT_IDS, FORMATS, OCCASIONS, type FormatSpec, type Limit, type PartSpec } from "@/lib/studio/formats";
import { movesFor, type MoveChoice } from "@/lib/studio/moves";
import { audienceFor, competitorsFor, formatBlocked, lintOption, receiptsFor, type Receipt } from "@/lib/studio/receipts";
import { defineWorkflow, type WorkflowContext } from "./types";

/**
 * W13 — Studio: marketing and launch copy for any kind of company. Code gathers; Claude writes; code
 * checks; a blind reader ranks.
 *   receipts + moves (code) → write N options, each with a different move (Opus for short lines,
 *   Sonnet for posts) → lint every option (code) → one revision for options that fail → blind reader
 *   critic (Haiku, low) ranks them and names AI tells → one rewrite of the best two if the reader
 *   wouldn't act or smelled AI → order: clean first, then the reader's rank → persist.
 * Nothing is published. `pieceId` set to an existing piece writes more options into it (kept ones stay).
 */

const Args = z.object({
  format: z.enum(FORMAT_IDS as [StudioFormatId, ...StudioFormatId[]]),
  occasion: z.enum(Object.keys(OCCASIONS) as [StudioOccasion, ...StudioOccasion[]]).optional(),
  audience: z.enum(["b2b", "b2c", "prosumer", "developer"]).optional(),
  brief: z.string().max(2000).optional(),
  /** Client-generated id so the UI can follow the run; an existing id writes more options into that piece. */
  pieceId: z.string().max(40).optional(),
  /** Allow moves that trade trust for attention (taboo lines). Off unless the founder turns it on. */
  bold: z.boolean().optional(),
});
type StudioArgs = z.infer<typeof Args>;

const MAX_OPTIONS = 12;

/* ─────────────────────────────── Tools (built per format; stable within a format, so the cache holds) ─────────────────────────────── */

function limitText(l: Limit): string {
  const unit = l.unit === "weighted" ? "characters (X counting)" : l.unit;
  const range = l.min !== undefined && l.max !== undefined ? `${l.min}–${l.max}` : l.max !== undefined ? `≤${l.max}` : `≥${l.min}`;
  return `${range} ${unit} (${l.kind === "hard" ? "hard limit" : l.kind === "recommended" ? "platform recommendation" : l.kind === "observed" ? "feed cut-off" : "house aim"})`;
}

function partDescription(p: PartSpec): string {
  const bits = [p.hint, p.limits.map(limitText).join("; ")];
  if (p.list) bits.push(p.list.split === "posts" ? `${p.list.min}–${p.list.max} posts separated by a line holding only ---` : `${p.list.min}–${p.list.max} items, one per line`);
  if (p.prefix) bits.push(`starts with "${p.prefix}"`);
  if (p.optional) bits.push("may be an empty string");
  return bits.filter(Boolean).join(". ");
}

function submitTool(spec: FormatSpec): AgentTool {
  const parts = Object.fromEntries(spec.parts.map((p) => [p.key, z.string().max(p.multiline ? 6000 : 800).describe(partDescription(p))]));
  return defineTool({
    name: "submit_options",
    description: "Submit every option. Call exactly once.",
    terminal: true,
    schema: z.object({
      options: z
        .array(
          z.object({
            moveId: z.string().describe("Id of the move this option uses, from <moves>."),
            parts: z.object(parts),
            receiptIds: z.array(z.string()).max(8).describe("Ids of every receipt this option's specifics rest on; up to 8, may be empty."),
            why: z.string().max(200).describe("≤20 words: the reaction you're aiming for in the reader."),
          }),
        )
        .max(MAX_OPTIONS)
        .describe(`${spec.options} options, each with a different move where possible.`),
      gaps: z.array(z.string().max(80)).max(6).describe("One entry per [[placeholder]]: the fact the founder must supply; up to 6."),
    }),
  });
}
type Written = { options: { moveId: string; parts: Record<string, string>; receiptIds: string[]; why: string }[]; gaps: string[] };

const Verdict = z.object({
  label: z.string().describe("The option's label."),
  stop: z.boolean(),
  act: z.boolean(),
  soundsAi: z.boolean(),
  giveaway: z.string().max(80).describe("The phrase that gave it away (≤8 words), or empty."),
  swappable: z.boolean(),
  believable: z.boolean(),
  fatal: z.array(z.string().max(80)).max(3),
  rewrite: z.string().max(320).describe("≤40 words; empty if you'd act on it."),
});
const submitVerdicts = defineTool({
  name: "submit_verdicts",
  description: "Submit your verdict on every option and your ranking. Call exactly once.",
  terminal: true,
  schema: z.object({
    verdicts: z.array(Verdict).max(MAX_OPTIONS),
    ranking: z.array(z.string()).max(MAX_OPTIONS).describe("Every label, best first."),
  }),
});
type Verdicts = { verdicts: z.infer<typeof Verdict>[]; ranking: string[] };

/* ─────────────────────────────── Task (per request; never cached) ─────────────────────────────── */

function clip(text: string | null | undefined, n: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function lines(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n\n");
}

function fmtReceipt(r: Receipt): string {
  const flags = [r.fact ? null : "belief, not a fact", r.nameable ? null : "don't name the person or company"].filter(Boolean);
  return `[${r.id}] ${r.label}: ${clip(r.text, 400)}${r.source ? ` (source: ${clip(r.source, 120)})` : ""}${flags.length ? ` [${flags.join("; ")}]` : ""}`;
}

function fmtMove(c: MoveChoice): string {
  const m = c.move;
  const ex = m.examples.slice(0, 2).map((e) => `  e.g. "${e.text}" (${e.who}${e.when ? `, ${e.when}` : ""})`);
  return [`[${m.id}] ${m.name}: ${m.line}`, `  how: ${m.how}`, ...ex, `  backfires: ${m.backfires}`].join("\n");
}

function fmtFormat(spec: FormatSpec): string {
  const parts = spec.parts.map((p) => `- ${p.key} (${p.label}): ${partDescription(p)}`);
  return lines(
    `${spec.label}: ${spec.blurb}`,
    `Parts:\n${parts.join("\n")}`,
    spec.total && `All parts together: ${limitText(spec.total)}.`,
    `Rules:\n${spec.rules.map((r) => `- ${r}`).join("\n")}`,
  );
}

/** The founder's own writing, posts first: the voice to match. */
function voiceBlock(ws: Workspace): string {
  const v = ws.voice;
  if (!v || (!v.summary && !v.samples.length)) return "No samples yet. Write like a founder talking to one person: plain, specific, contractions.";
  const samples = [...v.samples.filter((s) => s.kind === "post"), ...v.samples.filter((s) => s.kind === "email")]
    .slice(0, 2)
    .map((s, i) => `<sample ${i + 1} kind="${s.kind}">\n${s.text.slice(0, 900)}\n</sample>`);
  return [v.summary && `Summary: ${v.summary}`, ...samples].filter(Boolean).join("\n");
}

/** How recent pieces of this format opened, so this set doesn't repeat them. */
function recentOpeners(ws: Workspace, spec: FormatSpec, excludeId: string): string[] {
  const key = spec.parts[0].key;
  const today = todayISO();
  return Object.values(ws.studio.pieces)
    .filter((p) => p.id !== excludeId && p.format === spec.id && daysBetween(p.createdAt.slice(0, 10), today) <= 30)
    .flatMap((p) => p.options.slice(0, 2).map((o) => clip(o.parts[key], 80)))
    .filter(Boolean)
    .slice(0, 8);
}

function readerFor(ws: Workspace, audience: StudioAudience): string {
  const profile = ws.studio.profile;
  if (profile?.reader.trim()) return profile.reader.trim();
  if (audience === "b2b") {
    const champion = ws.foundation?.personas.find((p) => p.role === "champion") ?? ws.foundation?.personas[0];
    if (champion?.titles[0]) return `a ${champion.titles[0]}${ws.foundation?.icp.primarySegment ? ` at ${ws.foundation.icp.primarySegment}` : ""}`;
  }
  if (ws.company?.whoItsFor) return ws.company.whoItsFor;
  return AUDIENCES[audience].reader;
}

interface Plan {
  ws: Workspace;
  spec: FormatSpec;
  audience: StudioAudience;
  occasion: StudioOccasion;
  brief: string;
  receipts: Receipt[];
  moves: MoveChoice[];
  reader: string;
  pieceId: string;
  existing?: StudioPiece;
}

function taskMessage(plan: Plan): string {
  const { ws, spec, audience, occasion, brief, receipts, moves, reader, existing } = plan;
  const usable = moves.filter((m) => !m.missing);
  const blocked = moves.filter((m) => m.missing);
  const name = ws.studio.profile?.productName || ws.company?.name || "the product";
  const used = existing ? [...new Set(existing.options.map((o) => o.moveId))] : [];
  const openers = recentOpeners(ws, spec, plan.pieceId);
  return lines(
    taskHeader(),
    `<task>Write ${spec.options} options for: ${spec.label}. Occasion: ${OCCASIONS[occasion].label} (${OCCASIONS[occasion].guide})</task>`,
    `<company>${name}${ws.company?.plainOneLiner ? `: ${ws.company.plainOneLiner}` : ""}\nSells to: ${AUDIENCES[audience].label.toLowerCase()} (${AUDIENCES[audience].blurb})\nThe reader: ${reader}, ${spec.reading}.</company>`,
    brief ? `<brief>\n${clip(brief, 1800)}\n</brief>` : "<brief>No brief. Write the strongest evergreen version from the receipts.</brief>",
    `<format>\n${fmtFormat(spec)}\n</format>`,
    receipts.length ? `<receipts>\n${receipts.map(fmtReceipt).join("\n")}\n</receipts>` : "<receipts>none yet: no specifics allowed; write [[gaps]] where they'd go</receipts>",
    usable.length ? `<moves>\n${usable.map(fmtMove).join("\n")}\n</moves>` : "<moves>none fit; write each option from a different angle and set moveId to \"free\"</moves>",
    blocked.length > 0 && `<moves_unavailable note="missing receipts; don't use">\n${blocked.map((m) => `- ${m.move.name}: needs ${m.missing}`).join("\n")}\n</moves_unavailable>`,
    used.length > 0 && `<already_written note="the founder has options with these moves; prefer others">${used.join(", ")}</already_written>`,
    openers.length > 0 && `<recent_openers note="recent ${spec.label} pieces opened like this; don't repeat">\n${openers.map((o) => `- ${o}`).join("\n")}\n</recent_openers>`,
    `<voice>\n${voiceBlock(ws)}\n</voice>`,
    "Write them now and submit with submit_options.",
  );
}

/* ─────────────────────────────── Checking ─────────────────────────────── */

function errorsOf(lint: StudioLint): string[] {
  return lint.violations.filter((v) => v.severity === "error").map((v) => `${v.code}: ${v.detail}`);
}

function emptyLint(): StudioLint {
  return { passed: true, violations: [], stats: { words: 0, grade: 0, concrete: 0, vague: 0 } };
}

/** Builds options from the model's output: unknown parts dropped, invented receipt ids reported, every option linted against its siblings. */
function build(plan: Plan, written: Written, keep: StudioOption[] = []): { options: StudioOption[]; problems: Map<number, string[]> } {
  const known = new Set(plan.receipts.map((r) => r.id));
  const moveIds = new Set(plan.moves.filter((m) => !m.missing).map((m) => m.move.id));
  const problems = new Map<number, string[]>();
  const options: StudioOption[] = written.options.map((o, i) => {
    const issues: string[] = [];
    const parts = Object.fromEntries(plan.spec.parts.map((p) => [p.key, (o.parts?.[p.key] ?? "").trim()]));
    const receiptIds = [...new Set(o.receiptIds)].filter((id) => {
      if (known.has(id)) return true;
      issues.push(`receipt ${id} doesn't exist. Cite a listed id or remove the specific it supports.`);
      return false;
    });
    let moveId = o.moveId;
    if (!moveIds.has(moveId)) {
      if (moveIds.size) issues.push(`move ${o.moveId} isn't one of the listed moves.`);
      moveId = "free";
    }
    if (issues.length) problems.set(i, issues);
    return { id: newId("opt"), moveId, parts, receiptIds, why: clip(o.why, 200), lint: emptyLint() };
  });
  const all = [...options, ...keep];
  const piece = { format: plan.spec.id, audience: plan.audience, options: all };
  for (const o of options) o.lint = lintOption(plan.ws, piece, o);
  return { options, problems };
}

function badness(o: StudioOption, problems: string[] = []): number {
  return errorsOf(o.lint).length * 10 + problems.length * 10 + o.lint.violations.length;
}

function revisionFeedback(options: StudioOption[], problems: Map<number, string[]>): string {
  const rows: string[] = [];
  options.forEach((o, i) => {
    const issues = [...errorsOf(o.lint), ...(problems.get(i) ?? [])];
    if (issues.length) rows.push(`Option ${i + 1} (${o.moveId}):\n${issues.map((x) => `- ${x}`).join("\n")}`);
  });
  return `Code checked every option. These failed:\n\n${rows.join("\n\n")}\n\nRewrite ONLY to fix these (keep what works, keep each option's move). Submit all ${options.length} options again, in the same order, with submit_options.`;
}

async function write(ctx: WorkflowContext<StudioArgs>, plan: Plan, tool: AgentTool, messages: Anthropic.Beta.BetaMessageParam[], effort: "low" | "medium") {
  const res = await ctx.agent<Written>({
    tier: plan.spec.tier,
    system: [STUDIO_CORE, STUDIO_RULES],
    messages,
    tools: [tool],
    effort,
    maxTokens: 16000,
    requireTerminal: true,
  });
  if (!res.result) throw new AgentError("I couldn't finish those options. Try again in a moment.", "unknown");
  return res;
}

/** Replaces our "Saved." tool result with feedback, so the model revises in context. */
function withFeedback(messages: Anthropic.Beta.BetaMessageParam[], feedback: string, toolName: string): Anthropic.Beta.BetaMessageParam[] {
  const history = [...messages];
  const last = history[history.length - 1];
  const assistant = history[history.length - 2];
  const use =
    assistant && Array.isArray(assistant.content)
      ? (assistant.content as Anthropic.Beta.BetaContentBlockParam[]).find((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use" && b.name === toolName)
      : undefined;
  if (use && last?.role === "user") {
    history[history.length - 1] = { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, is_error: true, content: feedback }] };
    return history;
  }
  return [...history, { role: "user", content: feedback }];
}

/* ─────────────────────────────── The reader (Haiku, blind) ─────────────────────────────── */

const LABELS = "ABCDEFGHIJKL".split("");

function asText(spec: FormatSpec, o: StudioOption): string {
  return spec.parts
    .filter((p) => p.role !== "visual" || spec.id === "image")
    .map((p) => (o.parts[p.key] ? `${p.label}: ${o.parts[p.key]}` : null))
    .filter(Boolean)
    .join("\n");
}

async function read(ctx: WorkflowContext<StudioArgs>, plan: Plan, options: StudioOption[]): Promise<Map<string, StudioCritic> | null> {
  if (options.length < 2) return null;
  const order = options.map((o, i) => ({ o, r: Math.random(), i })).sort((a, b) => a.r - b.r);
  const byLabel = new Map(order.map((x, i) => [LABELS[i], x.o]));
  try {
    const res = await ctx.agent<Verdicts>({
      tier: "fast",
      system: STUDIO_CRITIC,
      messages: [
        {
          role: "user",
          content: lines(
            `You are ${plan.reader}. You meet this ${plan.spec.reading}.`,
            ...order.map((x, i) => `<option label="${LABELS[i]}">\n${asText(plan.spec, x.o)}\n</option>`),
          ),
        },
      ],
      tools: [submitVerdicts],
      effort: "low",
      maxTokens: 4000,
      requireTerminal: true,
    });
    const r = res.result;
    if (!r) return null;
    const ranking = [...r.ranking.filter((l) => byLabel.has(l)), ...[...byLabel.keys()].filter((l) => !r.ranking.includes(l))];
    const out = new Map<string, StudioCritic>();
    for (const v of r.verdicts) {
      const o = byLabel.get(v.label);
      if (!o) continue;
      out.set(o.id, {
        rank: ranking.indexOf(v.label) + 1,
        of: options.length,
        stop: v.stop,
        act: v.act,
        soundsAi: v.soundsAi,
        giveaway: v.giveaway,
        swappable: v.swappable,
        fatal: v.fatal,
        rewrite: v.rewrite,
        at: nowISO(),
      });
    }
    return out;
  } catch (err) {
    // The reader is a quality pass, not a gate: if it fails, the linted options still ship.
    if (err instanceof AgentError && err.code === "stopped") throw err;
    return null;
  }
}

function needsRewrite(c: StudioCritic | undefined): boolean {
  return !!c && (!c.act || c.soundsAi || c.swappable || !c.stop || c.fatal.length > 0);
}

function readerFeedback(options: { index: number; o: StudioOption }[]): string {
  const rows = options.map(({ index, o }) => {
    const c = o.critic!;
    const said = [
      !c.stop && "they wouldn't stop scrolling",
      !c.act && "they wouldn't act on it",
      c.soundsAi && `it reads as AI-written${c.giveaway ? ` (“${c.giveaway}”)` : ""}`,
      c.swappable && "a competitor could say it unchanged",
      ...c.fatal,
    ].filter(Boolean);
    return `Option ${index + 1} (${o.moveId}): ${said.join("; ")}.${c.rewrite ? ` Their fix: ${c.rewrite}` : ""}`;
  });
  return `A real reader judged them blind. Rewrite these options to fix what the reader said, keeping every rule (receipts, limits, banned phrases) and each option's move:\n${rows.join("\n")}\nSubmit all options again in the same order with submit_options; leave the others unchanged.`;
}

/** Clean options first, then the reader's ranking, then fewest warnings. */
function order(options: StudioOption[]): StudioOption[] {
  return [...options].sort((a, b) => {
    const ea = errorsOf(a.lint).length ? 1 : 0;
    const eb = errorsOf(b.lint).length ? 1 : 0;
    if (ea !== eb) return ea - eb;
    const ra = a.critic?.rank ?? 99;
    const rb = b.critic?.rank ?? 99;
    if (ra !== rb) return ra - rb;
    return a.lint.violations.length - b.lint.violations.length;
  });
}

function placeholders(options: StudioOption[]): string[] {
  const out: string[] = [];
  for (const o of options) for (const text of Object.values(o.parts)) for (const m of text.matchAll(/\[\[([^\]]{1,80})\]\]/g)) out.push(m[1].trim());
  return out;
}

/** Drops empty and repeated gaps; "The pilot fee" repeats "pilot fee". The first wording wins. */
function dedupe(items: string[]): string[] {
  const key = (x: string) => x.toLowerCase().trim().replace(/^(the|a|an)\s+/, "");
  const out: string[] = [];
  for (const x of items) {
    const k = key(x);
    if (!k || out.some((y) => key(y).includes(k) || k.includes(key(y)))) continue;
    out.push(x.trim());
  }
  return out;
}

function titleFor(spec: FormatSpec, brief: string): string {
  const b = clip(brief, 60);
  return b ? `${spec.label}: ${b}` : spec.label;
}

/* ─────────────────────────────── Run ─────────────────────────────── */

export async function runStudio(ctx: WorkflowContext<StudioArgs>) {
  const a = ctx.args;
  const ws = ctx.read();
  const spec = FORMATS[a.format];
  const blocked = formatBlocked(ws, a.format);
  if (blocked) throw new AgentError(blocked, "bad_request");
  const existing = a.pieceId ? ws.studio.pieces[a.pieceId] : undefined;
  const audience = a.audience ?? existing?.audience ?? audienceFor(ws);
  const occasion = a.occasion ?? existing?.occasion ?? spec.defaultOccasion;
  const brief = (a.brief ?? existing?.brief ?? "").trim();
  const receipts = receiptsFor(ws);
  const plan: Plan = {
    ws,
    spec,
    audience,
    occasion,
    brief,
    receipts,
    moves: movesFor({ format: spec.id, audience, occasion, receipts, competitors: competitorsFor(ws).length, bold: !!a.bold }),
    reader: readerFor(ws, audience),
    pieceId: a.pieceId ?? newId("stu"),
    existing,
  };
  const kept = existing?.options ?? [];

  ctx.emit({ type: "status", text: "Gathering your receipts" });
  ctx.emit({
    type: "action",
    text: `${receipts.length === 1 ? "1 receipt" : `${receipts.length} receipts`} · ${plan.moves.filter((m) => !m.missing).length} moves fit ${spec.label.toLowerCase()}`,
  });

  ctx.emit({ type: "status", text: `Writing ${spec.options} options` });
  const tool = submitTool(spec);
  let gen = await write(ctx, plan, tool, [{ role: "user", content: taskMessage(plan) }], "medium");
  let { options, problems } = build(plan, gen.result!, kept);

  ctx.emit({ type: "status", text: "Checking limits, sources and AI tells" });
  const failing = options.filter((o, i) => errorsOf(o.lint).length || problems.has(i)).length;
  if (failing) {
    ctx.emit({ type: "status", text: `Fixing ${failing === 1 ? "one option" : `${failing} options`}` });
    const again = await write(ctx, plan, tool, withFeedback(gen.messages, revisionFeedback(options, problems), tool.name), "medium");
    const next = build(plan, again.result!, kept);
    // Per option, keep whichever version is cleaner; a revision that made things worse never wins.
    if (next.options.length === options.length) {
      options = options.map((o, i) => (badness(next.options[i], next.problems.get(i)) < badness(o, problems.get(i)) ? next.options[i] : o));
      gen = again;
    }
    problems = new Map();
  }

  ctx.emit({ type: "status", text: "Reading them the way your reader would" });
  const verdicts = await read(ctx, plan, options);
  if (verdicts) for (const o of options) o.critic = verdicts.get(o.id);
  options = order(options);

  // The best two get one rewrite if the reader wouldn't act on them or smelled AI. A fresh turn with
  // the current options (not a replayed tool call), so it works whether or not thinking is on.
  const targets = options
    .slice(0, 2)
    .filter((o) => needsRewrite(o.critic))
    .map((o) => ({ index: options.indexOf(o), o }));
  if (targets.length) {
    ctx.emit({ type: "status", text: targets.some(({ o }) => o.critic?.soundsAi) ? "Rewriting what sounded machine-made" : "Sharpening the best two" });
    const current = options.map((o, i) => `<option n="${i + 1}" move="${o.moveId}" receipts="${o.receiptIds.join(",")}">\n${asText(spec, o)}\n</option>`).join("\n");
    const res = await write(ctx, plan, tool, [{ role: "user", content: lines(taskMessage(plan), `<current_options>\n${current}\n</current_options>`, readerFeedback(targets)) }], "medium").catch((err) => {
      if (err instanceof AgentError && err.code === "stopped") throw err;
      return null;
    });
    if (res?.result && res.result.options.length === options.length) {
      const next = build(plan, res.result, kept);
      for (const { index, o } of targets) {
        const candidate = next.options[index];
        // The reader already rejected the original, so a rewrite wins unless it brings more errors (warnings
        // don't count here). It keeps the verdict that prompted it, as telemetry.
        const errors = (x: StudioOption, problems: string[] = []) => errorsOf(x.lint).length + problems.length;
        if (candidate && errors(candidate, next.problems.get(index)) <= errors(o)) options[index] = { ...candidate, critic: o.critic };
      }
    }
  }

  // Final lint against the final set, so "same shape" and sourcing reflect what's saved.
  const latest = ctx.read();
  const finalPiece = { format: spec.id, audience, options: [...options, ...kept] };
  for (const o of options) o.lint = lintOption(latest, finalPiece, o);
  options = order(options);

  const gaps = dedupe([...placeholders(options), ...(gen.result?.gaps ?? [])]).slice(0, 8);
  const clean = options.filter((o) => !errorsOf(o.lint).length).length;
  ctx.emit({ type: "action", text: clean === options.length ? `All ${options.length} options pass every check` : `${clean} of ${options.length} options pass every check` });

  const id = plan.pieceId;
  await ctx.mutate((w) => {
    const at = nowISO();
    const prior = w.studio.pieces[id];
    // Kept options always stay; older unkept ones follow the new ones until the piece is full.
    const old = prior?.options ?? [];
    const merged = [...options, ...old.filter((o) => o.kept), ...old.filter((o) => !o.kept)].slice(0, MAX_OPTIONS);
    const keptOld = old.filter((o) => o.kept && !merged.includes(o));
    w.studio.pieces[id] = {
      id,
      format: spec.id,
      occasion,
      audience,
      brief,
      title: prior?.title ?? titleFor(spec, brief),
      options: [...merged, ...keptOld],
      gaps: dedupe([...gaps, ...(prior?.gaps ?? [])]).slice(0, 8),
      createdAt: prior?.createdAt ?? at,
      updatedAt: at,
      runId: ctx.runId,
    };
    const used = new Set(options.flatMap((o) => o.receiptIds));
    for (const m of w.studio.material) if (used.has(m.id)) m.uses += 1;
  });
  return { pieceId: id, options: options.length, clean };
}

export default defineWorkflow({
  id: "studio",
  args: Args,
  title: (a, ws) => {
    const spec = FORMATS[a.format];
    const existing = a.pieceId ? ws.studio.pieces[a.pieceId] : undefined;
    return existing ? `Writing more ${spec.label.toLowerCase()} options` : `Writing ${spec.label.toLowerCase()}`;
  },
  ref: (a) => (a.pieceId ? { kind: "studio", id: a.pieceId } : undefined),
  heavy: false,
  run: runStudio,
});
