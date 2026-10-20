import { connection } from "next/server";
import { isSequencer } from "@/lib/connectors/catalog";
import { listCampaigns } from "@/lib/hub/push";
import { errorResponse } from "@/lib/server/http";

/** A sequencer's campaigns for the picker. `?fresh=1` skips the 2-minute cache. */
export async function GET(request: Request, ctx: RouteContext<"/api/integrations/[id]/campaigns">) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!isSequencer(id)) return Response.json({ error: `${id} doesn't have campaigns.` }, { status: 404 });
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const r = await listCampaigns(id, fresh);
    if (!r.ok) return Response.json({ error: r.error.message, code: r.error.code }, { status: r.error.code === "auth" ? 412 : 502 });
    return Response.json({ campaigns: r.value });
  } catch (err) {
    return errorResponse(err);
  }
}
