"use client";

import { useState } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Company mark: the monogram is always there, and the site's favicon fades in over it once it
 * loads. Slow, offline or unknown domains keep the monogram instead of an empty box.
 */
export function Favicon({ domain, name, size = 20, className }: { domain: string; name?: string; size?: number; className?: string }) {
  // Keyed by domain so a reused component (lists, sheets) starts over when the domain changes.
  const [loaded, setLoaded] = useState<{ domain: string; ok: boolean } | null>(null);
  const status = loaded?.domain === domain ? (loaded.ok ? "ok" : "failed") : "loading";
  const letter = (name || domain || "?").replace(/^www\./, "").charAt(0).toUpperCase();
  // Google returns a 16px globe for unknown domains; treat that as missing.
  const settle = (img: HTMLImageElement) => setLoaded({ domain, ok: img.naturalWidth > 16 });

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-bg-subtle ring-1 ring-border", className)}
      style={{ width: size, height: size }}
    >
      <span aria-hidden className="font-semibold text-fg-3" style={{ fontSize: Math.max(9, Math.round(size * 0.5)) }}>
        {letter}
      </span>
      {domain && status !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          // An image that finished before hydration never fires onLoad; settle it on mount instead.
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0 && status === "loading") settle(el);
          }}
          onLoad={(e) => settle(e.currentTarget)}
          onError={() => setLoaded({ domain, ok: false })}
          className={cn(
            "absolute inset-0 size-full bg-surface object-contain p-[2px] transition-opacity duration-150 motion-reduce:transition-none",
            status === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </span>
  );
}
