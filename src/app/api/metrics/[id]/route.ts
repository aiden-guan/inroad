import { MetricConnectBody } from "@/lib/metrics/config";
import { connectMetrics, disconnectMetrics } from "@/lib/metrics/sync";
import { isMetricProvider } from "@/lib/metrics/types";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    if (!isMetricProvider(id)) return Response.json({ error: "Unknown metric provider." }, { status: 404 });
    const { key, config } = MetricConnectBody.parse(await readJSON(request));
    const result = await connectMetrics(id, key, config);
    if (!result.ok) return Response.json({ error: result.error.message, code: result.error.code }, { status: 400 });
    return Response.json({ ok: true, workspace: publicWorkspace(readWorkspace()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    if (!isMetricProvider(id)) return Response.json({ error: "Unknown metric provider." }, { status: 404 });
    await disconnectMetrics(id);
    return Response.json({ ok: true, workspace: publicWorkspace(readWorkspace()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
