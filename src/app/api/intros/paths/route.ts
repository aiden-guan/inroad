import { connection } from "next/server";
import { todayISO } from "@/lib/domain/ids";
import { waysIn } from "@/lib/intros/rules";
import { readConnections } from "@/lib/network/store";
import { errorResponse } from "@/lib/server/http";
import { readWorkspace } from "@/lib/store/workspace";

/**
 * Every way into a company, ranked in code (zero tokens). Server-side because LinkedIn connections
 * (insiders and alumni) live in connections.json, which never goes to the browser in bulk: only the
 * handful of matching people come back.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const domain = new URL(request.url).searchParams.get("domain")?.trim().toLowerCase();
    if (!domain) return Response.json({ error: "Which company? Pass ?domain=" }, { status: 400 });
    const ws = readWorkspace();
    if (!ws.accounts[domain]) return Response.json({ error: "That company isn't in your list." }, { status: 404 });
    return Response.json({ ways: waysIn(ws, domain, readConnections(), todayISO()) });
  } catch (err) {
    return errorResponse(err);
  }
}
