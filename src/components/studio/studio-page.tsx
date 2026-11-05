"use client";

import {
  MoreHorizontal,
  PenLine,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { spring } from "@/lib/motion";
import { relativeTime } from "@/lib/client/format";
import { newId } from "@/lib/domain/ids";
import type {
  StudioFormatId,
  StudioPiece,
  Workspace,
} from "@/lib/domain/types";
import { campaignById, type Campaign } from "@/lib/studio/campaigns";
import {
  AUDIENCES,
  FORMATS,
  OCCASIONS,
  formatsFor,
} from "@/lib/studio/formats";
import { audienceFor } from "@/lib/studio/receipts";
import { CampaignDetails, CampaignLibrary } from "./campaign-library";
import { MaterialCard, ProfileCard } from "./material";
import { NewPiece, type NewPieceArgs } from "./new-piece";
import { OptionCard } from "./option-card";
import { ImagesCard } from "./visuals";
import { GraphicsStudio } from "./graphics-studio";
import { StudioAIChoice, StudioAIProvider, useStudioAI } from "./studio-ai";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  );
}

/** Separate creation, campaign research and saved work; keep drafts mounted between views. */
export function StudioPage() {
  return <StudioAIProvider><StudioContent /></StudioAIProvider>;
}

function StudioContent() {
  const studioAI = useStudioAI();
  const { ws, loading, error } = useWorkspace();
  const { runs, start } = useRuns();
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("piece");
  const pickedView = params.get("view");
  const view = selected
    ? "work"
    : pickedView === "campaigns" || pickedView === "work" || pickedView === "graphics"
      ? pickedView
      : "create";
  const [formatPick, setFormat] = useState<StudioFormatId>();
  const [campaignIds, setCampaignIds] = useState<string[] | undefined>();
  const [setup, setSetup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [requested, setRequested] = useState<string>();
  const [graphicsPick, setGraphicsPick] = useState<{ pieceId: string; optionId: string }>();

  const pieces = useMemo(
    () =>
      Object.values(ws?.studio.pieces ?? {}).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    [ws],
  );
  const studioRuns = useMemo(
    () =>
      Object.values(runs)
        .filter((run) => run.workflow === "studio")
        .sort((a, b) => b.startedAt - a.startedAt),
    [runs],
  );
  const activeRuns = studioRuns.filter(
    (run) => run.status === "running" || run.status === "queued",
  );
  const current = selected ? ws?.studio.pieces[selected] : undefined;
  const selectedRun = selected
    ? studioRuns.find((run) => run.ref?.id === selected)
    : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "n" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTyping(event.target)
      )
        return;
      event.preventDefault();
      router.push("/studio?view=create", { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const select = (id: string) =>
    router.push(`/studio?piece=${encodeURIComponent(id)}`, { scroll: false });
  const openGraphics = (pieceId?: string, optionId?: string) => {
    const target = pieceId && optionId ? { pieceId, optionId } : graphicsPick;
    if (target) setGraphicsPick(target);
    const query = new URLSearchParams({ view: "graphics" });
    if (target) {
      query.set("graphicPiece", target.pieceId);
      query.set("graphicOption", target.optionId);
    }
    router.push(`/studio?${query}`, { scroll: false });
  };
  const useCampaign = (campaign: Campaign) => {
    setCampaignIds([campaign.id]);
    setFormat(campaign.preferredFormat);
    router.push("/studio?view=create", { scroll: false });
  };

  const write = async (args: NewPieceArgs) => {
    if (!studioAI.ready) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const pieceId = newId("stu");
      const run = await start("studio", { ...args, pieceId, agentProvider: studioAI.provider });
      if (!run) return;
      setRequested(pieceId);
      select(pieceId);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const writeMore = (piece: StudioPiece) =>
    studioAI.ready && void start("studio", { format: piece.format, pieceId: piece.id, agentProvider: studioAI.provider });

  if (!ws) {
    return (
      <div className="page-shell max-w-[1180px]" aria-busy={loading || undefined}>
        {loading ? (
          <>
            <Skeleton className="h-3 w-40" />
            <Skeleton className="mt-4 h-11 w-48" />
            <Skeleton className="mt-4 h-4 w-96 max-w-full" />
            <Skeleton className="mt-10 h-10 w-80 max-w-full rounded-lg" />
          </>
        ) : (
          <EmptyState
            title="Couldn't open Studio"
            body={`${error ?? "Your workspace didn't load."} Reload the page to try again.`}
            action={<Button onClick={() => window.location.reload()}>Reload</Button>}
          />
        )}
      </div>
    );
  }
  const format = formatPick ?? formatsFor(audienceFor(ws))[0].id;
  // One creator control at a time, beside the button it affects in the open view.
  const creator = <StudioAIChoice />;

  return (
    <div className="page-shell max-w-[1180px]">
      <PageHeader
        title="Studio"
        eyebrow="Words and pictures"
        description="Campaign ideas, copy and graphics, made from your own material."
        actions={
          <>
            <Button
              aria-label="Brand & material"
              icon={<Settings2 aria-hidden className="size-3.5" />}
              onClick={() => setSetup(true)}
            >
              <span className="hidden sm:inline">Brand & material</span>
              <span className="sm:hidden">Brand</span>
            </Button>
            {view !== "create" && (
              <Button
                variant="primary"
                icon={<Plus aria-hidden className="size-3.5" />}
                kbd="N"
                onClick={() =>
                  router.push("/studio?view=create", { scroll: false })
                }
              >
                Create
              </Button>
            )}
          </>
        }
      />

      <ViewTabs
        view={view}
        items={[
          { id: "create", label: "Create" },
          { id: "graphics", label: "Graphics" },
          { id: "campaigns", label: "Campaign library", short: "Library" },
          { id: "work", label: "Your work", count: pieces.length || undefined },
        ]}
      />

      <div hidden={view !== "create"}>
        <NewPiece
          ws={ws}
          format={format}
          onFormatChange={setFormat}
          campaignIds={campaignIds}
          onCampaignChange={setCampaignIds}
          onBrowse={() =>
            router.push("/studio?view=campaigns", { scroll: false })
          }
          onMaterial={() => setSetup(true)}
          onGraphics={() => openGraphics()}
          onWrite={(args) => void write(args)}
          busy={submitting}
          creator={view === "create" ? creator : undefined}
        />
      </div>
      <div hidden={view !== "graphics"}>
        <GraphicsStudio
          ws={ws}
          pieceId={params.get("graphicPiece") ?? graphicsPick?.pieceId}
          optionId={params.get("graphicOption") ?? graphicsPick?.optionId}
          onSelect={openGraphics}
          onWrite={() => {
            setFormat("image");
            router.push("/studio?view=create", { scroll: false });
          }}
          onEdit={select}
          creator={view === "graphics" ? creator : undefined}
        />
      </div>
      <div hidden={view !== "campaigns"}>
        <CampaignLibrary onUse={useCampaign} />
      </div>
      <div hidden={view !== "work"} className="space-y-5">
        {selected && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/studio?view=work", { scroll: false })}
          >
            ← All your work
          </Button>
        )}
        {activeRuns.map((run) => (
          <WorkLog key={run.id} run={run} />
        ))}
        {selectedRun &&
          selectedRun.status !== "running" &&
          selectedRun.status !== "queued" &&
          !current && <WorkLog run={selectedRun} />}
        {current ? (
          <PieceView
            ws={ws}
            piece={current}
            onMore={() => writeMore(current)}
            busy={activeRuns.some((run) => run.ref?.id === current.id)}
            onRemoved={() =>
              router.replace("/studio?view=work", { scroll: false })
            }
            onGraphics={openGraphics}
            creator={view === "work" ? creator : undefined}
          />
        ) : selected ? (
          selectedRun?.status === "running" ||
          selectedRun?.status === "queued" ||
          (requested === selected && !selectedRun) ? (
            <p role="status" className="text-[13px] text-fg-2">
              Writing your options. They’ll appear here when they’re ready.
            </p>
          ) : (
            <EmptyState
              title="No options saved for this piece"
              body="The piece may have been removed, or the writing run ended before it saved."
              action={
                <Button
                  onClick={() =>
                    router.push("/studio?view=create", { scroll: false })
                  }
                >
                  Create a piece
                </Button>
              }
            />
          )
        ) : (
          <WorkLibrary
            pieces={pieces}
            onSelect={select}
            onCreate={() =>
              router.push("/studio?view=create", { scroll: false })
            }
          />
        )}
      </div>

      <Sheet
        open={setup}
        onOpenChange={setSetup}
        title="Brand & material"
        width={500}
      >
        <div className="space-y-4 p-4">
          <p className="px-1 text-[13px] leading-5 text-fg-2">
            Your saved details apply to every piece. Add real stories, proof and
            examples when you have them.
          </p>
          <ProfileCard ws={ws} />
          <MaterialCard ws={ws} />
          <ImagesCard ws={ws} />
        </div>
      </Sheet>
    </div>
  );
}

/**
 * Studio's views as segmented tabs, matching the app's other tabs (Companies, an event). They stay links, so each view
 * has its own URL and browser history works.
 */
function ViewTabs({ view, items }: { view: string; items: { id: string; label: string; short?: string; count?: number }[] }) {
  const reduce = useReducedMotion();
  // Unique per mount, like Segmented: the hidden prefetched copy of the page must not share the sliding indicator.
  const indicator = `${useId()}-studio-view`;
  return (
    <nav aria-label="Studio views" className="mb-6 mt-6 md:mb-8">
      <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-bg-subtle p-1 ring-1 ring-inset ring-border scrollbar-none">
        {items.map((item) => {
          const active = view === item.id;
          return (
            <Link
              key={item.id}
              href={`/studio?view=${item.id}`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              aria-label={item.short ? item.label : undefined}
              className={cn(
                "relative inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] sm:gap-2 sm:px-3 sm:text-[13px]",
                active ? "text-fg" : "text-fg-3 hover:text-fg-2",
              )}
            >
              {active && (
                <motion.span
                  layoutId={indicator}
                  transition={reduce ? { duration: 0 } : spring.snappy}
                  className="absolute inset-0 rounded-md bg-surface shadow-xs ring-1 ring-inset ring-border-strong/60"
                />
              )}
              {item.short ? (
                <>
                  {/* A shorter word on a phone keeps all four tabs in view. */}
                  <span className="relative sm:hidden">{item.short}</span>
                  <span className="relative hidden sm:inline">{item.label}</span>
                </>
              ) : (
                <span className="relative">{item.label}</span>
              )}
              {item.count !== undefined && <span className="relative font-mono text-[12px] tnum text-fg-3">{item.count}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function PieceView({
  ws,
  piece,
  onMore,
  busy,
  onRemoved,
  onGraphics,
  creator,
}: {
  ws: Workspace;
  piece: StudioPiece;
  onMore: () => void;
  busy: boolean;
  onRemoved: () => void;
  onGraphics: (pieceId: string, optionId: string) => void;
  /** Who writes more: the compact Create with control, beside Write more. */
  creator?: ReactNode;
}) {
  const studioAI = useStudioAI();
  const { dispatch } = useWorkspace();
  const spec = FORMATS[piece.format];
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const inspiration = (piece.campaignIds ?? []).flatMap((id) => {
    const item = campaignById(id);
    return item ? [item] : [];
  });
  const ready = piece.options.filter((o) => o.lint.passed).length;
  const narrow = spec.preview === "line";
  return (
    <section aria-labelledby="studio-piece-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="agent">{spec.label}</Badge>
            <Badge tone="outline">{OCCASIONS[piece.occasion].label}</Badge>
            <Badge tone="outline">{AUDIENCES[piece.audience].label}</Badge>
          </div>
          <h2
            id="studio-piece-title"
            className="mt-2 text-pretty font-serif text-[22px] leading-[28px] tracking-[-0.01em] text-fg [overflow-wrap:anywhere]"
          >
            {piece.title || spec.label}
          </h2>
          <p className="mt-0.5 font-mono text-[12px] tnum text-fg-3">
            {piece.options.length} options · {ready} ready ·{" "}
            {relativeTime(piece.updatedAt)}
          </p>
        </div>
        {creator}
        <Button
          variant="agent"
          size="sm"
          icon={<Sparkles className="size-3.5" />}
          loading={busy}
          disabled={!studioAI.ready}
          onClick={onMore}
        >
          Write more
        </Button>
        <Menu
          trigger={
            <IconButton label="More for this piece">
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
        >
          <MenuItem
            danger
            icon={<Trash2 className="size-3.5" />}
            onSelect={() => {
              void dispatch({ type: "studio.piece.remove", id: piece.id });
              onRemoved();
            }}
          >
            Delete this piece
          </MenuItem>
        </Menu>
      </div>

      {(piece.brief || inspiration.length > 0 || piece.reference) && (
        <details className="mt-4 rounded-md border border-border px-3 py-2 text-[12px] leading-5">
          <summary className="cursor-pointer font-medium text-fg-2">
            Brief & campaign direction
          </summary>
          {piece.brief && (
            <p className="mt-2 whitespace-pre-wrap text-fg-2">{piece.brief}</p>
          )}
          {inspiration.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {inspiration.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCampaign(item)}
                  className="rounded-sm bg-bg-subtle px-2 py-1 text-fg-2 ring-1 ring-border hover:text-fg"
                >
                  {item.brand} · View approach
                </button>
              ))}
            </div>
          )}
          {piece.reference && (
            <div className="mt-3">
              <p className="font-medium text-fg-3">Your own inspiration</p>
              <p className="whitespace-pre-wrap text-fg-2">{piece.reference}</p>
            </div>
          )}
        </details>
      )}
      <CampaignDetails campaign={campaign} onClose={() => setCampaign(null)} />

      {piece.gaps.length > 0 && (
        <div className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-[12.5px] leading-[18px] text-fg">
          <span className="font-medium">Fill before publishing:</span>{" "}
          {piece.gaps.join(" · ")}
          <span className="text-fg-2">
            {" "}
            I left these as [[gaps]] instead of guessing.
          </span>
        </div>
      )}

      <div className={cn("mt-4 grid gap-3", narrow && "md:grid-cols-2")}>
        {piece.options.map((o, i) => (
          <OptionCard key={o.id} ws={ws} piece={piece} option={o} index={i} onGraphics={() => onGraphics(piece.id, o.id)} />
        ))}
      </div>

      <p className="mt-4 text-[12px] leading-[18px] text-fg-3">
        <PenLine className="mr-1 inline size-3.5 align-[-2px]" />
        Edit anything; checks rerun as you type. When two feel close, test them,
        and judge by paid conversions, not sign-ups. 37signals found total
        sign-ups hid a drop in paying customers.
      </p>
    </section>
  );
}

function WorkLibrary({
  pieces,
  onSelect,
  onCreate,
}: {
  pieces: StudioPiece[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const found = pieces.filter((piece) =>
    `${piece.title} ${piece.brief} ${FORMATS[piece.format].label}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  if (!pieces.length)
    return (
      <EmptyState
        title="Your next idea starts here"
        body="Create a piece from your own material or explore a campaign approach. Your options and kept drafts will be saved here."
        action={
          <Button variant="primary" onClick={onCreate}>
            Create your first piece
          </Button>
        }
      />
    );
  return (
    <section aria-labelledby="studio-work-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h2
          id="studio-work-title"
          className="font-serif text-[26px] leading-8 text-fg"
        >
          Your work
        </h2>
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden
            className="absolute left-2.5 top-2 size-4 text-fg-3"
          />
          <Input
            type="search"
            aria-label="Search your work"
            placeholder="Find a piece…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      {found.length ? (
        <ul className="divide-y divide-border rounded-lg bg-surface ring-1 ring-border">
          {found.map((piece) => (
            <li key={piece.id}>
              <button
                onClick={() => onSelect(piece.id)}
                className="block w-full rounded-sm px-4 py-4 text-left transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-fg-3">
                  <span>{FORMATS[piece.format].label}</span>
                  <span>{relativeTime(piece.updatedAt)}</span>
                </span>
                <span className="mt-1 block text-[14px] font-medium text-fg">
                  {piece.title || FORMATS[piece.format].label}
                </span>
                <span className="mt-2 block text-[12px] text-fg-3">
                  {piece.options.length} options ·{" "}
                  {piece.options.filter((option) => option.kept).length} kept
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No pieces match"
          action={<Button onClick={() => setQuery("")}>Clear search</Button>}
        />
      )}
    </section>
  );
}
