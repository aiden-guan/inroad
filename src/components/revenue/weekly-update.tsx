"use client";

import { ExternalLink, Send } from "lucide-react";
import { useState } from "react";
import { gmailComposeUrl } from "@/components/compose/handoff";
import { RunInline } from "@/components/today/parts";
import { AiBadge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/card";
import { CopyButton, Markdown, Segmented } from "@/components/ui/misc";
import { weekOf } from "@/lib/domain/ids";
import type { GtmUpdate, Workspace } from "@/lib/domain/types";
import { shortDay } from "@/lib/revenue/forecast";

type Audience = GtmUpdate["audience"];

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "ceo", label: "CEO" },
  { value: "board", label: "Board" },
  { value: "team", label: "Team" },
];

/** Markdown tables don't survive a paste into Gmail; the plain-text copy turns them into lines. */
function plain(u: GtmUpdate): string {
  const body = u.body
    .split("\n")
    .filter((l) => !/^\|[-|\s]+\|$/.test(l.trim()))
    .map((l) => (l.trim().startsWith("|") ? l.split("|").map((c) => c.trim()).filter(Boolean).join(" · ") : l))
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1");
  return body;
}

/**
 * The weekly update a Head of GTM sends: numbers from code, the story from the model, one click to copy
 * or open in Gmail. Nothing is sent from here.
 */
export function WeeklyUpdate({ ws, today }: { ws: Workspace; today: string }) {
  const [audience, setAudience] = useState<Audience>("ceo");
  const updates = ws.revenue?.updates ?? [];
  const latest = [...updates].filter((u) => u.audience === audience).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  const current = latest?.weekOf === weekOf(today);
  const gmail = latest ? gmailComposeUrl(ws, { subject: latest.subject, body: plain(latest) }) : null;

  return (
    <section className="mt-12" aria-labelledby="update-label">
      <SectionLabel right={<Segmented value={audience} onChange={setAudience} options={AUDIENCES} layoutId="update-audience" />}>
        <span id="update-label">Weekly update</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
        {latest ? (
          <article className="px-5 pb-5 pt-4 sm:px-7">
            <header className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-3">
              <AiBadge />
              <h3 className="min-w-0 flex-1 text-[14px] font-medium text-fg">{latest.subject}</h3>
              <span className="font-mono text-[11.5px] text-fg-3">Week of {shortDay(latest.weekOf)}</span>
            </header>
            <Markdown className="[&_table]:my-2 [&_table]:max-w-[560px] [&_table]:font-mono [&_table]:text-[12.5px] [&_td]:pr-4">{latest.body}</Markdown>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {gmail && (
                <a
                  href={gmail}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]"
                >
                  <Send className="size-3.5" aria-hidden /> Open in Gmail <ExternalLink className="size-3 opacity-60" aria-hidden />
                </a>
              )}
              <CopyButton text={`${latest.subject}\n\n${plain(latest)}`} label="Copy as text" />
              <CopyButton text={`# ${latest.subject}\n\n${latest.body}`} label="Copy as Markdown" />
              {!current && <span className="text-[12px] text-fg-3">From an earlier week.</span>}
            </div>
          </article>
        ) : (
          <p className="px-5 pt-5 text-[13.5px] leading-[21px] text-fg-2 sm:px-7">
            The update you&apos;d write on Friday afternoon: the number and the call, what changed, the risks with what you&apos;re doing about them, what&apos;s working, and next week&apos;s focus. Every number comes from your deals, not from me.
          </p>
        )}
        {!current && (
          <div className="px-5 pb-5 pt-4 sm:px-7">
            <RunInline workflow="gtm_update" args={{ audience }} label={latest ? "Write this week's update" : `Write the update for the ${audience === "ceo" ? "CEO" : audience}`} hint="About 20 seconds" />
          </div>
        )}
        {current && (
          <div className="border-t border-border bg-bg-subtle/50 px-5 py-3 sm:px-7">
            <RunInline workflow="gtm_update" args={{ audience }} variant="secondary" label="Rewrite it" hint="Uses this minute's numbers" />
          </div>
        )}
      </div>
    </section>
  );
}
