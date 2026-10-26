"use client";

import { AnimatePresence, motion } from "motion/react";
import { MoreHorizontal, PenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";
import { newId } from "@/lib/domain/ids";
import type { StudioPiece, Workspace } from "@/lib/domain/types";
import { AUDIENCES, FORMATS, OCCASIONS } from "@/lib/studio/formats";
import { MaterialCard, ProfileCard } from "./material";
import { NewPiece, type NewPieceArgs } from "./new-piece";
import { OptionCard } from "./option-card";
import { ImagesCard } from "./visuals";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/**
 * Studio: marketing and launch copy, written from the founder's own material. URL `?piece=<id>`
 * opens a piece. N starts a new one.
 */
export function StudioPage() {
  const { ws, loading, error } = useWorkspace();
  const { runs, start } = useRuns();
  const params = useSearchParams();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(() => params.get("piece"));
  const [composing, setComposing] = useState(false);

  const pieces = useMemo(() => Object.values(ws?.studio.pieces ?? {}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [ws]);
  const studioRuns = useMemo(() => Object.values(runs).filter((r) => r.workflow === "studio").sort((a, b) => b.startedAt - a.startedAt), [runs]);
  const activeRuns = studioRuns.filter((r) => r.status === "running" || r.status === "queued");
  const current = (selected && ws?.studio.pieces[selected]) || (!selected ? pieces[0] : undefined);
  const pendingId = selected && !ws?.studio.pieces[selected] ? selected : null;
  const showComposer = composing || (!!ws && pieces.length === 0 && !pendingId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      setComposing(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const select = (id: string) => {
    setSelected(id);
    router.replace(`/studio?piece=${encodeURIComponent(id)}`, { scroll: false });
  };

  const write = async (a: NewPieceArgs) => {
    const pieceId = newId("stu");
    const run = await start("studio", { ...a, pieceId });
    if (!run) return;
    setComposing(false);
    select(pieceId);
  };

  const writeMore = (piece: StudioPiece) => void start("studio", { format: piece.format, pieceId: piece.id });

  if (!ws) {
    return (
      <div className="mx-auto w-full max-w-[1180px] px-6 pt-8 md:px-10 md:pt-12">
        {loading ? <Skeleton className="h-9 w-40" /> : <p className="text-[13px] text-danger">{error ?? "Couldn't load your workspace."} Reload the page to try again.</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 pb-24 pt-8 md:px-10 md:pt-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.02em]">Studio</h1>
          <p className="mt-1.5 max-w-[60ch] text-[14px] text-fg-2">Launch posts, ads, headlines and pages, written from what only you can say. Every specific has a receipt; every option is checked for AI tells.</p>
        </div>
        {!showComposer && (
          <Button variant="primary" icon={<Plus className="size-4" />} kbd="N" onClick={() => setComposing(true)}>
            New piece
          </Button>
        )}
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <ProfileCard ws={ws} />
          <MaterialCard ws={ws} />
          <ImagesCard ws={ws} />
        </aside>

        <main className="min-w-0 space-y-5">
          <AnimatePresence initial={false}>
            {showComposer && (
              <motion.div key="composer" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                {pieces.length === 0 && <HowItWorks />}
                <NewPiece ws={ws} onWrite={(a) => void write(a)} onClose={pieces.length ? () => setComposing(false) : undefined} />
              </motion.div>
            )}
          </AnimatePresence>

          {activeRuns.map((r) => (
            <WorkLog key={r.id} run={r} />
          ))}

          {current ? <PieceView ws={ws} piece={current} onMore={() => writeMore(current)} busy={activeRuns.some((r) => r.ref?.id === current.id)} onRemoved={() => setSelected(null)} /> : null}

          {pieces.length > 1 && <Library pieces={pieces} current={current?.id} onSelect={select} />}
        </main>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["Give me material", "A moment, a number with its source, a user's words, what it can't do yet. Specifics are what make copy sound like a person."],
    ["I write options", "Several at once, each with a different move from campaigns that worked: Wispr Flow's villain, Ramp's footnoted claim, Supabase's borrowed rival."],
    ["Code and a reader check them", "Lint catches AI tells, unsourced numbers and platform limits. A blind reader ranks them; the weak ones get rewritten."],
  ];
  return (
    <ol className="mb-4 grid gap-3 md:grid-cols-3">
      {steps.map(([title, body], i) => (
        <li key={title} className="rounded-lg px-1">
          <p className="font-mono text-[11px] text-fg-4">{String(i + 1).padStart(2, "0")}</p>
          <p className="mt-0.5 text-[13px] font-medium text-fg">{title}</p>
          <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-2">{body}</p>
        </li>
      ))}
    </ol>
  );
}

function PieceView({ ws, piece, onMore, busy, onRemoved }: { ws: Workspace; piece: StudioPiece; onMore: () => void; busy: boolean; onRemoved: () => void }) {
  const { dispatch } = useWorkspace();
  const spec = FORMATS[piece.format];
  const ready = piece.options.filter((o) => o.lint.passed).length;
  const narrow = spec.preview === "line";
  return (
    <section>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="agent">{spec.label}</Badge>
            <Badge tone="outline">{OCCASIONS[piece.occasion].label}</Badge>
            <Badge tone="outline">{AUDIENCES[piece.audience].label}</Badge>
          </div>
          <h2 className="mt-2 font-serif text-[22px] leading-[28px] tracking-[-0.01em] text-fg">{piece.brief || spec.label}</h2>
          <p className="mt-0.5 font-mono text-[11.5px] tnum text-fg-3">
            {piece.options.length} options · {ready} ready · {relativeTime(piece.updatedAt)}
          </p>
        </div>
        <Button variant="agent" size="sm" icon={<Sparkles className="size-3.5" />} loading={busy} onClick={onMore}>
          Write more
        </Button>
        <Menu
          trigger={
            <IconButton label="More">
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

      {piece.gaps.length > 0 && (
        <div className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-[12.5px] leading-[18px] text-fg">
          <span className="font-medium">Fill before publishing:</span> {piece.gaps.join(" · ")}
          <span className="text-fg-2"> I left these as [[gaps]] instead of guessing.</span>
        </div>
      )}

      <div className={cn("mt-4 grid gap-3", narrow && "md:grid-cols-2")}>
        {piece.options.map((o, i) => (
          <OptionCard key={o.id} ws={ws} piece={piece} option={o} index={i} />
        ))}
      </div>

      <p className="mt-4 text-[12px] leading-[18px] text-fg-3">
        <PenLine className="mr-1 inline size-3.5 align-[-2px]" />
        Edit anything; checks rerun as you type. When two feel close, test them, and judge by paid conversions, not sign-ups. 37signals found total sign-ups hid a drop in paying customers.
      </p>
    </section>
  );
}

function Library({ pieces, current, onSelect }: { pieces: StudioPiece[]; current?: string; onSelect: (id: string) => void }) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-3">Everything you&apos;ve written</p>
      <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
        {pieces.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-bg-subtle", p.id === current && "bg-bg-subtle")}
            >
              <span className="w-36 shrink-0 truncate text-[12px] text-fg-3">{FORMATS[p.format].label}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{p.brief || p.options[0]?.parts[FORMATS[p.format].parts[0].key] || FORMATS[p.format].label}</span>
              {p.options.some((o) => o.kept) && <span className="font-mono text-[11px] text-accent-text">{p.options.filter((o) => o.kept).length} kept</span>}
              <span className="shrink-0 font-mono text-[11px] tnum text-fg-3">{relativeTime(p.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
