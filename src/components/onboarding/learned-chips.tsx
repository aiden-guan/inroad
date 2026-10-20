"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import type { LearningChip, Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

const ORDER: LearningChip["key"][] = ["what", "who", "pricing", "proof", "alternatives", "stage"];

function ChipEditor({ chip, onDone }: { chip: LearningChip; onDone: (saved: boolean) => void }) {
  const { dispatch } = useWorkspace();
  const [text, setText] = useState(chip.text);
  const save = () => {
    const next = text.trim();
    if (next === chip.text) return onDone(false);
    void dispatch({ type: "company.correctChip", key: chip.key, text: next || null });
    onDone(!!next);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex min-w-0 items-center gap-1.5"
    >
      <Input
        autoFocus
        value={text}
        maxLength={90}
        aria-label={chip.label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDone(false);
          }
        }}
        className="h-8 min-w-0 flex-1 text-[16px] sm:text-[14px]"
      />
      <Button type="submit" size="sm" variant="primary">
        Save
      </Button>
      <IconButton
        type="button"
        label={`Mark “${chip.label}” as wrong`}
        onClick={() => {
          void dispatch({ type: "company.correctChip", key: chip.key, text: null });
          onDone(false);
        }}
      >
        <X className="size-3.5" />
      </IconButton>
    </form>
  );
}

/**
 * "What I learned": each chip streams in as the model shares it, cites the page it came from, and can be corrected
 * in place. A correction is the founder's version everywhere from then on.
 */
export function LearnedChips({ ws, waiting }: { ws: Workspace; waiting: boolean }) {
  const { dispatch } = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);
  const [learned, setLearned] = useState<string | null>(null);
  const chips = ORDER.flatMap((k) => ws.company?.chips.filter((c) => c.key === k) ?? []);
  if (!chips.length && !waiting) return null;

  return (
    <section aria-labelledby="learned-label">
      <SectionLabel>
        <span id="learned-label">What I learned</span>
      </SectionLabel>
      {chips.length === 0 ? (
        <div className="space-y-3 py-1" aria-hidden>
          {["w-[72%]", "w-[54%]", "w-[63%]"].map((w) => (
            <div key={w} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-4">
              <Skeleton className="mt-1 h-3 w-20" />
              <Skeleton className={`h-4 ${w}`} />
            </div>
          ))}
        </div>
      ) : (
        <ul className="-mx-2">
          <AnimatePresence initial={false}>
            {chips.map((chip, i) => {
              const ev = chip.evidenceIds.map((id) => ws.evidence[id]).find(Boolean);
              return (
                <motion.li
                  key={chip.key}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.28, ease: ease.out, delay: Math.min(i, 5) * 0.04 }}
                  className="relative grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-md px-2 py-2 sm:grid-cols-[148px_minmax(0,1fr)]"
                >
                  <span className="pt-[3px] text-[12px] leading-4 text-fg-3">{chip.label}</span>
                  {editing === chip.key ? (
                    <ChipEditor
                      chip={chip}
                      onDone={(saved) => {
                        setEditing(null);
                        if (saved) setLearned(chip.key);
                      }}
                    />
                  ) : chip.rejected ? (
                    <div className="min-w-0 text-pretty">
                      <button
                        onClick={() => setEditing(chip.key)}
                        title="Click to correct"
                        className="rounded-xs text-left text-[14px] leading-[21px] text-fg-3 line-through decoration-fg-4"
                      >
                        {chip.text}
                      </button>
                      <span className="ml-2 text-[11.5px] text-fg-3">You said this was wrong</span>
                      <button
                        type="button"
                        onClick={() => void dispatch({ type: "company.correctChip", key: chip.key, text: chip.text })}
                        className="ml-2 rounded-xs text-[11.5px] text-fg-2 underline underline-offset-2 transition-colors duration-150 hover:text-fg"
                      >
                        Undo
                      </button>
                    </div>
                  ) : (
                    <div className="min-w-0 text-pretty">
                      <button
                        onClick={() => setEditing(chip.key)}
                        title="Click to correct"
                        className="rounded-xs text-left text-[14px] leading-[21px] text-fg decoration-fg-4 decoration-dotted underline-offset-[5px] transition-colors duration-150 hover:underline"
                      >
                        {chip.text}
                      </button>
                      {ev && !chip.corrected && (
                        <>
                          {" "}
                          <SourceChip url={ev.url} quote={ev.quote} claim={ev.claim} confidence={ev.confidence} />
                        </>
                      )}
                      {chip.corrected ? (
                        <span className="ml-2 text-[11.5px] text-fg-3">Your words</span>
                      ) : (
                        chip.confidence === "low" && <span className="ml-2 font-mono text-[10.5px] text-fg-3">guess</span>
                      )}
                    </div>
                  )}
                  <AnimatePresence>
                    {learned === chip.key && (
                      <motion.span
                        key="learned"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="pointer-events-none absolute inset-x-2 bottom-0 top-0"
                        aria-hidden
                      >
                        <motion.span
                          className="absolute inset-x-0 bottom-0 h-px origin-left bg-accent"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: 0.4, ease: ease.out }}
                          onAnimationComplete={() => setTimeout(() => setLearned((k) => (k === chip.key ? null : k)), 900)}
                        />
                        <span className="absolute right-0 top-2 text-[11px] leading-4 text-accent-text">Learned</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      {chips.length > 0 && <p className="mt-2 text-[12.5px] text-fg-3">Click anything I got wrong. I&rsquo;ll use your version everywhere.</p>}
    </section>
  );
}
