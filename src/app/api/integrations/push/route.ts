import { connection } from "next/server";
import { z } from "zod";
import { CONNECTORS } from "@/lib/connectors/catalog";
import { connectedSequencers, PushError, pushDraft } from "@/lib/hub/push";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const Body = z.object({
  packageId: z.string().min(1),
  step: z.number().int().min(1),
  integrationId: z.enum(["instantly", "smartlead", "lemlist"]).optional(),
  campaignId: z.string().min(1).optional(),
});

/**
 * Pushes an approved draft's lead and copy into a sequencer campaign. The composer calls this.
 * → { ok, externalId, integrationId, campaignId, campaignName, workspace }
 * Errors: 400 bad input / no email / no campaign, 409 duplicate or do-not-contact, 412 not connected, 502 vendor error.
 */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const r = await pushDraft(body);
    return Response.json({ ok: true, ...r, workspace: publicWorkspace(readWorkspace()) });
  } catch (err) {
    if (err instanceof PushError) return Response.json({ error: err.message }, { status: err.status });
    return errorResponse(err);
  }
}

/** What the composer needs to render a "Push to …" button: connected sequencers and their default campaign. */
export async function GET() {
  await connection();
  const ws = readWorkspace();
  return Response.json({
    sequencers: connectedSequencers(ws).map((id) => ({
      id,
      name: CONNECTORS[id].name,
      defaultCampaignId: ws.integrations[id]?.config.defaultCampaignId ?? null,
      defaultCampaignName: ws.integrations[id]?.config.defaultCampaignName ?? null,
    })),
  });
}
