"use client";

import { Download, ImagePlus, Images, Paintbrush, Star, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useSettingsStatus } from "@/components/settings/use-settings";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { CopyButton, Segmented } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import type { StudioImage, StudioOption, StudioPiece, StudioVisual, VisualLayout, Workspace } from "@/lib/domain/types";
import { FORMATS } from "@/lib/studio/formats";
import { LAYOUTS, aspectLabel, presetById, presetsFor } from "@/lib/studio/visuals";

/**
 * Graphics for an option: Claude designs them around the option's approved words (SVG, rendered to
 * PNG on this machine), optionally over a real screenshot or a picture painted by OpenAI's GPT Image.
 * Without an OpenAI key, Claude writes the prompt to paste into ChatGPT instead.
 */

const fileUrl = (name: string, download = false) => `/api/studio/files/${name}${download ? "?download=1" : ""}`;

type Picture = "none" | "mine" | "paint";

async function uploadImage(file: File): Promise<{ image?: StudioImage; error?: string }> {
  const body = new FormData();
  body.set("file", file);
  try {
    const res = await fetch("/api/studio/images", { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { image?: StudioImage; error?: string };
    return res.ok ? { image: json.image } : { error: json.error ?? "That upload didn't work. Try again." };
  } catch {
    return { error: "Couldn't reach the app to upload. Is it still running?" };
  }
}

/** A hidden file input behind a button; refreshes the workspace and hands back the new image. */
function UploadButton({ onUploaded, children, className }: { onUploaded?: (image: StudioImage) => void; children: React.ReactNode; className?: string }) {
  const { refresh } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          const { image, error } = await uploadImage(file);
          setBusy(false);
          if (error || !image) {
            toast.error(error ?? "That upload didn't work.");
            return;
          }
          await refresh();
          onUploaded?.(image);
        }}
      />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={className}>
        {busy ? <span className="text-[11px] text-fg-3">Uploading…</span> : children}
      </button>
    </>
  );
}

