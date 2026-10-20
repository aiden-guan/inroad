import { connection } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { toDomain } from "@/lib/signals/http";
import { shortBatch, ycByDomain, ycDirectory, ycUrl, type YcCompany } from "@/lib/signals/yc";
import { readWorkspace } from "@/lib/store/workspace";
import { siteBasics } from "@/lib/workflows/enrich";

/**
 * GET /api/companies/lookup?domain=acme.com
 * A free preview for "Add company": name and one-liner from the YC directory or the homepage,
 * whether the site is reachable, and whether it's already in the workspace. No model calls.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const raw = new URL(request.url).searchParams.get("domain") ?? "";
    const domain = raw.length <= 200 ? toDomain(raw) : null;
    if (!domain) return Response.json({ error: "That doesn't look like a website. Try something like acme.com." }, { status: 400 });

    const existing = readWorkspace().accounts[domain];
    // The directory is a 10 MB download the first time; don't hold the preview hostage to it.
    const dir = await Promise.race([ycDirectory(), new Promise<YcCompany[]>((resolve) => setTimeout(() => resolve([]), 4000))]);
    const yc = ycByDomain(dir, domain);
    const basics = await siteBasics(domain);

    return Response.json(
      {
        domain,
        reachable: Boolean(basics),
        name: yc?.name ?? basics?.name ?? null,
        oneLiner: yc?.oneLiner || basics?.description || null,
        yc: yc ? { batch: shortBatch(yc.batch), teamSize: yc.teamSize, url: ycUrl(yc), location: yc.locations.split(";")[0] || null } : null,
        existing: existing ? { name: existing.name, status: existing.status } : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
