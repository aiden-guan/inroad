"use client";

import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useToday } from "@/components/companies/list/lib";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { LoadingSignal } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/client/cn";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { visibleMoves } from "@/lib/moves/rules";
import { playEnabled, playMatches, playResults } from "@/lib/plays/catalog";
import { playLessons, resultsByVersion } from "@/lib/plays/custom";
import type { CustomPlay } from "@/lib/plays/recipe-types";
import { customPlays, editingRecipe, playsFor } from "@/lib/plays/recipes";
import { suggestPlays, type PlaySuggestion } from "@/lib/plays/suggest";
import { money } from "@/lib/revenue/forecast";
import { DescribePlay } from "./describe-play";
import { LiveQueue, liveQueue } from "./live-queue";
import { PlayEditor } from "./play-editor";
import { PlayRow, RowHeads, type Row } from "./play-row";
import { Suggestions } from "./suggestions";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=dialog],[role=menu]"));
}

/**
 * Plays: the programs a GTM engineer would wire up in Clay and a sequencer, run here in code against the workspace
 * every day. Describe your own in a sentence (compiled to a recipe you edit and dry-run), see every live match across
 * running plays, and open any play for its trigger, backtest, matches, skips, versions and results.
 */
export function PlaysPage() {
  const { ws, error, refresh } = useWorkspace();
  if (!ws) {
    return error ? (
      <div className="page-shell max-w-[1000px]">
        <EmptyState
          title="Couldn't load your workspace"
          body={`${error} Your data is still on this machine.`}
          action={
            <Button variant="primary" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      </div>
    ) : (
      <LoadingSignal label="Matching your plays" className="min-h-[60dvh]" />
    );
  }
  return <Plays ws={ws} />;
}

function Plays({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const today = useToday();
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("play");
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string | undefined>();
  const input = useRef<HTMLTextAreaElement>(null);

  const select = (id: string | null) => router.replace(id ? `/plays?play=${encodeURIComponent(id)}` : "/plays", { scroll: false });

  // N (or /) starts a new play from anywhere on the page; G then N still goes to Intros.
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key.toLowerCase() === "g") {
        g = Date.now();
        return;
      }
      const afterG = Date.now() - g < 1200;
      g = 0;
      if ((e.key !== "n" && e.key !== "/") || afterG) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const model = useMemo(() => {
    if (!today) return null;
    const desk = visibleMoves(ws.moves, today);
    const rows: Row[] = playsFor(ws).map((play) => {
      const cp = ws.customPlays?.[play.id];
      const matches = playMatches(ws, play, today);
      return {
        play,
        cp,
        on: playEnabled(ws, play.id),
        matches,
        live: matches.filter((m) => !m.worked).length,
        onToday: desk.filter((m) => m.playId === play.id).length,
        results: cp ? resultsByVersion(ws, cp).total : playResults(ws, play),
        lessons: cp ? playLessons(ws, cp) : [],
      };
    });
    return {
      rows,
      drafts: customPlays(ws).filter((cp) => cp.versions.length === 0),
      queue: liveQueue(rows),
      suggestions: suggestPlays(ws, today),
      onToday: desk.filter((m) => !!m.playId).length,
    };
  }, [ws, today]);

  if (!today || !model) return <LoadingSignal label="Matching your plays" className="min-h-[60dvh]" />;
  const running = model.rows.filter((r) => r.on).length;
  const live = model.queue.length;
  const pipeline = model.rows.reduce((n, r) => n + r.results.pipelineUsd + r.results.wonUsd, 0);
  const own = model.rows.filter((r) => r.cp);
  const builtIn = model.rows.filter((r) => !r.cp);

  const rewrite = (sentence: string, id: string) => {
    setText(sentence);
    setTarget(id);
    input.current?.focus();
    input.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const pick = async (s: PlaySuggestion) => {
    const play: CustomPlay = { id: newId("cp"), createdAt: nowISO(), sentence: s.sentence, origin: "suggestion", suggestion: s.key, versions: [], history: [], draft: s.recipe, unsupported: [], assumptions: [], dismissed: [] };
    if (await dispatch({ type: "customPlay.upsert", play })) select(play.id);
  };

  return (
    <div className="page-shell max-w-[1000px]">
      <PageHeader
        title="Plays"
        eyebrow="Always on"
        description="Repeatable programs I run against your accounts every day: a trigger you could write down, one action, and results counted from your deals. Describe your own in a sentence; running plays put their best match on Today."
      >
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
          <span>
            <span className="font-mono tnum text-fg-2">{running}</span> of {model.rows.length} running{own.length ? ` (${own.length} yours)` : ""}
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono tnum text-fg-2">{live}</span> {live === 1 ? "company" : "companies"} live
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-mono tnum text-fg-2">{model.onToday}</span> on Today
          </span>
          {pipeline > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tnum text-fg-2">{money(pipeline)}</span> in deals they touched
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>Free public signals only: no intent data bought</span>
        </p>
      </PageHeader>

      <div className="mt-8">
        <DescribePlay ref={input} ws={ws} text={text} setText={setText} target={target} clearTarget={() => setTarget(undefined)} onCompiled={(id) => select(id)} />
      </div>

      {model.drafts.length > 0 && (
        <section className="mt-6 space-y-2.5" aria-labelledby="play-drafts">
          <SectionLabel right={<span className="text-[12px] text-fg-3">Not running yet: dry-run, edit, then turn on</span>}>
            <span id="play-drafts">Drafts</span>
          </SectionLabel>
          {model.drafts.map((cp) => (
            <DraftCard key={cp.id} cp={cp} ws={ws} today={today} selected={selected === cp.id || (!selected && model.drafts.length === 1)} onSelect={(on) => select(on ? cp.id : null)} onRewrite={rewrite} />
          ))}
        </section>
      )}

      <LiveQueue items={model.queue} ws={ws} today={today} onOpenPlay={(id) => select(id)} />

      <Suggestions suggestions={model.suggestions} onPick={(s) => void pick(s)} />

      <section className="mt-10" aria-labelledby="all-plays">
        <SectionLabel right={<span className="text-[12px] text-fg-3">Open one for its trigger, backtest, matches and skips</span>}>
          <span id="all-plays">All plays</span>
        </SectionLabel>
        <RowHeads />
        <div className="space-y-2">
          {[...own, ...builtIn].map((row, i) => (
            <motion.div key={row.play.id} variants={listItem} initial="hidden" animate="show" custom={i}>
              <PlayRow row={row} ws={ws} today={today} open={selected === row.play.id} onToggle={() => select(selected === row.play.id ? null : row.play.id)} onRewrite={rewrite} />
            </motion.div>
          ))}
        </div>
        <ArchivedPlays ws={ws} />
      </section>
    </div>
  );
}

/** A play described but not turned on: open by default, straight into its editor and dry run. */
function DraftCard({ cp, ws, today, selected, onSelect, onRewrite }: { cp: CustomPlay; ws: Workspace; today: string; selected: boolean; onSelect: (on: boolean) => void; onRewrite: (sentence: string, id: string) => void }) {
  const recipe = editingRecipe(cp);
  const [collapsed, setCollapsed] = useState(false);
  const open = selected || !collapsed;
  const toggle = () => {
    setCollapsed(open);
    onSelect(!open);
  };
  return (
    <div className={cn("overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset", selected ? "ring-accent/30" : "ring-border")}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] sm:px-5">
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-fg-3 transition-transform duration-150", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{recipe?.name ?? "Untitled play"}</span>
        <Badge tone="warning">Draft</Badge>
        <Badge tone="agent">{cp.origin === "suggestion" ? "Suggested" : "Custom"}</Badge>
      </button>
      {open && (
        <div className="border-t border-border bg-bg-subtle/40 px-4 pb-5 pt-4 sm:px-5">
          <PlayEditor cp={cp} ws={ws} today={today} onRewrite={onRewrite} focus={selected} />
        </div>
      )}
    </div>
  );
}

/** Archived plays stay listed (quietly) with their results, and can come back. */
function ArchivedPlays({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const [open, setOpen] = useState(false);
  const archived = Object.values(ws.customPlays ?? {}).filter((cp) => !!cp.archivedAt);
  if (!archived.length) return null;
  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-3 hover:text-fg-2">
        <ChevronRight aria-hidden className={cn("size-3 transition-transform duration-150", open && "rotate-90")} />
        {archived.length} archived {archived.length === 1 ? "play" : "plays"}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {archived.map((cp) => (
            <li key={cp.id} className="flex flex-wrap items-center gap-x-3 text-[12.5px] text-fg-3">
              <span className="font-medium text-fg-2">{editingRecipe(cp)?.name ?? "Untitled play"}</span>
              <span>v{cp.versions.at(-1)?.version ?? 1}</span>
              <Button size="xs" variant="ghost" onClick={() => void dispatch({ type: "customPlay.archive", id: cp.id, archived: false, at: nowISO() })}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
