"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import type { PlaySuggestion } from "@/lib/plays/suggest";
import { orList } from "@/lib/plays/recipes";

/** "Plays you might want": three recipes built in code from the workspace, each one click from a dry run. */
export function Suggestions({ suggestions, onPick }: { suggestions: PlaySuggestion[]; onPick: (s: PlaySuggestion) => void }) {
  if (!suggestions.length) return null;
  return (
    <section className="mt-10" aria-labelledby="play-suggestions">
      <SectionLabel right={<span className="text-[12px] text-fg-3">Built from your signals and playbook · no AI used</span>}>
        <span id="play-suggestions">Plays you might want</span>
      </SectionLabel>
      <div className="grid gap-2.5 md:grid-cols-3">
        {suggestions.map((s) => (
          <div key={s.key} className="flex min-w-0 flex-col rounded-xl bg-surface p-4 shadow-sm ring-1 ring-inset ring-border">
            <h3 className="text-[14px] font-medium leading-5 text-fg">{s.name}</h3>
            <p className="mt-1 flex-1 text-[12.5px] leading-5 text-fg-2">{s.why}</p>
            <p className="mt-2 text-[12px] leading-[18px] text-fg-3">
              {s.fires ? (
                <>
                  Fires on <span className="font-mono text-fg-2 tnum">{s.fires}</span> today: {orList(s.companies, "and")}
                  {s.fires > s.companies.length ? ` and ${s.fires - s.companies.length} more` : ""}
                </>
              ) : (
                `Nothing new today; ${s.handled} already handled`
              )}
            </p>
            <Button size="xs" variant="secondary" icon={<FlaskConical className="size-3.5" />} className="mt-3 self-start" onClick={() => onPick(s)}>
              Dry-run it
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
