import { z } from "zod";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Meeting } from "@/lib/domain/types";
import { startRun } from "@/lib/runs/registry";
import { errorResponse, readJSON } from "@/lib/server/http";
import { mutateWorkspace } from "@/lib/store/workspace";
import { getWorkflow } from "@/lib/workflows";

const Body = z.object({
  title: z.string().min(1).max(160),
  startsAt: z.string().datetime({ offset: true }),
  attendees: z.array(z.object({ name: z.string().min(1).max(120), title: z.string().max(120).optional(), personId: z.string().optional() })).max(12).optional(),
  /** Start the call brief right away (spends tokens). */
  prep: z.boolean().optional(),
});

/** Adds a booked meeting to a deal (from a calendar, scheduler or AI SDR), optionally prepping it. */
export async function POST(request: Request, ctx: RouteContext<"/api/deals/[id]/meetings">) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await readJSON(request));
    const { value: meeting } = await mutateWorkspace((ws) => {
      const deal = ws.deals[id];
      if (!deal) return null;
      const m: Meeting = {
        id: newId("mtg"),
        dealId: id,
        title: body.title,
        startsAt: new Date(body.startsAt).toISOString(),
        attendees: (body.attendees ?? []).map((a) => ({ name: a.name, title: a.title, personId: a.personId && ws.people[a.personId] ? a.personId : undefined })),
      };
      ws.meetings[m.id] = m;
      deal.meetingIds.push(m.id);
      deal.updatedAt = nowISO();
      return m;
    });
    if (!meeting) return Response.json({ error: "Deal not found." }, { status: 404 });
    const run = body.prep ? await startRun(getWorkflow("prep")!, { meetingId: meeting.id }) : null;
    return Response.json({ meeting, run }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
