import { finishPosthog } from "@/lib/metrics/posthog-connect";

/** Outside /api: a cross-site OAuth navigation is expected here. One-time state + PKCE authorize it. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? undefined;
  const result = state.length <= 200 && (!code || code.length <= 4000) ? await finishPosthog(state, code, params.has("error")) : null;
  const title = result?.status === "done" ? "PostHog is connected" : result?.status === "choose" ? "You're signed in" : "Sign-in wasn't completed";
  const message = result?.status === "done" ? "Your metrics are ready in Inroad. You can close this tab." : result?.status === "choose" ? "Return to Inroad to choose your project. You can close this tab." : "Return to Inroad to try again. You can close this tab.";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Inroad</title><style>body{font:16px/1.6 system-ui;background:#faf9f6;color:#24231f;max-width:32rem;margin:18vh auto;padding:24px}h1{font:36px Georgia}p{color:#64615a}</style></head><body><p>Inroad</p><h1>${title}</h1><p>${message}</p></body></html>`, { status: result ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
}
