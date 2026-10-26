import { z } from "zod";
import { isLocalRequest, LOCAL_ONLY } from "@/lib/api-keys/auth";
import { revokeKey, updateKey } from "@/lib/api-keys/store";
import { KEY_EFFORTS, KEY_MODELS, type KeyEffort, type UpdateKeyResponse } from "@/lib/api-keys/types";
import type { ModelTier } from "@/lib/ai/models";
import { errorResponse, readJSON } from "@/lib/server/http";

const Patch = z.object({
  model: z.enum(KEY_MODELS.map((m) => m.id) as [ModelTier, ...ModelTier[]]).optional(),
  effort: z.enum(KEY_EFFORTS.map((e) => e.id) as [KeyEffort, ...KeyEffort[]]).optional(),
});

/** Sets the model and thinking level a key's ask_inroad calls run on. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(request)) return Response.json({ error: LOCAL_ONLY }, { status: 403 });
  try {
    const { id } = await ctx.params;
    const key = await updateKey(id, Patch.parse(await readJSON(request)));
    if (!key) return Response.json({ error: "That key doesn't exist or was revoked." }, { status: 404 });
    const res: UpdateKeyResponse = { key };
    return Response.json(res, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

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
