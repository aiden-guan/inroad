import { restoreWorkspace } from "@/lib/sample/store";
import { BODY_LIMIT_BYTES, bodyCutShort, errorResponse } from "@/lib/server/http";
import { BackupError, parseBackup, readSnapshot } from "@/lib/store/backup";
import { publicWorkspace } from "@/lib/store/workspace";

/**
 * Only the first 10 MB of an upload gets through Next's proxy (BODY_LIMIT_BYTES). Settings gzips a file
 * before sending it (a backup shrinks about tenfold), so this is a backup of 60 MB or more.
 */
const TOO_BIG_BACKUP =
  "That backup is over 10 MB even compressed, more than Inroad can take in one upload. To move a workspace that big, copy the whole data folder instead (Settings → Data says where it is).";

/**
 * Restores a backup over the current workspace, after backing the current one up.
 *  - `?backup=<name>`: one of the automatic backups (GET /api/workspace/backups).
 *  - Otherwise the body is the file itself: a downloaded backup (JSON, or gzipped, as Settings sends it)
 *    or an older workspace-only export.
 */
export async function POST(request: Request) {
  try {
    const name = new URL(request.url).searchParams.get("backup");
    let bundle;
    if (name) bundle = readSnapshot(name);
    else {
      const size = Number(request.headers.get("content-length") ?? 0);
      if (size > BODY_LIMIT_BYTES) return Response.json({ error: TOO_BIG_BACKUP }, { status: 413 });
      const body = new Uint8Array(await request.arrayBuffer());
      // Settings always sends a length. A stream sent without one and cut short reads as a damaged file.
      if (bodyCutShort(request, body.byteLength)) return Response.json({ error: TOO_BIG_BACKUP }, { status: 413 });
      if (!body.byteLength) return Response.json({ error: "Choose a backup file first." }, { status: 400 });
      bundle = parseBackup(body);
    }
    const { ws, backup, files, keptSuppressions } = await restoreWorkspace(bundle);
    return Response.json(
      { workspace: publicWorkspace(ws), restored: { createdAt: bundle.createdAt, files, legacy: bundle.legacy === true, keptSuppressions }, backup },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BackupError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
