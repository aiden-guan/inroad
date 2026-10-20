import { isLocalRequest, LOCAL_ONLY } from "@/lib/api-keys/auth";
import { revokeKey } from "@/lib/api-keys/store";
import { errorResponse } from "@/lib/server/http";

/** Revokes an agent key. Calls using it fail from the next request on. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(request)) return Response.json({ error: LOCAL_ONLY }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const ok = await revokeKey(id);
    if (!ok) return Response.json({ error: "That key doesn't exist or was already revoked." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
