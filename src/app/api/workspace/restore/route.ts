import { restoreWorkspace } from "@/lib/sample/store";
import { errorResponse } from "@/lib/server/http";
import { BackupError, parseBackup, readSnapshot } from "@/lib/store/backup";
import { publicWorkspace } from "@/lib/store/workspace";

// Far above any real workspace; a bigger body is the wrong file.
const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Restores a backup over the current workspace, after backing the current one up.
 *  - `?backup=<name>`: one of the automatic backups (GET /api/workspace/backups).
 *  - Otherwise the body is the file itself: a downloaded backup (JSON, or gzipped) or an older
 *    workspace-only export.
 */
export async function POST(request: Request) {
  try {
    const name = new URL(request.url).searchParams.get("backup");
    let bundle;
    if (name) bundle = readSnapshot(name);
    else {
      const size = Number(request.headers.get("content-length") ?? 0);
      if (size > MAX_BYTES) return Response.json({ error: "That file is too big to be an Inroad backup." }, { status: 413 });
      const body = new Uint8Array(await request.arrayBuffer());
      if (!body.byteLength) return Response.json({ error: "Choose a backup file first." }, { status: 400 });
      if (body.byteLength > MAX_BYTES) return Response.json({ error: "That file is too big to be an Inroad backup." }, { status: 413 });
      bundle = parseBackup(body);
    }
    const { ws, backup, files } = await restoreWorkspace(bundle);
    return Response.json({ workspace: publicWorkspace(ws), restored: { createdAt: bundle.createdAt, files, legacy: bundle.legacy === true }, backup }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof BackupError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
