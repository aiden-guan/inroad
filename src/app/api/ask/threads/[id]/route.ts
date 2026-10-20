import { connection } from "next/server";
import { z } from "zod";
import { nowISO } from "@/lib/domain/ids";
import { errorResponse, readJSON } from "@/lib/server/http";
import { decideProposal, getThread, publicThread } from "@/lib/store/threads";

/** One thread's display turns (the raw model history stays on the server). */
export async function GET(_request: Request, ctx: RouteContext<"/api/ask/threads/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const thread = getThread(id);
  if (!thread) return Response.json({ error: "Conversation not found." }, { status: 404 });
  return Response.json({ thread: publicThread(thread) });
}

const Patch = z.object({
  proposalId: z.string().min(3).max(40),
  status: z.enum(["applied", "dismissed"]),
  runId: z.string().max(40).optional(),
});

/** Records the founder's decision on a proposal chip. The change itself is applied by the client's actions. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/ask/threads/[id]">) {
  try {
    const { id } = await ctx.params;
    const body = Patch.parse(await readJSON(request));
    const thread = await decideProposal(id, body.proposalId, { status: body.status, runId: body.runId, at: nowISO() });
    if (!thread) return Response.json({ error: "That proposal is gone. Reopen the conversation." }, { status: 404 });
    return Response.json({ thread: publicThread(thread) });
  } catch (err) {
    return errorResponse(err);
  }
}
