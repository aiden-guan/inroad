import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, readJSON } from "@/lib/server/http";
import { sourceUpdateStatus, startSourceUpdate } from "@/lib/server/updates";
import { snapshotBefore } from "@/lib/store/backup";

/**
 * GET: where this copy of Inroad stands on updates (a git checkout; the Mac app asks its shell instead).
 * GET ?check=1 asks GitHub now.
 * POST: backs up the workspace, then has the launcher update and restart Inroad. It answers before the
 * server stops; the page then polls GET, which the launcher's "Updating" page answers until Inroad is back.
 * POST { "action": "backup" }: the backup alone, which the Mac app's shell takes before it restarts into a new version.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const check = new URL(request.url).searchParams.get("check") === "1";
    return Response.json(await sourceUpdateStatus({ check }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.object({ action: z.enum(["update", "backup"]).default("update") });

export async function POST(request: Request) {
  try {
    // An empty body is an update, so the app can POST with nothing in it.
    const { action } = Body.parse(request.headers.get("content-length") === "0" || !request.body ? {} : await readJSON(request));
    if (action === "backup") return Response.json({ ok: true, backup: snapshotBefore("before_update") });
    const r = await startSourceUpdate();
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json(r, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
