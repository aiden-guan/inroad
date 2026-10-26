import { z } from "zod";
import { readConnections } from "@/lib/network/store";
import { logPastedReply } from "@/lib/replies/paste";
import { errorResponse, readJSON } from "@/lib/server/http";
import { mutateWorkspace, publicWorkspace } from "@/lib/store/workspace";

const Target = z.union([
  z.object({ personId: z.string().min(1).max(64) }),
  z.object({ connectionId: z.string().min(1).max(64) }),
  z.object({ domain: z.string().min(3).max(253), name: z.string().min(1).max(120), email: z.string().max(254).optional(), company: z.string().max(120).optional() }),
]);
const Body = z.object({ text: z.string().min(2).max(50_000), target: Target, receivedAt: z.string().max(40).optional() });

/**
 * ⌘K "Paste a reply", step two: logs the reply against the person the founder confirmed (filing them
 * first when they're new) and marks their open touches as replied. Zero tokens: the composer's reply
 * mode reads and answers it next.
 */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const connections = "connectionId" in body.target ? readConnections() : [];
    const { ws, value } = await mutateWorkspace((draft) => logPastedReply(draft, connections, body, new Date()));
    return Response.json({ reply: value, workspace: publicWorkspace(ws) });
  } catch (err) {
    return errorResponse(err);
  }
}
