import { connection } from "next/server";
import { z } from "zod";
import { isLocalRequest, LOCAL_ONLY } from "@/lib/api-keys/auth";
import { createKey, listKeys } from "@/lib/api-keys/store";
import { ACCESS, CLIENTS, KEY_EFFORTS, KEY_MODELS, type CreateKeyResponse, type KeyEffort, type KeysResponse } from "@/lib/api-keys/types";
import type { ModelTier } from "@/lib/ai/models";
import { errorResponse, readJSON } from "@/lib/server/http";

/** The founder's agent keys and their activity. Local requests only: keys are never managed over a tunnel. */
export async function GET(request: Request) {
  await connection();
  if (!isLocalRequest(request)) return Response.json({ error: LOCAL_ONLY }, { status: 403 });
  try {
    const body: KeysResponse = listKeys();
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.object({
  name: z.string().trim().min(1).max(40),
  client: z.enum(CLIENTS.map((c) => c.id) as [string, ...string[]]),
  access: z.enum(ACCESS.map((a) => a.id) as [string, ...string[]]),
  model: z.enum(KEY_MODELS.map((m) => m.id) as [ModelTier, ...ModelTier[]]).optional(),
  effort: z.enum(KEY_EFFORTS.map((e) => e.id) as [KeyEffort, ...KeyEffort[]]).optional(),
});

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ error: LOCAL_ONLY }, { status: 403 });
  try {
    const body = Body.parse(await readJSON(request));
    const access = ACCESS.find((a) => a.id === body.access)!;
    const created = await createKey({ name: body.name, client: body.client as CreateKeyResponse["key"]["client"], scopes: access.scopes, model: body.model, effort: body.effort });
    const res: CreateKeyResponse = created;
    return Response.json(res, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
