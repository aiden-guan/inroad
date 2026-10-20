import { connection } from "next/server";
import { readWorkspace } from "@/lib/store/workspace";

/** One deal with its company, people and meetings (briefs and debriefs included). */
export async function GET(_request: Request, ctx: RouteContext<"/api/deals/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const ws = readWorkspace();
  const deal = ws.deals[id];
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
  const account = ws.accounts[deal.accountDomain];
  return Response.json({
    deal: { ...deal, amountUsd: deal.priceQuotes?.length ? deal.amountUsd : undefined },
    account: account ? { domain: account.domain, name: account.name, oneLiner: account.oneLiner, whyNow: account.whyNow, tier: account.tier, dossier: account.dossier ?? null } : null,
    people: deal.contacts.map((c) => ws.people[c.personId]).filter(Boolean),
    meetings: deal.meetingIds.map((m) => ws.meetings[m]).filter(Boolean),
  });
}
