import "server-only";
import { randomBytes } from "node:crypto";
import { connectorFor } from "@/lib/connectors";
import { inboundSourceName } from "@/lib/connectors/catalog";
import { nowISO, todayISO } from "@/lib/domain/ids";
import type { Activity, HubEventType, Workspace } from "@/lib/domain/types";
import { readWorkspace } from "@/lib/store/workspace";
import { queueDealSync } from "./crm-sync";
import { deliver, type HubEvent } from "./deliver";
import { appUrl } from "./payloads";
import { dailyBriefMessage, hotReplyMessage } from "./slack-messages";
import { mutateHub } from "./store";

/**
 * Where something happened decides what it may trigger:
 *  - founder: their own action in the UI → webhooks, CRM write-back, Slack
 *  - agent:   a workflow finished (dossier.ready, brief.ready) → webhooks, Slack
 *  - inbound: data another tool pushed in. It is untrusted and never triggers outbound actions
 *             (no webhooks, no CRM writes). It may only notify the founder in their own Slack.
 */
export type HubOrigin = "founder" | "agent" | "inbound";

const msgId = () => `msg_${randomBytes(12).toString("hex")}`;

async function notifySlack(type: HubEventType, data: Record<string, unknown>, origin: HubOrigin, ws: Workspace): Promise<void> {
  const state = ws.integrations.slack;
  if (!state?.enabled) return;
  const slack = connectorFor("slack", ws)?.notify;
  if (!slack) return;

  if (type === "brief.ready" && state.config.dailyBrief !== false) {
    const today = todayISO();
    // Claim today's slot atomically first, so two brief.ready events can't both post.
    const claimed = await mutateHub((hub) => {
      if (hub.slack.briefSentOn === today) return false;
      hub.slack.briefSentOn = today;
      return true;
    });
    if (!claimed) return;
    const r = await slack.post(dailyBriefMessage(ws, appUrl()));
    if (!r.ok) {
      await mutateHub((hub) => {
        if (hub.slack.briefSentOn === today) delete hub.slack.briefSentOn;
      });
    }
    return;
  }

  // Founder-logged replies don't ping Slack: they already know.
  if (type === "reply.logged" && origin !== "founder" && state.config.replyAlerts !== false) {
    const activity = data.__activity as Activity | undefined;
    if (!activity || (activity.sentiment !== "positive" && activity.sentiment !== "referral")) return;
    const via = typeof data.__via === "string" ? data.__via : inboundSourceName(String(activity.source ?? "webhook"));
    await slack.post(hotReplyMessage(ws, activity, via, appUrl()));
  }
}

/**
 * Tell the rest of the stack something happened. Safe to fire and forget: never throws.
 * Workflows call it when they finish, e.g. `void emitHubEvent("dossier.ready", { account: accountData(ws, domain) })`.
 * Keys starting with `__` are internal hints (not sent to webhooks).
 */
export async function emitHubEvent(type: HubEventType, data: Record<string, unknown>, opts: { origin?: HubOrigin } = {}): Promise<void> {
  const origin = opts.origin ?? "agent";
  try {
    const ws = readWorkspace();
    const publicData = Object.fromEntries(Object.entries(data).filter(([k, v]) => !k.startsWith("__") && v !== undefined));
    const event: HubEvent = { id: msgId(), type, at: nowISO(), data: publicData };
    const jobs: Promise<unknown>[] = [];

    if (origin !== "inbound") {
      for (const hook of ws.webhooks) {
        if (!hook.paused && hook.events.includes(type)) jobs.push(deliver(hook, event));
      }
      const dealId = (publicData.deal as { id?: unknown } | undefined)?.id;
      if ((type === "deal.created" || type === "deal.stage_changed") && typeof dealId === "string") jobs.push(queueDealSync(dealId));
    }
    jobs.push(notifySlack(type, data, origin, ws));

    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === "rejected") console.error("[hub]", type, r.reason);
  } catch (err) {
    console.error("[hub] emit failed", type, err);
  }
}

/** "Send today's brief now" on the Slack card. */
export async function sendDailyBriefNow(): Promise<{ ok: boolean; message: string }> {
  const ws = readWorkspace();
  const slack = connectorFor("slack", ws)?.notify;
  if (!slack) return { ok: false, message: "Connect Slack first." };
  const r = await slack.post(dailyBriefMessage(ws, appUrl()));
  if (!r.ok) return { ok: false, message: r.error.message };
  await mutateHub((hub) => {
    hub.slack.briefSentOn = todayISO();
  });
  return { ok: true, message: "Sent today's brief to Slack." };
}
