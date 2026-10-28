import { connection } from "next/server";
import { campaignMedia } from "@/lib/studio/campaign-media";
import {
  campaignPoster,
  campaignVideoAvailability,
} from "@/lib/studio/campaign-media-cache";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; index: string }> },
) {
  await connection();
  const { id, index: rawIndex } = await context.params;
  if (!/^\d{1,2}$/.test(rawIndex)) return new Response(null, { status: 404 });
  const index = Number(rawIndex);
  if (!campaignMedia(id)[index]) return new Response(null, { status: 404 });
  if (new URL(request.url).searchParams.get("check") === "video")
    return Response.json(
      { status: await campaignVideoAvailability(id, index) },
      { headers: { "Cache-Control": "no-store" } },
    );
  const poster = await campaignPoster(id, index);
  if (!poster)
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(new Uint8Array(poster.bytes), {
    headers: {
      "Content-Type": poster.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
