"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/ui/card";
import { isConsumer } from "@/lib/consumer/market";
import { daysBetween, todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { plural, shortDay } from "@/lib/moves/util";
import { buyerVoice } from "@/lib/voice";
import { RECENT_DAYS } from "@/lib/voice/stats";
import type { VoiceSnippet, VoiceTheme } from "@/lib/voice/types";
import { KIND_LABELS, SourceTag, TrendLabel } from "./parts";

/**
 * "What buyers said this month" for Revenue: the themes raised most in the last 30 days, one quote each with its
 * receipt, and any vendor buyers named that the playbook doesn't know. Self-contained (it counts from the workspace
 * itself) and computed in code; the Playbook's Buyer voice has the rest.
 */

const recentSnippet = (t: VoiceTheme, today: string): VoiceSnippet | undefined => {
  const inWindow = t.snippets.filter((s) => daysBetween(s.date, today) < RECENT_DAYS);
  return inWindow.find((s) => s.verbatim) ?? inWindow[0];
};

const playbookHref = (q: string) => `/playbook?${q}#buyer-themes`;

export function BuyerVoiceCard({ ws }: { ws: Workspace }) {
  const [today] = useState(todayISO);
  const voice = useMemo(() => buyerVoice(ws, today), [ws, today]);
  if (isConsumer(ws) || !voice.summary.quotes) return null;

  const recent = voice.conversations.filter((c) => daysBetween(c.date, today) < RECENT_DAYS);
  const calls = recent.filter((c) => c.kind === "call").length;
  const replies = recent.filter((c) => c.kind === "reply").length;
  const top = voice.themes
    .filter((t) => t.trend.recent > 0)
    .sort((a, b) => b.trend.recent - a.trend.recent || b.calls - a.calls)
    .slice(0, 3);
  const named = voice.alternatives.filter((a) => a.kind === "competitor" && a.snippets.some((s) => daysBetween(s.date, today) < RECENT_DAYS));

  return (
    <section className="mt-12" aria-labelledby="buyer-voice-label">
      <SectionLabel
        right={
          <Link href="/playbook#buyers" className="inline-flex items-center gap-1 rounded-xs text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline">
            All of it in the Playbook <ArrowUpRight className="size-3" />
          </Link>
        }
      >
        <span id="buyer-voice-label">What buyers said this month</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
        <p className="border-b border-border px-4 py-2.5 text-[12.5px] text-fg-3 sm:px-5">
          Last {RECENT_DAYS} days · {calls || replies ? `${plural(calls, "call")}, ${plural(replies, "reply", "replies")}` : "no calls or replies"}
          {voice.summary.lastDate && !recent.length && ` · the last was ${shortDay(voice.summary.lastDate)}`} · counted in code
        </p>
        {top.length === 0 ? (
          <p className="px-4 py-4 text-[13.5px] leading-[21px] text-fg-2 sm:px-5">Nothing new from buyers in the last {RECENT_DAYS} days. Debrief your next call and it shows up here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {top.map((t) => {
              const s = recentSnippet(t, today);
              return (
                <li key={t.key}>
                  <Link href={playbookHref(`theme=${encodeURIComponent(t.key)}`)} className="block px-4 py-3 transition-colors hover:bg-bg-subtle/50 sm:px-5">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[14px] font-medium text-fg [overflow-wrap:anywhere]">{t.label}</span>
                      <span className="text-[12px] text-fg-3">{KIND_LABELS[t.kind]}</span>
                      <span className="font-mono text-[12px] tnum text-fg-2">
                        {t.trend.recent} of {t.trend.recentTotal} recent · {t.trend.before} of {t.trend.beforeTotal} before
                      </span>
                      <TrendLabel trend={t.trend} />
                    </span>
                    {s && (
                      <span className="mt-1.5 flex min-w-0 items-start gap-2">
                        <SourceTag s={s} className="mt-0.5" />
                        <span className={s.verbatim ? "line-clamp-2 min-w-0 font-serif text-[14px] italic leading-[21px] text-fg-2" : "line-clamp-2 min-w-0 text-[13px] leading-5 text-fg-3"}>
                          {s.verbatim ? `“${s.text}”` : s.text}
                          <span className="not-italic font-sans text-[12px] text-fg-3">
                            {" "}
                            {[s.title, s.company].filter(Boolean).join(", ")}
                          </span>
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {named.length > 0 && (
          <p className="border-t border-border px-4 py-2.5 text-[12.5px] leading-5 text-fg-3 sm:px-5">
            Named this month:{" "}
            {named.map((a, i) => (
              <span key={a.key}>
                {i > 0 && ", "}
                <Link href={`/playbook?alt=${encodeURIComponent(a.key)}#buyer-alternatives`} className="text-fg-2 underline-offset-2 hover:text-fg hover:underline">
                  {a.name}
                </Link>
                {!a.inPlaybook && " (not in your playbook)"}
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}
