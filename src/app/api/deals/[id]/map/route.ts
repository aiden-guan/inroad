import { connection } from "next/server";
import { mapToMarkdown } from "@/lib/deals/rules";
import { readWorkspace } from "@/lib/store/workspace";

/** The mutual action plan as Markdown, to review with the buyer in a shared doc. */
export async function GET(_request: Request, ctx: RouteContext<"/api/deals/[id]/map">) {
  await connection();
  const { id } = await ctx.params;
  const ws = readWorkspace();
  const deal = ws.deals[id];
  if (!deal?.map) return Response.json({ error: "This deal has no mutual action plan yet." }, { status: 404 });
  const md = mapToMarkdown(deal.map, deal.name, ws.company?.name);
  const file = `${deal.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-action-plan.md`;
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `inline; filename="${file}"`, "Cache-Control": "no-store" } });
}
