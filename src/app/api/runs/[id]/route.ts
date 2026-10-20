import { connection } from "next/server";
import { runSteps } from "@/lib/runs/registry";
import { readWorkspace } from "@/lib/store/workspace";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const run = readWorkspace().runs.find((r) => r.id === id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ run, steps: runSteps(id) });
}
