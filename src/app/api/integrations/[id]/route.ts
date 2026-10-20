import { z } from "zod";
import { makeConnector, SECRET_KEY, type ConnectorConfig } from "@/lib/connectors";
import { CONNECTORS, isNative } from "@/lib/connectors/catalog";
import { nowISO } from "@/lib/domain/ids";
import { forgetCampaigns } from "@/lib/hub/push";
import { mutateHub } from "@/lib/hub/store";
import { errorResponse, readJSON } from "@/lib/server/http";
import { mutateWorkspace, publicWorkspace, readWorkspace, setSecrets } from "@/lib/store/workspace";

const ConnectBody = z.object({ key: z.string().trim().min(8, "Paste the whole key.").max(4000) });

// Labels a connector falls back to when the tool didn't name the account; they can't tell two accounts apart.
const GENERIC_LABELS = new Set(["HubSpot", "Attio workspace", "Instantly workspace", "lemlist team"]);
// Settings that only make sense in the account they were made in.
const ACCOUNT_KEYS = ["pipelineId", "defaultCampaignId", "defaultCampaignName", "portalId", "uiDomain"];

/** True when the new key belongs to a different account than the saved settings and record ids. */
function otherAccount(id: string, prev: ConnectorConfig, next: { accountLabel: string; config?: ConnectorConfig }): boolean {
  if (id === "hubspot") return prev.portalId !== undefined && next.config?.portalId !== undefined && String(prev.portalId) !== String(next.config.portalId);
  // Smartlead's label is a campaign count and Slack's never changes.
  if (id === "smartlead" || id === "slack") return false;
  const before = prev.accountLabel;
  return typeof before === "string" && before !== next.accountLabel && !GENERIC_LABELS.has(before) && !GENERIC_LABELS.has(next.accountLabel);
}

/** Connect: validate the pasted key with one cheap read, then save it to secrets.json (never the workspace). */
export async function POST(request: Request, ctx: RouteContext<"/api/integrations/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!isNative(id)) return Response.json({ error: `Unknown integration: ${id}` }, { status: 404 });
    const { key } = ConnectBody.parse(await readJSON(request));
    const current = readWorkspace().integrations[id]?.config ?? {};

    const result = await makeConnector(id, key, current).validate();
    if (!result.ok) return Response.json({ error: result.error.message, code: result.error.code }, { status: 400 });

    setSecrets(id, { [SECRET_KEY]: key });
    forgetCampaigns(id);
    const switched = otherAccount(id, current, result.value);
    const at = nowISO();
    const { ws } = await mutateWorkspace((w) => {
      const prev = w.integrations[id];
      // A different account: its stage map, campaign and record ids point at things that don't exist there.
      const prevConfig = prev?.config ?? {};
      const kept = switched ? Object.fromEntries(Object.entries(prevConfig).filter(([k]) => !k.startsWith("stage_") && !ACCOUNT_KEYS.includes(k))) : prevConfig;
      if (switched) for (const d of Object.values(w.deals)) if (d.external) d.external = d.external.filter((e) => e.integrationId !== id);
      w.integrations[id] = {
        id,
        enabled: true,
        connectedAt: at,
        config: {
          ...kept,
          ...(result.value.config ?? {}),
          accountLabel: result.value.accountLabel,
          // Defaults on first connect: CRM write-back is off until the founder turns it on; Slack posts both kinds.
          ...(CONNECTORS[id].kind === "crm" && prev?.config.writeBack === undefined ? { writeBack: false } : {}),
          ...(id === "slack" && prev?.config.dailyBrief === undefined ? { dailyBrief: true, replyAlerts: true } : {}),
        },
        stats: prev?.stats ?? { pushed: 0, pulled: 0 },
      };
    });
    if (switched) {
      await mutateHub((h) => {
        for (const k of Object.keys(h.refs)) if (k.startsWith(`${id}:`)) delete h.refs[k];
      });
    }
    return Response.json({ ok: true, accountLabel: result.value.accountLabel, workspace: publicWorkspace(ws) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Disconnect: forget the key. Settings like stage mapping stay, so reconnecting is one paste. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/integrations/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!isNative(id)) return Response.json({ error: `Unknown integration: ${id}` }, { status: 404 });
    setSecrets(id, { [SECRET_KEY]: null });
    forgetCampaigns(id);
    const { ws } = await mutateWorkspace((w) => {
      const st = w.integrations[id];
      if (!st) return;
      st.enabled = false;
      delete st.connectedAt;
      delete st.lastError;
      delete st.config.accountLabel;
    });
    return Response.json({ ok: true, workspace: publicWorkspace(ws) });
  } catch (err) {
    return errorResponse(err);
  }
}
