import { z } from "zod";
import { calendarDigest, trackCompany } from "@/lib/calendar/sync";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const Body = z.object({ domain: z.string().trim().min(3).max(253) });

/**
 * Track a company found on the calendar: it's added (or tracked), and its meetings go on its deal through
 * the booking path, which starts the deal at Talking. Returns the meetings it made, by calendar event.
 */
export async function POST(request: Request) {
  try {
    const { domain } = Body.parse(await readJSON(request));
    const r = await trackCompany(domain);
    if (!r.ok) return Response.json({ error: r.message }, { status: 400 });
    return Response.json({ ...r, digest: calendarDigest(), workspace: publicWorkspace(readWorkspace()) });
  } catch (err) {
    return errorResponse(err);
  }
}
