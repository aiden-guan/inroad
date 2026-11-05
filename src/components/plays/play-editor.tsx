"use client";

import { AlertTriangle, Info, Lightbulb, PenLine, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import type { Action } from "@/lib/domain/actions";
import { measureLine, playLessons, resultsByVersion, type PlayLesson } from "@/lib/plays/custom";
import type { CustomPlay, Recipe, RecipeVersion } from "@/lib/plays/recipe-types";
import { currentVersion, describeChanges, editingRecipe } from "@/lib/plays/recipes";
import { shortDay, localDate } from "@/lib/moves/util";
import { DryRunPanel } from "./dry-run";
import { Micro, ResultsLine } from "./parts";
import { RecipeCard } from "./recipe-card";

const SOURCE: Record<RecipeVersion["source"], string> = { compiled: "From your sentence", suggested: "From a suggestion", edit: "Edited", learned: "Learned from skips" };

/** Dispatch, then offer the snapshot back: undo puts the play exactly as it was. */
export function useUndoable() {
  const { dispatch } = useWorkspace();
  return async (actions: Action | Action[], message: string, undo: Action[]) => {
    const ok = await dispatch(actions);
    if (ok) toast(message, { action: { label: "Undo", onClick: () => void dispatch(undo) } });
    return ok;
  };
}

/** The lesson chip: what the skips argue for, accept (a new version, undoable) or dismiss. */
export function LessonChip({ cp, lesson, blocked, className }: { cp: CustomPlay; lesson: PlayLesson; blocked?: boolean; className?: string }) {
  const run = useUndoable();
  const snapshot = structuredClone(cp);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-accent-subtle/60 px-3 py-2.5 ring-1 ring-inset ring-accent/20", className)}>
      <Lightbulb className="size-4 shrink-0 text-accent-text" aria-hidden />
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[13px] font-medium text-fg">
          <span className="text-accent-text">Got it. </span>
          {lesson.title}
        </p>
        <p className="text-[12px] leading-[18px] text-fg-2">{lesson.detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Tooltip content={blocked ? "Save or discard your unsaved changes first" : `Saves v${(cp.versions.at(-1)?.version ?? 0) + 1}; undo puts it back`}>
          <span>
            <Button
              size="xs"
              variant="primary"
              disabled={blocked}
              onClick={() => void run({ type: "customPlay.commit", id: cp.id, source: "learned", recipe: lesson.recipe, note: lesson.note, at: nowISO() }, `${lesson.note}. Saved as a new version.`, [{ type: "customPlay.upsert", play: snapshot }])}
            >
              Accept
            </Button>
          </span>
        </Tooltip>
        <Button size="xs" variant="ghost" onClick={() => void run({ type: "customPlay.dismissLesson", id: cp.id, key: lesson.key, skips: lesson.skips, at: nowISO() }, "Dismissed. It comes back only after 3 more skips like these.", [{ type: "customPlay.upsert", play: snapshot }])}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/**
 * A play the founder wrote, open: the sentence it came from and anything it can't run, the recipe to edit in
 * place, a dry run of exactly what's on screen, then its lessons, versions and results by version.
 */
export function PlayEditor({ cp, ws, today, onRewrite, focus }: { cp: CustomPlay; ws: Workspace; today: string; onRewrite: (sentence: string, id: string) => void; focus?: boolean }) {
  const { dispatch } = useWorkspace();
  const run = useUndoable();
  const ref = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState("");
  const current = currentVersion(cp);
  const recipe = editingRecipe(cp);
  const unsaved = !!current && !!cp.draft;
  const changes = useMemo(() => (unsaved && current && cp.draft ? describeChanges(current.recipe, cp.draft, ws) : []), [unsaved, current, cp.draft, ws]);
  const lessons = useMemo(() => (current ? playLessons(ws, cp) : []), [ws, cp, current]);
  const results = useMemo(() => (current ? resultsByVersion(ws, cp) : null), [ws, cp, current]);
  const draft = !current;
  const on = !!ws.plays?.[cp.id]?.enabled;

  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const edit = (next: Recipe) => void dispatch({ type: "customPlay.edit", id: cp.id, recipe: next, at: nowISO() });
  const turnOn = () =>
    run(
      [
        { type: "customPlay.commit", id: cp.id, source: cp.origin === "suggestion" ? "suggested" : "compiled", at: nowISO() },
        { type: "play.set", id: cp.id, enabled: true, at: nowISO() },
      ],
      `${recipe?.name ?? "Your play"} is running. Its first card lands on Today.`,
      [{ type: "customPlay.upsert", play: structuredClone(cp) }, { type: "play.set", id: cp.id, enabled: false, at: nowISO() }],
    );
  const save = () => {
    const next = (cp.versions.at(-1)?.version ?? 0) + 1;
    void run({ type: "customPlay.commit", id: cp.id, source: "edit", note: note.trim() || undefined, at: nowISO() }, `Saved v${next}. Results from here count toward v${next}.`, [{ type: "customPlay.upsert", play: structuredClone(cp) }]);
    setNote("");
  };

  // ⌘↵: turn a draft on, or save the unsaved changes.
  useEffect(() => {
    if (!focus || (!draft && !unsaved)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      // A field being edited saves on blur: let that edit land before the version is cut.
      const field = document.activeElement as HTMLElement | null;
      if (field && ref.current?.contains(field) && /^(INPUT|TEXTAREA)$/.test(field.tagName)) field.blur();
      setTimeout(() => (draft ? void turnOn() : save()), 60);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!recipe) return null;
  return (
    <div ref={ref} className="space-y-4">
      <div className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <input
            key={recipe.name}
            defaultValue={recipe.name}
            maxLength={60}
            aria-label="Play name"
            onBlur={(e) => {
              const name = e.target.value.replace(/\s+/g, " ").trim();
              if (name && name !== recipe.name) edit({ ...recipe, name });
              else e.target.value = recipe.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = recipe.name;
                e.currentTarget.blur();
              }
            }}
            className="-ml-1.5 h-8 w-full min-w-0 max-w-xl rounded-sm bg-transparent px-1.5 text-[16px] font-medium text-fg ring-1 ring-transparent transition-[box-shadow,background-color] duration-150 hover:ring-border focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-5 text-fg-2">
          <span className="font-serif text-[15px] italic text-fg">“{cp.sentence}”</span>
          <button type="button" onClick={() => onRewrite(cp.sentence, cp.id)} className="inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-fg-3 outline-none hover:text-fg-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            <PenLine className="size-3" aria-hidden />
            Rewrite from a sentence
          </button>
        </p>
        {cp.unsupported.map((u) => (
          <div key={u.phrase} className="flex gap-2.5 rounded-lg bg-warning-subtle/70 px-3 py-2 text-[12.5px] leading-5 ring-1 ring-inset ring-warning/20">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <p className="min-w-0 text-fg-2">
              <span className="font-medium text-fg">Can&apos;t detect “{u.phrase}”.</span> {u.why} <span className="text-fg-3">Nearest: {u.nearest}</span>
            </p>
          </div>
        ))}
        {cp.assumptions.map((a) => (
          <p key={a} className="flex gap-2 text-[12.5px] leading-5 text-fg-3">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {a}
          </p>
        ))}
      </div>

      <RecipeCard recipe={recipe} ws={ws} onChange={edit} />

      {unsaved && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-inset ring-border-strong/70">
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-[13px] font-medium text-fg">Unsaved changes to v{current!.version}</p>
            <p className="text-[12px] leading-[18px] text-fg-3">{changes.length ? changes.join(" · ") : "Nothing that changes what it matches."} v{current!.version} keeps running until you save.</p>
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional, for the version note)" aria-label="Version note" className="h-8 w-full sm:w-56" />
          <Button size="sm" variant="primary" kbd="⌘↵" onClick={save}>
            Save as v{(cp.versions.at(-1)?.version ?? 0) + 1}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void run({ type: "customPlay.discardDraft", id: cp.id }, "Changes discarded.", [{ type: "customPlay.upsert", play: structuredClone(cp) }])}>
            Discard
          </Button>
        </div>
      )}

      <DryRunPanel ws={ws} today={today} recipe={recipe} playId={cp.id} compareTo={unsaved ? current!.recipe : undefined} sentence={cp.sentence} />

      {draft && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" kbd="⌘↵" onClick={() => void turnOn()}>
            Turn it on
          </Button>
          <span className="text-[12px] text-fg-3">Runs beside the built-in plays and puts cards on Today. Nothing is sent: you approve every draft.</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => void run({ type: "customPlay.remove", id: cp.id }, "Draft discarded.", [{ type: "customPlay.upsert", play: structuredClone(cp) }])}
          >
            Discard draft
          </Button>
        </div>
      )}

      {lessons.map((l) => (
        <LessonChip key={l.key} cp={cp} lesson={l} blocked={unsaved} />
      ))}

      {current && results && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <Micro>Versions and results</Micro>
            <span className="text-[12px] text-fg-3">Each company counts toward the version that was running when it was first worked.</span>
          </div>
          <ol className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-border">
            {[...cp.versions].reverse().map((v) => {
              const r = results.byVersion.get(v.version);
              const isCurrent = v.version === current.version;
              return (
                <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
                  <span className="w-8 shrink-0 font-mono text-[12px] font-medium text-fg tnum">v{v.version}</span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg">
                      <span className="min-w-0">{v.note}</span>
                      {isCurrent && <Badge tone={on ? "success" : "neutral"}>{on ? "Running" : "Current"}</Badge>}
                      {v.source === "learned" && <Badge tone="agent">Learned</Badge>}
                    </p>
                    <p className="text-[12px] text-fg-3">
                      {shortDay(localDate(v.at))} · {SOURCE[v.source]} · {r ? measureLine(r, v.recipe.measure) : "Nothing worked from it yet"}
                    </p>
                  </div>
                  {r && <ResultsLine r={r} className="text-fg-3" />}
                  {!isCurrent && (
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<RotateCcw className="size-3" />}
                      onClick={() => void run({ type: "customPlay.rollback", id: cp.id, version: v.version, at: nowISO() }, `Back on v${v.version}. New results count toward it.`, [{ type: "customPlay.upsert", play: structuredClone(cp) }])}
                    >
                      Roll back
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-[12px] text-fg-3">
              All versions: <ResultsLine r={results.total} /> · {measureLine(results.total, current.recipe.measure)}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto text-fg-3"
              onClick={() =>
                void run({ type: "customPlay.archive", id: cp.id, archived: true, at: nowISO() }, "Archived. It stops running; its results are kept.", [
                  { type: "customPlay.archive", id: cp.id, archived: false, at: nowISO() },
                  { type: "play.set", id: cp.id, enabled: on, at: nowISO() },
                ])
              }
            >
              Archive
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
