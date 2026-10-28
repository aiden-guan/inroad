"use client";

import Image from "next/image";
import { ArrowUpRight, Play } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/client/cn";
import {
  campaignMedia,
  mediaOriginal,
  mediaPreviewUrl,
  type CampaignMedia,
} from "@/lib/studio/campaign-media";
import { YouTubePlayer } from "./youtube-player";

function PreviewImage({
  id,
  index = 0,
  media,
  cover = false,
  fallback,
}: {
  id: string;
  index?: number;
  media: CampaignMedia;
  cover?: boolean;
  fallback: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="absolute inset-0 flex flex-col justify-end bg-bg-subtle p-5 text-left">
      <p className="font-serif text-[25px] leading-8 text-fg">{fallback}</p>
      <p className="mt-2 text-[11px] leading-4 text-fg-3">
        Publisher preview unavailable. The full study is available below.
      </p>
    </div>
  ) : (
    <Image
      unoptimized
      fill
      src={mediaPreviewUrl(id, index)}
      alt={media.alt}
      className={cover ? "object-cover" : "object-contain"}
      sizes="(max-width: 640px) 100vw, 600px"
      onError={() => setFailed(true)}
    />
  );
}

export function CampaignPreview({
  id,
  brand,
  title,
  onOpen,
}: {
  id: string;
  brand: string;
  title?: string;
  onOpen: () => void;
}) {
  const media = campaignMedia(id)[0];
  if (!media) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Preview ${brand} campaign creative`}
      className="group relative block aspect-[16/9] w-full overflow-hidden rounded-t-lg bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
    >
      <PreviewImage id={id} media={media} cover fallback={title ?? brand} />
      <span className="absolute right-3 top-3 rounded-full bg-surface-raised/95 px-2.5 py-1 text-[10px] font-medium tracking-wide text-fg shadow-sm">
        {media.kind === "youtube" ? "Film study" : "Original creative"}
      </span>
    </button>
  );
}

function MediaStage({
  id,
  index,
  media,
}: {
  id: string;
  index: number;
  media: CampaignMedia;
}) {
  const [state, setState] = useState<
    "idle" | "checking" | "playing" | "unavailable" | "unknown"
  >("idle");
  const onUnavailable = useCallback(() => setState("unavailable"), []);
  const play = async () => {
    setState("checking");
    try {
      const response = await fetch(
        `${mediaPreviewUrl(id, index)}?check=video`,
        { signal: AbortSignal.timeout(7000) },
      );
      const body = response.ok ? await response.json() : null;
      setState(
        body?.status === "available"
          ? "playing"
          : body?.status === "unavailable"
            ? "unavailable"
            : "unknown",
      );
    } catch {
      setState("unknown");
    }
  };
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-bg-subtle ring-1 ring-border">
      <PreviewImage
        id={id}
        index={index}
        media={media}
        fallback={media.title}
      />
      {state === "playing" && media.kind === "youtube" ? (
        <YouTubePlayer
          videoId={media.videoId}
          title={media.title}
          onUnavailable={onUnavailable}
        />
      ) : media.kind === "youtube" &&
        (state === "idle" || state === "checking") ? (
        <button
          type="button"
          disabled={state === "checking"}
          onClick={() => void play()}
          aria-label={`Play ${media.title}`}
          className="absolute inset-0 flex items-center justify-center bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-raised px-5 py-3 text-[13px] font-semibold text-fg shadow-lg">
            <Play aria-hidden className="size-4" />
            {state === "checking"
              ? "Checking availability…"
              : "Play original film"}
          </span>
        </button>
      ) : null}
      {(state === "unavailable" || state === "unknown") && (
        <div
          role="status"
          className="absolute inset-x-0 bottom-0 border-t border-border bg-surface-raised/95 px-4 py-3 text-[12px] leading-5 text-fg-2"
        >
          {state === "unavailable"
            ? "The publisher is not allowing playback here. The study and original source remain available."
            : "Playback could not be verified on this connection. You can still read the study or open the publisher's source."}
          <button
            type="button"
            onClick={() => void play()}
            className="ml-2 text-accent-text underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function CampaignMediaGallery({ id }: { id: string }) {
  const items = campaignMedia(id);
  const [index, setIndex] = useState(0);
  const media = items[index] ?? items[0];
  if (!media) return null;
  return (
    <section aria-label="Original campaign creative">
      <MediaStage
        key={mediaOriginal(media)}
        id={id}
        index={index}
        media={media}
      />
      {items.length > 1 && (
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label="Choose a creative example"
        >
          {items.map((item, i) => (
            <button
              type="button"
              key={mediaOriginal(item)}
              aria-pressed={index === i}
              onClick={() => setIndex(i)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-left text-[12px] ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                i === index
                  ? "bg-accent/10 text-accent-text ring-accent/40"
                  : "text-fg-2 hover:bg-bg-subtle",
              )}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-2 text-[11px] leading-4">
        <a
          href={media.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 text-fg-3 underline underline-offset-4"
        >
          {media.credit}
        </a>
        <a
          href={mediaOriginal(media)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-accent-text underline underline-offset-4"
        >
          Open original <ArrowUpRight aria-hidden className="size-3" />
        </a>
      </div>
    </section>
  );
}
