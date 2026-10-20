import { stopRun } from "@/lib/runs/registry";

export async function POST(_request: Request, ctx: RouteContext<"/api/runs/[id]/stop">) {
  const { id } = await ctx.params;
  return Response.json({ stopped: stopRun(id) });
}
