import { connection } from "next/server";
import { searchInfo, searchMode } from "@/lib/columns/answer";
import { liveJobs } from "@/lib/columns/jobs";
import { ColumnsOpError } from "@/lib/columns/ops";
import { parseOps } from "@/lib/columns/schema";
import { applyOps, readColumns } from "@/lib/columns/store";
import type { ColumnsData, ColumnsResponse } from "@/lib/columns/types";
import { todayISO } from "@/lib/domain/ids";
import { errorResponse, readJSON } from "@/lib/server/http";
import { readSettings } from "@/lib/store/settings";

/**
 * Research columns on the Companies table: the questions, their answers, saved views, and the runs filling
 * columns right now (so cells can show a running state). POST applies the same ops the browser applied
 * optimistically (src/lib/columns/ops.ts) and returns the new state.
 */

function respond(data: ColumnsData): Response {
  const settings = readSettings();
  let search: ColumnsResponse["search"];
  try {
    search = searchInfo(searchMode(), { dailyLimit: settings.search?.dailyLimit, used: settings.researchRequests?.[todayISO()] });
  } catch {
    search = { provider: null, limit: settings.search?.dailyLimit ?? 100, used: 0 };
  }
  const body: ColumnsResponse = { ...data, jobs: liveJobs(), search };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  await connection();
  try {
    return respond(readColumns());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ops = parseOps(await readJSON(request));
    return respond(await applyOps(ops));
  } catch (err) {
    if (err instanceof ColumnsOpError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
