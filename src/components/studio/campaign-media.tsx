"use client";

import Image from "next/image";
import { ArrowUpRight, ImageOff, Play } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/client/cn";
import {
  campaignMedia,
  mediaOriginal,
  mediaPoster,
  type CampaignMedia,
} from "@/lib/studio/campaign-media";

/** A direct publisher asset: no image proxy, scraping, or connection to a founder's private material. */
function PreviewImage({
  media,
  className,
}: {
  media: CampaignMedia;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-2 px-4 text-center text-[12px] text-fg-3">
      <ImageOff aria-hidden className="size-5" />
      Preview unavailable
    </span>
  ) : (
    <Image
      unoptimized
      fill
      src={mediaPoster(media)}
      alt={media.alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("object-contain", className)}
      sizes="(max-width: 640px) 100vw, 600px"
    />
  );
}

export function CampaignPreview({
  id,
  brand,
  onOpen,
}: {
  id: string;
  brand: string;
  onOpen: () => void;
}) {
  const media = campaignMedia(id)[0];
  if (!media) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Preview ${brand} campaign creative`}
      className="group relative mb-4 block aspect-video w-full overflow-hidden rounded-md bg-bg-subtle ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <PreviewImage media={media} />
      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded bg-surface-raised/95 px-2 py-1 text-[11px] font-medium text-fg shadow-sm">
        {media.kind !== "image" && <Play aria-hidden className="size-3" />}{" "}
        {media.kind === "image" ? "View creative" : "Watch campaign"}
        {campaignMedia(id).length > 1 && (
          <span className="text-fg-3">
            · {campaignMedia(id).length} examples
          </span>
        )}
      </span>
    </button>
  );
}

function MediaStage({ media }: { media: CampaignMedia }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-bg-subtle ring-1 ring-border">
      {playing && media.kind === "youtube" ? (
        <iframe
          title={media.title}
          src={`https://www.youtube-nocookie.com/embed/${media.videoId}?autoplay=1&rel=0`}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : playing && media.kind === "video" && !failed ? (
        <video
          controls
          autoPlay
          playsInline
          preload="none"
          poster={media.poster}
          aria-label={media.title}
          className="absolute inset-0 size-full"
          onError={() => setFailed(true)}
        >
          <source src={media.src} type="video/mp4" />
        </video>
      ) : (
        <>
          <PreviewImage media={media} />
          {media.kind !== "image" && !failed && (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={`Play ${media.title}`}
              className="absolute inset-0 flex items-center justify-center bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
            >
              <span className="inline-flex items-center gap-2 rounded-full bg-surface-raised px-5 py-3 text-[13px] font-semibold text-fg shadow-lg">
                <Play aria-hidden className="size-4" /> Play video
              </span>
            </button>
          )}
          {failed && (
            <p
              role="status"
              className="absolute inset-x-0 bottom-0 bg-surface-raised p-3 text-center text-[12px] text-fg-2"
            >
              This video could not load. Open the original to watch it.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function CampaignMediaGallery({ id }: { id: string }) {
  const items = campaignMedia(id);
  const [index, setIndex] = useState(0);
  const media = items[index] ?? items[0];
  if (!media)
    return (
      <p className="mb-5 rounded-md bg-bg-subtle p-3 text-[12px] leading-5 text-fg-2">
        Research record. No original campaign creative has been verified for
        this entry.
      </p>
    );
  return (
    <section aria-label="Original campaign creative" className="mb-6">
      <MediaStage key={mediaOriginal(media)} media={media} />
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
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3 text-[12px] leading-5">
        <div className="min-w-0">
          <p className="font-semibold text-fg">{media.title}</p>
          <a
            href={media.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-fg-3 underline underline-offset-4"
          >
            {media.credit}
          </a>
        </div>
        <a
          href={mediaOriginal(media)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-accent-text underline underline-offset-4"
        >
          Open original <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </div>
    </section>
  );
}
