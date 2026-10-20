"use client";

import { useAsk } from "@/components/providers/ask-provider";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { money, plural, shortDate } from "@/lib/client/format";
import { daysBetween } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { championOf, customerRows, dealValue, type ChampionInfo } from "./lib";

const GRID = "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_72px_minmax(0,1fr)]";

/** Won deals and imported paying customers: when they went live, who champions it, and whether you've asked for a referral yet. */
export function Customers({ ws, today, onOpen, onTalking }: { ws: Workspace; today: string; onOpen: (domain: string) => void; onTalking: () => void }) {
  const { openAsk } = useAsk();
  const rows = customerRows(ws);

  if (!rows.length) {
    return (
      <EmptyState
        title="No customers yet."
        body="Your first one is in Talking. Deals land here when you mark them won."
        action={<Button onClick={onTalking}>Go to Talking</Button>}
      />
    );
  }

  const askedReferral = (domain: string, since: string) =>
    ws.activities.some((a) => a.accountDomain === domain && a.at >= since && (a.kind === "intro_requested" || a.sentiment === "referral" || /referr/i.test(a.summary)));

  return (
    <div className="pb-16">
      <div className={cn("hidden h-8 items-center gap-3 border-b border-border px-3 text-[11px] font-medium text-fg-3 md:grid", GRID)}>
        <span>Company</span>
        <span>Customer since</span>
        <span>Champion</span>
        <span>Value</span>
        <span>Referral</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const name = ws.accounts[r.domain]?.name || r.deal?.name || r.domain;
          const wonAt = r.since;
          const live = r.deal?.pilot?.startedOn;
          const days = today ? Math.max(0, daysBetween(wonAt, today)) : 0;
          const named = Object.values(ws.people).find((p) => p.accountDomain === r.domain && p.champion);
          const champ: ChampionInfo = r.deal ? championOf(r.deal, ws) : named ? { name: named.name, status: named.champion ?? "untested" } : { status: "none" };
          const value = r.deal ? dealValue(r.deal) : undefined;
          const asked = askedReferral(r.domain, wonAt);
          return (
            <li key={r.key} className={cn("group relative flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px] transition-colors duration-100 hover:bg-bg-subtle/70 md:grid md:h-12 md:py-0", GRID)}>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
                <Favicon domain={r.domain} name={name} size={20} />
                <button
                  onClick={() => onOpen(r.domain)}
                  className="min-w-0 truncate text-left font-medium text-fg outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                >
                  {name}
                </button>
              </div>
              <span className="text-[12.5px] text-fg-2">
                <span className="font-mono text-[12px]">{shortDate(wonAt)}</span>
                <span className="text-fg-3"> · {days < 1 ? "today" : plural(days, "day")}</span>
                {live && <span className="block text-[11.5px] text-fg-3 md:inline"> · live {shortDate(live)}</span>}
              </span>
              <span className={cn("hidden truncate text-[12.5px] md:block", champ.status === "none" ? "text-fg-4" : "text-fg-2")}>
                {champ.status === "none" ? "No champion named" : champ.name ?? "Named"}
              </span>
              <span className="hidden font-mono text-[12px] tnum text-fg-2 md:block">{value ? money(value) : "—"}</span>
              <div className="relative z-[1] w-full md:w-auto">
                {asked ? (
                  <span className="text-[12.5px] text-fg-3">Asked</span>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="-ml-2"
                    onClick={() =>
                      openAsk({
                        context: { kind: "account", id: r.domain },
                        prefill: `Draft a short referral ask for ${name}: who else they know with the same problem, and a forwardable two-line blurb.`,
                      })
                    }
                  >
                    Ask for a referral
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
