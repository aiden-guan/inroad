import { connection } from "next/server";
import { z } from "zod";
import { baseUrl } from "@/lib/api-keys/auth";
import { buildExport, coldCapLeft, exportSequencer, sequencerCandidates } from "@/lib/network/export";
import { errorResponse, readJSON } from "@/lib/server/http";
import { readWorkspace } from "@/lib/store/workspace";

const csvResponse = (csv: string, fileName: string, rows: number, extra: Record<string, string> = {}) =>
  new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "x-rows": String(rows),
      ...extra,
    },
  });

/**
 * GET ?kind=accounts|people|deals → a CSV download.
 * GET ?kind=sequencer → the drafts that could go to a sequencer (JSON) and the cold first touches the cap leaves, for the founder to pick.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind === "sequencer") {
      const ws = readWorkspace();
      const drafts = sequencerCandidates(ws).map((p) => {
        const person = p.personId ? ws.people[p.personId] : undefined;
        return {
          id: p.id,
          person: person?.name ?? "",
          title: person?.title ?? "",
          company: ws.accounts[p.accountDomain]?.name ?? p.accountDomain,
          domain: p.accountDomain,
          subject: p.steps[0]?.subject ?? null,
          steps: p.steps.length,
          mode: p.mode,
          createdAt: p.createdAt,
        };
      });
      return Response.json({ drafts, capLeft: coldCapLeft(ws) }, { headers: { "cache-control": "no-store" } });
    }
    const k = z.enum(["accounts", "people", "deals"]).parse(kind);
    const { csv, fileName, rows } = buildExport(k, baseUrl(request));
    return csvResponse(csv, fileName, rows);
  } catch (err) {
    return errorResponse(err);
  }
}

/** The founder's chosen drafts as a sequencer CSV (Instantly, Smartlead, lemlist column names), within the cold cap. Exporting is the approval. */
export async function POST(request: Request) {
  try {
    const { packageIds } = z.object({ packageIds: z.array(z.string().max(64)).min(1).max(500) }).parse(await readJSON(request));
    const { csv, fileName, rows, skipped } = await exportSequencer(packageIds);
    if (!rows && skipped) {
      return Response.json({ error: "You've used your cold first touches for today (or this week). More open tomorrow, or Monday for the weekly cap." }, { status: 409 });
    }
    if (!rows) return Response.json({ error: "None of those drafts are ready anymore. Refresh and try again." }, { status: 409 });
    return csvResponse(csv, fileName, rows, { "x-skipped": String(skipped) });
  } catch (err) {
    return errorResponse(err);
  }
}
