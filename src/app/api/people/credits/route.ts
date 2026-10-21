import { connectorFor } from "@/lib/connectors";
import { nowISO } from "@/lib/domain/ids";
import { errorResponse } from "@/lib/server/http";
import { mutateWorkspace, publicWorkspace } from "@/lib/store/workspace";

/** Re-reads the Firecrawl credit balance (free) and refreshes the "Connected · N credits left" label. */
export async function POST() {
  try {
    const people = connectorFor("firecrawl")?.people;
    if (!people) return Response.json({ error: "Firecrawl isn't connected.", code: "not_connected" }, { status: 412 });
    const r = await people.credits();
    const { ws } = await mutateWorkspace((w) => {
      const st = w.integrations.firecrawl;
      if (!st) return;
      if (r.ok) {
        st.config.accountLabel = `${r.value.remaining.toLocaleString("en-US")} credits left`;
        if (r.value.plan !== undefined) st.config.planCredits = r.value.plan;
        if (st.lastError) delete st.lastError;
      } else if (r.error.code === "auth" || r.error.code === "plan") {
        st.lastError = { at: nowISO(), message: r.error.message };
      }
    });
    if (!r.ok) return Response.json({ error: r.error.message, code: r.error.code }, { status: 400 });
    return Response.json({ ...r.value, workspace: publicWorkspace(ws) });
  } catch (err) {
    return errorResponse(err);
  }
}
