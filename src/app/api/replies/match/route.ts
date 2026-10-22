import { z } from "zod";
import { readConnections } from "@/lib/network/store";
import { matchSender, ownIdentity, parseSender } from "@/lib/replies/sender";
import { errorResponse, readJSON } from "@/lib/server/http";
import { readWorkspace } from "@/lib/store/workspace";

const Body = z.object({ text: z.string().min(1).max(50_000) });

/**
 * ⌘K "Paste a reply", step one: who sent it, matched in code against people on file and LinkedIn
 * connections. Read-only and free; only the few candidates leave the server, never the connections.
 */
export async function POST(request: Request) {
  try {
    const { text } = Body.parse(await readJSON(request));
    const ws = readWorkspace();
    const sender = parseSender(text, ownIdentity(ws));
    return Response.json({ sender, matches: matchSender(ws, readConnections(), sender, new Date()) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
