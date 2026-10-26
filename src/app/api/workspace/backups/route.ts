import path from "node:path";
import { connection } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { BACKUP_DIR, BackupError, listBackups, readSnapshot } from "@/lib/store/backup";

/**
 * GET: the automatic backups in `<data>/backups`, newest first, and where they are.
 * GET ?name=…: what one of them holds (company and counts), for the restore confirmation.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const name = new URL(request.url).searchParams.get("name");
    if (name) {
      const bundle = readSnapshot(name);
      return Response.json({ name, createdAt: bundle.createdAt, summary: bundle.summary }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ dir: path.resolve(BACKUP_DIR()), backups: listBackups() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof BackupError) return Response.json({ error: err.message }, { status: 404 });
    return errorResponse(err);
  }
}
