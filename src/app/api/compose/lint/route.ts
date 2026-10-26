import { z } from "zod";
import { lintStep } from "@/lib/quality/context";
import { preflight } from "@/lib/quality/gates";
import { CONSUMER_KINDS, lintDraft } from "@/lib/quality/lint";
import { errorResponse, readJSON } from "@/lib/server/http";
import { readWorkspace } from "@/lib/store/workspace";

const FRAMES = ["founder_card", "4t", "problem_prompter", "mouse_trap", "observation_problem_proof", "referral", "permission_to_close", "reply", "intro", "recap", "invite"] as const;
const KINDS = ["email", "linkedin_note", "linkedin_dm", "recap", "invite", "intro_wrapper", "intro_forwardable", "post", ...CONSUMER_KINDS] as const;

const Body = z.union([
  // Lint a draft already in the workspace, optionally with edits (same check the editor shows).
  z.object({
    packageId: z.string(),
    step: z.number().int().min(1).max(3).optional(),
    subject: z.string().max(200).nullable().optional(),
    body: z.string().max(5000).optional(),
  }),
  // Lint any text: lets an outside agent (an AI SDR, a sequencer) check copy for zero tokens.
  z.object({
    body: z.string().min(1).max(5000),
    subject: z.string().max(200).nullable().optional(),
    frame: z.enum(FRAMES).default("4t"),
    step: z.number().int().min(1).max(10).default(1),
    kind: z.enum(KINDS).default("email"),
    thread: z.enum(["new", "reply"]).optional(),
    allowWords: z.array(z.string().max(80)).max(100).optional(),
    sourcedText: z.string().max(20_000).optional(),
    assetId: z.string().optional(),
    /** Consumer marketing rules (disclosure, reviews, health/earnings/green claims); on for every consumer kind. */
    consumer: z.boolean().optional(),
    /** Paid, gifted or affiliate content: requires a clear disclosure. */
    sponsored: z.boolean().optional(),
  }),
]);

/**
 * POST /api/compose/lint — deterministic outbound lint, no model call, no cost.
 * Returns { passed, violations[{code, severity, detail}], stats } (plus blockers for workspace drafts).
 */
export async function POST(request: Request) {
  try {
    const input = Body.parse(await readJSON(request));
    if ("packageId" in input) {
      const ws = readWorkspace();
      const pkg = ws.outreach[input.packageId];
      if (!pkg) return Response.json({ error: "Draft not found." }, { status: 404 });
      const step = input.step ? pkg.steps.find((s) => s.step === input.step) : (pkg.steps.find((s) => s.status === "draft") ?? pkg.steps[0]);
      if (!step) return Response.json({ error: "That draft has no step to check." }, { status: 404 });
      const lint = lintStep(ws, pkg, step, { subject: input.subject, body: input.body });
      const pf = preflight(ws, pkg, step);
      return Response.json({ ...lint, blockers: pf.blockers, warnings: pf.warnings, footer: pf.footer });
    }
    return Response.json(lintDraft({ ...input, subject: input.subject ?? null }));
  } catch (err) {
    return errorResponse(err);
  }
}
