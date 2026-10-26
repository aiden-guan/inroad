"use client";

import { useState } from "react";
import { cn } from "@/lib/client/cn";
import { FORMATS, listItems, weightedLength, type FormatSpec } from "@/lib/studio/formats";
import type { StudioFormatId } from "@/lib/domain/types";

/**
 * See it where it runs. Each preview renders the option the way its reader meets it: the feed cut
 * at "…see more", the image with the platform's safe zones shaded, the search result, the hero.
 * Approximations for judging fit and the first glance, not pixel copies of any platform.
 */
export function Preview({ format, parts, name }: { format: StudioFormatId; parts: Record<string, string>; name: string }) {
  const spec = FORMATS[format];
  switch (spec.preview) {
    case "feed":
      return <FeedPreview spec={spec} parts={parts} name={name} />;
    case "thread":
      return <ThreadPreview parts={parts} name={name} />;
    case "image":
      return <ImagePreview spec={spec} parts={parts} />;
    case "search":
      return <SearchPreview parts={parts} name={name} />;
    case "hero":
      return <HeroPreview parts={parts} />;
    case "line":
      return (
        <div className="rounded-md bg-primary px-6 py-10 text-center">
          <p className="font-serif text-[28px] leading-[34px] tracking-[-0.02em] text-primary-fg">{parts.line || "…"}</p>
          {parts.sign && <p className="mt-3 text-[13px] font-medium text-primary-fg/70">{parts.sign}</p>}
        </div>
      );
    default:
      return <DocPreview spec={spec} parts={parts} />;
  }
}

function Avatar({ name }: { name: string }) {
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-[13px] font-medium text-fg-2 ring-1 ring-border">{(name.trim()[0] ?? "Y").toUpperCase()}</span>;
}

function FeedPreview({ spec, parts, name }: { spec: FormatSpec; parts: Record<string, string>; name: string }) {
  const [open, setOpen] = useState(false);
  const hookPart = spec.parts.find((p) => p.fold) ?? spec.parts[0];
  const text = spec.parts
    .filter((p) => p.role !== "meta" && p.role !== "visual")
    .map((p) => parts[p.key])
    .filter(Boolean)
    .join("\n\n");
  const fold = hookPart.fold?.chars ?? 140;
  const cut = !open && text.length > fold;
  return (
    <div className="rounded-md bg-surface p-4 ring-1 ring-border">
      <div className="flex items-center gap-2.5">
        <Avatar name={name} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-fg">{name}</p>
          <p className="text-[11.5px] text-fg-3">{spec.id === "linkedin_post" ? "now" : "Sponsored"}</p>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-[14px] leading-[21px] text-fg">
        {cut ? text.slice(0, fold).trimEnd() : text}
        {cut && (
          <button onClick={() => setOpen(true)} className="text-fg-3 hover:text-fg-2 hover:underline">
            …see more
          </button>
        )}
      </p>
      {parts.headline && (
        <div className="mt-3 rounded-sm bg-bg-subtle px-3 py-2 ring-1 ring-border">
          <p className="text-[13px] font-semibold text-fg">{parts.headline}</p>
          {parts.description && <p className="text-[12px] text-fg-3">{parts.description}</p>}
        </div>
      )}
      {hookPart.fold && (
        <p className="mt-2 font-mono text-[10.5px] text-fg-4">
          Cut at about {fold} characters, where the feed usually folds ({hookPart.fold.verified === "secondary" ? "observed, not documented" : "documented"}).
        </p>
      )}
    </div>
  );
}