function Thumb({ image, selected, onSelect }: { image: StudioImage; selected?: boolean; onSelect?: () => void }) {
  return (
    <Tooltip content={`${image.source === "openai" ? "Painted by OpenAI" : "Uploaded"} · ${image.width}×${image.height}${image.alt ? ` · ${image.alt}` : ""}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={image.alt || (image.source === "openai" ? "Painted image" : "Uploaded image")}
        className={cn(
          "relative size-14 shrink-0 overflow-hidden rounded-md bg-bg-subtle ring-1 transition-shadow duration-150",
          selected ? "ring-2 ring-accent" : "ring-border hover:ring-border-strong",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local files served by our own route */}
        <img src={fileUrl(image.file)} alt="" className="size-full object-cover" />
        {image.source === "openai" && <span className="absolute bottom-0.5 right-0.5 rounded-[3px] bg-black/60 px-1 font-mono text-[9px] text-white">AI</span>}
      </button>
    </Tooltip>
  );
}

export function VisualPanel({ ws, piece, option }: { ws: Workspace; piece: StudioPiece; option: StudioOption }) {
  const { runs, start } = useRuns();
  const { status } = useSettingsStatus();
  const presets = presetsFor(piece.format);
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "linkedin");
  const [picture, setPicture] = useState<Picture>("none");
  const [imageId, setImageId] = useState<string | null>(null);
  const [layout, setLayout] = useState<VisualLayout | "auto">("auto");
  const [direction, setDirection] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [promptRunId, setPromptRunId] = useState<string | null>(null);

  const images = useMemo(() => Object.values(ws.studio.images).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [ws.studio.images]);
  const visuals = useMemo(
    () =>
      Object.values(ws.studio.visuals)
        .filter((v) => v.optionId === option.id)
        .sort((a, b) => Number(!!b.kept) - Number(!!a.kept) || b.createdAt.localeCompare(a.createdAt)),
    [ws.studio.visuals, option.id],
  );
  const run = runId ? runs[runId] : undefined;
  const promptRun = promptRunId ? runs[promptRunId] : undefined;
  const running = run && (run.status === "running" || run.status === "queued");
  const writingPrompt = promptRun && (promptRun.status === "running" || promptRun.status === "queued");
  const hasOpenAI = !!status?.openai.hasKey;
  const chosen = imageId ? ws.studio.images[imageId] : undefined;

  const layouts = (Object.keys(LAYOUTS) as VisualLayout[]).filter((l) => {
    if (picture === "none") return !LAYOUTS[l].needsImage;
    // A painted picture is never shown as the product's screenshot.
    if (picture === "paint" || chosen?.source === "openai") return l === "photo";
    return !!LAYOUTS[l].needsImage;
  });
  const layoutValue = layout !== "auto" && layouts.includes(layout) ? layout : "auto";
  const cannot = picture === "mine" && !chosen ? "Pick or upload an image first." : picture === "paint" && !hasOpenAI ? "Add an OpenAI key, or use a ChatGPT prompt." : null;

  const design = async () => {
    const r = await start(
      "visual",
      {
        pieceId: piece.id,
        optionId: option.id,
        preset: presetId,
        layout: layoutValue,
        imageId: picture === "mine" ? imageId : undefined,
        generate: picture === "paint",
        variants: 2,
        direction: direction.trim() || undefined,
      },
      { notify: false, onError: (e) => toast.error(e.message) },
    );
    if (r) setRunId(r.id);
  };

  const writePrompt = async () => {
    const r = await start("visual", { pieceId: piece.id, optionId: option.id, preset: presetId, mode: "prompt", direction: direction.trim() || undefined }, { notify: false, onError: (e) => toast.error(e.message) });
    if (r) setPromptRunId(r.id);
  };

  const preset = presetById(presetId);

  return (
    <div className="mt-3 rounded-md bg-bg-subtle/60 p-3 ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<string>
          layoutId={`preset-${option.id}`}
          value={presetId}
          onChange={setPresetId}
          options={presets.map((p) => ({ value: p.id, label: <span className="whitespace-nowrap">{p.short}</span> }))}
          className="max-w-full overflow-x-auto"
        />
      </div>
      <p className="mt-1.5 text-[11.5px] leading-4 text-fg-3">
        {preset.w}×{preset.h} ({aspectLabel(preset.w, preset.h)}) · {preset.note}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented<Picture>
          layoutId={`picture-${option.id}`}
          value={picture}
          onChange={setPicture}
          options={[
            { value: "none", label: "Words only" },
            { value: "mine", label: "Your image" },
            { value: "paint", label: "AI image" },
          ]}
        />
        <label className="sr-only" htmlFor={`layout-${option.id}`}>
          Layout
        </label>
        <select
          id={`layout-${option.id}`}
          value={layoutValue}
          onChange={(e) => setLayout(e.target.value as VisualLayout | "auto")}
          className="h-8 rounded-md bg-surface px-2 text-[12.5px] text-fg ring-1 ring-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="auto">Layout: Claude picks</option>
          {layouts.map((l) => (
            <option key={l} value={l}>
              {LAYOUTS[l].label}
            </option>
          ))}
        </select>
      </div>

      {picture === "mine" && (
        <div className="mt-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <UploadButton
              onUploaded={(img) => setImageId(img.id)}
              className="flex size-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border-strong bg-surface text-fg-3 transition-colors hover:text-fg"
            >
              <ImagePlus className="size-4" aria-hidden />
              <span className="text-[10.5px]">Upload</span>
            </UploadButton>
            {images.map((img) => (
              <Thumb key={img.id} image={img} selected={img.id === imageId} onSelect={() => setImageId(img.id === imageId ? null : img.id)} />
            ))}
          </div>
          <p className="mt-1 text-[11.5px] leading-4 text-fg-3">A real screenshot of your product, or a photo you have the rights to. Claude looks at it and designs around it.</p>
        </div>
      )}

      {picture === "paint" && (
        <p className="mt-3 text-[12px] leading-[17px] text-fg-2">
          {hasOpenAI ? (
            <>
              Claude writes the prompt and OpenAI&apos;s GPT Image paints it, with no words in it; Claude sets the words on top. Billed to your OpenAI account. The graphic is marked as AI imagery,
              which Meta and TikTok ask you to disclose.
            </>
          ) : (
            <>
              No OpenAI key yet.{" "}
              <Link href="/settings#images" className="text-accent-text underline-offset-4 hover:underline">
                Add one in Settings
              </Link>
              , or write a prompt below, make the picture in ChatGPT, and upload it under Your image.
            </>
          )}
        </p>
      )}

      {picture !== "none" && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" icon={<Wand2 className="size-3.5" />} loading={!!writingPrompt} onClick={() => void writePrompt()}>
            Write a ChatGPT prompt
          </Button>
          {option.imagePrompt && !writingPrompt && (
            <div className="mt-1.5 rounded-md bg-surface p-2.5 ring-1 ring-border">
              <p className="whitespace-pre-wrap text-[12.5px] leading-[18px] text-fg">{option.imagePrompt.text}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11.5px] leading-4 text-fg-3">Paste into ChatGPT, download the picture, then upload it under Your image.</p>
                <CopyButton text={option.imagePrompt.text} />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          maxLength={600}
          placeholder="What it should show or feel like (optional)"
          aria-label="Direction for the graphic"
          className="h-8 text-[12.5px] sm:flex-1"
        />
        <Tooltip content={cannot ?? "Two designs. Code checks every word, contrast and safe zone; Claude looks at each render and fixes what fails."}>
          <span>
            <Button variant="agent" size="sm" className="h-8" icon={<Paintbrush className="size-3.5" />} loading={!!running} disabled={!!cannot} onClick={() => void design()}>
              Design 2 graphics
            </Button>
          </span>
        </Tooltip>
      </div>

      {run && running && <WorkLog run={run} className="mt-3" />}
      {run?.status === "error" && run.error && <p className="mt-2 text-[12px] text-danger">{run.error.message}</p>}

      {visuals.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {visuals.map((v) => (
            <VisualTile key={v.id} visual={v} headline={option.parts[FORMATS[piece.format].parts[0].key] ?? ""} />
          ))}
        </div>
      )}
    </div>
  );
}

function VisualTile({ visual, headline }: { visual: StudioVisual; headline: string }) {
  const { dispatch } = useWorkspace();
  const errors = visual.checks.filter((c) => c.severity === "error");
  const warns = visual.checks.filter((c) => c.severity === "warn");
  const [open, setOpen] = useState(false);
  return (
    <figure className={cn("overflow-hidden rounded-md bg-surface ring-1", visual.kept ? "ring-accent/40" : "ring-border")}>
      {visual.pngFile ? (
        // eslint-disable-next-line @next/next/no-img-element -- local files served by our own route
        <img src={fileUrl(visual.pngFile)} alt={`Graphic: ${headline}`} width={visual.width} height={visual.height} className="block h-auto w-full bg-bg-subtle" />
      ) : (
        <div className="flex items-center justify-center bg-bg-subtle text-[12px] text-fg-3" style={{ aspectRatio: `${visual.width} / ${visual.height}` }}>
          Didn&apos;t render
        </div>
      )}
      <figcaption className="p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone="outline">{LAYOUTS[visual.layout].label}</Badge>
          {visual.aiImagery && (
            <Tooltip content="The picture layer was painted by AI. Meta and TikTok ask you to disclose realistic AI imagery; use their AI label when you post.">
              <span>
                <Badge tone="info">AI imagery</Badge>
              </span>
            </Tooltip>
          )}
          {visual.stale && (
            <Tooltip content="You edited this option's words after the graphic was made. Design it again before posting.">
              <span>
                <Badge tone="warning">Old words</Badge>
              </span>
            </Tooltip>
          )}
          {visual.review && (
            <Tooltip content="Claude's look at the actual render, where 7 means it would post it.">
              <span className="ml-auto font-mono text-[11px] tnum text-fg-3">{visual.review.score}/10</span>
            </Tooltip>
          )}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1.5 flex w-full items-center gap-2 text-left text-[12px] leading-[17px]">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", errors.length ? "bg-warning" : "bg-success")} />
          <span className={cn("min-w-0 flex-1 truncate", errors.length ? "text-warning" : "text-fg-2")}>
            {errors.length ? errors[0].detail : warns.length ? `Ready · ${warns.length} to consider` : "Ready: approved words only, readable, in the safe zone"}
          </span>
        </button>
        {open && (
          <ul className="mt-1.5 space-y-1 rounded-md bg-bg-subtle px-2.5 py-2 ring-1 ring-border">
            {visual.checks.length ? (
              visual.checks.map((c, i) => (
                <li key={i} className={cn("text-[12px] leading-[17px]", c.severity === "error" ? "text-fg" : "text-fg-3")}>
                  {c.detail}
                </li>
              ))
            ) : (
              <li className="text-[12px] text-fg-2">Every word is from the approved copy; contrast, size and safe zones pass.</li>
            )}
            {visual.review?.fix && <li className="text-[12px] leading-[17px] text-fg-3">Claude would change: {visual.review.fix}</li>}
            {visual.why && <li className="font-serif text-[13px] italic leading-[18px] text-fg-2">{visual.why}</li>}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-1">
          {visual.pngFile && (
            <a
              href={fileUrl(visual.pngFile, true)}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              <Download className="size-3.5" aria-hidden /> PNG
            </a>
          )}
          <a href={fileUrl(visual.svgFile, true)} className="inline-flex h-7 items-center rounded-md px-2 text-[12px] font-medium text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg">
            SVG
          </a>
          <span className="flex-1" />
          <IconButton
            label={visual.kept ? "Kept" : "Keep this one"}
            onClick={() => void dispatch({ type: "studio.visual.keep", id: visual.id, kept: !visual.kept })}
            className={visual.kept ? "text-accent-text" : undefined}
          >
            <Star className={cn("size-3.5", visual.kept && "fill-current")} />
          </IconButton>
          <IconButton label="Delete graphic" onClick={() => void dispatch({ type: "studio.visual.remove", id: visual.id })}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </figcaption>
    </figure>
  );
}

/** The image library in the Studio aside: screenshots and photos for graphics. */
export function ImagesCard({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const images = Object.values(ws.studio.images).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="rounded-lg bg-surface p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <Images className="size-3.5 text-fg-3" aria-hidden /> Your images
          </h2>
          <p className="mt-0.5 text-[12px] leading-[17px] text-fg-3">Real screenshots and photos for graphics. Your product&apos;s UI only ever comes from here.</p>
        </div>
        <UploadButton className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg">
          <ImagePlus className="size-4" aria-label="Upload an image" />
        </UploadButton>
      </div>
      {images.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {images.map((img) => (
            <li key={img.id} className="group relative">
              <Thumb image={img} />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => void dispatch({ type: "studio.image.remove", id: img.id })}
                className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-surface text-fg-3 shadow-sm ring-1 ring-border hover:text-fg group-hover:flex group-focus-within:flex"
              >
                <X className="size-2.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
