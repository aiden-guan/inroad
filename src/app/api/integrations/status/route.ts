import { connection } from "next/server";
import { NATIVE_IDS } from "@/lib/connectors/catalog";
import { inboundSecret, signingSecret } from "@/lib/hub/secrets";
import { mutateHub, readHub } from "@/lib/hub/store";
import type { HubStatus } from "@/lib/hub/types";
import { errorResponse } from "@/lib/server/http";
import { isLocalRequest } from "@/lib/server/local-request";
import { secretKeysSet } from "@/lib/store/workspace";

/**
 * Everything the Integrations page needs that isn't in the workspace: the inbound URL token and
 * signing secret (the founder has to copy them into other tools), recent inbound events,
 * deliveries and syncs, and which connectors have a saved key (never the key).
 */
export async function GET(request: Request) {
  await connection();
  try {
    const origin = new URL(request.url).origin;
    // Only the founder's own machine may set the address other tools are given (never a forwarded/tunnel host).
    if (isLocalRequest(request) && readHub().appUrl !== origin) {
      await mutateHub((hub) => {
        hub.appUrl = origin;
      });
    }
    const hub = readHub();
    const body: HubStatus = {
      appUrl: hub.appUrl,
      inbound: { secret: inboundSecret(), events: hub.inbound.slice(0, 40) },
      signing: { secret: signingSecret() },
      deliveries: hub.deliveries.slice(0, 20),
      sync: hub.sync.slice(0, 20),
      keys: Object.fromEntries(NATIVE_IDS.map((id) => [id, secretKeysSet(id).includes("key")])),
      slack: { briefSentOn: hub.slack.briefSentOn },
    };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