function ThreadPreview({ parts, name }: { parts: Record<string, string>; name: string }) {
  const posts = listItems(FORMATS.x_post.parts[0], parts.posts ?? "");
  return (
    <ol className="space-y-2">
      {posts.map((p, i) => {
        const n = weightedLength(p);
        return (
          <li key={i} className="flex gap-2.5 rounded-md bg-surface p-3 ring-1 ring-border">
            <Avatar name={name} />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-[14px] leading-[20px] text-fg">{p}</p>
              <p className={cn("mt-1 text-right font-mono text-[10.5px] tnum", n > 280 ? "text-danger" : "text-fg-4")}>
                {n}/280{posts.length > 1 ? ` · ${i + 1}/${posts.length}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ImagePreview({ spec, parts }: { spec: FormatSpec; parts: Record<string, string> }) {
  const aspects = spec.aspects ?? [];
  const [i, setI] = useState(0);
  const a = aspects[i] ?? { label: "1:1", w: 1, h: 1 };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {aspects.map((x, k) => (
          <button
            key={x.label}
            onClick={() => setI(k)}
            className={cn("h-6 rounded-xs px-2 text-[11.5px] ring-1 transition-colors", k === i ? "bg-surface text-fg ring-border-strong" : "text-fg-3 ring-border hover:text-fg-2")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="mx-auto w-full max-w-[320px]">
        <div className="relative w-full overflow-hidden rounded-md bg-sunken ring-1 ring-border" style={{ aspectRatio: `${a.w} / ${a.h}` }}>
          {"safe" in a && a.safe && (
            <>
              <div className="absolute inset-x-0 top-0 bg-danger-subtle/70" style={{ height: `${a.safe.top * 100}%` }} />
              <div className="absolute inset-x-0 bottom-0 bg-danger-subtle/70" style={{ height: `${a.safe.bottom * 100}%` }} />
              <div className="absolute inset-y-0 left-0 bg-danger-subtle/70" style={{ width: `${a.safe.side * 100}%` }} />
              <div className="absolute inset-y-0 right-0 bg-danger-subtle/70" style={{ width: `${a.safe.side * 100}%` }} />
            </>
          )}
          <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 px-2 text-center text-[11px] italic leading-4 text-fg-4">{parts.visual}</p>
          <div className="absolute inset-x-0 top-[16%] px-[9%] text-center">
            <p className="font-serif text-[22px] font-medium leading-[26px] tracking-[-0.01em] text-fg">{parts.headline}</p>
            {parts.support && <p className="mt-1.5 text-[12px] leading-4 text-fg-2">{parts.support}</p>}
          </div>
          {parts.cta && (
            <span className="absolute bottom-[38%] left-1/2 -translate-x-1/2 rounded-sm bg-primary px-3 py-1 text-[11px] font-medium text-primary-fg">{parts.cta}</span>
          )}
        </div>
        {a.note && <p className="mt-1.5 text-center text-[11px] text-fg-3">{a.note}</p>}
      </div>
    </div>
  );
}

function SearchPreview({ parts, name }: { parts: Record<string, string>; name: string }) {
  const heads = (parts.headlines ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const descs = (parts.descriptions ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const host = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "yoursite"}.com`;
  return (
    <div className="space-y-3">
      {[0, 1].map((k) => (
        <div key={k} className="rounded-md bg-surface p-3 ring-1 ring-border">
          <p className="text-[11.5px] text-fg-2">
            <span className="font-semibold">Sponsored</span> · {host}
            {parts.path ? `/${parts.path}` : ""}
          </p>
          <p className="mt-0.5 text-[16px] leading-[22px] text-accent-text">{[heads[k], heads[k + 2], heads[k + 4]].filter(Boolean).join(" | ") || "…"}</p>
          <p className="mt-0.5 text-[13px] leading-[19px] text-fg-2">{[descs[k], descs[k + 1]].filter(Boolean).join(" ")}</p>
        </div>
      ))}
      <p className="font-mono text-[10.5px] text-fg-4">Google mixes headlines and descriptions in any order; two sample combinations.</p>
    </div>
  );
}

function HeroPreview({ parts }: { parts: Record<string, string> }) {
  return (
    <div className="rounded-md bg-surface px-6 py-10 text-center ring-1 ring-border">
      <p className="mx-auto max-w-[22ch] font-serif text-[30px] leading-[34px] tracking-[-0.02em] text-fg">{parts.headline}</p>
      <p className="mx-auto mt-3 max-w-[48ch] text-[14.5px] leading-[22px] text-fg-2">{parts.subhead}</p>
      {parts.cta && <span className="mt-5 inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-fg">{parts.cta}</span>}
      {(parts.proof || parts.share) && <p className="mt-4 text-[12.5px] text-fg-3">{parts.proof || parts.share}</p>}
    </div>
  );
}

function DocPreview({ spec, parts }: { spec: FormatSpec; parts: Record<string, string> }) {
  return (
    <div className="space-y-3 rounded-md bg-surface p-4 ring-1 ring-border">
      {spec.parts
        .filter((p) => parts[p.key])
        .map((p) => (
          <div key={p.key}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">{p.label}</p>
            <p className={cn("mt-0.5 whitespace-pre-wrap text-fg", p.role === "hook" || p.role === "title" ? "font-serif text-[18px] leading-[24px]" : "text-[14px] leading-[21px]")}>{parts[p.key]}</p>
          </div>
        ))}
    </div>
  );
}
