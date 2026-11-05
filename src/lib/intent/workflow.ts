import "server-only";
import { z } from "zod";
import { AgentError } from "@/lib/ai/errors";
import { defineWorkflow } from "@/lib/workflows/types";
import { intentMockBase } from "./http";
import { runRadarScan } from "./radar";
import { runIntentScan } from "./scan";

/**
 * Research → Intent. "asks": people asking in public for what the company sells (free sources, one cheap model pass).
 * "radar": developers engaging with the repositories in its space (GitHub, zero tokens).
 */
export default defineWorkflow({
  id: "intent",
  args: z.object({
    mode: z.enum(["asks", "radar"]).default("asks"),
    repos: z.array(z.string().min(3).max(200)).max(5).optional(),
    windowDays: z.number().int().min(7).max(90).optional(),
  }),
  title: (a, ws) =>
    a.mode === "radar"
      ? `Reading developer activity on ${a.repos?.length === 1 ? a.repos[0].replace(/^https?:\/\/github\.com\//, "") : `${a.repos?.length ?? 0} repositories`}`
      : ws.company?.market === "consumer"
        ? "Finding people asking for what you make"
        : "Finding people asking for what you sell",
  // The Intent panel follows its run by this ref: one for the feed, one for the radar.
  ref: (a) => ({ kind: "playbook", id: `intent:${a.mode}` }),
  heavy: true,
  run: async (ctx) => {
    // The sample's posts are examples; scanning starts once there's a real company (the mock server can still answer).
    if (ctx.read().sample && !intentMockBase()) {
      throw new AgentError("The sample shows example posts. Scanning starts once you set up your own company.", "bad_request");
    }
    return ctx.args.mode === "radar" ? runRadarScan(ctx) : runIntentScan(ctx);
  },
});
