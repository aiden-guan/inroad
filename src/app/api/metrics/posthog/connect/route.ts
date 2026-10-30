import { z } from "zod";
import { posthogWithKey, selectPosthogProject } from "@/lib/metrics/posthog-connect";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.union([
  z.object({ key: z.string().trim().min(8).max(4000) }),
  z.object({ flowId: z.string().min(20).max(200), projectId: z.string().regex(/^\d+$/), region: z.enum(["us", "eu"]) }),
]);
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const result = "key" in body ? await posthogWithKey(body.key) : await selectPosthogProject(body.flowId, body.projectId, body.region);
    return result.ok ? Response.json(result.value, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: result.error.message }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
