import { connection } from "next/server";
import { z } from "zod";
import { hasDatedNextStep } from "@/lib/deals/rules";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type Account, type Deal, type Meeting, type Person, type Workspace } from "@/lib/domain/types";
import { startRun } from "@/lib/runs/registry";
import { errorResponse, readJSON } from "@/lib/server/http";
import { toDomain } from "@/lib/signals";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { getWorkflow } from "@/lib/workflows";

/**
 * Deals, for the founder's other tools and agents (an AI SDR that booked a meeting, a CRM sync,
 * Zapier). GET lists the pipeline; POST opens a deal at Talking (idempotent per company) and can
 * attach the booked meeting and start the call brief.
 */

function summarize(ws: Workspace, d: Deal) {
  const today = todayISO();
  const quoted = (d.priceQuotes?.length ?? 0) > 0;
  return {
    id: d.id,
    name: d.name,
    domain: d.accountDomain,
    stage: d.stage,
    nextStep: d.nextStep ?? null,
    nextStepOverdue: !!d.nextStep && d.nextStep.date < today,
    hasDatedNextStep: hasDatedNextStep(d.nextStep, today),
    score: d.qualification?.total ?? 0,
    qualified: d.qualification?.qualified ?? false,
    // Dollar pipeline is fiction until a price has been quoted.
    amountUsd: quoted ? (d.amountUsd ?? null) : null,
    contacts: d.contacts.map((c) => ({ personId: c.personId, name: ws.people[c.personId]?.name, title: ws.people[c.personId]?.title, role: c.role })),
    meetings: d.meetingIds.length,
    lastActivityAt: d.lastActivityAt,
    url: `/companies?c=${encodeURIComponent(d.accountDomain)}`,
  };
}

export async function GET(request: Request) {
  await connection();
  const ws = readWorkspace();
  const params = new URL(request.url).searchParams;
  const stage = params.get("stage");
  const all = params.get("all") === "1";
  const deals = Object.values(ws.deals)
    .filter((d) => (stage ? d.stage === stage : all || OPEN_STAGES.includes(d.stage)))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .map((d) => summarize(ws, d));
  return Response.json({ deals });
}

const Body = z.object({
  domain: z.string().min(3).max(253),
  name: z.string().min(1).max(120).optional(),
  source: z.enum(["warm_intro", "signal_cold", "investor_intro", "community", "content", "dinner", "event", "inbound", "network", "referral"]).optional(),
  sourceDetail: z.string().max(80).optional(),
  contact: z.object({ name: z.string().min(1).max(120), title: z.string().max(120).optional(), email: z.string().email().optional() }).optional(),
  meeting: z
    .object({
      title: z.string().min(1).max(160),
      startsAt: z.string().datetime({ offset: true }),
      attendees: z.array(z.object({ name: z.string().min(1).max(120), title: z.string().max(120).optional() })).max(12).optional(),
    })
    .optional(),
  /** Start the call brief right away (spends tokens). */
  prep: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const domain = toDomain(body.domain);
    if (!domain) return Response.json({ error: `"${body.domain}" isn't a company domain.` }, { status: 400 });
    const at = nowISO();
    const { value } = await mutateWorkspace((ws) => {
      let acc: Account | undefined = ws.accounts[domain];
      if (!acc) {
        acc = {
          domain,
          name: body.name ?? domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
          status: "in_pipeline",
          source: "integration",
          sourceDetail: body.sourceDetail,
          addedAt: at,
          fitScore: 0,
          tier: "C",
          criteria: [],
          signals: [],
          whyNow: null,
          whyNowScore: 0,
          peopleIds: [],
          warmPathCount: 0,
          watch: true,
        };
        ws.accounts[domain] = acc;
      }
      let deal = acc.dealId ? ws.deals[acc.dealId] : undefined;
      const created = !deal || !OPEN_STAGES.includes(deal.stage);
      if (!deal || !OPEN_STAGES.includes(deal.stage)) {
        deal = {
          id: newId("deal"),
          accountDomain: domain,
          name: acc.name,
          stage: "talking",
          stageHistory: [{ stage: "talking", at }],
          source: body.source ?? "inbound",
          contacts: [],
          meetingIds: [],
          createdAt: at,
          updatedAt: at,
          lastActivityAt: at,
        };
        ws.deals[deal.id] = deal;
        acc.dealId = deal.id;
        acc.status = "in_pipeline";
      }
      if (body.contact) {
        const name = body.contact.name.trim();
        let person: Person | undefined = acc.peopleIds.map((id) => ws.people[id]).find((p) => p?.name.toLowerCase() === name.toLowerCase());
        if (!person) {
          person = {
            id: newId("per"),
            accountDomain: domain,
            name,
            title: body.contact.title ?? "",
            email: body.contact.email,
            evidenceIds: [],
            confidence: "medium",
            mayHaveLeft: false,
            contactPaths: body.contact.email ? [{ kind: "integration", value: body.contact.email, via: body.sourceDetail ?? "Your tools", verified: false, founderConfirmed: false }] : [],
            jurisdiction: "unknown",
            doNotContact: false,
            source: "integration",
          };
          ws.people[person.id] = person;
          acc.peopleIds.push(person.id);
        }
        if (!deal.contacts.some((c) => c.personId === person!.id)) deal.contacts.push({ personId: person.id });
      }
      let meeting: Meeting | undefined;
      if (body.meeting) {
        meeting = {
          id: newId("mtg"),
          dealId: deal.id,
          title: body.meeting.title,
          startsAt: new Date(body.meeting.startsAt).toISOString(),
          attendees: (body.meeting.attendees ?? []).map((a) => ({ name: a.name, title: a.title, personId: acc!.peopleIds.find((id) => ws.people[id]?.name.toLowerCase() === a.name.toLowerCase()) })),
        };
        ws.meetings[meeting.id] = meeting;
        deal.meetingIds.push(meeting.id);
      }
      deal.updatedAt = deal.lastActivityAt = at;
      return { deal: summarize(ws, deal), created, meetingId: meeting?.id };
    });
    let run = null;
    if (body.prep && value.meetingId) run = await startRun(getWorkflow("prep")!, { meetingId: value.meetingId });
    return Response.json({ ...value, run }, { status: value.created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
