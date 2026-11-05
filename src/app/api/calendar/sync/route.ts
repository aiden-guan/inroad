import { calendarDigest, syncCalendarNow } from "@/lib/calendar/sync";
import { errorResponse } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

/** "Sync now": reads the calendar right away instead of at the next 15-minute mark. Zero tokens. */
export async function POST() {
  try {
    const r = await syncCalendarNow();
    if (!r.ok) return Response.json({ error: r.message, digest: calendarDigest() }, { status: 502 });
    return Response.json({ ok: true, changed: r.changed, summary: r.summary, digest: calendarDigest(), ...(r.changed ? { workspace: publicWorkspace(readWorkspace()) } : {}) });
  } catch (err) {
    return errorResponse(err);
  }
}
