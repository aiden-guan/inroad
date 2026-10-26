import { connection } from "next/server";
import { newId, nowISO } from "@/lib/domain/ids";
import type { StudioImage } from "@/lib/domain/types";
import { errorResponse } from "@/lib/server/http";
import { mutateWorkspace } from "@/lib/store/workspace";
import { imageInfo, saveStudioFile } from "@/lib/studio/files";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Upload a screenshot or photo for Studio graphics (multipart: file, alt?). PNG and JPEG only,
 * checked by their bytes, not their name. The file stays on this machine in .data/studio.
 */
export async function POST(request: Request) {
  await connection();
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return Response.json({ error: "Choose a PNG or JPEG to upload." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "That image is over 10 MB. Export a smaller one." }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    const info = imageInfo(buf);
    if (!info) return Response.json({ error: "That isn't a PNG or JPEG." }, { status: 415 });
    if (info.width < 64 || info.height < 64 || info.width > 8000 || info.height > 8000) {
      return Response.json({ error: `That image is ${info.width}×${info.height}. Use one between 64 and 8000 pixels on each side.` }, { status: 400 });
    }
    const id = newId("img");
    const image: StudioImage = {
      id,
      source: "upload",
      file: `${id}.${info.mime === "image/png" ? "png" : "jpg"}`,
      mime: info.mime,
      width: info.width,
      height: info.height,
      alt: String(form?.get("alt") ?? "")
        .trim()
        .slice(0, 200),
      createdAt: nowISO(),
    };
    saveStudioFile(image.file, buf);
    await mutateWorkspace((ws) => {
      ws.studio.images[id] = image;
    });
    return Response.json({ image });
  } catch (err) {
    return errorResponse(err);
  }
}
