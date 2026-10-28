import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { campaignMedia, mediaPoster } from "./campaign-media";
import { imageInfo } from "./files";
import { DATA_DIR } from "@/lib/store/settings";
import { writeFileAtomic } from "@/lib/store/data-file";

const MAX_BYTES = 8 * 1024 * 1024;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
interface Poster {
  bytes: Buffer;
  mime: string;
}

/** Reject HTML, tracking pixels and YouTube's HTTP-200 unavailable-video thumbnail. */
export function campaignImageInfo(
  bytes: Buffer,
): { mime: string; width: number; height: number } | null {
  const common = imageInfo(bytes);
  if (common) return common;
  if (
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X")
      return {
        mime: "image/webp",
        width: bytes.readUIntLE(24, 3) + 1,
        height: bytes.readUIntLE(27, 3) + 1,
      };
    if (
      chunk === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    )
      return {
        mime: "image/webp",
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return {
        mime: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6)))
    return {
      mime: "image/gif",
      width: bytes.readUInt16LE(6),
      height: bytes.readUInt16LE(8),
    };
  if (
    bytes.length > 24 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /avif|avis/.test(bytes.toString("ascii", 8, 24))
  ) {
    const ispe = bytes.indexOf(Buffer.from("ispe"));
    if (ispe > 0 && ispe + 16 <= bytes.length)
      return {
        mime: "image/avif",
        width: bytes.readUInt32BE(ispe + 8),
        height: bytes.readUInt32BE(ispe + 12),
      };
  }
  return null;
}

function validate(bytes: Buffer): Poster | null {
  if (bytes.length > MAX_BYTES) return null;
  try {
    const info = campaignImageInfo(bytes);
    return info &&
      info.width >= 240 &&
      info.height >= 120 &&
      info.width <= 12000 &&
      info.height <= 12000 &&
      info.width * info.height <= 64_000_000
      ? { bytes, mime: info.mime }
      : null;
  } catch {
    return null;
  }
}

const pending = new Map<string, Promise<Poster | null>>();
const retryAfter = new Map<string, number>();

/** Only an asset in the curated registry can be fetched. Successful copies survive a publisher outage. */
export async function campaignPoster(
  id: string,
  index: number,
): Promise<Poster | null> {
  const media = campaignMedia(id)[index];
  if (!media) return null;
  if (media.preview) {
    try {
      const bundled = validate(
        fs.readFileSync(path.join(process.cwd(), "public", media.preview)),
      );
      if (bundled) return bundled;
    } catch {
      /* A missing bundle can still use the publisher and last-good cache below. */
    }
  }
  const url = mediaPoster(media);
  if (!url.startsWith("https://")) return null;
  const key = createHash("sha256").update(url).digest("hex");
  const file = path.join(DATA_DIR, "cache", "campaign-media", `${key}.image`);
  let cached: Poster | null = null;
  let fresh = false;
  try {
    cached = validate(fs.readFileSync(file));
    fresh = Date.now() - fs.statSync(file).mtimeMs < FRESH_MS;
  } catch {
    /* first view */
  }
  if (cached && fresh) return cached;
  if ((retryAfter.get(key) ?? 0) > Date.now()) return cached;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
        headers: {
          Accept: "image/webp,image/png,image/jpeg,image/gif,image/avif",
          "User-Agent": "Inroad campaign reference viewer",
        },
      });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("image/") ||
        Number(response.headers.get("content-length")) > MAX_BYTES ||
        !response.body
      ) {
        await response.body?.cancel();
        return cached;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            return cached;
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const poster = validate(Buffer.concat(chunks));
      if (!poster) return cached;
      try {
        writeFileAtomic(file, poster.bytes);
      } catch {
        /* viewing can continue if the cache is read-only */
      }
      return poster;
    } catch {
      return cached;
    } finally {
      retryAfter.set(key, Date.now() + 60_000);
    }
  })();
  pending.set(key, task);
  void task.finally(() => pending.delete(key));
  return task;
}

export type VideoAvailability = "available" | "unavailable" | "unknown";
const videoChecks = new Map<
  string,
  { status: VideoAvailability; until: number }
>();

/** A public oEmbed response is required before offering an embedded player. Network failure is not removal. */
export async function campaignVideoAvailability(
  id: string,
  index: number,
): Promise<VideoAvailability> {
  const media = campaignMedia(id)[index];
  if (!media || media.kind !== "youtube") return "unavailable";
  const previous = videoChecks.get(media.videoId);
  if (previous && previous.until > Date.now()) return previous.status;
  let status: VideoAvailability = "unknown";
  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set(
      "url",
      `https://www.youtube.com/watch?v=${media.videoId}`,
    );
    endpoint.searchParams.set("format", "json");
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if ([401, 404].includes(res.status)) status = "unavailable";
    else if (res.ok && res.headers.get("content-type")?.includes("json")) {
      const data = await res.json();
      if (
        data?.type === "video" &&
        typeof data?.title === "string" &&
        data?.provider_name === "YouTube"
      )
        status = "available";
    }
  } catch {
    /* don't promise playback when it cannot be verified */
  }
  videoChecks.set(media.videoId, {
    status,
    until: Date.now() + (status === "available" ? 6 * 60 * 60_000 : 15_000),
  });
  return status;
}

export function resetCampaignMediaChecks() {
  retryAfter.clear();
  videoChecks.clear();
  pending.clear();
}
