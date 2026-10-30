import { startPosthog, posthogConnection, cancelPosthogConnection } from "@/lib/metrics/posthog-connect";
import { errorResponse } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const result = await startPosthog(new URL(request.url).origin);
    return result.ok ? Response.json(result.value, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: result.error.message }, { status: 400 });
  } catch { return Response.json({ error: "Couldn't open PostHog sign-in. Try again." }, { status: 502 }); }
}
export async function GET(request: Request) {
  try {
    const flow = posthogConnection(new URL(request.url).searchParams.get("flowId") ?? "");
    return flow ? Response.json(flow, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Sign-in expired. Connect again." }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("flowId");
  if (id) cancelPosthogConnection(id);
  return Response.json({ ok: true });
}
