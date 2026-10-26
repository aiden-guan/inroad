import { connection } from "next/server";
import { readWorkspace } from "@/lib/store/workspace";
import { isSafeName, readStudioFile } from "@/lib/studio/files";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml" };

/** A friendly download name: "ledgerline-linkedin-statement.png". */
function downloadName(name: string): string {
  const ws = readWorkspace();
  const v = Object.values(ws.studio.visuals).find((x) => x.pngFile === name || x.svgFile === name);
  const product = (ws.studio.profile?.productName || ws.company?.name || "graphic").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ext = name.split(".").pop();
  return v ? `${product || "graphic"}-${v.preset}-${v.layout}.${ext}` : name;
}

/**
 * Studio's images and graphics (local files in .data/studio). Names are code-generated and checked
 * against a strict pattern. SVGs are served with a sandboxing CSP so a browser opening one directly
 * can't run anything (the sanitizer already strips scripts; this is the second wall).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/studio/files/[name]">) {
  await connection();
  const { name } = await ctx.params;
  if (!isSafeName(name)) return Response.json({ error: "Not found." }, { status: 404 });
  const data = readStudioFile(name);
  if (!data) return Response.json({ error: "Not found." }, { status: 404 });
  const ext = name.split(".").pop() ?? "";
  const headers = new Headers({
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    // Names are never reused, so a file's bytes never change.
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  });
  if (new URL(request.url).searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename="${downloadName(name)}"`);
  return new Response(new Uint8Array(data), { headers });
}
