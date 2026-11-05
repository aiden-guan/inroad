import { connection } from "next/server";
import { z } from "zod";
import { calendarDigest, connectCalendar, disconnectCalendar, pendingCalendarMeetings } from "@/lib/calendar/sync";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const ConnectBody = z.object({ url: z.string().trim().min(8, "Paste the whole address.").max(4000) });

/**
 * The Calendar connection on Integrations. GET: what the last read found (never the address itself, only
 * its host and last few characters). POST: connect with a private iCal address (checked with one read,
 * kept in secrets.json, then the first sync backfills 60 days back and 30 ahead). DELETE: disconnect.
 */
export async function GET() {
  await connection();
  try {
    return Response.json({ digest: calendarDigest(), pending: pendingCalendarMeetings() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { url } = ConnectBody.parse(await readJSON(request));
    const r = await connectCalendar(url);
    if (!r.ok) return Response.json({ error: r.message }, { status: 400 });
    return Response.json({ ok: true, summary: r.summary, digest: calendarDigest(), workspace: publicWorkspace(readWorkspace()) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    await disconnectCalendar();
    return Response.json({ ok: true, digest: calendarDigest(), workspace: publicWorkspace(readWorkspace()) });
  } catch (err) {
    return errorResponse(err);
  }
}
