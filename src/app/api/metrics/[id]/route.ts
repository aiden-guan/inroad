import { MetricConnectBody } from "@/lib/metrics/config";
import { connectMetrics, disconnectMetrics, updateMetricSettings } from "@/lib/metrics/sync";
import { cancelPosthogConnection } from "@/lib/metrics/posthog-connect";
import { z } from "zod";
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
    if (id === "posthog") cancelPosthogConnection();
    await disconnectMetrics(id);
    return Response.json({ ok: true, workspace: publicWorkspace(readWorkspace()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    if (!isMetricProvider(id)) return Response.json({ error: "Unknown metric provider." }, { status: 404 });
    const raw = await readJSON(request);
    const patch = id === "posthog" ? z.object({ activityEvent: z.string().trim().max(200), identifiedOnly: z.boolean() }).parse(raw) : id === "stripe" ? z.object({ currency: z.string().trim().regex(/^[a-zA-Z]{3}$/).nullable().optional().transform((s) => s?.toLowerCase()) }).parse(raw) : {};
    const result = await updateMetricSettings(id, patch);
    return result.ok ? Response.json({ ok: true, workspace: publicWorkspace(readWorkspace()) }) : Response.json({ error: result.error.message }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
