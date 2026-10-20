import "server-only";

/**
 * The hub's public surface for other areas (workflows, routes):
 *
 *   import { emitHubEvent, accountData } from "@/lib/hub";
 *   void emitHubEvent("dossier.ready", { account: accountData(ws, domain) });
 *
 * Fire and forget; it never throws. Events go to subscribed outbound webhooks, deal events to
 * CRMs with write-back on, and `brief.ready` posts the daily brief to Slack (once a day).
 */
export { emitHubEvent, type HubOrigin } from "./events";
export { accountData, activityData, briefData, dealData, draftData, personData } from "./payloads";
