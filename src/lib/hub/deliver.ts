import "server-only";
import { createHmac } from "node:crypto";
import { newId, nowISO } from "@/lib/domain/ids";
import type { HubEventType, OutboundWebhook } from "@/lib/domain/types";
import { mutateWorkspace } from "@/lib/store/workspace";
import { signingSecret } from "./secrets";
import { mutateHub } from "./store";
import type { DeliveryLogEntry } from "./types";

export interface HubEvent {
  /** Stable across retries; receivers dedupe on it (`webhook-id`). */
  id: string;
  type: HubEventType;
  at: string;
  data: Record<string, unknown>;
}

/**
 * Standard Webhooks signature: base64(HMAC_SHA256(secretBytes, `${id}.${timestamp}.${body}`)).
 * Any Standard Webhooks library (Svix's, or the spec's reference code) verifies it.
 */
export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

// First try plus three retries. Kept short because this is a local app, not a queue.
const SCHEDULE_MS = [0, 2_000, 10_000, 30_000];
const MAX_BODY = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfter(res: Response): number | undefined {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? Math.min(60_000, s * 1000) : undefined;
}

/** Keeps payloads under ~20 KB by trimming the longest strings first. */
function compact(event: HubEvent): string {
  let body = JSON.stringify(event);
  if (body.length <= MAX_BODY) return body;
  const trim = (v: unknown): unknown =>
    typeof v === "string" ? (v.length > 600 ? `${v.slice(0, 600)}…` : v) : Array.isArray(v) ? v.slice(0, 20).map(trim) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)])) : v;
  body = JSON.stringify({ ...event, data: trim(event.data) });
  return body;
}

/** Delivers one event to one endpoint with retries, then records the outcome on the endpoint and in the log. */
export async function deliver(hook: OutboundWebhook, event: HubEvent, opts: { test?: boolean } = {}): Promise<DeliveryLogEntry> {
  const body = compact(event);
  const secret = signingSecret();
  let status: number | "error" = "error";
  let error: string | undefined;
  let attempts = 0;
  let gone = false;
  // "Send test" is someone watching a spinner: one quick attempt, and the error right away.
  const schedule = opts.test ? [0] : SCHEDULE_MS;
  const timeoutMs = opts.test ? 8_000 : 15_000;

  for (const [i, wait] of schedule.entries()) {
    if (wait) await sleep(wait + Math.floor(Math.random() * 500));
    attempts++;
    const ts = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Inroad-Webhooks/1.0",
          "webhook-id": event.id,
          "webhook-timestamp": String(ts),
          "webhook-signature": sign(secret, event.id, ts, body),
        },
        body,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (res.ok) {
        error = undefined;
        break;
      }
      if (res.status === 410) {
        gone = true;
        error = "The endpoint answered 410 Gone, so I paused it.";
        break;
      }
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      error = res.status >= 300 && res.status < 400 ? `Redirected (${res.status}). Use the final URL.` : `Answered ${res.status}.`;
      if (!retryable) break;
      const ra = retryAfter(res);
      if (ra && i < schedule.length - 1) await sleep(ra);
    } catch (err) {
      status = "error";
      error = err instanceof Error && err.name === "TimeoutError" ? `No answer within ${timeoutMs / 1000}s.` : "Couldn't reach the endpoint.";
    }
  }

  const entry: DeliveryLogEntry = { id: newId("dlv"), webhookId: hook.id, type: event.type, at: nowISO(), status, attempts, ...(error ? { error } : {}), ...(opts.test ? { test: true } : {}) };
  await mutateHub((hub) => {
    hub.deliveries.unshift(entry);
  });
  await mutateWorkspace((ws) => {
    const w = ws.webhooks.find((x) => x.id === hook.id);
    if (!w) return;
    w.lastDelivery = { at: entry.at, status, event: event.type };
    if (gone) w.paused = true;
  });
  return entry;
}
