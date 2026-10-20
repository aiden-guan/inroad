import { connection } from "next/server";
import { connectorFor } from "@/lib/connectors";
import { CONNECTORS, isCrm } from "@/lib/connectors/catalog";
import { suggestStageMap } from "@/lib/hub/stage-map";
import { errorResponse } from "@/lib/server/http";

/** CRM pipelines and stages, plus a code-made suggestion for mapping our six stages onto each. */
export async function GET(_request: Request, ctx: RouteContext<"/api/integrations/[id]/pipelines">) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!isCrm(id)) return Response.json({ error: `${id} isn't a CRM.` }, { status: 404 });
    const crm = connectorFor(id)?.crm;
    if (!crm) return Response.json({ error: `${CONNECTORS[id].name} isn't connected.` }, { status: 412 });
    const r = await crm.listPipelines();
    if (!r.ok) return Response.json({ error: r.error.message, code: r.error.code }, { status: 502 });
    return Response.json({ pipelines: r.value.map((p) => ({ ...p, suggested: suggestStageMap(p) })) });
  } catch (err) {
    return errorResponse(err);
  }
}
