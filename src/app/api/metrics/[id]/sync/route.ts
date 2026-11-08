import { syncMetrics } from "@/lib/metrics/sync";
import { isMetricProvider } from "@/lib/metrics/types";
import { errorResponse } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isMetricProvider(id)) return Response.json({ error: "Unknown metric provider." }, { status: 404 });
    const result = await syncMetrics(id);
    if (!result) return Response.json({ error: "Leave the sample workspace before syncing providers." }, { status: 400 });
    if (!result.ok) return Response.json({ error: result.error.message, code: result.error.code }, { status: 502 });
    return Response.json({ ok: true, workspace: publicWorkspace(readWorkspace()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
