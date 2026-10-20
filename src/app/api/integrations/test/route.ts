import { randomBytes } from "node:crypto";
import { z } from "zod";
import { connectorFor } from "@/lib/connectors";
import { nowISO } from "@/lib/domain/ids";
import { deliver } from "@/lib/hub/deliver";
import { sendDailyBriefNow } from "@/lib/hub/events";
import { appUrl } from "@/lib/hub/payloads";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const Body = z.discriminatedUnion("target", [
  z.object({ target: z.literal("webhook"), id: z.string().min(1) }),
  z.object({ target: z.literal("slack"), what: z.enum(["ping", "brief"]) }),
]);

/** Founder-initiated test sends: a signed sample event to one endpoint, or a Slack ping / today's brief. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    if (body.target === "webhook") {
      const hook = readWorkspace().webhooks.find((w) => w.id === body.id);
      if (!hook) return Response.json({ error: "That endpoint no longer exists." }, { status: 404 });
      const type = hook.events[0] ?? "brief.ready";
      const entry = await deliver(
        { ...hook, paused: false },
        { id: `msg_${randomBytes(12).toString("hex")}`, type, at: nowISO(), data: { test: true, message: "Test event from Inroad. Real events carry the same envelope.", dashboard_url: appUrl() } },
        { test: true },
      );
      const ok = typeof entry.status === "number" && entry.status >= 200 && entry.status < 300;
      return Response.json({ ok, entry, error: ok ? undefined : (entry.error ?? "The endpoint didn't accept it."), workspace: publicWorkspace(readWorkspace()) }, { status: ok ? 200 : 502 });
    }
    if (body.what === "brief") {
      const r = await sendDailyBriefNow();
      return Response.json(r.ok ? { ok: true, message: r.message } : { error: r.message }, { status: r.ok ? 200 : 502 });
    }
    const slack = connectorFor("slack")?.notify;
    if (!slack) return Response.json({ error: "Connect Slack first." }, { status: 412 });
    const r = await slack.post({ text: "Test from Inroad. Daily briefs and interested-reply alerts post here." });
    return Response.json(r.ok ? { ok: true, message: "Sent a test message." } : { error: r.error.message }, { status: r.ok ? 200 : 502 });
  } catch (err) {
    return errorResponse(err);
  }
}
