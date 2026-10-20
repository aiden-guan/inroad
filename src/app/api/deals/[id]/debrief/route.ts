import { z } from "zod";
import { addDays, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Meeting } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";
import { startRun } from "@/lib/runs/registry";
import { errorResponse, readJSON } from "@/lib/server/http";
import { mutateWorkspace } from "@/lib/store/workspace";
import { getWorkflow } from "@/lib/workflows";

const Body = z.object({
  notes: z.string().min(20).max(200_000),
  source: z.enum(["transcript", "founder_notes"]).optional(),
  meetingId: z.string().optional(),
  /** Title for the call when no meeting is given (e.g. the recorder's meeting name). */
  title: z.string().min(1).max(160).optional(),
});

/**
 * Debriefs a call from a pasted or pushed transcript (call recorders via Zapier/n8n, or the
 * founder's notes). Attaches it to a meeting (today's undebriefed one, or a new one), then starts
 * the debrief run; the founder reviews and applies it in the company sheet.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/deals/[id]/debrief">) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await readJSON(request));
    const today = todayISO();
    const { value } = await mutateWorkspace((ws): { error: string; status: number } | { meetingId: string } => {
      const deal = ws.deals[id];
      if (!deal) return { error: "Deal not found.", status: 404 };
      if (body.meetingId) return ws.meetings[body.meetingId]?.dealId === id ? { meetingId: body.meetingId } : { error: "That meeting isn't on this deal.", status: 400 };
      const todays = deal.meetingIds
        .map((m) => ws.meetings[m])
        .find((m) => {
          if (!m || m.debrief) return false;
          const d = localDate(m.startsAt);
          return d <= today && d >= addDays(today, -1);
        });
      if (todays) return { meetingId: todays.id };
      const meeting: Meeting = { id: newId("mtg"), dealId: id, title: body.title ?? `Call with ${deal.name}`, startsAt: nowISO(), attendees: [] };
      ws.meetings[meeting.id] = meeting;
      deal.meetingIds.push(meeting.id);
      return { meetingId: meeting.id };
    });
    if ("error" in value) return Response.json({ error: value.error }, { status: value.status });
    const run = await startRun(getWorkflow("debrief")!, { meetingId: value.meetingId, notes: body.notes, source: body.source });
    return Response.json({ meetingId: value.meetingId, run }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
