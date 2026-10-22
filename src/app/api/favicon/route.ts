import { connection } from "next/server";
import { companyIcon, iconsAllowed } from "@/lib/signals/icons";
import { toDomain } from "@/lib/signals/http";

/**
 * GET /api/favicon?domain=acme.com: a company's icon, fetched from its own site and cached on this
 * computer (src/lib/signals/icons.ts). 204 when icons are off for that domain or it has none, and the
 * UI keeps the first letter (an image with no body fails quietly; a 404 would log a console error).
 * Served with no-sniff and a sandbox CSP, as an image and nothing else.
 */
export async function GET(request: Request) {
  await connection();
  const domain = toDomain(new URL(request.url).searchParams.get("domain") ?? "");
  const none = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  if (!domain || domain.length > 253) return none(400);
  if (!iconsAllowed(domain)) return none(204);
  const icon = await companyIcon(domain);
  if (!icon) return none(204);
  return new Response(new Uint8Array(icon.bytes), {
    headers: {
      "Content-Type": icon.type,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
