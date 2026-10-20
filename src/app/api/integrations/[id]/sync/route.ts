import { z } from "zod";
import { connectorFor } from "@/lib/connectors";
import { CONNECTORS, isCrm, isSequencer } from "@/lib/connectors/catalog";
import { importCompanies, pushOpenDeals } from "@/lib/hub/crm-sync";
import { inboundSecret } from "@/lib/hub/secrets";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("push_deals") }),
  z.object({ op: z.literal("pull_companies") }),
  z.object({ op: z.literal("register_replies"), publicUrl: z.url() }),
]);

/**
 * Explicit, founder-initiated syncs (all plain HTTP, zero tokens):
 *  - push_deals: mirror open and won deals into the CRM now
 *  - pull_companies: note the CRM's recently updated companies as known, so they're never suggested
 *  - register_replies: ask the sequencer to send reply events to our inbound URL
 */
export async function POST(request: Request, ctx: RouteContext<"/api/integrations/[id]/sync">) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await readJSON(request));

    if (body.op === "push_deals" || body.op === "pull_companies") {
      if (!isCrm(id)) return Response.json({ error: `${id} isn't a CRM.` }, { status: 404 });
      if (!connectorFor(id)) return Response.json({ error: `${CONNECTORS[id].name} isn't connected.` }, { status: 412 });
      if (body.op === "push_deals") {
        const r = await pushOpenDeals(id);
        if (!r.pushed && r.failed) return Response.json({ error: r.firstError ?? "Nothing was pushed." }, { status: 502 });
        const message = r.pushed
          ? `Pushed ${r.pushed} deal${r.pushed === 1 ? "" : "s"} to ${CONNECTORS[id].name}${r.failed ? `; ${r.failed} failed: ${r.firstError}` : ""}.`
          : "No open deals to push yet.";
        return Response.json({ ok: true, message, workspace: publicWorkspace(readWorkspace()) });
      }
      const r = await importCompanies(id);
      if (!r.ok) return Response.json({ error: r.error.message }, { status: 502 });
      return Response.json({ ok: true, message: r.value.message, workspace: publicWorkspace(readWorkspace()) });
    }

    if (!isSequencer(id)) return Response.json({ error: `${id} isn't a sequencer.` }, { status: 404 });
    const seq = connectorFor(id)?.sequencer;
    if (!seq) return Response.json({ error: `${CONNECTORS[id].name} isn't connected.` }, { status: 412 });
    if (!seq.registerReplyWebhook) return Response.json({ error: `Add the webhook in ${CONNECTORS[id].name} by hand; its API doesn't support it.` }, { status: 400 });
    const base = body.publicUrl.replace(/\/+$/, "");
    if (!base.startsWith("https://")) return Response.json({ error: `${CONNECTORS[id].name} can only call an https address. Use your tunnel's https URL.` }, { status: 400 });
    const r = await seq.registerReplyWebhook(`${base}/api/hooks/${id}/${inboundSecret()}`);
    if (!r.ok) return Response.json({ error: r.error.message }, { status: 502 });
    return Response.json({ ok: true, message: `${CONNECTORS[id].name} will now send replies here.` });
  } catch (err) {
    return errorResponse(err);
  }
}
