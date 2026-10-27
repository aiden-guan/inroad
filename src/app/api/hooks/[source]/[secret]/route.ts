import { createHash } from "node:crypto";
import { connection } from "next/server";
import { receiveInbound } from "@/lib/hub/inbound";
import { verifyInbound } from "@/lib/hub/secrets";
import { BodyTooLargeError, readTextBody } from "@/lib/server/http";

/**
 * Inbound webhook for any tool: POST /api/hooks/{source}/{secret}.
 * `source` picks a payload template (instantly, smartlead, lemlist, calendly, calcom, clay, …;
 * anything else is read as the generic shape). The path secret authenticates the caller.
 * Answers fast with what was recorded. Never triggers outbound actions.
 */

const MAX_BYTES = 1_000_000;
const SOURCE = /^[a-z0-9_-]{1,32}$/;

export async function POST(request: Request, ctx: RouteContext<"/api/hooks/[source]/[secret]">) {
  const { source, secret } = await ctx.params;
  if (!SOURCE.test(source)) return Response.json({ error: "Unknown source." }, { status: 404 });
  if (!verifyInbound(secret)) return Response.json({ error: "This hook URL isn't valid. Copy it again from Inroad → Integrations." }, { status: 401 });

  let raw: string;
  try {
    raw = await readTextBody(request, MAX_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return Response.json({ error: "Payload too large (1 MB max). Send fewer rows per request." }, { status: 413 });
    throw err;
  }

  let payload: unknown;
  const type = request.headers.get("content-type") ?? "";
  try {
    payload = type.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
  } catch {
    return Response.json({ error: "Send a JSON body (Content-Type: application/json)." }, { status: 400 });
  }

  const deliveryKey =
    request.headers.get("idempotency-key") ?? request.headers.get("webhook-id") ?? request.headers.get("x-request-id") ?? createHash("sha256").update(raw).digest("hex").slice(0, 40);

  try {
    const entry = await receiveInbound(source, payload, deliveryKey.slice(0, 120));
    return Response.json({ ok: true, status: entry.status, summary: entry.summary, counts: entry.counts, ...(entry.unmapped ? { unmapped: entry.unmapped } : {}) });
  } catch (err) {
    console.error("[hooks]", source, err);
    return Response.json({ error: "Couldn't record that event. Try again." }, { status: 500 });
  }
}

/** Some tools ping the URL before saving it. */
export async function GET(_request: Request, ctx: RouteContext<"/api/hooks/[source]/[secret]">) {
  await connection();
  const { source, secret } = await ctx.params;
  if (!SOURCE.test(source) || !verifyInbound(secret)) return Response.json({ error: "This hook URL isn't valid." }, { status: 401 });
  return Response.json({ ok: true, source, message: "Inroad is listening. POST JSON here." });
}
